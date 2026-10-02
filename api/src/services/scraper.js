const fsp = require('fs').promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { redisClient, invalidateGamesList } = require('../utils/cache.js');
const { stripRelease, searchNames, bestSimilarity, normTitle } = require('../utils/title.js');
const { itchGameUrl, parseItchPage } = require('../utils/itch.js');
const { statusOfRow, planNext } = require('../utils/scrapeplan.js');
const { AsyncLocalStorage } = require('async_hooks');

// Поиск данных об игре: обложка, кадры, описание, теги, автор и дата. Источники — открытые:
//   itch.io — страница игры по ссылке (через ScraperAPI: напрямую сервер туда не пускают);
//   VNDB    — открытый API базы визуальных новелл, по ссылке или по названию;
//   Steam   — API магазина, по ссылке или по названию.
// Найденное по названию сверяется с названиями игры: лучше не найти ничего, чем приписать
// игре чужое описание.

// Не латиница: японский, китайский, корейский. Такие названия Steam не ищем — его выдача
// английская, и на иероглифы она отвечает чем попало
const CJK = /[぀-ヿ㐀-鿿ｦ-ﾟ가-힯]/;
// Ссылки, которые автопоиск находит по названию, а не по точной ссылке: их каждый поиск
// находит и сверяет заново (см. lookupInputs и applyLookup)
const BY_TITLE = /store\.steampowered\.com|vndb\.org/i;

// У каждого поиска метаданных свой «протокол»: какие источники не ответили.
// AsyncLocalStorage держит его отдельно для каждого поиска, даже когда фоновый
// воркер и ручная правка ищут одновременно, и не требует протаскивать параметр
// через все функции источников.
const lookupRun = new AsyncLocalStorage();

function noteFailed(label) {
    lookupRun.getStore()?.failed.add(label);
}

// fetch для источников. Отличает «ответили: нет такой игры» от «не смогли спросить»:
// сетевой сбой и таймаут, 403, 429 (лимит), 5xx (сервер лёг).
// global.fetch берём в момент вызова — так его по-прежнему можно подменять в тестах.
async function sourceFetch(url, options) {
    let host = 'источник';
    try { host = new URL(String(url)).hostname.replace(/^www\./, ''); } catch (e) {}
    try {
        const res = await globalThis.fetch(url, options);
        if (res.status === 403 || res.status === 429 || res.status >= 500) noteFailed(host);
        return res;
    } catch (e) {
        noteFailed(host);
        throw e;
    }
}

// Игры с возрастной меткой (хорроры, например) Steam отдаёт только после подтверждения
// возраста. Без этих кук appdetails отвечает success: false, и ветка Steam молча
// возвращает пустоту.
const STEAM_HEADERS = {
    'User-Agent': 'Mozilla/5.0',
    Cookie: 'birthtime=283993201; lastagecheckage=1-0-1979',
};

// Тот же ли автор: «Moon Studio» и «Moon Studio, Marlow Localize», «PIXELBOX» и «Pixelbox»
function sameAuthor(found, authors) {
    return found.some((d) => authors.some((a) => {
        const x = normTitle(d), y = normTitle(a);
        return x && y && (x === y || (Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x))));
    }));
}

// Несколько разных названий, по одному на смысл: «Clockwork Garden» у игры и «Clockwork-Garden»
// у архива — это одно и то же, искать дважды незачем
function distinct(list, n) {
    const out = [];
    for (const x of list) if (out.length < n && !out.some((o) => normTitle(o) === normTitle(x))) out.push(x);
    return out;
}

class ScraperService {
    constructor() {
        this.isBackgroundScraping = false;
        this.io = null;
        this.GAMES_DIR = '';
        this.dbService = null;
    }

    setDependencies(io, gamesDir, dbService) {
        this.io = io;
        this.GAMES_DIR = gamesDir;
        this.dbService = dbService;
    }

    // Попросить поиск для игр прямо сейчас: срок «подошёл», счётчик неудач обнулён.
    // Это и импорт новой игры, и кнопка «Искать сейчас» — очередь как отдельной
    // сущности нет, воркер просто берёт из базы тех, чей срок настал.
    async requestScrape(ids) {
        if (!this.dbService || !ids.length) return 0;
        const marks = ids.map(() => '?').join(',');
        const res = await this.dbService.get().run(
            `UPDATE games SET meta_retry_at = ?, meta_attempts = 0 WHERE id IN (${marks})`,
            [Date.now(), ...ids]
        );
        this.processBackgroundScrape();
        return res?.changes || 0;
    }

    async countDue() {
        const row = await this.dbService.get().get(
            'SELECT COUNT(*) AS n FROM games WHERE ready = 1 AND meta_retry_at IS NOT NULL AND meta_retry_at <= ?',
            [Date.now()]
        ).catch(() => null);
        return row?.n || 0;
    }

    // Старые ключи Redis от прошлой очереди. Разово убираем, чтобы не путали
    async cleanupLegacyQueue() {
        try {
            await redisClient.del(['scrape:queue', 'scrape:queued_set']);
            for await (const key of redisClient.scanIterator({ MATCH: 'scrape:miss:*', COUNT: 200 })) {
                await redisClient.del(key);
            }
        } catch (e) {}
    }

    // В имени папки за номером версии идёт только служебное: разработчик, язык,
    // сайт-источник («…_1.4-Moon_Studio», «…-v1.07-rus__example.site»). cleanTitle
    // срезает хвосты лишь с конца, поэтому здесь обрываем название на самой версии.
    titleFromFolder(folder) {
        const name = stripRelease(folder
            .replace(/[-_]/g, ' ')
            // Точки между словами — тоже пробелы: «Lantern.Keeper.Northern.Isles.KG». В версии
            // («v1.03») точка между цифрами — её не трогаем
            .replace(/(\p{L})\.(?=\p{L})/gu, '$1 ')
            .replace(/\s(?:v(?:er)?\.?\s?\d+(?:\.\d+)*|\d+(?:\.\d+)+)\b.*$/i, '')
            .replace(/\s+/g, ' ')
            .trim());
        return name || folder;
    }

    // Название из readme игры. Японские игры пишут его в первой строке «説明書»:
    // 『Sky Knight ～星の迷宮～』説明書 — полнее, чем о себе говорит сама игра («SkyKnight»).
    // Старые readme — в Shift_JIS
    async readmeTitle(gamePath) {
        const README = /^(?:read[\s_-]?me|説明書|取扱説明書|はじめに|最初に|お読みください|必ずお読みください)[^/]*\.(?:txt|md)$/i;
        for (const dir of [gamePath, path.join(gamePath, 'www')]) {
            let names;
            try { names = await fsp.readdir(dir); } catch (e) { continue; }
            for (const name of names.filter((n) => README.test(n))) {
                try {
                    const buf = (await fsp.readFile(path.join(dir, name))).subarray(0, 4096);
                    let text = new TextDecoder('utf-8').decode(buf);
                    if (text.includes('�')) text = new TextDecoder('shift_jis').decode(buf);
                    const m = text.slice(0, 600).match(/『([^』\n]{2,80})』|「([^」\n]{2,80})」/);
                    const title = (m?.[1] || m?.[2] || '').trim();
                    if (/[\p{L}\p{N}]/u.test(title)) return title;
                } catch (e) {}
            }
        }
        return '';
    }

    // Что искать для игры: сохранённые ссылки и названия — из самой игры, папки и readme
    async lookupInputs(folder) {
        const gamePath = path.join(this.GAMES_DIR, folder);
        const saved = await this.dbService.get().get('SELECT link, meta_locked FROM games WHERE id = ?', [folder]);
        let locked = [];
        try { locked = JSON.parse(saved?.meta_locked || '[]') || []; } catch (e) {}
        // Все известные ссылки, а не только первая: иначе при повторном поиске ссылка, которая
        // в этот раз не нашлась, выпала бы из карточки
        const query = this.searchableLinks(saved?.link, locked.includes('link')).join(' ');

        const folderTitle = this.titleFromFolder(folder);
        let title = folderTitle;
        try {
            const sys = JSON.parse(await fsp.readFile(path.join(gamePath, 'data', 'System.json'), 'utf8'));
            if (sys.gameTitle && !sys.gameTitle.toLowerCase().includes('rmmz')) title = sys.gameTitle;
        } catch (e) {}
        // Имя папки не выбрасываем: оно часто совпадает с названием в магазине лучше,
        // чем название, которое игра пишет о себе сама. Название из readme — тоже
        return { title, query, altTitle: folderTitle, readmeTitle: await this.readmeTitle(gamePath) };
    }

    // Какие из ссылок игры подавать в поиск как точные. Ссылки Steam и VNDB, которые нашёл сам
    // автопоиск, — нет: они найдены по названию, и однажды принятая чужая игра находилась бы
    // снова и снова. Их поиск находит заново — и сверяет. Вписанные руками (manual) идут все
    searchableLinks(link, manual) {
        return String(link || '').split(',').map((x) => x.trim()).filter(Boolean)
            .filter((l) => manual || !BY_TITLE.test(l));
    }

    // Поиск с отчётом: кроме найденного — список источников, которые не ответили.
    // Только так «игры нигде нет» отличается от «Steam упёрся в лимит»: иначе
    // оба случая выглядели бы одинаково и получали одинаковую недельную пометку.
    async lookupMetadata(title, query, { altTitle = '', readmeTitle = '' } = {}) {
        const run = { failed: new Set() };
        const data = await lookupRun.run(run, () => this.fetchUniversalMetadata(title, query, { altTitle, readmeTitle }));
        return { data, failed: [...run.failed] };
    }

    // Записать итог поиска в игру. Одно место и для фоновой очереди, и для ручной
    // правки, с одними правилами: ручная правка при неудаче не стирает теги.
    //   manual       — поля, которые человек только что поменял сам: они главнее
    //                  найденного и дальше защищены от автопоиска
    //   prevAttempts — неудач подряд до этой попытки; ручной поиск передаёт 0
    async applyLookup(folder, { data, failed }, { manual = {}, prevAttempts = 0 } = {}) {
        const db = this.dbService.get();
        const row = await db.get('SELECT * FROM games WHERE id = ?', [folder]);
        if (!row) return null;

        let locked = [];
        try { locked = JSON.parse(row.meta_locked || '[]'); } catch (e) {}
        locked = [...new Set([...locked, ...Object.keys(manual)])];

        const found = !!(data && (data.tags?.length || data.description));
        const fields = {};
        let media = null;
        if (found) {
            if (data.tags?.length) fields.tags = JSON.stringify(data.tags);
            if (data.description) fields.description = data.description;
            // Язык отсюда не берём: магазин знает язык своего издания, а не того, что
            // лежит в папке. Его определяет utils/gamelang.js по тексту самой игры
            for (const key of ['developer', 'releaseDate']) {
                if (!locked.includes(key) && data[key]) fields[key] = data[key];
            }
            // Ссылки, введённые руками, остаются первыми; найденные дописываются следом
            const split = (v) => String(v || '').split(',').map(x => x.trim()).filter(Boolean);
            // Повторный поиск не должен терять то, что уже было известно: источник мог
            // не ответить именно сейчас. Найденное идёт первым, известное — следом
            const discovered = split(data.link);
            if (locked.includes('link')) {
                fields.link = [...new Set([...split(manual.link ?? row.link), ...discovered])].join(',');
            } else if (discovered.length) {
                // Прежняя ссылка Steam или VNDB остаётся, только если магазин сейчас не ответил.
                // Ответил и её не подтвердил — это была чужая игра: «SkyKnight» получала
                // «Sky Knight Quest» из Steam, и ссылка держалась бы в карточке навсегда
                const answered = (l) => !failed.some((host) => l.includes(host.split('.').slice(-2).join('.')));
                const kept = split(row.link).filter((l) => !(BY_TITLE.test(l) && answered(l)));
                fields.link = [...new Set([...discovered, ...kept])].join(',');
            }

            let screensNow = [];
            try { screensNow = JSON.parse(row.screens || '[]') || []; } catch (e) {}
            media = await this.saveGameMedia(folder, data, row.cover, screensNow);
            if (media.cover) fields.cover = media.cover;
            if (media.screens.length) fields.screens = JSON.stringify(media.screens);
        }

        // Итог считаем по тому, что лежит у игры после записи: если поиск ничего
        // не дал, но теги остались с прошлого раза, игра не становится «не найденной»
        const status = statusOfRow({ ...row, ...fields }, failed);
        const plan = planNext(status, prevAttempts);
        Object.assign(fields, {
            meta_status: status,
            meta_attempts: plan.attempts,
            meta_retry_at: plan.retryAt,
            meta_checked_at: Date.now(),
            meta_error: status === 'error' ? failed.join(', ') : '',
            meta_locked: JSON.stringify(locked),
            scraped: 1,
        });

        const keys = Object.keys(fields);
        await db.run(
            `UPDATE games SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`,
            [...keys.map(k => fields[k]), folder]
        );
        await invalidateGamesList();
        // Прежние картинки убираем через минуту: страницы, открытые до поиска, успеют
        // получить новые адреса и не покажут пустые рамки на месте удалённых файлов
        if (media?.stale.length) {
            setTimeout(() => media.stale.forEach((f) => fsp.unlink(f).catch(() => {})), 60 * 1000).unref();
        }
        return { found, status, retryAt: plan.retryAt, failed, row: { ...row, ...fields } };
    }

    // Воркер. Берёт из базы игру, у которой подошёл срок, ищет, записывает итог
    // и срок следующей попытки. Если сервер перезапустят посреди поиска, ничего
    // не потеряется: пока итог не записан, срок у игры по-прежнему «подошёл».
    async processBackgroundScrape() {
        if (this.isBackgroundScraping || !this.dbService) return;
        this.isBackgroundScraping = true;

        try {
            for (;;) {
                const game = await this.dbService.get().get(
                    `SELECT id, meta_attempts FROM games
                     WHERE ready = 1 AND meta_retry_at IS NOT NULL AND meta_retry_at <= ?
                     ORDER BY meta_retry_at LIMIT 1`,
                    [Date.now()]
                );
                if (!game) break;
                const folder = game.id;

                try {
                    console.log(`[Queue] ⏳ Поиск метаданных: ${folder}`);
                    const { title, query, altTitle, readmeTitle } = await this.lookupInputs(folder);
                    const lookup = await this.lookupMetadata(title, query, { altTitle, readmeTitle });
                    const result = await this.applyLookup(folder, lookup, { prevAttempts: game.meta_attempts || 0 });

                    const next = result.retryAt ? new Date(result.retryAt).toISOString().slice(0, 16).replace('T', ' ') : 'не будет';
                    console.log(`[Queue] ${result.found ? '✅' : '⚠️'} ${folder}: ${result.status}` +
                        (result.failed.length ? ` (не ответили: ${result.failed.join(', ')})` : '') +
                        `, следующая попытка: ${next}`);
                    if (result.found && this.io) {
                        this.io.emit('scrape-success', { message: `✅ Данные для "${title}" успешно загружены!` });
                    }
                } catch (e) {
                    // Сбой нашего кода, а не источника. Срок сдвигаем по той же политике,
                    // иначе цикл тут же схватил бы эту игру снова и крутился на ней вечно.
                    console.error(`[Queue] ❌ Ошибка для ${folder}:`, e.message);
                    const plan = planNext('error', game.meta_attempts || 0);
                    await this.dbService.get().run(
                        'UPDATE games SET meta_status = ?, meta_attempts = ?, meta_retry_at = ?, meta_error = ?, meta_checked_at = ? WHERE id = ?',
                        ['error', plan.attempts, plan.retryAt, String(e.message).slice(0, 200), Date.now(), folder]
                    ).catch(() => {});
                    await invalidateGamesList();
                }

                // Показываем ход дела в интерфейсе: сколько игр ещё ждёт
                if (this.io) this.io.emit('scrape-progress', { left: await this.countDue() });

                // Пауза, чтобы не получить бан от источников
                await new Promise(r => setTimeout(r, 4000));
            }
        } finally {
            this.isBackgroundScraping = false;
            if (this.io) this.io.emit('scrape-progress', { left: 0 });
        }
    }

    // Потолок ScraperAPI на день — в кредитах. Цена запроса у ScraperAPI разная: страница
    // itch.io стоит десять кредитов (цену он пишет в заголовке ответа sa-credit-cost). Считать
    // запросы, а не кредиты, нельзя: «30 в день» обошлись бы в 300 кредитов из 1000 в месяц.
    // Число — SCRAPER_DAILY_LIMIT, по умолчанию 30: около 1000 в месяц
    scraperDayKey() {
        return `scraperapi:used:${new Date().toISOString().slice(0, 10)}`;
    }

    async scraperCreditsLeft() {
        const limit = Number(process.env.SCRAPER_DAILY_LIMIT) || 30;
        let used = 0;
        try { used = Number(await redisClient.get(this.scraperDayKey())) || 0; } catch (e) {}
        return limit - used;
    }

    async spendScraperCredits(cost) {
        const key = this.scraperDayKey();
        try {
            if ((await redisClient.incrBy(key, cost)) === cost) await redisClient.expire(key, 2 * 86400);
        } catch (e) {}
    }

    // Запаса нет (kind 'spent') или не хватает на этот запрос ('price'). В лог — раз в день на случай
    scraperLimitReached(kind, message) {
        const day = this.scraperDayKey();
        if (this.scraperWarned?.day !== day) this.scraperWarned = { day, kinds: new Set() };
        if (!this.scraperWarned.kinds.has(kind)) {
            this.scraperWarned.kinds.add(kind);
            console.warn(`[ScraperAPI] ${message}`);
        }
        noteFailed('ScraperAPI (limit)');
        return null;
    }

    // Единая точка выхода через ScraperAPI: он открывает страницы, куда сервер напрямую не
    // пускают. Но запрос стоит кредитов (1000 в месяц), поэтому зовём его, только когда
    // бесплатного пути нет. Ждём ответа не меньше 75 секунд: запрос, оборванный нами раньше 70,
    // ScraperAPI списывает, а ответа мы не получаем
    async fetchViaScraper(url, { timeoutMs = 75000 } = {}) {
        if (!process.env.SCRAPER_API_KEY) return null;
        const left = await this.scraperCreditsLeft();
        if (left <= 0) return this.scraperLimitReached('spent', `Дневной запас (${Number(process.env.SCRAPER_DAILY_LIMIT) || 30} кредитов) исчерпан — до завтра без него`);
        try {
            // max_cost — остаток на сегодня: дороже ScraperAPI запрос не выполнит и ничего не спишет.
            // Так страница за 10 кредитов не уходит, когда осталось 5
            const proxied = `http://api.scraperapi.com?api_key=${process.env.SCRAPER_API_KEY}`
                + `&url=${encodeURIComponent(url)}`
                + `&max_cost=${left}`;
            const res = await globalThis.fetch(proxied, { signal: AbortSignal.timeout(Math.max(timeoutMs, 75000)) });
            // Списывает он удачные ответы (и 404) — по цене из заголовка
            if (res.ok || res.status === 404) await this.spendScraperCredits(Number(res.headers?.get?.('sa-credit-cost')) || 1);
            if (res.status === 403 && /max_cost/i.test(await res.text().catch(() => ''))) {
                return this.scraperLimitReached('price', `Запрос стоит ${res.headers?.get?.('sa-credit-cost') || 'больше'} кредитов, а на сегодня осталось ${left} — такие до завтра не делаем`);
            }
            if (!res.ok) {
                if (res.status === 403 || res.status === 429 || res.status >= 500) noteFailed('api.scraperapi.com');
                return null;
            }
            return await res.text();
        } catch (e) {
            noteFailed('api.scraperapi.com');
            return null;
        }
    }

    // Страница игры на itch.io. Сервер туда напрямую не пускают (Cloudflare просит
    // JavaScript), поэтому только через ScraperAPI. Нет ключа — без itch.io.
    // Разобранное храним неделю: окно новинок и поиск для библиотеки открывают одни и те же игры
    async fetchItchMetadata(rawUrl) {
        const url = itchGameUrl(rawUrl);
        if (!url) return null;
        const key = `itch:page:${url}`;
        try {
            const cached = await redisClient.get(key);
            if (cached) return JSON.parse(cached);
        } catch (e) {}
        if (!process.env.SCRAPER_API_KEY) return null;
        const html = await this.fetchViaScraper(url);
        const data = html ? parseItchPage(html, url) : null;
        // Страница стоит 10 кредитов ScraperAPI — храним неделю: оценка и описание меняются редко
        if (!data) noteFailed('itch.io');
        else await redisClient.set(key, JSON.stringify(data), { EX: 7 * 86400 }).catch(() => {});
        return data;
    }

    // Приводим картинку к обычному JPEG. По ссылке с расширением .jpg источники отдают
    // то AVIF, то WebP, а обложкой бывает анимация на полтора мегабайта —
    // браузер такое либо не покажет, либо покажет мультик вместо обложки.
    // ffmpeg берёт первый кадр и заодно отсеивает битые файлы: что не декодируется,
    // то и не сохраняем.
    async toJpeg(buf) {
        // Исходник кладём во временный файл: через pipe ffmpeg не читает GIF —
        // его демультиплексору нужна перемотка, и картинка молча терялась.
        const tmp = path.join(os.tmpdir(), `rpgimg_${crypto.randomBytes(8).toString('hex')}`);
        try {
            await fsp.writeFile(tmp, buf);
            const out = await new Promise((resolve) => {
                const proc = spawn('ffmpeg', [
                    '-v', 'error', '-i', tmp, '-frames:v', '1',
                    '-vf', "scale='min(1600,iw)':-2", '-q:v', '3', '-f', 'mjpeg', 'pipe:1',
                ]);
                const chunks = [];
                proc.stdout.on('data', (d) => chunks.push(d));
                proc.on('close', () => resolve(chunks.length ? Buffer.concat(chunks) : null));
                proc.on('error', () => resolve(null));
            });
            return out && out.length > 1024 ? out : null;
        } catch (e) {
            return null;
        } finally {
            await fsp.unlink(tmp).catch(() => {});
        }
    }

    // Размер кадра читаем прямо из заголовка JPEG (маркер SOF), без лишнего процесса.
    // Нужен, чтобы отличить настоящий скриншот от превью и от значка.
    jpegSize(buf) {
        for (let i = 2; i + 9 < buf.length;) {
            if (buf[i] !== 0xff) { i += 1; continue; }
            const marker = buf[i + 1];
            if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
            const len = buf.readUInt16BE(i + 2);
            const isSOF = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
            if (isSOF) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
            i += 2 + len;
        }
        return { width: 0, height: 0 };
    }

    // Грубый отпечаток картинки: уменьшаем до 16×16 в оттенках серого и сравниваем
    // каждую точку со средней яркостью. Одна и та же картинка в разных файлах даёт
    // почти одинаковый код, разные — расходятся на сотню бит. ffmpeg у нас уже есть.
    async imageFingerprint(buf) {
        const raw = await new Promise((resolve) => {
            const proc = spawn('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-vf', 'scale=16:16', '-pix_fmt', 'gray', '-f', 'rawvideo', 'pipe:1']);
            const chunks = [];
            proc.stdout.on('data', (d) => chunks.push(d));
            proc.on('close', () => resolve(chunks.length ? Buffer.concat(chunks) : null));
            proc.on('error', () => resolve(null));
            proc.stdin.on('error', () => {});
            proc.stdin.end(buf);
        });
        if (!raw || raw.length < 64) return null;

        const mean = raw.reduce((sum, v) => sum + v, 0) / raw.length;
        return [...raw].map((v) => (v > mean ? 1 : 0));
    }

    // Картинки складываем в отдельную папку _media, а не внутрь игры: папки игр
    // мы не трогаем принципиально, да и на сервере они бывают только для чтения.
    // Имена картинок — по содержимому («cover-3f2a9c1b7e.jpg», «2-9d0e4b77aa.jpg»): с
    // постоянными именами (cover.jpg, 1.jpg…6.jpg) после нового поиска адреса бы не
    // менялись, и браузер показывал бы старые картинки из своего кэша. Сменилась картинка —
    // сменился адрес. Прежние файлы игры, на которые ещё смотрит база, возвращаются в stale:
    // их удалит applyLookup, когда запишет новые адреса
    async saveGameMedia(folder, data, currentCover, currentScreens = []) {
        const result = { cover: null, screens: [], stale: [] };
        const dir = path.join(this.GAMES_DIR, '_media', folder);
        const named = (prefix, buf) => `${prefix}-${crypto.createHash('md5').update(buf).digest('hex').slice(0, 10)}.jpg`;

        try {
            await fsp.mkdir(dir, { recursive: true });
        } catch (e) {
            return result;
        }

        // Скачиваем в память и считаем отпечаток: источники любят отдавать обложку
        // ещё раз первым кадром.
        const seen = new Set();          // точные совпадения по содержимому
        const prints = [];               // отпечатки: ловят одну картинку в разных файлах
        const TOO_CLOSE = 6;             // расстояние, ниже которого считаем картинку повтором

        const remember = async (buf) => {
            const print = await this.imageFingerprint(buf);
            if (!print) return true;     // ffmpeg не справился — не мешаем сохранению
            const duplicate = prints.some((old) => old.reduce((n, v, i) => n + (v !== print[i] ? 1 : 0), 0) <= TOO_CLOSE);
            if (duplicate) return false;
            prints.push(print);
            return true;
        };

        // minWidth отсекает мелочь: превью, значки движка и баннеры. Настоящий кадр из игры
        // всегда шире.
        const grab = async (url, { minWidth = 0 } = {}) => {
            try {
                const res = await fetch(url, {
                    headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'image/*' },
                    signal: AbortSignal.timeout(30000),
                });
                if (!res.ok) return null;
                const raw = Buffer.from(await res.arrayBuffer());
                if (raw.length < 2048 || raw.length > 25 * 1024 * 1024) return null;

                const hash = crypto.createHash('md5').update(raw).digest('hex');
                if (seen.has(hash)) return null;
                seen.add(hash);

                const buf = await this.toJpeg(raw);
                if (!buf) return null;

                const { width, height } = this.jpegSize(buf);
                if (width < minWidth || height < Math.round(minWidth / 2)) return null;

                if (!await remember(buf)) return null;
                return buf;
            } catch (e) {
                return null;
            }
        };

        // Обложка — найденная. Свою загруженную не трогаем никогда.
        const isManual = /cover_custom/i.test(currentCover || '');
        if (!isManual && data.coverUrl) {
            const saved = await grab(data.coverUrl, { minWidth: 300 });
            if (saved) {
                const name = named('cover', saved);
                await fsp.writeFile(path.join(dir, name), saved);
                result.cover = `_media/${folder}/${name}`;
            }
        }

        // Кадры — основные, следом запасные. Повторы одной картинки отсечёт отпечаток в grab
        const shots = [...(data.screens || []), ...(data.spareScreens || [])];

        // Сначала собираем кадры в памяти и только потом переписываем папку: если в
        // этот раз ничего не нашлось, старая галерея останется на месте, а если
        // нашлось меньше прежнего — в папке не останется хвостов от прошлого разбора.
        const picked = [];
        for (const url of shots) {
            if (picked.length >= 6) break;
            // 500 px — граница между превью (400×250) и настоящей картинкой
            const buf = await grab(url, { minWidth: 500 });
            if (buf) picked.push(buf);
        }

        for (let i = 0; i < picked.length; i += 1) {
            const name = named(String(i + 1), picked[i]);
            await fsp.writeFile(path.join(dir, name), picked[i]);
            result.screens.push(`_media/${folder}/${name}`);
        }

        // Уборка найденного прошлыми поисками: обложка «cover.jpg»/«cover-….jpg» и кадры
        // «1.jpg»/«1-….jpg». Своя загруженная обложка (cover_custom_…) сюда не попадает.
        // Не нашлось нового — старое остаётся на месте
        const keep = new Set([result.cover, ...result.screens].filter(Boolean).map((p) => path.basename(p)));
        const inUse = new Set([currentCover, ...currentScreens].filter(Boolean).map((p) => path.basename(String(p))));
        for (const f of await fsp.readdir(dir).catch(() => [])) {
            const isCover = /^cover(?:-[0-9a-f]{10})?\.jpg$/i.test(f);
            const isShot = /^\d+(?:-[0-9a-f]{10})?\.jpg$/i.test(f);
            if (keep.has(f) || !(isCover || isShot)) continue;
            if ((isCover && !result.cover) || (isShot && !result.screens.length)) continue;
            // На прежние файлы ещё ссылаются открытые страницы — их удалим после записи базы
            if (inUse.has(f)) result.stale.push(path.join(dir, f));
            else await fsp.unlink(path.join(dir, f)).catch(() => {});
        }
        return result;
    }

    // VNDB — открытая база визуальных новелл: номер «v123» из ссылки или поиск по названию
    async fetchVNDBMetadata(query, verify = [query]) {
        try {
            const byId = /^v\d+$/.test(query);
            const res = await sourceFetch('https://api.vndb.org/kana/vn', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filters: byId ? ['id', '=', query] : ['search', '=', query], fields: 'title, released, description, image.url, tags.name' }),
            });
            const data = await res.json();
            const vn = data.results?.[0];
            if (!vn) return null;

            if (!byId) {
                // Вхождения мало: игра «Lantern» получила бы описание новеллы «The Lost Lantern».
                // Порог — 0.75, как у Steam
                if (bestSimilarity(vn.title, verify) < 0.75) return null;
                // Вся библиотека — игры на MV и MZ, а MV вышел в конце 2015-го.
                // Новелла старше — однофамилица, а не наша игра
                const year = parseInt(String(vn.released || ''), 10);
                if (year && year < 2015) return null;
            }

            return {
                coverUrl: vn.image ? vn.image.url : null,
                description: (vn.description || '').replace(/\[\/?(b|i|u|url|spoiler|quote)[^\]]*\]/gi, '').trim(),
                tags: vn.tags ? vn.tags.map(t => t.name) : [],
                releaseDate: vn.released ? vn.released.substring(0, 4) : '',
                link: `https://vndb.org/${vn.id}`,
                developer: '',
                language: '',
            };
        } catch (e) {}
        return null;
    }

    // Steam: номер игры из ссылки или поиск по названию. authors — автор игры, каким его знают
    // другие источники: по нему выбираем между одноимёнными играми
    async fetchSteamMetadata(query, verify = [query], authors = []) {
        try {
            const details = async (id) => {
                const detailRes = await sourceFetch(`https://store.steampowered.com/api/appdetails?appids=${id}&cc=US&l=english`, { headers: STEAM_HEADERS });
                const detailData = await detailRes.json();
                // Переизданную игру магазин отдаёт под номером новой страницы: на запрос
                // одного номера ответ приходит с ключом другого. Спрашивали один номер — берём
                // единственный ответ, как бы он ни был подписан
                const detail = detailData?.[id] || Object.values(detailData || {})[0];
                return detail?.success ? detail.data : null;
            };
            let appId = query;
            let game = null;
            if (!/^\d+$/.test(query)) {
                const searchRes = await sourceFetch(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(query)}&l=english&cc=US`, { headers: STEAM_HEADERS });
                const searchData = await searchRes.json();
                // Простого вхождения мало: «Moon» превратилась бы в «Moonlighter».
                // Берём самое похожее из первых пяти
                const scored = (searchData.items || []).slice(0, 5)
                    .map((item) => ({ id: item.id, score: bestSimilarity(item.name, verify) }))
                    .filter((x) => x.score >= 0.75);
                if (!scored.length) return null;
                const top = Math.max(...scored.map((x) => x.score));
                const tied = scored.filter((x) => x.score === top);
                appId = tied[0].id;
                // Одноимённых игр в Steam бывает несколько, у разных авторов. Берём ту, чей
                // разработчик или издатель — автор, известный от других источников.
                // Не совпал ни один — первую
                if (tied.length > 1 && authors.length) {
                    for (const x of tied.slice(0, 3)) {
                        const data = await details(x.id);
                        if (data && sameAuthor([...(data.developers || []), ...(data.publishers || [])], authors)) {
                            appId = x.id;
                            game = data;
                            break;
                        }
                    }
                }
            }

            game = game || await details(appId);
            if (game) {
                const desc = (game.short_description || game.about_the_game || '').replace(/<[^>]*>?/gm, '').trim();

                // Обложка: сначала вертикальная витрина 600×900 — она по форме как
                // остальные обложки в сетке. Широкий баннер шапки оставляем запасным:
                // у карточки он выглядит полоской.
                let coverUrl = game.header_image;
                try {
                    const capsule = `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`;
                    const head = await sourceFetch(capsule, { method: 'HEAD', headers: STEAM_HEADERS, signal: AbortSignal.timeout(10000) });
                    if (head.ok) coverUrl = capsule;
                } catch (e) {}

                return {
                    coverUrl,
                    screens: (game.screenshots || []).slice(0, 6).map(x => x.path_full).filter(Boolean),
                    description: desc,
                    tags: game.genres ? game.genres.map(g => g.description) : [],
                    developer: game.developers ? game.developers.join(', ') : '',
                    releaseDate: game.release_date?.date ? (game.release_date.date.match(/\d{4}/)?.[0] || '') : '',
                    link: `https://store.steampowered.com/app/${appId}`,
                    language: 'Multi',
                };
            }
        } catch (e) {}
        return null;
    }

    // Поиск данных игры по всем источникам сразу. inputQuery — ссылки игры одной строкой:
    // точные (itch.io, номер в Steam, номер новеллы VNDB) идут без угадывания. Названия —
    // из самой игры (title), из имени папки (altTitle) и из readme: игра сама себя часто называет
    // иначе, чем магазин, а папку обычно называют так, как было при скачивании.
    // Порядок: itch.io (только по ссылке: страница стоит кредитов, а по названию легко найти
    // чужую), VNDB, Steam. Кто дал поле первым, того и поле; кадры — от itch.io, без них — от Steam
    async fetchUniversalMetadata(title, inputQuery, { altTitle = '', readmeTitle = '' } = {}) {
        const result = {
            tags: [], description: '', coverUrl: '', screens: [], spareScreens: [],
            developer: '', releaseDate: '', language: '', links: [],
        };
        let foundAny = false;
        const take = (data) => {
            foundAny = true;
            if (data.link) result.links.push(data.link);
            if (!result.tags.length && data.tags?.length) result.tags = data.tags;
            for (const key of ['coverUrl', 'description', 'developer', 'releaseDate', 'language']) {
                result[key] = result[key] || data[key] || '';
            }
        };

        const query = String(inputQuery || '');
        const explicitItch = itchGameUrl(query);
        const explicitSteam = (query.match(/store\.steampowered\.com\/app\/(\d+)/i) || [])[1] || '';
        // Номер новеллы — только из самой ссылки vndb.org: «v1» встречается и в других адресах
        const explicitVndb = ((query.match(/vndb\.org\/(v\d+)/i) || [])[1] || '').toLowerCase();

        // Полные названия идут раньше коротких, и найденное по названию сверяем с полными: игра
        // зовёт себя «SkyKnight», а архив — «SkyKnight_TheCrystalLabyrinth», и без этого Steam
        // отдавал бы ей чужую «Sky Knight Quest» (см. searchNames в utils/title.js)
        const names = searchNames([title, altTitle, readmeTitle]);
        const verify = (q) => (names.verify.length ? names.verify : [q]);

        if (explicitItch) {
            const itch = await this.fetchItchMetadata(explicitItch);
            if (itch) {
                take(itch);
                result.screens = itch.screens || [];
            }
        }

        const vndbQueries = explicitVndb ? [explicitVndb] : distinct(names.search.filter((q) => q.length >= 3), 2);
        for (const q of vndbQueries) {
            const vndb = await this.fetchVNDBMetadata(q, verify(q));
            if (vndb) { take(vndb); break; }
        }

        const latin = names.search.filter((n) => !CJK.test(n) && n.length >= 3);
        const steamQueries = explicitSteam ? [explicitSteam] : distinct(latin, 2);
        const authors = [...new Set(String(result.developer || '').split(/\s*[,/]\s*/).filter(Boolean))];
        for (const q of steamQueries) {
            const steam = await this.fetchSteamMetadata(q, verify(q), authors);
            if (!steam) continue;
            take(steam);
            // Кадры itch.io точные (игра по ссылке), Steam найден по названию — его кадры только
            // запасом, а без кадров itch.io — основными
            if (result.screens.length) result.spareScreens.push(...steam.screens);
            else result.screens = steam.screens;
            break;
        }

        if (!foundAny) return null;
        result.tags = [...new Set(result.tags)];
        result.link = [...new Set(result.links)].join(',');
        return result;
    }
}

module.exports = new ScraperService();

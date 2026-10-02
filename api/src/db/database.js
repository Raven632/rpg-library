const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');
const { statusOfRow, planNext } = require('../utils/scrapeplan.js');
const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const { invalidateGamesList } = require('../utils/cache.js');
const { detectGameLanguages } = require('../utils/gamelang.js');
const { extractVersion } = require('../utils/title.js');
const { SYSTEM_DIRS } = require('../config/index.js');
const galleryService = require('../services/gallery.js');

const exists = async (p) => { try { await fsp.access(p); return true; } catch { return false; } };
// Поля игры, которые человек поменял сам (routes/games.js, «Изменить»): их автоматика не трогает
const lockedFields = (row) => { try { return JSON.parse(row?.meta_locked || '[]') || []; } catch { return []; } };

class DatabaseService {
    constructor() {
        this.db = null;
        this.sessionToken = '';
        this.io = null;
        this.scraperService = null;
        this.GAMES_DIR = '';
        this.textLangRunning = false;
        this.textLangAgain = false;
    }

    setDependencies(io, scraperService, gamesDir) {
        this.io = io;
        this.scraperService = scraperService;
        this.GAMES_DIR = gamesDir;
    }

    async init(gamesDir) {
        this.db = await open({ filename: path.join(gamesDir, 'library.db'), driver: sqlite3.Database });
        
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS games (
                id TEXT PRIMARY KEY, title TEXT, cover TEXT, tags TEXT, description TEXT,
                rating INTEGER DEFAULT 0, lastPlayed INTEGER DEFAULT 0, addedAt INTEGER DEFAULT 0, 
                scraped INTEGER DEFAULT 0, ready INTEGER DEFAULT 0
            )
        `);
        await this.db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)');

        // 1. Пытаемся взять ключ из .env (Правильный путь для production)
        if (process.env.SESSION_SECRET) {
            this.sessionToken = process.env.SESSION_SECRET;
        } else {
            // 2. Иначе — случайный ключ, один раз сгенерированный и сохраненный в БД
            let tokenRow = await this.db.get('SELECT value FROM settings WHERE key = "session_secret"');
            if (!tokenRow) {
                this.sessionToken = crypto.randomBytes(64).toString('hex');
                await this.db.run('INSERT INTO settings (key, value) VALUES (?, ?)', ['session_secret', this.sessionToken]);
            } else {
                this.sessionToken = tokenRow.value;
            }
        }

        try { await this.db.exec('ALTER TABLE games ADD COLUMN developer TEXT DEFAULT ""'); } catch(e){}
        try { await this.db.exec('ALTER TABLE games ADD COLUMN language TEXT DEFAULT ""'); } catch(e){}
        try { await this.db.exec('ALTER TABLE games ADD COLUMN releaseDate TEXT DEFAULT ""'); } catch(e){}
        try { await this.db.exec('ALTER TABLE games ADD COLUMN link TEXT DEFAULT ""'); } catch(e){}
        try { await this.db.exec('ALTER TABLE games ADD COLUMN size INTEGER DEFAULT 0'); } catch(e){}
        try { await this.db.exec('ALTER TABLE games ADD COLUMN version TEXT DEFAULT "1.0.0"'); } catch(e){}
        try { await this.db.exec('ALTER TABLE games ADD COLUMN status TEXT DEFAULT ""'); } catch(e){}
        try { await this.db.exec('ALTER TABLE games ADD COLUMN favorite INTEGER DEFAULT 0'); } catch(e){}
        try { await this.db.exec('ALTER TABLE games ADD COLUMN playtime INTEGER DEFAULT 0'); } catch(e){}
        try { await this.db.exec('ALTER TABLE games ADD COLUMN progress TEXT DEFAULT ""'); } catch(e){}
        try { await this.db.exec('ALTER TABLE games ADD COLUMN screens TEXT DEFAULT ""'); } catch(e){}

        // Состояние поиска метаданных. Раньше «нашли / не нашли» было размазано по
        // трём местам: флаг scraped здесь, пометка «не найдено» и сама очередь в Redis.
        // Теперь всё в одной строке таблицы, и очередь — это просто «чей срок подошёл».
        let metaAdded = false;
        try { await this.db.exec("ALTER TABLE games ADD COLUMN meta_status TEXT DEFAULT 'new'"); metaAdded = true; } catch(e){}
        try { await this.db.exec('ALTER TABLE games ADD COLUMN meta_attempts INTEGER DEFAULT 0'); } catch(e){}
        try { await this.db.exec('ALTER TABLE games ADD COLUMN meta_checked_at INTEGER DEFAULT 0'); } catch(e){}
        try { await this.db.exec('ALTER TABLE games ADD COLUMN meta_retry_at INTEGER'); } catch(e){}
        try { await this.db.exec("ALTER TABLE games ADD COLUMN meta_error TEXT DEFAULT ''"); } catch(e){}
        // Поля, которые человек поправил руками: автопоиск их больше не трогает
        try { await this.db.exec("ALTER TABLE games ADD COLUMN meta_locked TEXT DEFAULT '[]'"); } catch(e){}
        if (metaAdded) await this.migrateMetaStatus();

        // Язык по тексту самой игры (см. utils/gamelang.js). NULL — ещё не считали,
        // пустая строка — посчитали, но текста не нашлось
        let textLangAdded = false;
        try { await this.db.exec('ALTER TABLE games ADD COLUMN text_lang TEXT'); textLangAdded = true; } catch(e){}
        // Поле language раньше заполнял автопоиск: магазин знает язык своего издания (Steam
        // пишет «Multi»), а не того, что лежит в папке. Теперь в нём только ручная правка,
        // найденное на сайтах стираем один раз
        if (textLangAdded) {
            await this.db.run(`UPDATE games SET language = '' WHERE COALESCE(meta_locked, '') NOT LIKE '%"language"%'`);
        }

        // Версия у себя, вписанная руками или узнанная при обновлении игры, когда в названии
        // папки её нет
        try { await this.db.exec("ALTER TABLE games ADD COLUMN my_version TEXT DEFAULT ''"); } catch(e){}

        // Список «Хочу поиграть» (services/wishlist.js). key — «itch:адрес игры»; info — что
        // показывало окно новинок (JSON)
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS wishlist (
                key TEXT PRIMARY KEY, source TEXT NOT NULL, ref TEXT NOT NULL, url TEXT NOT NULL,
                info TEXT NOT NULL DEFAULT '{}', addedAt INTEGER NOT NULL DEFAULT 0
            )
        `);

        console.log('🗄️ [DB] База данных инициализирована.');
        return this.db;
    }

    get() {
        if (!this.db) throw new Error('База данных еще не инициализирована!');
        return this.db;
    }

    // Разовый перенос старого состояния в новые колонки. Игры с тегами, ссылкой и
    // картинками считаются готовыми; «не найденные» получают первую попытку завтра,
    // а не прямо сейчас — иначе обновление запустило бы разом обход всей библиотеки.
    async migrateMetaStatus() {
        const rows = await this.db.all('SELECT id, tags, description, link, screens, scraped FROM games');
        const now = Date.now();
        for (const row of rows) {
            let status = statusOfRow(row);
            let plan = planNext(status, 0, now);
            if (!row.scraped && status === 'not_found') {
                status = 'new';
                plan = { attempts: 0, retryAt: now };
            }
            await this.db.run(
                'UPDATE games SET meta_status = ?, meta_attempts = ?, meta_retry_at = ? WHERE id = ?',
                [status, plan.attempts, plan.retryAt, row.id]
            );
        }
        console.log(`🗄️ [DB] Состояние метаданных перенесено: ${rows.length} игр`);
    }

    // До init() токен пустой — requireAuth в этом случае никого не пускает
    getSessionToken() { return this.sessionToken; }

    // Ключ сессии один на весь сервер, поэтому «выйти» по-настоящему — это сменить
    // его: старая кука перестаёт работать сразу и везде, включая устройство, которое
    // потерялось. Если ключ задан в .env, он там и остаётся: после перезапуска
    // значение всё равно вернётся из конфига, и смена была бы обманом.
    async rotateSessionToken() {
        if (process.env.SESSION_SECRET) return false;
        this.sessionToken = crypto.randomBytes(64).toString('hex');
        await this.db.run(
            'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
            ['session_secret', this.sessionToken]
        );
        return true;
    }

    async addGameToDB(folder, gamePath) {
        let title = folder.replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim() || folder;
        
        try {
            const sysRaw = await fsp.readFile(path.join(gamePath, 'data', 'System.json'), 'utf8');
            const sys = JSON.parse(sysRaw);
            if (sys.gameTitle && !sys.gameTitle.toLowerCase().includes('rmmz')) title = sys.gameTitle;
        } catch(e) {}

        // Обложка — своя картинка игры; найденную в магазине позже положит поиск (saveGameMedia)
        const cover = (await this.ownCover(folder, gamePath)) || (await this.gameImageCover(folder, gamePath));

        const stat = await fsp.stat(gamePath);

        await this.db.run(
            `INSERT OR REPLACE INTO games (id, title, cover, tags, description, rating, lastPlayed, addedAt, scraped, ready)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [folder, title, cover, '[]', '', 0, 0, stat.birthtimeMs || stat.mtimeMs || Date.now(), 0, 1]
        );
        
        // Библиотека изменилась — кэш списка больше не актуален
        await invalidateGamesList();

        if (this.io) this.io.emit('scrape-success', { message: `✅ Игра "${title}" добавлена в библиотеку!` });

        // Новая игра сразу «созрела» для поиска — воркер возьмёт её первой
        this.scraperService.requestScrape([folder]);
        // INSERT OR REPLACE обнулил text_lang — и у новой игры, и у перезалитой поверх
        this.fillTextLang().catch(e => console.error('[Lang]', e.message));
    }

    // Досчитывает язык игр, у которых его ещё нет. Одна игра — доли секунды, но вся
    // библиотека — полминуты чтения карт, поэтому фоном, а не в запросе.
    // Повторный вызов во время прохода не теряется: проход просто повторится
    async fillTextLang() {
        if (this.textLangRunning) { this.textLangAgain = true; return; }
        this.textLangRunning = true;
        try {
            do {
                this.textLangAgain = false;
                const rows = await this.db.all('SELECT id FROM games WHERE text_lang IS NULL AND ready = 1');
                for (const { id } of rows) {
                    const found = await detectGameLanguages(path.join(this.GAMES_DIR, id)).catch(() => null);
                    await this.db.run('UPDATE games SET text_lang = ? WHERE id = ?', [found ? JSON.stringify(found) : '', id]);
                }
                if (rows.length) {
                    console.log(`[Lang] Язык определён: ${rows.length} игр`);
                    await invalidateGamesList();
                }
            } while (this.textLangAgain);
        } finally {
            this.textLangRunning = false;
        }
    }

    // Обложка, которую автор положил в игру: cover.jpg или cover.png
    async ownCover(folder, gamePath) {
        if (await exists(path.join(gamePath, 'cover.jpg'))) return `${folder}/cover.jpg`;
        if (await exists(path.join(gamePath, 'cover.png'))) return `${folder}/cover.png`;
        return null;
    }

    // Запасная обложка из самой игры: первый титульный экран, иначе иконка
    async gameImageCover(folder, gamePath) {
        const titles = await fsp.readdir(path.join(gamePath, 'img', 'titles1')).catch(() => []);
        const image = titles.find((f) => /\.(png|jpg|jpeg)$/i.test(f));
        if (image) return `${folder}/img/titles1/${image}`;
        if (await exists(path.join(gamePath, 'icon', 'icon.png'))) return `${folder}/icon/icon.png`;
        return null;
    }

    // Новая версия игры встала на место старой (services/uploads.js). Запись та же — сохранения,
    // наигранное время, статус и найденные данные при ней. Меняем только то, что берётся из самих
    // файлов: название — как при добавлении игры, из самой игры, если человек не вписывал его сам;
    // свою версию — из имени архива или названия в игре (иначе на карточке осталась бы старая
    // бы: в имени папки осталась старая); обложку из папки игры, если прежней больше нет; язык
    // patch — поверх игры лёг патч или мод (services/uploads.js): игра та же, её название и версию
    // не трогаем, а язык текста считаем заново — английский патч его меняет
    async refreshGame(folder, gamePath, { archiveName = '', backupDir = '', patch = false } = {}) {
        // Картинки игры поменялись — оглавление галереи построится заново
        galleryService.forget(folder).catch(() => {});
        const row = await this.db.get('SELECT title, cover, my_version, meta_locked FROM games WHERE id = ?', [folder]);
        if (!row) return {};
        // Что было до новой версии — рядом с отложенной прежней: «Вернуть прежнюю версию» вернёт и
        // это. Только первый раз: повторный заход после перезапуска сервера видит уже новое
        if (backupDir) {
            const saved = { title: row.title || '', my_version: row.my_version || '', cover: row.cover || '', ...(patch ? { patch: archiveName } : {}) };
            await fsp.writeFile(`${backupDir}.json`, JSON.stringify(saved), { flag: 'wx' }).catch(() => {});
        }
        if (patch) {
            await this.db.run('UPDATE games SET text_lang = NULL WHERE id = ?', [folder]);
            await invalidateGamesList();
            this.fillTextLang().catch((e) => console.error('[Lang]', e.message));
            return {};
        }
        let gameTitle = '';
        try { gameTitle = JSON.parse(await fsp.readFile(path.join(gamePath, 'data', 'System.json'), 'utf8')).gameTitle || ''; } catch (e) {}
        const version = extractVersion('', archiveName.replace(/\.(zip|7z|rar)$/i, '')) || extractVersion(gameTitle, '');
        const fields = { text_lang: null };
        if (version) fields.my_version = version.slice(0, 40);
        if (gameTitle && !gameTitle.toLowerCase().includes('rmmz') && !lockedFields(row).includes('title')) fields.title = gameTitle;
        if (row.cover && row.cover.startsWith(`${folder}/`) && !(await exists(path.join(this.GAMES_DIR, row.cover)))) {
            fields.cover = (await this.ownCover(folder, gamePath)) || (await this.gameImageCover(folder, gamePath));
        }
        const keys = Object.keys(fields);
        await this.db.run(`UPDATE games SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...keys.map((k) => fields[k]), folder]);
        await invalidateGamesList();
        this.fillTextLang().catch((e) => console.error('[Lang]', e.message));
        return { version };
    }

    // Прежняя версия вернулась на место (routes/games.js): своя версия и обложка — как до обновления,
    // язык текста — заново
    async restoreGame(folder, saved = {}) {
        galleryService.forget(folder).catch(() => {});
        const row = await this.db.get('SELECT meta_locked FROM games WHERE id = ?', [folder]);
        const fields = { text_lang: null, my_version: saved.my_version || '' };
        if (saved.cover !== undefined) fields.cover = saved.cover || null;
        // Название, вписанное руками после обновления, главнее прежнего
        if (saved.title && !lockedFields(row).includes('title')) fields.title = saved.title;
        const keys = Object.keys(fields);
        await this.db.run(`UPDATE games SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...keys.map((k) => fields[k]), folder]);
        await invalidateGamesList();
        this.fillTextLang().catch((e) => console.error('[Lang]', e.message));
    }

    async syncDatabase() {
        const entries = await fsp.readdir(this.GAMES_DIR);
        const existingGames = await this.db.all('SELECT id FROM games');
        const dbIds = existingGames.map(g => g.id);

        for (const folder of entries) {
            const gamePath = path.join(this.GAMES_DIR, folder);
            try { 
                const stat = await fsp.stat(gamePath); 
                if (!stat.isDirectory() || SYSTEM_DIRS.includes(folder)) continue;
                if (!dbIds.includes(folder)) await this.addGameToDB(folder, gamePath);
            } catch(e) { continue; }
        }

        for (const id of dbIds) {
            if (!entries.includes(id) || SYSTEM_DIRS.includes(id)) {
                // Папки могло не быть лишь миг — игру меняли на новую версию (services/uploads.js):
                // удаляем запись, только если папки нет и сейчас. Иначе с ней ушло бы всё, что об игре известно
                if (!SYSTEM_DIRS.includes(id) && await exists(path.join(this.GAMES_DIR, id))) continue;
                await this.db.run('DELETE FROM games WHERE id = ?', [id]);
                await invalidateGamesList();
            }
        }
    }
}

module.exports = new DatabaseService();

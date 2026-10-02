const express = require('express');
const compression = require('compression');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const audioService = require('../services/audio.js');
const { findGameFolder } = require('../utils/archive.js');
const { isSafeSegment } = require('../utils/validate.js');
const { GAMES_DIR, SYSTEM_DIRS } = require('../config/index.js');

// Игры — на своём адресе (порт GAME_PORT), отдельно от библиотеки. Код игры — чужой: её скачали с
// форума или с сайта репаков. На адресе библиотеки он работал бы с вашим входом и мог бы позвать
// её API — скачать базу, удалить игры. Так же itch.io запускает игры с отдельного домена. Здесь у
// игры нет ни входа библиотеки, ни её API: только свои файлы и свои сейвы, по ключу в адресе
// (/g/<ключ>/<игра>/…). Ключ — подпись имени игры ключом сессии: выход из библиотеки меняет и его.
// Библиотека открывает игру в рамке на весь экран (frontend GameFrame) и отвечает на её сообщения
// только с этого адреса.
//
// Заодно игре закрыта связь с чужими сайтами (Content-Security-Policy): игры работают без сети, а
// собирать и отправлять куда-то данные ей незачем. Что заблокировано — в журнал ([CSP])

// rev — «ревизия» папки игры (номер папки на диске, revOf): обновление, патч или возврат прежней
// версии кладут на место другую папку, и у файлов игры меняется адрес. Поэтому файлы можно
// кэшировать надолго: старый кэш после обновления просто не пригодится
function gameKey(secret, id, rev = '') {
    return crypto.createHmac('sha256', String(secret)).update(`play\n${id}${rev ? `\n${rev}` : ''}`).digest('hex').slice(0, 32);
}

async function revOf(id) {
    try { return String((await fsp.stat(path.join(GAMES_DIR, id))).ino); } catch { return ''; }
}

function keyMatches(secret, id, key, rev = '') {
    const want = Buffer.from(gameKey(secret, id, rev));
    const got = Buffer.from(String(key || ''));
    return got.length === want.length && crypto.timingSafeEqual(got, want);
}

const CSP = [
    "default-src 'self' data: blob:",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:",
    "style-src 'self' 'unsafe-inline' data: blob:",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "font-src 'self' data: blob:",
    "connect-src 'self' data: blob:",
    "worker-src 'self' data: blob:",
    "frame-src 'self' data: blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    'report-uri /csp-report',
].join('; ');

// Версия rpg-fixes.js для адреса — время изменения файла (проверяем не чаще раза в 10 секунд)
const FIXES = path.join(__dirname, '..', '..', 'public', 'rpg-fixes.js');
let fixesSeen = { at: 0, v: '' };
async function fixesVersion() {
    if (Date.now() - fixesSeen.at > 10e3) {
        const st = await fsp.stat(FIXES).catch(() => null);
        fixesSeen = { at: Date.now(), v: st ? String(Math.round(st.mtimeMs)) : String(Date.now()) };
    }
    return fixesSeen.v;
}

// Содержимое папок для подбора регистра — на минуту: игра просит сотни файлов из одних и тех же папок
const dirCache = new Map();
async function listDir(dir) {
    const hit = dirCache.get(dir);
    if (hit && Date.now() - hit.at < 60e3) return hit.names;
    let names = null;
    try { names = await fsp.readdir(dir); } catch { names = null; }
    if (dirCache.size > 2000) dirCache.clear();
    dirCache.set(dir, { names, at: Date.now() });
    return names;
}

// Путь rel внутри root с подобранным регистром каждой части: «audio/se/Cursor2.ogg» → «Audio/se/Cursor2.ogg».
// Не нашлась часть — дальше как есть (файла нет, ответит 404)
async function fixCase(root, rel) {
    let cur = root;
    const parts = String(rel).split(/[\\/]+/).filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
        const exact = path.join(cur, parts[i]);
        if (fs.existsSync(exact)) { cur = exact; continue; }
        const low = parts[i].toLowerCase();
        const match = (await listDir(cur))?.find((n) => n.toLowerCase() === low);
        if (!match) return path.join(cur, ...parts.slice(i));
        cur = path.join(cur, match);
    }
    return cur;
}

// Путь внутри GAMES_DIR → адрес для перехода, с приставкой (/g/<ключ> или пусто)
const toUrl = (prefix, rel) => `${prefix}/${rel.split(/[\\/]/).map(encodeURIComponent).join('/')}`;

// Отдать файл игры. rel — путь от GAMES_DIR («Игра/www/js/main.js»), prefix — приставка адреса для
// переходов, inject — что вставить в index.html перед rpg-fixes.js (window.__RPG)
// cache — адрес файла меняется вместе с папкой игры (сервер игр, gameKey с rev): файлы можно держать
// в кэше браузера год и не переспрашивать. Без этого каждый запуск — сотни проверок «не изменился ли»
async function serveGameFile(req, res, next, { rel, prefix, inject, cache = false }) {
    const LONG = 'private, max-age=31536000, immutable';
    let reqPath = rel;
    let filePath = path.join(GAMES_DIR, reqPath);

    // 1. Защита от выхода за пределы папки (Path Traversal)
    const normalizedGamesDir = path.resolve(GAMES_DIR);
    const normalizedFilePath = path.resolve(filePath);
    if (normalizedFilePath !== normalizedGamesDir && !normalizedFilePath.startsWith(normalizedGamesDir + path.sep)) {
        return res.status(403).send('Доступ запрещен');
    }

    try {
        // 2. Регистр букв в пути: игры собирают под Windows, где «Audio» и «audio» — одна папка, а
        //    движок просит «audio/se/…», «fonts/…». Подбираем каждую часть пути, не только имя файла:
        //    иначе у игры с папками «Audio», «Fonts» не было ни звуков, ни шрифта, и она вставала
        if (!fs.existsSync(filePath)) {
            const fixed = await fixCase(GAMES_DIR, reqPath);
            if (fixed !== filePath && path.resolve(fixed).startsWith(normalizedGamesDir + path.sep)) {
                filePath = fixed;
                reqPath = path.relative(GAMES_DIR, filePath);
            }
        }

        let stat;
        try { stat = await fsp.stat(filePath); } catch(e) {}

        // 3. Если запрошена директория - ищем исполняемый файл (index.html)
        if (stat && stat.isDirectory()) {
            // Строку запроса при переходе в папку игры не теряем: в ней язык меню (?lang=), адрес
            // библиотеки (?lib=) и отладочные ?fps, ?dev
            const query = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
            if (!req.path.endsWith('/')) return res.redirect(req.path + '/' + query);

            if (fs.existsSync(path.join(filePath, 'index.html'))) {
                filePath = path.join(filePath, 'index.html');
            } else if (fs.existsSync(path.join(filePath, 'www', 'index.html'))) {
                return res.redirect(req.path + 'www/' + query);
            } else {
                const deepDir = await findGameFolder(filePath);
                if (deepDir) return res.redirect(toUrl(prefix, path.relative(GAMES_DIR, deepDir)) + '/' + query);
                return res.status(404).send(`<div style="color:red; text-align:center; padding:50px;">index.html не найден.</div>`);
            }
        }

        // 4. Звук: отдаём тот формат, который попросили
        // Формат выбирает браузер: rpg-fixes проверяет, умеет ли он Ogg. .ogg — всегда
        // настоящий Ogg (MZ на старых iOS разбирает его своим декодером). .m4a просит только
        // браузер без Ogg — если готового m4a в игре нет, перекодируем (FFmpeg, с кэшем).
        const ext = path.extname(filePath).toLowerCase();
        if (ext === '.m4a' || ext === '.ogg') {
            const base = filePath.slice(0, -4);
            // Для m4a первыми — готовые (.rpgmvm — тот же m4a, зашифрованный): их не надо перекодировать
            const pathsToTry = ext === '.m4a'
                ? [filePath, base + '.rpgmvm', base + '.ogg', base + '.rpgmvo']
                : [filePath, base + '.m4a', filePath + '_', base + '.rpgmvm', base + '.rpgmvo'];

            let sourcePath = null;
            for (const p of pathsToTry) {
                try { await fsp.access(p); sourcePath = p; break; } catch {}
            }
            // Папка игры — та, где лежит audio/: в ней data/System.json с ключом шифрования.
            // Так находится и игра в www/, и во вложенной папке
            const parts = sourcePath ? path.relative(GAMES_DIR, sourcePath).split(path.sep) : [];
            const audioAt = parts.indexOf('audio');
            const gameRoot = path.join(GAMES_DIR, ...(audioAt > 0 ? parts.slice(0, audioAt) : parts.slice(0, 1)));

            if (sourcePath && sourcePath !== filePath && ext === '.m4a') {
                try {
                    const readyPath = await audioService.ensureM4aFromSource(sourcePath, gameRoot);
                    res.type('audio/mp4');
                    res.setHeader('Cache-Control', cache ? LONG : 'public, max-age=86400');
                    return res.sendFile(readyPath, { cacheControl: false });
                } catch (err) { filePath = sourcePath; }
            } else if (sourcePath && sourcePath !== filePath && /\.(rpgmvo|rpgmvm|ogg_)$/i.test(sourcePath)) {
                // Просили обычный .ogg, а в игре только зашифрованный — отдаём расшифрованным
                try {
                    const data = await audioService.decryptRpgmvo(sourcePath, gameRoot);
                    res.type(sourcePath.endsWith('.rpgmvm') ? 'audio/mp4' : 'audio/ogg');
                    res.setHeader('Cache-Control', cache ? LONG : 'public, max-age=86400');
                    return res.send(data);
                } catch (err) { filePath = sourcePath; }
            } else if (sourcePath) {
                filePath = sourcePath;
            }
        }

        // Ролики: в сборках для Windows они только .webm, а MV на телефоне просит .mp4.
        // Если файла в нужном формате нет, отдаём другой: браузер разберёт его по содержимому
        if (ext === '.webm' || ext === '.mp4') {
            try { await fsp.access(filePath); } catch {
                const other = filePath.slice(0, -ext.length) + (ext === '.webm' ? '.mp4' : '.webm');
                try { await fsp.access(other); filePath = other; } catch {}
            }
        }

        // 5. Инъекция патчей в HTML и JS файлы игр
        let finalStat;
        try { finalStat = await fsp.stat(filePath); } catch(e) {}

        if (finalStat && finalStat.isFile()) {
            // index.html: убираем CSP самой игры и вставляем наш скрипт-эмулятор rpg-fixes.js,
            // а перед ним — что игре знать о себе (window.__RPG)
            if (filePath.endsWith('index.html')) {
                let html = await fsp.readFile(filePath, 'utf8');
                html = html.replace(/<meta[^>]+http-equiv=['"]?Content-Security-Policy['"]?[^>]*>/gi, '');
                const config = inject ? `<script>window.__RPG=${JSON.stringify(inject).replace(/</g, '\\u003c')}</script>` : '';
                // Версия rpg-fixes — время его файла: новый выкачается, прежний берётся из кэша
                html = html.replace(/(<body[^>]*>)/i, `$1${config}<script src="/rpg-fixes.js?v=${await fixesVersion()}"></script>`);
                res.setHeader('Content-Type', 'text/html');
                res.setHeader('Cache-Control', 'no-store');
                return res.send(html);
            }

            // JS плагины: заменяем import.meta для обхода ошибок Webpack
            if (filePath.endsWith('.js') && finalStat.size < 5 * 1024 * 1024) {
                let jsContent = await fsp.readFile(filePath, 'utf8');
                if (jsContent.includes('import.meta')) {
                    jsContent = jsContent.replace(/\bimport\.meta\b/g, "window.__import_meta");
                    res.setHeader('Content-Type', 'application/javascript');
                    if (cache) res.setHeader('Cache-Control', LONG);
                    return res.send(jsContent);
                }
            }

            if (cache) {
                res.setHeader('Cache-Control', LONG);
                return res.sendFile(filePath, { cacheControl: false });
            }
            return res.sendFile(filePath);
        }
    } catch(e) {
        // Ошибки ФС просто прокидываем дальше (к 404)
    }

    // === ПРОПАВШИЕ ФАЙЛЫ И ШРИФТЫ (404) ===
    const reqExt = path.extname(reqPath).toLowerCase();
    // 1. Сейвы и конфиги -> отдаем пустой объект, чтобы не ломать плагины
    if (['.json', '.rpgsave', '.rmmzsave'].includes(reqExt)) {
        res.setHeader('Content-Type', 'application/json');
        return res.status(404).send('{}');
    }
    // 2. Стили (шрифты) -> отдаем пустой CSS, чтобы браузер не ругался на MIME type
    if (reqExt === '.css') {
        res.setHeader('Content-Type', 'text/css');
        return res.status(404).send('');
    }
    // 3. Остальные файлы (картинки, аудио, шрифты) -> просто отдаем пустоту
    if (['.js', '.png', '.jpg', '.m4a', '.ogg', '.ttf', '.woff', '.woff2'].includes(reqExt)) {
        return res.status(404).send('');
    }
    next();
}

// Путь запроса без приставки → путь от GAMES_DIR. Битая %-кодировка — null
function relFrom(urlPath) {
    try { return decodeURIComponent(urlPath).replace(/^\/+/, ''); } catch { return null; }
}

const isGameId = (id) => isSafeSegment(id) && !id.startsWith('.') && !SYSTEM_DIRS.includes(id);

// Сервер игр. secret() — нынешний ключ сессии, store — сейвы (utils/savestore.js),
// onSaved(id, key) — после записи слота (прогресс игры), publicDir — где rpg-fixes.js и чит-меню
// onError(id, отчёт, User-Agent) — ошибка в игре (services/gameErrors.js)
function createGameApp({ secret, store, onSaved = () => {}, onError = async () => {}, publicDir }) {
    const app = express();
    app.disable('x-powered-by');
    app.use(compression());
    app.use((req, res, next) => {
        res.setHeader('Content-Security-Policy', CSP);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Referrer-Policy', 'no-referrer');
        next();
    });

    // Наши скрипты для игр — открыты: в них ничего своего
    // rpg-fixes.js с версией в адресе (?v=) — надолго, чит-меню — на сутки
    for (const file of ['rpg-fixes.js', 'Cheat_Menu.js', 'Cheat_Menu.css']) {
        app.get(`/${file}`, (req, res) => res.sendFile(path.join(publicDir, file), req.query.v ? { maxAge: '365d', immutable: true } : { maxAge: '1d' }));
    }

    // Что заблокировал запрет на чужие сайты. Одно и то же — не чаще раза в час
    const reported = new Map();
    app.post('/csp-report', express.json({ type: ['application/csp-report', 'application/json', 'application/reports+json'], limit: '16kb' }), (req, res) => {
        const r = req.body?.['csp-report'] || req.body?.[0]?.body || req.body || {};
        const game = relFrom(new URL(r['document-uri'] || r.documentURL || 'http://x/', 'http://x').pathname)?.split('/')[2] || '?';
        const what = `${r['violated-directive'] || r.effectiveDirective || '?'} ${r['blocked-uri'] || r.blockedURL || '?'}`;
        const key = `${game}\n${what}`;
        if (!reported.has(key) || Date.now() - reported.get(key) > 3600e3) {
            if (reported.size > 500) reported.clear();
            reported.set(key, Date.now());
            console.log(`[CSP] ${game}: заблокировано ${what}`);
        }
        res.status(204).end();
    });

    // Ключ из адреса: подходит к этой игре — дальше, нет — 403
    const checkKey = async (req, res, next) => {
        const { key, game } = req.params;
        if (!isGameId(game) || !keyMatches(secret(), game, key, await revOf(game))) return res.status(403).send('Нет доступа');
        next();
    };

    // Сейвы — только этой игры
    app.get('/saves/:key/:game', checkKey, async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.json(await store.list(req.params.game));
    });
    app.post('/saves/:key/:game/:slot', checkKey, express.json({ limit: '50mb' }), async (req, res) => {
        if (typeof req.body?.value !== 'string') return res.status(400).json({ error: 'Bad data' });
        try {
            const slot = path.basename(req.params.slot);
            const result = await store.write(req.params.game, slot, req.body.value, req.body.updatedAt);
            res.json(result === 'older' ? { success: true, kept: 'server' } : { success: true });
            if (result === 'older') console.log(`[Saves] ${req.params.game}: «${slot}» на сервере новее — присланный сейв ушёл в историю`);
            if (result === 'saved') onSaved(req.params.game, slot);
        } catch (e) {
            res.status(500).json({ error: 'Server error' });
        }
    });
    app.delete('/saves/:key/:game/:slot', checkKey, async (req, res) => {
        try { await store.remove(req.params.game, path.basename(req.params.slot)); } catch (e) {}
        res.json({ success: true });
    });

    // Ошибки игры с устройства — в журнал для «Ревизии»
    app.post('/errors/:key/:game', checkKey, express.json({ limit: '64kb' }), async (req, res) => {
        try { await onError(req.params.game, req.body || {}, req.get('user-agent') || ''); } catch (e) {}
        res.status(204).end();
    });

    // Файлы игры: /g/<ключ>/<игра>/<путь>
    app.get(['/g/:key/:game', '/g/:key/:game/*'], checkKey, (req, res, next) => {
        const prefix = `/g/${req.params.key}`;
        const rel = relFrom(req.path.slice(prefix.length));
        if (rel === null) return res.status(400).send('Непонятный адрес');
        const inject = { id: req.params.game, saves: `/saves/${req.params.key}`, errors: `/errors/${req.params.key}`, framed: true };
        return serveGameFile(req, res, next, { rel, prefix, inject, cache: true });
    });

    app.use((req, res) => res.status(404).send(''));
    return app;
}

module.exports = { createGameApp, serveGameFile, gameKey, keyMatches, revOf, relFrom, isGameId, fixCase, CSP };

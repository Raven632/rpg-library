// ============================================================================
// [1] ИМПОРТЫ И КОНФИГУРАЦИЯ
// ============================================================================
require('dotenv').config();

// Встроенные модули Node.js
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const util = require('util');
const http = require('http');
const execFilePromise = util.promisify(require('child_process').execFile);

// Сторонние библиотеки (NPM)
const express = require('express');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const { Server } = require('socket.io');
const { setIo, redisClient, invalidateGamesList } = require('./src/utils/cache.js');

// Локальные сервисы и утилиты
const dbService = require('./src/db/database.js');
const scraperService = require('./src/services/scraper.js');
const audioService = require('./src/services/audio.js');
const itchService = require('./src/services/itch.js');
const wishlistService = require('./src/services/wishlist.js');
const uploadService = require('./src/services/uploads.js');
const telegramService = require('./src/services/telegram.js');
const gameErrors = require('./src/services/gameErrors.js');
const galleryService = require('./src/services/gallery.js');
const { thumbnail } = require('./src/utils/thumbs.js');
const { authRouter, requireAuth, isAuthedSocket } = require('./src/routes/auth.js');
const gamesRouter = require('./src/routes/games.js');
const createUploadsRouter = require('./src/routes/uploads.js');
const backupRouter = require('./src/routes/backup.js');
const createSavesRouter = require('./src/routes/saves.js');
const itchRouter = require('./src/routes/itch.js');
const wishlistRouter = require('./src/routes/wishlist.js');
const createTelegramRouter = require('./src/routes/telegram.js');
const { createGameApp, serveGameFile, gameKey, revOf, relFrom, isGameId } = require('./src/routes/play.js');
const { findGameFolder, getFolderSize } = require('./src/utils/archive.js');
const { GAMES_DIR, EXTRACT_TMP, SAVES_DIR, AUDIOCACHE, OLD_DIR, SYSTEM_DIRS } = require('./src/config/index.js');
const { backfillProgress, updateProgress } = require('./src/utils/saveprogress.js');

// ============================================================================
// [2] ИНИЦИАЛИЗАЦИЯ ПРИЛОЖЕНИЯ И ЗАВИСИМОСТЕЙ
// ============================================================================
const app = express();
const server = http.createServer(app);
// CORS к веб-сокетам браузером не применяется, поэтому пускаем по той же куке,
// что и обычные запросы: чужая страница и сторонний скрипт получат 403.
const io = new Server(server, {
    allowRequest: (req, done) => done(null, isAuthedSocket(req) && fromLibraryOnly(req.headers)),
});

// Запросы к API и сокету — только со страниц самой библиотеки. Браузер помечает, откуда запрос
// (Sec-Fetch-Site): с сервера игр (тот же хост, другой порт) — same-site, с чужого сайта — cross-site.
// Старый браузер без пометки: смотрим Origin — с порта игр не пускаем. Без обоих заголовков — не
// браузер (проверка совместимости, curl): у него есть вход, но нет чужого кода
function fromLibraryOnly(headers) {
    const site = headers['sec-fetch-site'];
    if (site && site !== 'same-origin' && site !== 'none') return false;
    const origin = headers.origin;
    if (origin && ISOLATED) {
        try { if (new URL(origin).port === GAME_PORT) return false; } catch (e) { return false; }
    }
    return true;
}

// Внедрение зависимостей в сервисы
scraperService.setDependencies(io, GAMES_DIR, dbService);
dbService.setDependencies(io, scraperService, GAMES_DIR);
itchService.setDependencies(dbService);
wishlistService.setDependencies(dbService, { itch: itchService });
uploadService.setDependencies({
    dir: EXTRACT_TMP,
    gamesDir: GAMES_DIR,
    oldDir: OLD_DIR,
    addGameToDB: dbService.addGameToDB.bind(dbService),
    refreshGame: dbService.refreshGame.bind(dbService),
    findGameFolder,
    // Размер новой игры — в фоне: у большой du считает минуту
    afterAdd: (folder, dest) => getFolderSize(dest)
        .then((size) => size && dbService.get().run('UPDATE games SET size = ? WHERE id = ?', [size, folder]))
        .then(() => invalidateGamesList())
        .catch((e) => console.error('[Upload] Размер игры:', e.message)),
});
// Сообщения в Telegram: новости сводкой, загрузки без присмотра, копия базы и сейвов, проблемы
telegramService.setDependencies({ db: dbService, buildBackup: backupRouter.buildBackup, tmpDir: EXTRACT_TMP, gamesDir: GAMES_DIR, savesDir: SAVES_DIR });
uploadService.onFinished = (info) => telegramService.uploadFinished(info);
gameErrors.setDependencies(dbService);
galleryService.setDependencies({ gamesDir: GAMES_DIR });
setIo(io);

// ============================================================================
// [3] ГЛОБАЛЬНЫЕ MIDDLEWARE И НАСТРОЙКА ПАПОК
// ============================================================================
app.use(compression());
// Тело JSON у нас обычно в несколько килобайт (метаданные, форма входа), и 1 МБ
// хватает с запасом: 50 МБ позволяли любому неавторизованному клиенту занимать
// память сервера. Исключение — сейвы: у больших игр один слот весит больше мегабайта
// (бывает и 1,1 МБ), и с общим лимитом сервер отвечал 413 — сохранение
// оставалось только в браузере. Их разбирает сам роут сохранений с лимитом побольше
// и уже после проверки входа (routes/saves.js)
const smallJson = express.json({ limit: '1mb' });
app.use((req, res, next) => (
    req.method === 'POST' && req.path.startsWith('/api/saves/') ? next() : smallJson(req, res, next)
));
app.use(cookieParser());
// Отключаем строгие политики Helmet, чтобы игры в iframe (Cross-Origin) работали корректно
app.use(helmet({ 
    contentSecurityPolicy: false, 
    crossOriginEmbedderPolicy: false, 
    crossOriginOpenerPolicy: false, 
    originAgentCluster: false 
}));

// Лимитер запросов для API
// Куски загрузки игры сюда не входят: по 20 МБ в быстрой сети их за минуту больше двухсот,
// и загрузка упиралась бы в 429. У них свой лимит (routes/uploads.js), после проверки входа
const apiLimiter = rateLimit({ 
    windowMs: 60 * 1000, 
    max: 200, 
    message: { error: 'Слишком много запросов' },
    // Картинки галереи (services/gallery.js) — десятки на экран сразу: лимит они выбрали бы за минуту
    skip: (req) => req.path.startsWith('/games/upload/') || /^\/gallery\/[^/]+\/(thumb|image)$/.test(req.path),
});
app.use('/api/', apiLimiter);
app.use('/api/', (req, res, next) => (fromLibraryOnly(req.headers) ? next() : res.status(403).json({ error: 'Запрос не со страницы библиотеки' })));

// Создание системных директорий при старте
Promise.all([
    fsp.mkdir(EXTRACT_TMP, { recursive: true }),
    fsp.mkdir(SAVES_DIR, { recursive: true }),
    fsp.mkdir(AUDIOCACHE, { recursive: true })
]).catch(err => console.error('[Init] Ошибка создания системных папок:', err));


// ============================================================================
// [4] ФОНОВЫЕ ЗАДАЧИ (КРОН)
// ============================================================================

// Авто-очистка временной папки загрузок (каждый час)
setInterval(async () => {
    try {
        const files = await fsp.readdir(EXTRACT_TMP);
        const now = Date.now();
        for (const file of files) {
            const filePath = path.join(EXTRACT_TMP, file);
            const stat = await fsp.stat(filePath);
            
            // Удаляем файлы и папки старше 24 часов (86400000 мс)
            if (now - stat.mtimeMs > 86400000) { 
                await fsp.rm(filePath, { recursive: true, force: true }).catch(()=>{});
                console.log(`[Cleanup] Удален старый временный файл: ${file}`);
            }
        }
    } catch (e) {
        console.error('[Cleanup] Ошибка очистки:', e.message);
    }
}, 60 * 60 * 1000);


// ============================================================================
// [5] API РОУТЫ (ОТКРЫТЫЕ И ЗАКРЫТЫЕ)
// ============================================================================

// --- ОТКРЫТЫЕ API ---
app.use('/api', authRouter); // Логин, логаут, проверка статуса настройки

// --- ЗАМОК АВТОРИЗАЦИИ ---
app.use('/api', requireAuth); // Все роуты ниже этой строки требуют куки `auth_token`

// --- ЗАКРЫТЫЕ API ---
app.use('/api/games/upload', createUploadsRouter(uploadService));
app.use('/api/backup', backupRouter);
app.use('/api/games', gamesRouter);
app.use('/api/saves', createSavesRouter(EXTRACT_TMP));
app.use('/api/itch', itchRouter);
app.use('/api/wishlist', wishlistRouter);
app.use('/api/telegram', createTelegramRouter(telegramService));

// Журнал ошибок игр (services/gameErrors.js): прислать — игра по-старому, на адресе библиотеки
// (на своём адресе она шлёт серверу игр); прочитать и очистить — «Ревизия»
app.post('/api/errors/:id', async (req, res) => {
    if (isGameId(req.params.id)) await gameErrors.record(req.params.id, req.body || {}, req.get('user-agent') || '').catch(() => {});
    res.status(204).end();
});
// Галерея из файлов игры (services/gallery.js): оглавление, миниатюра, картинка целиком
app.get('/api/gallery/:id', async (req, res) => {
    if (!isGameId(req.params.id) || !fs.existsSync(path.join(GAMES_DIR, req.params.id))) return res.status(404).json({ error: 'Игра не найдена' });
    try { res.json(await galleryService.state(req.params.id)); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/gallery/:id/thumb', async (req, res) => {
    try {
        const file = isGameId(req.params.id) && await galleryService.thumb(req.params.id, req.query.f);
        if (!file) return res.status(404).end();
        res.setHeader('Cache-Control', 'private, max-age=604800');
        res.sendFile(file);
    } catch (e) { res.status(500).end(); }
});
app.get('/api/gallery/:id/image', async (req, res) => {
    try {
        const img = isGameId(req.params.id) && await galleryService.image(req.params.id, req.query.f);
        if (!img) return res.status(404).end();
        res.setHeader('Content-Type', img.type);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'private, max-age=86400');
        res.send(img.data);
    } catch (e) { res.status(500).end(); }
});
app.get('/api/errors', async (req, res) => {
    try { res.json({ games: await gameErrors.list() }); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/errors/:id', async (req, res) => {
    await gameErrors.clear(req.params.id).catch(() => {});
    res.json({ success: true });
});

// Место на диске для шапки. du по всей папке игр — десятки секунд на большой библиотеке, поэтому
// считаем его фоном раз в час, а отвечаем сразу: до первого подсчёта — размером игр из базы
let cachedStorage = null;
let storageRunning = false;
const STORAGE_TTL = 60 * 60 * 1000;
async function refreshStorage() {
    if (storageRunning) return;
    storageRunning = true;
    try {
        const { stdout } = await execFilePromise('nice', ['-n', '19', 'du', '-sb', GAMES_DIR]);
        const stats = await fsp.statfs(GAMES_DIR);
        cachedStorage = { used: parseInt(stdout.split('\t')[0], 10), free: stats.bavail * stats.bsize, at: Date.now() };
    } catch (error) {
        console.error('[Storage] Ошибка чтения диска:', error.message);
    } finally {
        storageRunning = false;
    }
}

app.get('/api/storage', async (req, res) => {
    try {
        if (!cachedStorage || Date.now() - cachedStorage.at > STORAGE_TTL) refreshStorage();
        const stats = await fsp.statfs(GAMES_DIR);
        const free = stats.bavail * stats.bsize;
        const used = cachedStorage?.used ?? ((await dbService.get().get('SELECT SUM(size) AS s FROM games'))?.s || 0);
        res.json({ used, free });
    } catch (error) {
        console.error('[Storage] Ошибка чтения диска:', error);
        res.status(500).json({ error: 'Failed to read storage' });
    }
});


// ============================================================================
// [6] РАЗДАЧА СТАТИКИ И ПРОКСИ ИГР (ЯДРО ПЛАТФОРМЫ)
// ============================================================================

// Раздача фронтенда (React сборка в папке public)
// Файлы сборки (assets/…-хеш.js) меняют имя вместе с содержимым — их держим в кэше год; страницу
// index.html браузер переспрашивает всегда, иначе после выкатки он показывал бы прежнюю версию
app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, file) => {
        if (/[\\/]assets[\\/]/.test(file)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        else if (file.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    },
}));

// Игры — на своём адресе (routes/play.js): порт GAME_PORT, по умолчанию 8081. GAME_ISOLATION=off —
// по-старому, на адресе библиотеки (на случай, если на каком-то устройстве игры в рамке не пойдут)
const GAME_PORT = String(process.env.GAME_PORT || '8081').trim();
const ISOLATED = process.env.GAME_ISOLATION !== 'off';
// Полный адрес сервера игр, если он не «тот же адрес, другой порт» (dev за прокси)
const GAME_ORIGIN = (process.env.GAME_ORIGIN || '').replace(/\/+$/, '');

// Старт игры: адрес для страницы. В рамке — сервер игр с ключом этой игры, по-старому — папка игры
app.post('/api/play/:id', async (req, res) => {
    const id = req.params.id;
    if (!isGameId(id) || !(await fsp.stat(path.join(GAMES_DIR, id)).then((st) => st.isDirectory(), () => false))) {
        return res.status(404).json({ error: 'Игра не найдена' });
    }
    if (!ISOLATED) return res.json({ mode: 'page', path: `/${encodeURIComponent(id)}/` });
    res.json({ mode: 'frame', port: GAME_PORT, origin: GAME_ORIGIN, path: `/g/${gameKey(dbService.getSessionToken(), id, await revOf(id))}/${encodeURIComponent(id)}/` });
});

// Картинки из папок — обложки и снимки (_media/…, старые обложки в папке игры). Остальное из папок
// игр адрес библиотеки не отдаёт: код игры здесь не должен запускаться. Старая ссылка на игру
// (закладка) — в библиотеку, она откроет игру сама
const IMAGE_FILE = /\.(png|jpe?g|webp|gif|avif|bmp)$/i;
app.get('*', requireAuth, async (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path === '/') return next();
    const rel = relFrom(req.path);
    if (rel === null) return res.status(400).send('Непонятный адрес');
    const first = rel.split('/')[0];
    if (!ISOLATED) {
        return serveGameFile(req, res, next, { rel, prefix: '', inject: { id: first, saves: '/api/saves', errors: '/api/errors' } });
    }
    if (IMAGE_FILE.test(rel)) {
        const file = path.resolve(GAMES_DIR, rel);
        if (!file.startsWith(path.resolve(GAMES_DIR) + path.sep)) return res.status(403).end();
        res.setHeader('X-Content-Type-Options', 'nosniff');
        // ?w=360 или 720 — уменьшенная копия (utils/thumbs.js): карточкам на телефоне хватает её.
        // Не получилось (не картинка, нет ffmpeg) — отдаём исходную
        if (req.query.w) {
            const small = await thumbnail(file, req.query.w, path.join(GAMES_DIR, '_media', '.thumbs')).catch(() => null);
            if (small) {
                res.setHeader('Cache-Control', 'private, max-age=604800');
                return res.sendFile(small, { cacheControl: false });
            }
        }
        return res.sendFile(file, (err) => { if (err && !res.headersSent) res.status(404).end(); });
    }
    if (isGameId(first) && fs.existsSync(path.join(GAMES_DIR, first))) return res.redirect(`/?play=${encodeURIComponent(first)}`);
    next();
});


// ============================================================================
// [7] ЗАПУСК СЕРВЕРА И ФАЙЛОВЫЙ ВОТЧЕР
// ============================================================================

if (require.main === module) {
    dbService.init(GAMES_DIR).then(async () => {
        
        await gameErrors.init();
        // Первичная синхронизация базы при старте
        await dbService.syncDatabase();
        // Сейвы, которые лежат под прежними, «исправленными» именами папок, — к своим играм
        const ids = (await dbService.get().all('SELECT id FROM games')).map((r) => r.id);
        await createSavesRouter.store.migrate(ids).catch((e) => console.error('[Saves]', e.message));
        // Загрузки, чья распаковка оборвалась перезапуском, — доделать
        uploadService.recover().catch((e) => console.error('[Upload]', e.message));

        // Запуск HTTP и WebSocket сервера
        const PORT = process.env.PORT || 3000;
        const srv = server.listen(PORT, () => {
            console.log(`🚀 RPG API: Сервер запущен на порту ${PORT}`);
        });
        
        // Отключаем таймауты для поддержки долгих загрузок больших архивов
        srv.timeout = 0; srv.requestTimeout = 0; srv.keepAliveTimeout = 0;

        // Сервер игр — внутри контейнера порт 3001, снаружи GAME_PORT (docker-compose.yml)
        let gameSrv = null;
        if (ISOLATED) {
            const gameApp = createGameApp({
                secret: () => dbService.getSessionToken(),
                store: createSavesRouter.store,
                publicDir: path.join(__dirname, 'public'),
                onError: (id, body, ua) => gameErrors.record(id, body, ua),
                onSaved: (id, slot) => { if (/^(RPG File\d+|MZ_file\d+)$/i.test(slot)) updateProgress(id).catch(() => {}); },
            });
            gameSrv = http.createServer(gameApp).listen(3001, () => console.log(`🎮 Игры: порт 3001 (снаружи ${GAME_PORT})`));
        }
        
        // Ядро не доставляет процессу с PID 1 сигналы, для которых нет обработчика.
        // Без этих строк сервер не слышал SIGTERM и через 10 секунд получал SIGKILL.
        const shutdown = async (signal) => {
            console.log(`⏹️  Получен ${signal}, завершаем работу`);
            // Страховка: если что-то зависнет при закрытии — выходим сами
            setTimeout(() => process.exit(0), 5000).unref();
            io.close();
            srv.close();
            gameSrv?.close();
            try { await redisClient.quit(); } catch (e) {}
            try { await dbService.get().close(); } catch (e) {}
            process.exit(0);
        };
        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));
        
        // Разовый проход по существующим сейвам, чтобы прогресс появился у старых игр
        setTimeout(() => backfillProgress().catch(e => console.error('[Progress]', e.message)), 3000);
        // И язык по тексту игры — для тех, что добавлены до появления этой проверки
        setTimeout(() => dbService.fillTextLang().catch(e => console.error('[Lang]', e.message)), 4000);

        // Поиск метаданных: воркер берёт из базы игры, чей срок подошёл. На старте —
        // догнать то, что созрело, пока сервер лежал; дальше раз в полчаса проверять,
        // не подошёл ли срок у отложенных (повторы идут с паузами от часа до месяца).
        // Ключи старой очереди в Redis больше не нужны — убираем разово.
        setTimeout(async () => {
            await scraperService.cleanupLegacyQueue();
            scraperService.processBackgroundScrape().catch(e => console.error('[Queue]', e.message));
        }, 5000);
        setInterval(() => {
            scraperService.processBackgroundScrape().catch(e => console.error('[Queue]', e.message));
        }, 30 * 60 * 1000).unref();

        // Telegram: раз в час — место на диске и копия базы и сейвов (если бот настроен)
        telegramService.start();
        // Оглавления галерей — фоном, по одной игре, через 10 минут после старта
        galleryService.start(async () => (await dbService.get().all('SELECT id FROM games WHERE ready = 1 ORDER BY lastPlayed DESC')).map((r) => r.id));

        // Настройка "наблюдателя" (Watcher) за папкой игр для автообновления библиотеки
        let syncTimer = null;
        let syncInProgress = false;
        let pendingSync = false;
        let lastReadyCount = (await dbService.get().get('SELECT COUNT(*) as c FROM games WHERE ready = 1'))?.c || 0;

        async function runSyncSafely(reason = 'watcher') {
            if (syncInProgress) { pendingSync = true; return; }
            syncInProgress = true;
            try {
                await dbService.syncDatabase();
                const newReadyCount = (await dbService.get().get('SELECT COUNT(*) as c FROM games WHERE ready = 1'))?.c || 0;
                
                // Если количество игр изменилось, уведомляем фронтенд
                if (newReadyCount !== lastReadyCount) {
                    const diff = newReadyCount - lastReadyCount;
                    lastReadyCount = newReadyCount;
                    io.emit('scrape-success', { message: diff > 0 ? `✅ Добавлено готовых игр: ${diff}` : '🔄 Библиотека обновлена' });
                }
                console.log('[Watcher] ✅ Синхронизация завершена');
            } catch (e) { 
                console.error('[Watcher] ❌ Ошибка синхронизации:', e); 
            } finally {
                syncInProgress = false;
                // Если пока мы синкали, файлы снова изменились — запускаем еще раз
                if (pendingSync) { pendingSync = false; setTimeout(() => runSyncSafely('pending'), 300); }
            }
        }

        // Прослушиваем изменения директории (игнорируя служебные папки)
        fs.watch(GAMES_DIR, { persistent: true }, (eventType, filename) => {
            if (!filename || SYSTEM_DIRS.includes(filename)) return;
            
            // Используем Debounce (5 сек), чтобы не запускать синк на каждый скопированный файл
            clearTimeout(syncTimer);
            syncTimer = setTimeout(() => runSyncSafely(`fs.watch:${eventType}:${filename}`), 5000);
        });

        console.log(`[Watcher] 👀 Наблюдение за ${GAMES_DIR} включено`);
    }).catch(console.error);
}

module.exports = { app };

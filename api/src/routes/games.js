const express = require('express');
const fsp = require('fs').promises;
const path = require('path');
const dbService = require('../db/database.js');
const scraperService = require('../services/scraper.js');
const { GAMES_DIR, SAVES_DIR, OLD_DIR } = require('../config/index.js');
const { coverUpload } = require('../utils/upload.js');
const { getFolderSize } = require('../utils/archive.js');
const { validateIdParam } = require('../utils/validate.js');
const { redisClient, invalidateGamesList, GAMES_LIST_KEY } = require('../utils/cache.js');
const { normalizeTags } = require('../utils/tags.js');
const { shownTitle, extractVersion } = require('../utils/title.js');
const { duplicateGroups, improvable, coverage } = require('../utils/audit.js');

const router = express.Router();

// Все роуты с :id — только безопасное имя папки (без "." / ".." / слэшей)
router.param('id', validateIdParam);

let isCalculatingSizes = false; // Глобальный замок

// Прежние версии игры в _old/<игра>: папки по дате, старые первыми (рядом — их .json)
const oldVersionsOf = async (id) => (await fsp.readdir(path.join(OLD_DIR, id), { withFileTypes: true }).catch(() => []))
    .filter((e) => e.isDirectory()).map((e) => e.name).sort();

// Строку пишем мы сами, но битое значение в базе не должно ронять весь список
const parseProgress = (raw) => { try { return raw ? JSON.parse(raw) : null; } catch { return null; } };

// Как показывать название: без версий и подписей переводчиков, японское — английским
// из имени папки. Название, вписанное руками в «Изменить», — как есть.
// Версия в колонке version у всех «1.0.0» по умолчанию: настоящая — вписанная руками или
// узнанная при обновлении (my_version), а без неё — из названия и папки
function titleFields(row) {
    const shown = shownTitle(row);
    return {
        displayTitle: shown.title,
        originalTitle: shown.original,
        version: row.my_version || extractVersion(row.title, row.id),
        myVersion: row.my_version || '',
    };
}

// --- 1. ПОЛУЧЕНИЕ ВСЕХ ИГР (С КЭШИРОВАНИЕМ REDIS) ---
router.get('/', async (req, res) => {
    try {
        // [REDIS] 1. Проверяем кэш. Если есть — отдаем мгновенно!
        const cachedGames = await redisClient.get(GAMES_LIST_KEY);
        if (cachedGames) {
            return res.json(JSON.parse(cachedGames));
        }

        const rows = await dbService.get().all('SELECT * FROM games WHERE ready = 1');

        // =========================================================
        // БЕЗОПАСНОЕ ФОНОВОЕ ВЗВЕШИВАНИЕ (С ЗАЩИТОЙ ОТ ГОНКИ)
        // =========================================================
        const gamesWithoutSize = rows.filter(r => !r.size || r.size === 0);
        if (gamesWithoutSize.length > 0 && !isCalculatingSizes) {
            isCalculatingSizes = true; 
            
            setTimeout(async () => {
                try {
                    let sizeUpdated = false;
                    for (const g of gamesWithoutSize) {
                        const gamePath = path.join(GAMES_DIR, g.id);
                        const s = await getFolderSize(gamePath);
                        if (s > 0) {
                            await dbService.get().run('UPDATE games SET size = ? WHERE id = ?', [s, g.id]);
                            sizeUpdated = true;
                        }
                    }
                    // [REDIS] Сбрасываем кэш, если размеры обновились, чтобы UI увидел изменения
                    if (sizeUpdated) await invalidateGamesList();
                } catch (e) {
                    console.error('[Background] Ошибка взвешивания:', e);
                } finally {
                    isCalculatingSizes = false; 
                }
            }, 1000); 
        }
        // =========================================================

        // Прежние версии, отложенные при обновлении игры (services/uploads.js): сколько их у игры
        const oldVersions = {};
        for (const id of await fsp.readdir(OLD_DIR).catch(() => [])) {
            oldVersions[id] = (await oldVersionsOf(id)).length;
        }

        const games = rows.map(row => ({
            id: row.id, 
            title: row.title, 
            cover: row.cover,
            developer: row.developer || '',
            language: row.language || '',
            releaseDate: row.releaseDate || '',
            link: row.link || '',
            size: row.size || 0,
            ...titleFields(row),
            // Без этого поля значок «ждёт метаданные» горел на каждой карточке
            scraped: !!row.scraped,
            tags: normalizeTags(row.tags ? JSON.parse(row.tags) : []),
            description: row.description, 
            url: `/${row.id}/`, 
            number: 0,
            addedAt: row.addedAt, 
            lastPlayed: row.lastPlayed, 
            rating: row.rating,
            status: row.status || '',
            favorite: !!row.favorite,
            playtime: row.playtime || 0,
            progress: parseProgress(row.progress),
            screens: parseProgress(row.screens) || [],
            oldVersions: oldVersions[row.id] || 0,
            // Язык по тексту самой игры: { main, langs, original }. language выше —
            // только ручная правка, она главнее
            textLang: parseProgress(row.text_lang),
            // Состояние поиска метаданных — для строчки в окне игры и для ревизии
            meta: {
                status: row.meta_status || 'new',
                attempts: row.meta_attempts || 0,
                retryAt: row.meta_retry_at || null,
                checkedAt: row.meta_checked_at || 0,
                error: row.meta_error || '',
            },
        })).sort((a, b) => b.addedAt - a.addedAt); 
        games.forEach((g, i) => g.number = i + 1);

        // [REDIS] 2. Сохраняем собранный список в кэш на 5 минут (300 секунд)
        await redisClient.set(GAMES_LIST_KEY, JSON.stringify(games), { EX: 300 });

        res.json(games);
    } catch (e) { res.status(500).json({ error: 'DB Error' }); }
});

// --- ДОГОН МЕТАДАННЫХ: ставим в очередь всех, у кого их нет ---
// Искать заново сразу для группы игр. Вызывается из ревизии: сначала видно,
// чего не хватает, и там же это чинится — раньше кнопка работала вслепую.
//   missing — не найденные и те, где источники не ответили
//   partial — с тегами, но без картинок или ссылки
//   improvable — найденные, но с пробелами, искались до последнего улучшения поиска
//     (список тот же, что в ревизии, и считает его сервер, а не присылает окно)
router.post('/rescan', async (req, res) => {
    try {
        let ids;
        if (req.body?.scope === 'improvable') {
            ids = improvable(await dbService.get().all('SELECT * FROM games WHERE ready = 1')).map((g) => g.id);
        } else {
            const scope = req.body?.scope === 'partial' ? ['partial'] : ['new', 'not_found', 'error'];
            ids = (await dbService.get().all(
                `SELECT id FROM games WHERE ready = 1 AND meta_status IN (${scope.map(() => '?').join(',')})`,
                scope
            )).map(r => r.id);
        }
        const queued = await scraperService.requestScrape(ids);
        await invalidateGamesList();
        res.json({ success: true, queued });
    } catch (e) {
        res.status(500).json({ error: 'Не удалось поставить в очередь' });
    }
});

// «Искать сейчас» для одной игры из её окна
router.post('/:id/rescrape', async (req, res) => {
    try {
        const queued = await scraperService.requestScrape([path.basename(req.params.id)]);
        if (!queued) return res.status(404).json({ error: 'Игра не найдена' });
        await invalidateGamesList();
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Не удалось поставить в очередь' });
    }
});

// --- РЕВИЗИЯ БИБЛИОТЕКИ ---
// Отвечает на вопросы, которых по списку игр не видно: что не запустится, что лежит
// дважды, что занимает место и ни разу не открывалось, от чего остались сейвы, хотя
// игры уже нет. Ничего не удаляет и не чинит — только показывает.
router.get('/audit', async (req, res) => {
    const exists = async (p) => { try { await fsp.access(p); return true; } catch { return false; } };

    try {
        const rows = await dbService.get().all('SELECT * FROM games WHERE ready = 1');

        // Движок открывает игру через index.html: либо в корне папки, либо в www —
        // ровно так его ищет раздача файлов. Нет ни того, ни другого — игра не запустится
        const broken = [];
        for (const g of rows) {
            const dir = path.join(GAMES_DIR, g.id);
            const ok = await exists(path.join(dir, 'index.html'))
                || await exists(path.join(dir, 'www', 'index.html'));
            if (!ok) broken.push({ id: g.id, title: g.title, size: g.size || 0 });
        }

        // Одна игра в двух папках: одно название или одна страница магазина (utils/audit.js)
        const duplicates = duplicateGroups(rows);

        const slim = (g) => ({ id: g.id, title: g.title, size: g.size || 0 });
        const bySize = (a, b) => b.size - a.size;

        const never = rows.filter(g => !g.lastPlayed && !g.playtime).map(slim).sort(bySize);
        const heavy = rows.map(slim).sort(bySize).slice(0, 10);

        // Поиск метаданных: берём готовое состояние, а не угадываем по пустым полям.
        // Раньше ревизия и кнопка «Дозагрузить» считали «без метаданных» по-разному.
        const withMeta = (g) => ({ ...slim(g), status: g.meta_status, retryAt: g.meta_retry_at || null, error: g.meta_error || '' });
        const missing = rows.filter(g => g.meta_status === 'not_found' || g.meta_status === 'error').map(withMeta).sort(bySize);
        const partial = rows.filter(g => g.meta_status === 'partial').map(withMeta).sort(bySize);
        const now = Date.now();
        const pending = rows.filter(g => g.meta_status === 'new' || (g.meta_retry_at && g.meta_retry_at <= now)).length;

        // Папки, игры к которым уже нет. Сейвы в таком случае — единственное, что
        // осталось от прохождения, поэтому показываем отдельно и ничего не трогаем.
        const ids = new Set(rows.map(g => g.id));
        const orphanDirs = async (dir, kind) => {
            try {
                const entries = await fsp.readdir(dir, { withFileTypes: true });
                // С точки — служебное, не игра: история сейвов (_saves/.history)
                return entries.filter(e => e.isDirectory() && !e.name.startsWith('.') && !ids.has(e.name)).map(e => ({ id: e.name, kind }));
            } catch (e) {
                return [];
            }
        };
        const orphans = [
            ...await orphanDirs(SAVES_DIR, 'saves'),
            ...await orphanDirs(path.join(GAMES_DIR, '_media'), 'media'),
            ...await orphanDirs(OLD_DIR, 'old'),
        ];

        res.json({
            total: rows.length, coverage: coverage(rows),
            broken, duplicates, missing, partial, improvable: improvable(rows), pending, orphans, never, heavy,
        });
    } catch (e) {
        console.error('[Audit] Ошибка:', e.message);
        res.status(500).json({ error: 'Не удалось собрать ревизию' });
    }
});

// --- ПРЕЖНИЕ ВЕРСИИ: отложенные при обновлении игры (services/uploads.js) — посмотреть, вернуть, удалить ---
// Сколько места освободит удаление: после патча прежняя версия делит с нынешней неизменённые файлы
// (жёсткие ссылки, services/uploads.js) — их удаление не освобождает, считаем только свои
async function ownSize(dir) {
    let total = 0;
    for (const e of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) total += await ownSize(p);
        else if (e.isFile()) {
            const st = await fsp.stat(p).catch(() => null);
            if (st && st.nlink === 1) total += st.size;
        }
    }
    return total;
}

router.get('/:id/old', async (req, res) => {
    const versions = [];
    for (const date of await oldVersionsOf(req.params.id)) {
        let saved = {};
        try { saved = JSON.parse(await fsp.readFile(path.join(OLD_DIR, req.params.id, `${date}.json`), 'utf8')); } catch (e) {}
        // patch — имя архива патча, после которого эта версия ушла в запас
        versions.push({ date, size: await ownSize(path.join(OLD_DIR, req.params.id, date)), patch: saved.patch || '' });
    }
    res.json({ versions });
});

// «Вернуть прежнюю версию»: обновили не тем архивом или новая версия не работает. Те же два
// переименования, что при обновлении: текущая уходит в запас, последняя прежняя — на её место,
// а с ней своя версия и обложка, какими были до обновления
router.post('/:id/old/restore', async (req, res) => {
    const id = req.params.id;
    const dir = path.join(OLD_DIR, id);
    const game = path.join(GAMES_DIR, id);
    try {
        const latest = (await oldVersionsOf(id)).pop();
        if (!latest) return res.status(404).json({ error: 'Прежней версии нет' });
        const st = await fsp.lstat(game).catch(() => null);
        if (!st || st.isSymbolicLink() || !st.isDirectory()) return res.status(409).json({ error: 'Эту игру здесь не вернуть' });
        let saved = {};
        try { saved = JSON.parse(await fsp.readFile(path.join(dir, `${latest}.json`), 'utf8')); } catch (e) {}
        await fsp.rename(game, path.join(dir, new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')));
        await fsp.rename(path.join(dir, latest), game);
        await fsp.rm(path.join(dir, `${latest}.json`), { force: true });
        await dbService.restoreGame(id, saved);
        console.log(`[Old] ${id}: вернули версию от ${latest}`);
        res.json({ success: true });
    } catch (e) {
        console.error('[Old]', e.message);
        res.status(500).json({ error: 'Не удалось вернуть прежнюю версию' });
    }
});

router.delete('/:id/old', async (req, res) => {
    try {
        await fsp.rm(path.join(OLD_DIR, req.params.id), { recursive: true, force: true });
        await invalidateGamesList();
        res.json({ success: true });
    } catch (e) {
        console.error('[Old]', e.message);
        res.status(500).json({ error: 'Не удалось удалить прежнюю версию' });
    }
});

// --- 2. РОУТ ДЛЯ ЗАГРУЗКИ КАСТОМНОЙ ОБЛОЖКИ ---
router.post('/:id/cover', coverUpload.single('cover'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Файл обложки не получен' });
    const gameId = path.basename(req.params.id);
    try {
        const game = await dbService.get().get('SELECT cover FROM games WHERE id = ?', [gameId]);
        if (!game) {
            await fsp.unlink(req.file.path).catch(()=>{});
            return res.status(404).json({ error: 'Игра не найдена' });
        }
        if (game.cover && game.cover.includes('cover_custom')) {
            const oldCoverPath = path.join(GAMES_DIR, game.cover);
            await fsp.unlink(oldCoverPath).catch(() => {});
        }
        // Своя обложка — в _media, как и найденные поиском: внутрь папки игры мы не пишем.
        // Прежние свои обложки могли остаться в самой папке — их путь в базе, и работают они как раньше
        const ext = path.extname(req.file.originalname) || '.jpg';
        const coverName = `cover_custom_${Date.now()}${ext}`;
        const mediaDir = path.join(GAMES_DIR, '_media', gameId);
        await fsp.mkdir(mediaDir, { recursive: true });
        const finalCoverPath = path.join(mediaDir, coverName);
        const dbCoverPath = `_media/${gameId}/${coverName}`;

        await fsp.rename(req.file.path, finalCoverPath).catch(async (e) => {
            // Загрузка лежит на другом разделе — rename туда не умеет
            if (e.code !== 'EXDEV') throw e;
            await fsp.copyFile(req.file.path, finalCoverPath);
            await fsp.unlink(req.file.path).catch(() => {});
        });
        await dbService.get().run('UPDATE games SET cover = ? WHERE id = ?', [dbCoverPath, gameId]);
        
        // [REDIS] Сбрасываем кэш, так как обложка изменилась
        await invalidateGamesList();
        
        res.json({ success: true, coverPath: dbCoverPath });
    } catch (e) {
        await fsp.unlink(req.file.path).catch(()=>{});
        res.status(500).json({ error: 'Ошибка при смене обложки' });
    }
});

// --- 3. РОУТ ДЛЯ СБРОСА ОБЛОЖКИ (ВОЗВРАТ К ОРИГИНАЛУ) ---
router.delete('/:id/cover', async (req, res) => {
    const gameId = path.basename(req.params.id);
    try {
        const game = await dbService.get().get('SELECT cover FROM games WHERE id = ?', [gameId]);
        if (!game) return res.status(404).json({ error: 'Игра не найдена' });

        if (game.cover && game.cover.includes('cover_custom')) {
            const oldCoverPath = path.join(GAMES_DIR, game.cover);
            await fsp.unlink(oldCoverPath).catch(() => {});
        }
        // Возвращаем найденную поиском обложку из _media (самую свежую), а если её нет —
        // ту, что лежит в самой игре. Раньше смотрели только в папку игры, и после сброса
        // своей обложки игра оставалась без картинки до следующего поиска
        let newDbCover = '';
        const mediaDir = path.join(GAMES_DIR, '_media', gameId);
        const found = [];
        for (const f of await fsp.readdir(mediaDir).catch(() => [])) {
            if (!/^cover(?:-[0-9a-f]{10})?\.jpg$/i.test(f)) continue;
            const stat = await fsp.stat(path.join(mediaDir, f)).catch(() => null);
            if (stat) found.push({ f, at: stat.mtimeMs });
        }
        if (found.length) {
            newDbCover = `_media/${gameId}/${found.sort((a, b) => b.at - a.at)[0].f}`;
        } else {
            try {
                await fsp.access(path.join(GAMES_DIR, gameId, 'cover.jpg'));
                newDbCover = `${gameId}/cover.jpg`;
            } catch (e) {}
        }
        await dbService.get().run('UPDATE games SET cover = ? WHERE id = ?', [newDbCover, gameId]);
        
        // [REDIS] Сбрасываем кэш
        await invalidateGamesList();
        
        res.json({ success: true, coverPath: newDbCover });
    } catch (e) {
        res.status(500).json({ error: 'Ошибка при сбросе обложки' });
    }
});

// --- 4. РЕДАКТИРОВАНИЕ МЕТАДАННЫХ ---
router.post('/:id/edit', async (req, res) => {
    const folder = path.basename(req.params.id);
    const { title, developer, language, releaseDate, link, myVersion } = req.body;

    try {
        const current = await dbService.get().get('SELECT * FROM games WHERE id = ?', [folder]);
        if (!current) return res.status(404).json({ error: 'Игра не найдена' });

        // Версия у себя — для плашки на карточке, когда в названии папки её нет. Поиск не нужен
        if (myVersion !== undefined && String(myVersion).trim() !== (current.my_version || '')) {
            await dbService.get().run('UPDATE games SET my_version = ? WHERE id = ?', [String(myVersion).trim().slice(0, 40), folder]);
        }

        // Что человек действительно поменял. Форма присылает все поля разом, и если
        // считать ручным всё присланное, автопоиск навсегда перестал бы обновлять
        // поля, которые просто стояли в форме с прошлого раза.
        const sent = { developer, language, releaseDate, link };
        const manual = {};
        for (const [key, value] of Object.entries(sent)) {
            if (value !== undefined && String(value) !== String(current[key] || '')) manual[key] = value;
        }
        // Название тоже запоминаем как ручное: его показываем как есть, без чистки
        if (title !== undefined && title !== current.title) manual.title = title;

        // Поменянное пишем сразу: оно главнее всего, что найдётся, и должно остаться,
        // даже если поиск ничего не даст
        const direct = { ...manual };
        const directKeys = Object.keys(direct);
        if (directKeys.length) {
            await dbService.get().run(
                `UPDATE games SET ${directKeys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`,
                [...directKeys.map(k => direct[k]), folder]
            );
        }

        const searchFrom = title || current.title || folder;
        // Ссылки, которые человек сейчас не трогал, ищем как при обычном повторном поиске:
        // найденные автопоиском по названию (Steam, VNDB) — заново и со сверкой. Иначе
        // «Сохранить» возвращало бы в карточку однажды принятую чужую игру
        let locked = [];
        try { locked = JSON.parse(current.meta_locked || '[]') || []; } catch (e) {}
        const linksForSearch = scraperService.searchableLinks(link, manual.link !== undefined || locked.includes('link')).join(',');

        const lookup = await scraperService.lookupMetadata(searchFrom, linksForSearch, {
            altTitle: scraperService.titleFromFolder(folder),
            readmeTitle: await scraperService.readmeTitle(path.join(GAMES_DIR, folder)),
        });

        // Неудача поиска ничего не трогает: опечатка в ссылке не стирает хорошие теги и описание
        const result = await scraperService.applyLookup(folder, lookup, { manual });

        // Текст сообщения собирает интерфейс на языке пользователя: отсюда — только факты
        const g = result.row;
        res.json({
            success: true,
            found: result.found,
            failed: result.failed,
            game: {
                title: g.title,
                ...titleFields(g),
                cover: g.cover,
                developer: g.developer || '',
                language: g.language || '',
                releaseDate: g.releaseDate || '',
                link: g.link || '',
                tags: normalizeTags(g.tags ? JSON.parse(g.tags) : []),
                description: g.description || '',
                screens: parseProgress(g.screens) || [],
                meta: {
                    status: g.meta_status,
                    attempts: g.meta_attempts || 0,
                    retryAt: g.meta_retry_at || null,
                    checkedAt: g.meta_checked_at || 0,
                    error: g.meta_error || '',
                },
            }
        });
    } catch (e) { 
        console.error(e);
        res.status(500).json({ error: 'Сбой сервера при обновлении' }); 
    }
});

// --- 5. СОХРАНЕНИЕ РЕЙТИНГА И ВРЕМЕНИ ИГРЫ ---
router.post('/:id/meta', async (req, res) => {
    const folder = path.basename(req.params.id);
    const { rating, lastPlayed, status, favorite } = req.body;

    try {
        const game = await dbService.get().get('SELECT id FROM games WHERE id = ?', [folder]);
        if (!game) return res.status(404).json({ error: 'Игра не найдена' });

        const updates = [], params = [];
        if (rating !== undefined) { updates.push('rating = ?'); params.push(rating); }
        if (lastPlayed !== undefined) { updates.push('lastPlayed = ?'); params.push(lastPlayed); }

        // Статус приходит из браузера — принимаем только известные значения.
        // Иначе в базе окажется любой текст, который пришлёт клиент.
        const STATUSES = ['', 'playing', 'done', 'dropped', 'wish'];
        if (status !== undefined) {
            if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Неизвестный статус' });
            updates.push('status = ?'); params.push(status);
        }
        if (favorite !== undefined) { updates.push('favorite = ?'); params.push(favorite ? 1 : 0); }

        if (updates.length > 0) {
            params.push(folder);
            await dbService.get().run(`UPDATE games SET ${updates.join(', ')} WHERE id = ?`, params);
            
            // [REDIS] Сбрасываем кэш, так как рейтинг или время игры обновились
            await invalidateGamesList();
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Ошибка сохранения метаданных' }); }
});

// --- 6. УДАЛЕНИЕ ИГРЫ ---
router.delete('/:id', async (req, res) => {
    const id = path.basename(req.params.id);
    const gamePath = path.join(GAMES_DIR, id);
    
    try {
        // Удаляем только то, что есть в библиотеке (не _saves, не library.db и т.п.)
        const game = await dbService.get().get('SELECT id FROM games WHERE id = ?', [id]);
        if (!game) return res.status(404).json({ error: 'Игра не найдена' });

        await fsp.access(gamePath);
        await fsp.rm(gamePath, { recursive: true, force: true });
        await dbService.get().run('DELETE FROM games WHERE id = ?', [id]);
        
        // [REDIS] Сбрасываем кэш после удаления
        await invalidateGamesList();
        
        res.json({ success: true });
    } catch(e) { 
        res.status(404).json({ error: 'Игра не найдена' }); 
    }
});

module.exports = router;

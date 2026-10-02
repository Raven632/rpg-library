const fsp = require('fs').promises;
const path = require('path');
const zlib = require('zlib');
const { SAVES_DIR } = require('../config/index.js');
const dbService = require('../db/database.js');
const { invalidateGamesList } = require('./cache.js');
const LZString = require('lz-string');

// Сейв лежит ровно в том виде, в каком игра положила его в localStorage:
// MV — обычный JSON, MZ — сжатый zlib. Обходимся встроенным модулем, без зависимостей.
function parseSave(raw) {
    // Три формата: обычный JSON, zlib (MZ) и LZString в base64 (стандартный MV).
    if (raw.charCodeAt(0) === 0x78) {
        // Файл писался как текст, поэтому байты возвращаем через latin1
        return JSON.parse(zlib.inflateSync(Buffer.from(raw, 'latin1')).toString('utf8'));
    }
    if (raw.trimStart().startsWith('{')) return JSON.parse(raw);
    return JSON.parse(LZString.decompressFromBase64(raw));
}

// Слоты сохранений: MV — «RPG%20File1.json», MZ — «MZ_file1.json».
// Файлы config и global прогресса не содержат, их не трогаем.
const SLOT_FILE = /^(RPG%20File\d+|MZ_file\d+)\.json$/i;

// Берём самый «продвинутый» слот — с наибольшим временем игры.
async function readProgress(gameId) {
    const dir = path.join(SAVES_DIR, path.basename(gameId));
    let files;
    try { files = await fsp.readdir(dir); } catch { return null; }

    let best = null;
    for (const file of files.filter(f => SLOT_FILE.test(f))) {
        const full = path.join(dir, file);
        try {
            const save = parseSave(await fsp.readFile(full, 'utf8'));
            // Движок считает время в кадрах, их 60 в секунде
            const playtime = Math.round((save?.system?._framesOnSave || 0) / 60);
            if (best && playtime <= best.playtime) continue;

            const levels = Object.values(save?.actors?._data || {})
                .map(a => a && a._level).filter(Boolean);
            best = {
                playtime,
                gold: save?.party?._gold ?? null,
                mapId: save?.map?._mapId ?? null,
                level: levels.length ? Math.max(...levels) : null,
                slot: file.replace(/\.json$/i, ''),
                savedAt: (await fsp.stat(full)).mtimeMs,
            };
        } catch (e) {
            // Чужой формат или битый слот — молча пропускаем, остальные читаем
        }
    }
    return best;
}

async function updateProgress(gameId) {
    const progress = await readProgress(gameId);
    if (!progress) return;
    await dbService.get().run(
        'UPDATE games SET playtime = ?, progress = ? WHERE id = ?',
        [progress.playtime, JSON.stringify(progress), gameId]
    );
    await invalidateGamesList();
}

// Разовый проход по уже накопленным сейвам: прогресс появится и у старых игр
async function backfillProgress() {
    const rows = await dbService.get().all('SELECT id FROM games WHERE ready = 1');
    let updated = 0;
    for (const row of rows) {
        const progress = await readProgress(row.id);
        if (!progress) continue;
        await dbService.get().run(
            'UPDATE games SET playtime = ?, progress = ? WHERE id = ?',
            [progress.playtime, JSON.stringify(progress), row.id]
        );
        updated++;
    }
    if (updated) {
        await invalidateGamesList();
        console.log(`[Progress] Прогресс прочитан из сейвов: ${updated} игр`);
    }
}

module.exports = { readProgress, updateProgress, backfillProgress, parseSave };

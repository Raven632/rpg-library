const express = require('express');
const fsp = require('fs').promises;
const path = require('path');
const util = require('util');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const dbService = require('../db/database.js');
const { GAMES_DIR, SAVES_DIR, EXTRACT_TMP, SYSTEM_DIRS } = require('../config/index.js');

const execFileP = util.promisify(require('child_process').execFile);

// «Скачать резервную копию» из меню: то, что не скачать заново, — база (игры, найденные данные,
// наигранное время, статусы, оценки) и сейвы. Собирается по запросу, свежая. Ночная копия
// (deploy/backup.sh) лежит на том же диске, что и библиотека: откажет он — пропадёт и она, а эта
// уходит к человеку на компьютер или телефон. Настройки сервера (.env) сюда не входят: в них ключи
const readme = (date) => `Резервная копия RPG Library от ${date}

library.db  — база: игры, найденные данные, наигранное время, статусы, оценки
_saves/     — сохранения игр, по папке на игру
games.txt   — какие игры были в библиотеке. Сами игры в копию не входят: их можно скачать заново

Как восстановить: остановить сервер, положить library.db и папку _saves в папку игр сервера
(GAMES_DIR; на проде — /srv/rpg-library/games) и запустить сервер. Игры вернуть в ту же папку
под теми же именами, что в games.txt: сохранения и данные привязаны к имени папки.
Входа в копии нет: при первом запуске сервер попросит завести учётную запись заново.
`;

// Ключ входа — он же значение куки — и учётная запись остаются только на сервере: с ключом из
// файла копии в библиотеку вошли бы без пароля. Без SESSION_SECRET в .env ключ живёт в базе.
// После восстановления сервер создаст новый ключ и попросит завести учётную запись
const PRIVATE_SETTINGS = ['session_secret', 'admin_user', 'admin_pass'];

async function stripSecrets(file) {
    const db = await open({ filename: file, driver: sqlite3.Database });
    try {
        await db.run(`DELETE FROM settings WHERE key IN (${PRIVATE_SETTINGS.map(() => '?').join(', ')})`, PRIVATE_SETTINGS);
        // Удалённая строка остаётся в свободных страницах файла, пока их не перепишут, — VACUUM
        // собирает файл заново только из живых данных
        await db.exec('VACUUM');
    } finally {
        await db.close();
    }
}

// Собрать копию в папке dir. С паролем — архив 7z, где под паролем и содержимое, и имена файлов:
// так её отправляют в Telegram (services/telegram.js), если в .env задан BACKUP_PASSWORD
async function buildBackup(dir, { password = '' } = {}) {
    const now = new Date();
    // VACUUM INTO — согласованная копия, даже если сервер в этот миг пишет в базу
    await dbService.get().run('VACUUM INTO ?', [path.join(dir, 'library.db')]);
    await stripSecrets(path.join(dir, 'library.db'));
    const games = (await fsp.readdir(GAMES_DIR, { withFileTypes: true }))
        .filter((e) => (e.isDirectory() || e.isSymbolicLink()) && !SYSTEM_DIRS.includes(e.name))
        .map((e) => e.name);
    await fsp.writeFile(path.join(dir, 'games.txt'), `${games.join('\n')}\n`);
    await fsp.writeFile(path.join(dir, 'README.txt'), readme(now.toLocaleString('ru-RU')));
    const parts = ['library.db', 'games.txt', 'README.txt'].map((f) => path.join(dir, f));
    const saves = (await fsp.readdir(SAVES_DIR, { withFileTypes: true }).catch(() => []))
        .filter((e) => e.isDirectory() && !e.name.startsWith('.')).length;
    if (await fsp.access(SAVES_DIR).then(() => true, () => false)) parts.push(SAVES_DIR);
    const stamp = now.toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
    const name = `rpg-library-backup_${stamp}.${password ? '7z' : 'zip'}`;
    const file = path.join(dir, name);
    const format = password ? ['-t7z', '-mhe=on', `-p${password}`] : ['-tzip'];
    // История сейвов (_saves/.history) — страховка на сервере на ближайшие часы, в копию не идёт
    await execFileP('7zz', ['a', ...format, '-bso0', '-bsp0', '-xr!.history', file, ...parts]);
    const { size } = await fsp.stat(file);
    return { file, name, size, games: games.length, saves };
}

const router = express.Router();

router.get('/', async (req, res) => {
    const dir = await fsp.mkdtemp(path.join(EXTRACT_TMP, 'backup_'));
    const cleanup = () => fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    try {
        const { file, name } = await buildBackup(dir);
        res.download(file, name, cleanup);
    } catch (e) {
        await cleanup();
        console.error('[Backup]', e.message);
        if (!res.headersSent) res.status(500).json({ error: 'Не удалось собрать резервную копию' });
    }
});

module.exports = router;
module.exports.stripSecrets = stripSecrets;
module.exports.buildBackup = buildBackup;

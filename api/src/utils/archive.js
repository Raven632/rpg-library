const { spawn } = require('child_process');
const fsp = require('fs').promises;
const path = require('path');

function spawnExtract(cmd, args) {
    return new Promise((resolve, reject) => {
        const proc = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'pipe'] });
        let stderr = '';
        proc.stderr.on('data', d => { if (stderr.length < 50000) stderr += d.toString(); });
        proc.on('close', code => code === 0 ? resolve() : reject(new Error(`Exit code ${code}. Stderr: ${stderr.slice(0, 2000)}`)));
        proc.on('error', err => reject(new Error(`Запуск ${cmd} не удался: ${err.message}`)));
    });
}

async function findGameFolder(dir, depth = 0) {
    if (depth > 10) return null;
    const items = await fsp.readdir(dir, { withFileTypes: true });
    if (items.some(i => i.isDirectory() && i.name.toLowerCase() === 'www')) return path.join(dir, items.find(i => i.name.toLowerCase() === 'www').name);
    if (items.some(i => i.isFile() && i.name.toLowerCase() === 'index.html')) return dir;
    for (const item of items) {
        if (item.isDirectory()) {
            const found = await findGameFolder(path.join(dir, item.name), depth + 1);
            if (found) return found;
        }
    }
    return null;
}

// Добавь эти импорты в самый верх файла archive.js, если их там нет:
const util = require('util');
const { execFile } = require('child_process');
const execFilePromise = util.promisify(execFile);

// ================= СТАЛО =================
// Нативный и мгновенный Linux-метод подсчета размера
async function getFolderSize(dirPath) {
    try {
        const { stdout } = await execFilePromise('du', ['-sb', dirPath]);
        return parseInt(stdout.split('\t')[0], 10);
    } catch (e) {
        console.error('[Size] Ошибка нативного подсчета:', e);
        return 0;
    }
}

module.exports = { spawnExtract, findGameFolder, getFolderSize };

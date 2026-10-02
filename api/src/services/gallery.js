const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

// Галерея из файлов самой игры: её картинки — CG, персонажи, фоны — листать, не проходя игру.
// Файлы игры только читаем: оглавление и миниатюры — в _media/<игра>/, расшифровка — в памяти.
//
// Оглавление строится один раз (в фоне или при первом открытии): для каждой картинки хватает
// первых 40 байт — размеры PNG лежат в заголовке и у зашифрованных (.rpgmvp, .png_) не шифруются.
// По размеру, «весу» файла и имени картинка попадает в раздел:
//   cg       — во весь экран игры и плотная: CG и сцены
//   backdrop — во весь экран, но это фон: папки фонов карт и боёв, имена «Bg_…», «Sky…», «背景…»
//   layer    — во весь экран, но почти пустая (прозрачный слой, из которых игра собирает CG)
//   portrait — высотой в экран, но уже его: персонаж в полный рост
//   other    — мелкое: интерфейс, значки
// Альбом — одна сцена со всеми вариантами и кадрами: имя до первой части с цифрой (albumKey)
const ENGINE_DIRS = new Set(['characters', 'faces', 'tilesets', 'system', 'animations', 'battlebacks1', 'battlebacks2',
    'enemies', 'sv_actors', 'sv_enemies', 'weather']);
const IMAGE = /\.(png|rpgmvp|png_|jpe?g|webp)$/i;
const DENSE = 0.12;   // байт на пиксель: плотнее — настоящая картинка, реже — прозрачный слой
const DENSE_WEBP = 0.02; // WebP сжимает раз в пять сильнее PNG — и порог ниже
const THUMB_WIDTH = 360;
const INDEX_VERSION = 3;
const RANK = { cg: 4, portrait: 3, backdrop: 2, layer: 1, other: 0 };

function screenOf(system) {
    const w = Number(system?.advanced?.screenWidth) || 816;
    const h = Number(system?.advanced?.screenHeight) || 624;
    return { w, h };
}

// Фоны карт (parallaxes) и боёв — «Фоны», хоть и во весь экран. Так же картинки с именем фона
const BACKDROP_DIRS = new Set(['parallaxes', 'battlebacks1', 'battlebacks2']);
const BACKDROP_NAME = /^(bg|back|battle|effect|fog|sky|cloud|title|window|menu|map)|background|背景/i;

function classify({ w, h, size, webp }, screen, rel = '') {
    if (!w || !h) return 'other';
    const dir = (rel.split('/')[1] || '').toLowerCase();
    const full = w >= 0.8 * screen.w && h >= 0.8 * screen.h;
    if (BACKDROP_DIRS.has(dir)) return full || h >= 0.8 * screen.h ? 'backdrop' : 'other';
    if (full) {
        if (size / (w * h) < (webp ? DENSE_WEBP : DENSE)) return 'layer';
        return BACKDROP_NAME.test(path.posix.basename(rel)) ? 'backdrop' : 'cg';
    }
    if (h >= 0.8 * screen.h) return 'portrait';
    return 'other';
}

// Имя альбома — имя картинки до первой части с цифрой: «eva_c132_0_1_0211013_…» → «eva_c132» (все
// варианты CG №132), «ecg_hero7_3» → «ecg_hero7», «074 (3)» → «074», «SceneB_05sunset-11» →
// «SceneB_05sunset». Порядковый номер в начале («1_受付嬢_普») пропускаем, если дальше есть буквы
function albumKey(rel) {
    const dir = path.posix.dirname(rel);
    const name = path.posix.basename(rel).replace(IMAGE, '');
    // Имя — просто номер («1», «02»): сцена — это папка («CG/Garden Walk/1.png»). «074 (3)» —
    // другое: вариант 3 сцены 074
    if (/^\d+$/.test(name) && dir !== '.' && !/^img\/pictures$/i.test(dir)) return dir;
    const tokens = name.match(/[^_\-\s.()]+|[_\-\s.()]+/g) || [name];
    let key = '';
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (/^[_\-\s.()]+$/.test(t)) { if (key) key += t; continue; }
        if (!key && /^\d+$/.test(t) && /\p{L}/u.test(tokens.slice(i + 1).join(''))) continue;
        if (/\d/.test(t)) {
            // Последняя часть имени — номер кадра или варианта («CG_ending_14», «ct_02b», «t_prince8»):
            // без него — одна сцена, один персонаж
            const last = !tokens.slice(i + 1).some((x) => !/^[_\-\s.()]+$/.test(x));
            key += last ? t.replace(/\(?\d+\)?[a-z]?$/i, '') : t;
            break;
        }
        key += t;
    }
    return `${dir}/${key.replace(/[_\-\s.(]+$/, '') || name}`;
}

// PNG: ширина и высота — байты 16–23. У зашифрованного перед ним свой заголовок в 16 байт
function pngSize(head) {
    let b = head;
    // Репаки «Compressed» пережимают картинки в WebP, а имя оставляют .png — размеры WebP в его
    // заголовке: VP8X (с прозрачностью) — 24-битные числа, VP8 (с потерями) и VP8L (без потерь) — свои
    if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' && b.length >= 30) {
        const kind = b.subarray(12, 16).toString('latin1');
        if (kind === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3), webp: true };
        if (kind === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff, webp: true };
        if (kind === 'VP8L') {
            const bits = b.readUInt32LE(21);
            return { w: 1 + (bits & 0x3fff), h: 1 + ((bits >> 14) & 0x3fff), webp: true };
        }
        return null;
    }
    if (b.subarray(0, 4).toString('latin1') === 'RPGM') b = b.subarray(16);
    else if (b.subarray(12, 16).toString('latin1') !== 'IHDR') return null;
    if (b.length < 24) return null;
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

async function readHead(file) {
    const fh = await fsp.open(file, 'r');
    try {
        const buf = Buffer.alloc(40);
        const { bytesRead } = await fh.read(buf, 0, 40, 0);
        return buf.subarray(0, bytesRead);
    } finally {
        await fh.close();
    }
}

// Расшифровать картинку RPG Maker (MV .rpgmvp, MZ .png_): 16 байт своего заголовка, потом первые
// 16 байт PNG, сложенные по XOR с ключом из System.json. Незашифрованная — как есть
function decrypt(data, keyHex) {
    if (data.subarray(0, 4).toString('latin1') !== 'RPGM') return data;
    const out = Buffer.from(data.subarray(16));
    const key = (keyHex || '').match(/../g)?.map((x) => parseInt(x, 16)) || [];
    if (key.length) for (let i = 0; i < 16 && i < out.length; i++) out[i] ^= key[i % key.length];
    return out;
}

class GalleryService {
    constructor() {
        this.gamesDir = '';
        this.mediaDir = '';
        this.building = new Map();     // игра → { done, total, promise }
        this.memo = new Map();         // игра → { index, files: Set } — прочитанное оглавление
        this.thumbJobs = 0;
        this.thumbQueue = [];
    }

    setDependencies({ gamesDir, mediaDir }) {
        this.gamesDir = gamesDir;
        this.mediaDir = mediaDir || path.join(gamesDir, '_media');
    }

    // Папка с img/ и data/: корень игры или её www
    async contentRoot(id) {
        const game = path.join(this.gamesDir, id);
        for (const dir of [path.join(game, 'www'), game]) {
            if (await fsp.stat(path.join(dir, 'img')).then((s) => s.isDirectory(), () => false)) return dir;
        }
        return null;
    }

    async system(root) {
        try {
            return JSON.parse((await fsp.readFile(path.join(root, 'data', 'System.json'), 'utf8')).replace(/^﻿/, ''));
        } catch {
            return {};
        }
    }

    indexPath(id) { return path.join(this.mediaDir, id, 'gallery.json'); }

    async cached(id) {
        if (this.memo.has(id)) return this.memo.get(id).index;
        let index;
        try { index = JSON.parse(await fsp.readFile(this.indexPath(id), 'utf8')); } catch { return null; }
        // Оглавление прежнего вида (до разделов «CG» и «Фоны») — построим заново
        if (index.v !== INDEX_VERSION) return null;
        if (this.memo.size > 20) this.memo.delete(this.memo.keys().next().value);
        this.memo.set(id, { index, files: new Set(index.albums.flatMap((a) => a.files)) });
        return index;
    }

    // Игру обновили, поставили патч или вернули прежнюю версию — оглавление устарело
    async forget(id) {
        this.memo.delete(id);
        await fsp.rm(this.indexPath(id), { force: true });
        await fsp.rm(path.join(this.mediaDir, id, 'gallery'), { recursive: true, force: true });
    }

    // Оглавление готово — оно; строится — сколько сделано; нет — начать строить
    async state(id) {
        const index = await this.cached(id);
        if (index) {
            this.prewarm(id, index);
            return { state: 'ready', ...index };
        }
        const job = this.build(id);
        return { state: 'building', done: job.done, total: job.total };
    }

    build(id) {
        if (this.building.has(id)) return this.building.get(id);
        const job = { done: 0, total: 0 };
        job.promise = this.runBuild(id, job)
            .catch((e) => console.error(`[Галерея] ${id}:`, e.message))
            .finally(() => this.building.delete(id));
        this.building.set(id, job);
        return job;
    }

    async runBuild(id, job) {
        const root = await this.contentRoot(id);
        const index = { v: INDEX_VERSION, builtAt: Date.now(), screen: { w: 816, h: 624 }, counts: {}, albums: [] };
        if (root) {
            index.screen = screenOf(await this.system(root));
            const files = [];
            const walk = async (rel) => {
                for (const e of await fsp.readdir(path.join(root, rel), { withFileTypes: true }).catch(() => [])) {
                    const r = `${rel}/${e.name}`;
                    if (e.isDirectory()) {
                        if (rel === 'img' && ENGINE_DIRS.has(e.name.toLowerCase())) continue;
                        await walk(r);
                    } else if (e.isFile() && IMAGE.test(e.name)) files.push(r);
                }
            };
            await walk('img');
            job.total = files.length;
            const albums = new Map();
            const kindOf = new Map();
            for (const rel of files) {
                const file = path.join(root, rel);
                let entry = { w: 0, h: 0, size: 0 };
                try {
                    const [head, st] = await Promise.all([readHead(file), fsp.stat(file)]);
                    entry = { ...(pngSize(head) || { w: 0, h: 0 }), size: st.size };
                } catch (e) {
                    // Нечитаемый файл — в «Прочее»
                }
                const kind = classify(entry, index.screen, rel);
                kindOf.set(rel, kind);
                const key = albumKey(rel);
                if (!albums.has(key)) albums.set(key, { key, kind, w: entry.w, h: entry.h, files: [] });
                const album = albums.get(key);
                album.files.push(rel);
                // Альбом — по самой «главной» картинке в нём: CG важнее персонажа, фона, слоя
                if (RANK[kind] > RANK[album.kind]) Object.assign(album, { kind, w: entry.w, h: entry.h });
                job.done++;
            }
            const collator = new Intl.Collator('en', { numeric: true });
            // Сначала img/pictures (там CG), потом свои папки плагинов, заставки — в конце
            const order = (key) => (key.startsWith('img/pictures/') ? 0 : /^img\/titles/i.test(key) ? 2 : 1);
            index.albums = [...albums.values()]
                .map((a) => {
                    const sorted = a.files.sort(collator.compare);
                    // Обложка альбома — первая картинка его раздела, а не прозрачный слой
                    return { ...a, files: sorted, cover: sorted.find((f) => kindOf.get(f) === a.kind) || sorted[0] };
                })
                .sort((a, b) => order(a.key) - order(b.key) || collator.compare(a.key, b.key));
            for (const a of index.albums) index.counts[a.kind] = (index.counts[a.kind] || 0) + a.files.length;
        }
        await fsp.mkdir(path.dirname(this.indexPath(id)), { recursive: true });
        const tmp = `${this.indexPath(id)}.tmp`;
        await fsp.writeFile(tmp, JSON.stringify(index));
        await fsp.rename(tmp, this.indexPath(id));
        this.memo.delete(id);
        const c = index.counts;
        console.log(`[Галерея] ${id}: CG ${c.cg || 0}, персонажей ${c.portrait || 0}, фонов ${c.backdrop || 0}, слоёв ${c.layer || 0}, прочего ${c.other || 0}, альбомов ${index.albums.length} — за ${Math.round((Date.now() - index.builtAt) / 1000)} с`);
        return index;
    }

    // Файл из оглавления этой игры — иначе null: чужие пути не читаем
    async resolve(id, rel) {
        if (typeof rel !== 'string' || !(await this.cached(id)) || !this.memo.get(id)?.files.has(rel)) return null;
        const root = await this.contentRoot(id);
        if (!root) return null;
        const file = path.resolve(root, rel);
        if (!file.startsWith(path.resolve(root) + path.sep)) return null;
        return { root, file };
    }

    // Картинка целиком, расшифрованная: { data, type }
    async image(id, rel) {
        const found = await this.resolve(id, rel);
        if (!found) return null;
        const data = decrypt(await fsp.readFile(found.file), (await this.system(found.root)).encryptionKey);
        // Тип — по содержимому: в репаках под именем .png бывает WebP
        const magic = data.subarray(0, 12).toString('latin1');
        const type = magic.startsWith('RIFF') && magic.endsWith('WEBP') ? 'image/webp'
            : data[0] === 0xff && data[1] === 0xd8 ? 'image/jpeg' : 'image/png';
        return { data, type };
    }

    // Миниатюра шириной 360 — WebP в _media/<игра>/gallery/. Делаем не больше трёх сразу
    // Одна и та же миниатюра, запрошенная дважды сразу, делается один раз
    thumb(id, rel) {
        const key = `${id}\n${rel}`;
        this.thumbsInFlight = this.thumbsInFlight || new Map();
        if (!this.thumbsInFlight.has(key)) {
            this.thumbsInFlight.set(key, this.makeThumb(id, rel).finally(() => this.thumbsInFlight.delete(key)));
        }
        return this.thumbsInFlight.get(key);
    }

    async makeThumb(id, rel) {
        const found = await this.resolve(id, rel);
        if (!found) return null;
        const out = path.join(this.mediaDir, id, 'gallery', `${crypto.createHash('sha1').update(`v2\n${rel}`).digest('hex').slice(0, 20)}.webp`);
        if (await fsp.access(out).then(() => true, () => false)) return out;
        await this.slot();
        try {
            if (await fsp.access(out).then(() => true, () => false)) return out;
            const img = await this.image(id, rel);
            await fsp.mkdir(path.dirname(out), { recursive: true });
            // Картинка приходит в поток (она расшифрована в памяти), а WebP — в файл: в потоке ffmpeg
            // не может вписать размер в заголовок WebP, и браузер такую картинку мог не показать
            const tmp = `${out}.${process.pid}.tmp`;
            try {
                await new Promise((resolve, reject) => {
                    const proc = spawn('ffmpeg', ['-v', 'error', '-y', '-i', 'pipe:0', '-frames:v', '1', '-vf', `scale='min(${THUMB_WIDTH},iw)':-2`, '-c:v', 'libwebp', '-quality', '70', '-f', 'webp', tmp]);
                    proc.on('error', reject);
                    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg: ${code}`))));
                    proc.stdin.on('error', () => {});
                    proc.stdin.end(img.data);
                });
                await fsp.rename(tmp, out);
            } finally {
                await fsp.rm(tmp, { force: true });
            }
            return out;
        } finally {
            this.release();
        }
    }

    // Открыли галерею — обложки первых экранов каждого раздела делаем заранее, по одной: пока
    // смотрят первую вкладку, вторая уже готова. Раз за запуск сервера на игру
    prewarm(id, index) {
        this.warmed = this.warmed || new Set();
        if (this.warmed.has(id)) return;
        this.warmed.add(id);
        const covers = ['cg', 'portrait', 'backdrop'].flatMap((kind) => index.albums.filter((a) => a.kind === kind).slice(0, 48).map((a) => a.cover || a.files[0]));
        (async () => {
            for (const rel of covers) await this.thumb(id, rel).catch(() => {});
        })();
    }

    slot() {
        if (this.thumbJobs < 3) { this.thumbJobs++; return Promise.resolve(); }
        return new Promise((resolve) => this.thumbQueue.push(resolve));
    }

    release() {
        const next = this.thumbQueue.shift();
        if (next) next(); else this.thumbJobs--;
    }

    // Фоном — оглавления всех игр, у которых их нет, по одной и с паузами: открыть галерею — сразу
    start(listIds) {
        const run = async () => {
            for (const id of await listIds()) {
                if (await this.cached(id)) continue;
                await this.build(id).promise;
                await new Promise((r) => setTimeout(r, 2000));
            }
        };
        setTimeout(() => run().catch((e) => console.error('[Галерея]', e.message)), 10 * 60 * 1000).unref();
    }
}

module.exports = new GalleryService();
module.exports.GalleryService = GalleryService;
module.exports.classify = classify;
module.exports.albumKey = albumKey;
module.exports.pngSize = pngSize;
module.exports.decrypt = decrypt;

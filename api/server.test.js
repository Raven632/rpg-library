const test = require('node:test');
const assert = require('node:assert');

// 1. Правильный импорт мидлвары (она обычная функция)
const { requireAuth } = require('./src/routes/auth.js');
const dbService = require('./src/db/database.js');
const { isSafeSegment } = require('./src/utils/validate.js');

// 2. Правильный импорт скрапера (это ЭКЗЕМПЛЯР КЛАССА, импортируем целиком)
const scraperService = require('./src/services/scraper.js');
// Имя куки задаётся через .env (в dev оно своё — auth_token_dev),
// поэтому тест обязан спрашивать его там же, где код, а не писать строку руками
const COOKIE_NAME = process.env.AUTH_COOKIE_NAME || 'auth_token';

// Тесты не тратят кредиты ScraperAPI и не трогают его дневной счётчик: ключ из окружения
// (в контейнере dev он настоящий) убираем. Тесты, которым он нужен, ставят свой и подменяют fetch
delete process.env.SCRAPER_API_KEY;

// ============================================================================
// requireAuth tests (Проверка авторизации)
// ============================================================================

test('requireAuth: GET/POST без куки возвращает 401', () => {
  const req = { method: 'GET', cookies: {} };
  let statusCode;
  let payload;
  let nextCalled = false;

  const res = {
    status(code) {
      statusCode = code;
      return { json(body) { payload = body; } };
    }
  };

  requireAuth(req, res, () => { nextCalled = true; });

  assert.strictEqual(nextCalled, false, 'next() не должен вызываться');
  assert.strictEqual(statusCode, 401, 'Ожидается HTTP 401');
  assert.ok(payload && payload.error, 'Должен быть текст ошибки');
});

test('requireAuth: запрос с неверным токеном возвращает 401', () => {
  const req = { method: 'POST', cookies: { [COOKIE_NAME]: 'WRONG_TOKEN_123' } };
  let statusCode;
  let nextCalled = false;

  const res = {
    status(code) {
      statusCode = code;
      return { json() {} };
    }
  };

  requireAuth(req, res, () => { nextCalled = true; });

  assert.strictEqual(nextCalled, false, 'next() не должен вызываться при неверном токене');
  assert.strictEqual(statusCode, 401, 'Ожидается HTTP 401');
});

test('requireAuth: запрос с правильным токеном пропускается', (t) => {
  const originalToken = dbService.sessionToken;
  dbService.sessionToken = 'test_token_123';
  t.after(() => { dbService.sessionToken = originalToken; });

  const req = { method: 'POST', cookies: { [COOKIE_NAME]: 'test_token_123' } };
  const res = {};
  let nextCalled = false;

  requireAuth(req, res, () => { nextCalled = true; });

  assert.strictEqual(nextCalled, true, 'Запрос с валидным токеном должен проходить');
});

test('requireAuth: пустой токен сервера (до init) не пропускает пустую куку', (t) => {
  const originalToken = dbService.sessionToken;
  dbService.sessionToken = '';
  t.after(() => { dbService.sessionToken = originalToken; });

  const req = { method: 'GET', cookies: { [COOKIE_NAME]: '' } };
  let statusCode;
  let nextCalled = false;
  const res = { status(code) { statusCode = code; return { json() {} }; } };

  requireAuth(req, res, () => { nextCalled = true; });

  assert.strictEqual(nextCalled, false, 'next() не должен вызываться');
  assert.strictEqual(statusCode, 401, 'Ожидается HTTP 401');
});

test('requireAuth: старый захардкоженный fallback-токен больше не работает', () => {
  const req = { method: 'GET', cookies: { [COOKIE_NAME]: 'fallback_secret_key_for_dev' } };
  let statusCode;
  let nextCalled = false;
  const res = { status(code) { statusCode = code; return { json() {} }; } };

  requireAuth(req, res, () => { nextCalled = true; });

  assert.strictEqual(nextCalled, false, 'next() не должен вызываться');
  assert.strictEqual(statusCode, 401, 'Ожидается HTTP 401');
});

// ============================================================================
// isSafeSegment tests (Защита id игры от "." / ".." / слэшей)
// ============================================================================

test('isSafeSegment: отбивает опасные значения', () => {
  for (const bad of ['', '.', '..', '../x', 'a/b', '/etc', 'x/..', undefined, null, 42]) {
    assert.strictEqual(isSafeSegment(bad), false, `Должен отбить: ${JSON.stringify(bad)}`);
  }
});

test('isSafeSegment: пропускает реальные имена папок игр', () => {
  for (const good of ['Starfall Inn', 'Mira\'s Potion Shop v1.2', 'Clockwork_ Garden of Gears', 'Starfall-Inn-1.08', '...json']) {
    assert.strictEqual(isSafeSegment(good), true, `Должен пропустить: ${good}`);
  }
});

// ============================================================================
// Название из имени папки
// ============================================================================

const fsp = require('fs').promises;

test('titleFromFolder: всё после номера версии — служебный хвост', () => {
  const t = (f) => scraperService.titleFromFolder(f);
  assert.strictEqual(t('Echoes_of_the_Old_Lighthouse_1.4-Moon_Studio'), 'Echoes of the Old Lighthouse');
  assert.strictEqual(t('starfall-inn-2.01-rus__example.site'), 'starfall inn');
  assert.strictEqual(t('celestia-ver-1.07-cn-mod-55.6-fixed2-rus__example.site'), 'celestia');
  // Число без точки — часть названия, а не версия
  assert.strictEqual(t('Tiny_Quest_2-v1.0'), 'Tiny Quest 2');
  // Точки между словами — пробелы, точка в версии — нет
  assert.strictEqual(t('Lantern.Keeper.Northern.Isles.KG'), 'Lantern Keeper Northern Isles KG');
  assert.strictEqual(t('Game.Name.v1.03'), 'Game Name', 'точка в версии — не пробел, версия срезана');
});

// ============================================================================
// Политика поиска метаданных (итог попытки и срок следующей)
// ============================================================================

const plan = require('./src/utils/scrapeplan.js');

test('scrapeplan: итог считается по тому, что у игры осталось после попытки', () => {
    const full = { tags: '["rpg"]', link: 'https://store.steampowered.com/app/1', screens: '["a.jpg"]' };
    assert.strictEqual(plan.statusOfRow(full), 'ok');
    assert.strictEqual(plan.statusOfRow({ ...full, screens: '[]' }), 'partial', 'теги есть, картинок нет');
    // Поиск упал, но теги остались с прошлого раза — игра не становится «не найденной»
    assert.strictEqual(plan.statusOfRow({ ...full, screens: '[]' }, ['store.steampowered.com']), 'partial');
    assert.strictEqual(plan.statusOfRow({ tags: '[]' }), 'not_found', 'все ответили «нет»');
    assert.strictEqual(plan.statusOfRow({ tags: '[]' }, ['store.steampowered.com']), 'error', 'кто-то не ответил');
});

test('scrapeplan: паузы растут, а после последней автопоиск останавливается', () => {
    const now = 1_000_000;
    assert.deepStrictEqual(plan.planNext('ok', 3, now), { attempts: 0, retryAt: null }, 'успех обнуляет счётчик');

    let attempts = 0;
    const delays = [];
    for (;;) {
        const next = plan.planNext('not_found', attempts, now);
        attempts = next.attempts;
        if (next.retryAt === null) break;
        delays.push(next.retryAt - now);
    }
    assert.deepStrictEqual(delays, plan.DELAYS.not_found);
    for (let i = 1; i < delays.length; i++) assert.ok(delays[i] > delays[i - 1], 'каждая пауза длиннее предыдущей');

    // Сбой источника — временная беда: первая повторная попытка через час, а не через сутки
    assert.strictEqual(plan.planNext('error', 0, now).retryAt - now, plan.HOUR);
});

test('lookupMetadata: «нигде нет» и «не смогли спросить» — разные итоги', async (t) => {
    const originalFetch = global.fetch;
    t.after(() => { global.fetch = originalFetch; });

    // Все источники ответили, но пусто
    global.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' });
    const none = await scraperService.lookupMetadata('Totally Unknown Game', '');
    assert.strictEqual(none.data, null);
    assert.deepStrictEqual(none.failed, [], 'никто не упал — значит честное «не найдено»');

    // Сеть лежит
    global.fetch = async () => { throw new Error('ECONNRESET'); };
    const down = await scraperService.lookupMetadata('Totally Unknown Game', '');
    assert.strictEqual(down.data, null);
    assert.ok(down.failed.length > 0, 'упавшие источники попали в отчёт');
    assert.ok(down.failed.includes('store.steampowered.com'), `ожидали Steam в ${JSON.stringify(down.failed)}`);
    assert.ok(down.failed.includes('api.vndb.org'), `ожидали VNDB в ${JSON.stringify(down.failed)}`);

    // Лимит 429 — тоже «не смогли спросить», хотя сеть в порядке
    global.fetch = async () => ({ ok: false, status: 429, json: async () => ({}), text: async () => '' });
    const limited = await scraperService.lookupMetadata('Totally Unknown Game', '');
    assert.ok(limited.failed.length > 0);
});

// ============================================================================
// gamelang: язык по тексту самой игры
// ============================================================================

const os = require('os');
const path = require('path');
const { detectGameLanguages } = require('./src/utils/gamelang.js');

// Настоящая папка игры во временном каталоге: детектор читает файлы сам
async function makeGame(t, files) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'rpg-lang-'));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) {
    await fsp.mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await fsp.writeFile(path.join(dir, name), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return dir;
}
const say = (lines) => ({ events: [null, { pages: [{ list: lines.map(s => ({ code: 401, parameters: [s] })) }] }] });

test('gamelang: русский перевод японской игры', async (t) => {
  const phrase = 'Ты правда думаешь, что мы успеем дойти до города до заката? Нам ещё идти через лес.';
  const dir = await makeGame(t, {
    'data/System.json': { locale: 'ja_JP' },
    // Имена карт видит только автор — по ним и узнаём язык оригинала
    'data/MapInfos.json': [null, { name: 'はじまりの村' }, { name: 'まおうのしろ' }],
    'data/Map001.json': say(Array(20).fill(phrase)),
  });
  assert.deepStrictEqual(await detectGameLanguages(dir), { main: 'ru', langs: ['ru'], original: 'ja' });
});

test('gamelang: таблица переводов даёт все языки, коды \\REM_MAP[...] — не текст', async (t) => {
  const ja = 'はぁ……いい天気だな。今日はどこへ行こうか。';
  const en = 'Hah… the weather feels great. Where should we go today, and what do you want to do?';
  const csv = ['Original,jp,en', ...Array(40).fill(`"${ja}","${ja}","${en}"`)].join('\n');
  const dir = await makeGame(t, {
    'data/System.json': { locale: 'en_US' },
    'data/MapInfos.json': [null, { name: 'Town' }],
    // Карты, где вместо реплик ссылки на файлы перевода
    'data/Map001.json': say(Array(50).fill('\\REM_MAP[map17_ev63_p2_hero_15]')),
    'game_messages.csv': csv,
  });
  const found = await detectGameLanguages(dir);
  assert.deepStrictEqual([...found.langs].sort(), ['en', 'ja']);
});

// ============================================================================
// Название для показа и версия
// ============================================================================

const { presentTitle, extractVersion } = require('./src/utils/title.js');

test('presentTitle: срезает версии и подписи переводчиков, подзаголовок оставляет', () => {
  const show = (raw, folder = '') => presentTitle(raw, { folder }).title;
  assert.strictEqual(show('Silver Bell v1.0.9 | TL: Marlow & Co'), 'Silver Bell');
  assert.strictEqual(show("Moonlit Harbor: The Keeper's Daughter 1.3.0 Steam 04/17/2342"), "Moonlit Harbor: The Keeper's Daughter");
  assert.strictEqual(show('Звёздный трактир 2.01 (Перевод:Marlow)'), 'Звёздный трактир');
  assert.strictEqual(show('Echoes of the Old Lighthouse Production Version 1.4'), 'Echoes of the Old Lighthouse');
  assert.strictEqual(show('Mira s Potion Shop ver1.03'), "Mira's Potion Shop");
  assert.strictEqual(show('Tale of Stars ~Even Stars Fall, Captain Mira Sails On~ 1.04'), 'Tale of Stars ~Even Stars Fall, Captain Mira Sails On~');
  assert.strictEqual(show('Nebel Sternenjäger ~ The First Lamp Steam EN1.12 | Перевод: Marlow'), 'Nebel Sternenjäger ~ The First Lamp');
  // Число без точки — часть названия
  assert.strictEqual(show('Tiny Quest 2'), 'Tiny Quest 2');
});

test('presentTitle: японское название заменяет английское из имени папки', () => {
  const starfall = presentTitle('スターフォール［メッセージ非表示：右クリック | 文章スキップ：Control］', { folder: 'Starfall_v26.08.02' });
  assert.deepStrictEqual(starfall, { title: 'Starfall', original: 'スターフォール' });
  // Английского взять неоткуда — остаётся как есть
  assert.strictEqual(presentTitle('フロンティアガーディアン最新', { folder: 'フロンティア' }).title, 'フロンティアガーディアン最新');
  // Сокращённое имя игры уступает полному из папки
  assert.strictEqual(presentTitle('Lantern 1.2', { folder: 'The_Lantern_Keeper_of_the_Northern_Isles_v1.2_Windows' }).title,
    'The Lantern Keeper of the Northern Isles');
});

test('extractVersion: из названия, иначе из папки; версия перевода после «|» не считается', () => {
  assert.strictEqual(extractVersion('A Knight Who Never Yields to the Storm_v1.0.4', ''), '1.0.4');
  assert.strictEqual(extractVersion('Star Lantern （ver1.19）', ''), '1.19');
  assert.strictEqual(extractVersion('Adventurer Karen', 'Adventurer_Karen'), '');
  assert.strictEqual(extractVersion('Going to the caves', 'Going to the caves 2.0.0v'), '2.0.0');
  assert.strictEqual(extractVersion('Лисички никогда не сдаются v1', 'fox-girls-never-give-up-ver1.03-rus__example.site'), '1.03');
  assert.strictEqual(extractVersion('Nebel | Версия перевода: 1.0', ''), '');
});

// ============================================================================
// itch.io
// ============================================================================

test('itch.io: ссылка на игру — из строки ссылок; страница автора и сам itch.io — не игра', () => {
  const { itchGameUrl } = require('./src/utils/itch.js');
  assert.strictEqual(itchGameUrl('https://store.steampowered.com/app/1,https://Moon-Studio.itch.io/Starfall-Inn/devlog/1'), 'https://moon-studio.itch.io/starfall-inn');
  assert.strictEqual(itchGameUrl('https://moon-studio.itch.io/'), '');
  assert.strictEqual(itchGameUrl('https://itch.io/games/made-with-rpg-maker'), '');
  assert.strictEqual(itchGameUrl('https://www.itch.io/game'), '');
});

test('itch.io: лента каталога — название, жанр, цена, платформы, даты', () => {
  const { parseItchRss } = require('./src/utils/itch.js');
  const xml = `<rss><channel><title>Latest games made with RPG Maker - itch.io</title>
    <item><guid>https://moon-studio.itch.io/starfall-inn</guid><title>Starfall Inn [Free] [Role Playing] [Windows]</title><plainTitle>Starfall Inn</plainTitle>
      <price>$0.00</price><currency>USD</currency><platforms><windows>yes</windows></platforms>
      <description><![CDATA[A cozy RPG about running an inn at the edge of the world.
<img alt="Starfall Inn" src="https://img.itch.zone/a/315x250/x.png"/>]]></description>
      <imageurl>https://img.itch.zone/a/315x250/x.png</imageurl><link>https://moon-studio.itch.io/starfall-inn</link>
      <createDate>Tue, 01 Sep 2026 11:40:09 GMT</createDate><updateDate>Thu, 24 Sep 2026 18:31:23 GMT</updateDate></item>
    <item><guid>https://pixelbox.itch.io/clockwork-garden</guid><title>Clockwork Garden [$5.00] [Adventure] [Windows]</title><plainTitle>Clockwork Garden &amp; co</plainTitle>
      <price>$5.00</price><platforms><windows>yes</windows><html>yes</html></platforms><link>https://pixelbox.itch.io/clockwork-garden</link></item>
  </channel></rss>`;
  const [a, b] = parseItchRss(xml);
  assert.deepStrictEqual([a.title, a.creator, a.genre, a.price, a.platforms, a.description],
    ['Starfall Inn', 'moon-studio', 'Role Playing', '', ['windows'], 'A cozy RPG about running an inn at the edge of the world.']);
  assert.strictEqual(a.updatedAt, Date.parse('Thu, 24 Sep 2026 18:31:23 GMT'));
  assert.deepStrictEqual([b.title, b.price, b.platforms], ['Clockwork Garden & co', '$5.00', ['windows', 'html']]);
});

test('itch.io: страница игры — описание до «More information», теги, автор, оценка, кадры', () => {
  const { parseItchPage } = require('./src/utils/itch.js');
  const html = `<html><head><meta content="https://img.itch.zone/c/original/cover.png" property="og:image"/></head><body>
    <h1 itemprop="name" class="game_title">Starfall Inn</h1>
    <div class="formatted_description user_formatted"><p>An RPG made with RPG Maker MZ.</p><h1>Summary</h1><p>Follow Mira&#x27;s adventure.</p></div>
    <div class="more_information_toggle"></div><div class="game_info_panel_widget"><table>
    <tr><td>Updated</td><td><abbr title="26 September 2026 @ 17:43 UTC">12 hours ago</abbr></td></tr>
    <tr><td>Rating</td><td><div data-tooltip="4.39 average rating from 802 total ratings"></div></td></tr>
    <tr><td>Author</td><td><a href="https://moon-studio.itch.io">moon-studio</a></td></tr>
    <tr><td>Made with</td><td><a href="https://itch.io/games/made-with-rpg-maker">RPG Maker</a></td></tr>
    <tr><td>Tags</td><td><a href="https://itch.io/games/tag-fantasy">Fantasy</a>, <a href="https://itch.io/games/tag-cozy">cozy</a></td></tr>
    </table></div>
    <div class="screenshot_list"><a href="https://img.itch.zone/s1/original/1.png"><img/></a><a href="https://img.itch.zone/s2/original/2.png"><img/></a></div>
    <a href="https://img.itch.zone/other/original/not-a-screenshot.png"></a></body></html>`;
  const p = parseItchPage(html, 'https://moon-studio.itch.io/starfall-inn/');
  assert.strictEqual(p.title, 'Starfall Inn');
  assert.strictEqual(p.description, "An RPG made with RPG Maker MZ.\nSummary\nFollow Mira's adventure.");
  assert.deepStrictEqual([p.developer, p.madeWith, p.tags, p.updated], ['moon-studio', 'RPG Maker', ['Fantasy', 'cozy'], '2026-09-26']);
  assert.deepStrictEqual(p.rating, { value: 4.39, count: 802 });
  assert.strictEqual(p.coverUrl, 'https://img.itch.zone/c/original/cover.png');
  assert.deepStrictEqual(p.screens, ['https://img.itch.zone/s1/original/1.png', 'https://img.itch.zone/s2/original/2.png']);
  assert.strictEqual(parseItchPage('<html>Just a moment...</html>', 'x'), null);
});

test('itch.io: каталог — адрес ленты по фильтрам, «в библиотеке», пауза после отказа', async (t) => {
  const itch = require('./src/services/itch.js');
  const { open } = require('sqlite');
  const sqlite3 = require('sqlite3');
  const db = await open({ filename: ':memory:', driver: sqlite3.Database });
  await db.exec('CREATE TABLE games (id TEXT PRIMARY KEY, link TEXT, ready INTEGER DEFAULT 1)');
  await db.run("INSERT INTO games (id, link) VALUES ('Starfall_Inn', 'https://store.steampowered.com/app/1,https://moon-studio.itch.io/starfall-inn')");
  const prev = { db: itch.dbService, paused: itch.pausedUntil };
  itch.setDependencies({ get: () => db });
  const { redisClient } = require('./src/utils/cache.js');
  t.mock.method(redisClient, 'get', async () => null);
  t.mock.method(redisClient, 'set', async () => 'OK');
  t.after(async () => { itch.setDependencies(prev.db); itch.pausedUntil = prev.paused; await db.close(); });

  assert.strictEqual(itch.feedUrl({ sort: 'newest', days: 7, price: 'free', web: true, tags: ['horror', 'fantasy'], page: 2 }),
    'https://itch.io/games/newest/last-7-days/free/made-with-rpg-maker/platform-web/tag-horror/tag-fantasy.xml?page=2');
  assert.strictEqual(itch.feedUrl({}), 'https://itch.io/games/made-with-rpg-maker.xml');

  let asked = '', status = 200;
  t.mock.method(globalThis, 'fetch', async (url) => {
    asked = String(url);
    return { status, ok: status === 200, text: async () => '<rss><item><plainTitle>Starfall Inn</plainTitle><link>https://moon-studio.itch.io/starfall-inn</link><price>$0.00</price></item></rss>' };
  });
  // Неизвестные сортировка, период, цена и теги отбрасываются
  const res = await itch.latest({ sort: 'weird', days: '5', price: 'cheap', tags: 'fantasy,../../x,horror,unknown' });
  assert.strictEqual(asked, 'https://itch.io/games/made-with-rpg-maker/tag-fantasy/tag-horror.xml');
  assert.deepStrictEqual([res.page, res.more, res.items[0].game], [1, false, { id: 'Starfall_Inn' }]);

  // «Слишком часто»: минуту itch.io не спрашиваем вовсе
  status = 429;
  await assert.rejects(() => itch.latest({ sort: 'newest' }), (e) => e.limited === true);
  asked = '';
  await assert.rejects(() => itch.latest({ sort: 'top-rated' }), (e) => e.limited === true);
  assert.strictEqual(asked, '', 'во время паузы запросов нет');
});

test('itch.io: ссылка у игры даёт описание, автора и кадры в поиске метаданных', async (t) => {
  const scraper = require('./src/services/scraper.js');
  const page = `<meta content="https://img.itch.zone/c/original/cover.png" property="og:image"/><h1 class="game_title">Some Game</h1>
    <div class="formatted_description user_formatted"><p>A story about a witch.</p></div><div class="more_information_toggle"></div>
    <table><tr><td>Author</td><td><a href="https://dev.itch.io">dev</a></td></tr>
    <tr><td>Tags</td><td><a href="https://itch.io/games/tag-fantasy">Fantasy</a></td></tr></table>
    <div class="screenshot_list"><a href="https://img.itch.zone/s1/original/1.png"></a></div>`;
  const prevKey = process.env.SCRAPER_API_KEY;
  process.env.SCRAPER_API_KEY = 'test';
  t.after(() => { if (prevKey === undefined) delete process.env.SCRAPER_API_KEY; else process.env.SCRAPER_API_KEY = prevKey; });
  // Кэш страниц itch.io — в Redis; в тесте его нет, иначе второй прогон брал бы из кэша
  const { redisClient } = require('./src/utils/cache.js');
  t.mock.method(redisClient, 'get', async () => null);
  t.mock.method(redisClient, 'set', async () => 'OK');
  const asked = [];
  t.mock.method(scraper, 'fetchViaScraper', async (url) => { asked.push(url); return url.includes('dev.itch.io/some-game') ? page : null; });
  // Остальные источники по названию ничего не находят
  for (const name of ['fetchVNDBMetadata', 'fetchSteamMetadata']) t.mock.method(scraper, name, async () => null);

  const { data } = await scraper.lookupMetadata('Some Game', 'https://dev.itch.io/some-game');
  assert.ok(asked.includes('https://dev.itch.io/some-game'));
  assert.deepStrictEqual([data.description, data.developer, data.tags, data.coverUrl, data.screens],
    ['A story about a witch.', 'dev', ['Fantasy'], 'https://img.itch.zone/c/original/cover.png', ['https://img.itch.zone/s1/original/1.png']]);
  assert.ok(data.link.includes('https://dev.itch.io/some-game'));
});

test('ScraperAPI: дневной запас — в кредитах по цене из ответа; дороже остатка ScraperAPI не выполнит', async (t) => {
  const scraper = require('./src/services/scraper.js');
  const { redisClient } = require('./src/utils/cache.js');
  const prev = { key: process.env.SCRAPER_API_KEY, limit: process.env.SCRAPER_DAILY_LIMIT };
  process.env.SCRAPER_API_KEY = 'test';
  process.env.SCRAPER_DAILY_LIMIT = '12';
  t.after(() => {
    for (const [name, value] of [['SCRAPER_API_KEY', prev.key], ['SCRAPER_DAILY_LIMIT', prev.limit]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });
  let used = 0;
  t.mock.method(redisClient, 'get', async () => String(used));
  t.mock.method(redisClient, 'incrBy', async (key, n) => (used += n));
  t.mock.method(redisClient, 'expire', async () => true);
  t.mock.method(console, 'warn', () => {});
  // Как ScraperAPI: страница itch.io — 10 кредитов, простая страница — 1; цена — в заголовке,
  // дороже max_cost — отказ без списания
  const asked = [];
  t.mock.method(globalThis, 'fetch', async (input) => {
    const url = String(input);
    asked.push(url);
    const cost = decodeURIComponent(url).includes('itch.io') ? 10 : 1;
    const headers = new Headers({ 'sa-credit-cost': String(cost) });
    if (cost > Number(new URL(url).searchParams.get('max_cost'))) return { ok: false, status: 403, headers, text: async () => 'This request exceeds your max_cost.' };
    return { ok: true, status: 200, headers, text: async () => 'page' };
  });

  assert.strictEqual(await scraper.fetchViaScraper('https://dev.itch.io/a'), 'page');
  assert.ok(asked[0].includes('max_cost=12'), asked[0]);
  assert.strictEqual(used, 10, 'списано по цене из ответа, а не «кредит за запрос»');
  // Осталось 2: вторая страница itch.io дороже — ScraperAPI отказал и не списал
  assert.strictEqual(await scraper.fetchViaScraper('https://dev.itch.io/b'), null);
  assert.strictEqual(used, 10);
  // Страница за кредит проходит, пока запас есть
  assert.strictEqual(await scraper.fetchViaScraper('https://example.com/page'), 'page');
  assert.strictEqual(await scraper.fetchViaScraper('https://example.com/page'), 'page');
  assert.strictEqual(used, 12);
  // Запас кончился — запросов нет вовсе
  const sent = asked.length;
  assert.strictEqual(await scraper.fetchViaScraper('https://example.com/page'), null);
  assert.strictEqual(asked.length, sent);

  // Окно «Новинки»: страница itch.io не открылась, а запаса меньше её цены — окно скажет, что до завтра
  const itch = require('./src/services/itch.js');
  assert.strictEqual(await itch.budgetSpent(), true);
  used = 0;
  assert.strictEqual(await itch.budgetSpent(), false);
});

// ============================================================================
// «Хочу поиграть»
// ============================================================================

const WISHLIST_TABLE = `CREATE TABLE wishlist (
  key TEXT PRIMARY KEY, source TEXT NOT NULL, ref TEXT NOT NULL, url TEXT NOT NULL,
  info TEXT NOT NULL DEFAULT '{}', addedAt INTEGER NOT NULL DEFAULT 0)`;

// Список на базе в памяти; чьи игры в библиотеке — подставной источник
async function wishlistTestDb(t, { library = new Map() } = {}) {
  const { open } = require('sqlite');
  const sqlite3 = require('sqlite3');
  const db = await open({ filename: ':memory:', driver: sqlite3.Database });
  await db.exec(WISHLIST_TABLE);
  const wishlist = require('./src/services/wishlist.js');
  const prev = { db: wishlist.dbService, sources: wishlist.sources };
  wishlist.setDependencies({ get: () => db }, { itch: { libraryGames: async () => library } });
  t.after(async () => { wishlist.setDependencies(prev.db, prev.sources); await db.close(); });
  return { db, wishlist };
}

test('«Хочу поиграть»: что сохраняем — только известные поля, картинки своего сайта, адрес собираем сами', () => {
  const { normalize } = require('./src/services/wishlist.js');
  const itch = normalize({ source: 'itch', url: 'https://Moon-Studio.itch.io/Starfall-Inn', title: 'Starfall Inn', evil: '<script>',
    cover: 'https://img.itch.zone/a.png', screens: ['javascript:alert(1)', 'https://evil.example/x.png', 'https://img.itch.zone/2.png'],
    platforms: ['windows', 'dos'] });
  assert.deepStrictEqual([itch.key, itch.url, itch.info.cover, itch.info.screens, itch.info.platforms, itch.info.evil],
    ['itch:https://moon-studio.itch.io/starfall-inn', 'https://moon-studio.itch.io/starfall-inn', 'https://img.itch.zone/a.png',
      ['https://img.itch.zone/2.png'], ['windows'], undefined]);
  assert.strictEqual(normalize({ source: 'itch', url: 'https://moon-studio.itch.io/x', cover: 'http://img.itch.zone/a.png' }).info.cover, '',
    'картинка не по https — не берём');
  for (const bad of [{ source: 'steam', id: 1 }, { source: 'itch', url: 'https://itch.io/games' }, { source: 'itch', url: 'javascript:alert(1)' }, {}]) {
    assert.strictEqual(normalize(bad), null, JSON.stringify(bad));
  }
});

test('«Хочу поиграть»: добавить, убрать, «в библиотеке»', async (t) => {
  const { db, wishlist } = await wishlistTestDb(t, { library: new Map([['https://moon-studio.itch.io/starfall-inn', 'Starfall_Inn']]) });
  const { setIo } = require('./src/utils/cache.js');
  const events = [];
  setIo({ emit: (name) => events.push(name) });
  t.after(() => setIo(null));

  await wishlist.add({ source: 'itch', url: 'https://moon-studio.itch.io/starfall-inn', title: 'Starfall Inn' });
  await wishlist.add({ source: 'itch', url: 'https://dev.itch.io/some-game', title: 'Some' });
  await assert.rejects(() => wishlist.add({ source: 'itch', url: 'https://itch.io/' }), (e) => e.bad === true);
  const { items } = await wishlist.list();
  assert.deepStrictEqual(items.map(x => x.key).sort(), ['itch:https://dev.itch.io/some-game', 'itch:https://moon-studio.itch.io/starfall-inn']);
  const by = Object.fromEntries(items.map(x => [x.key, x]));
  assert.deepStrictEqual(by['itch:https://moon-studio.itch.io/starfall-inn'].game, { id: 'Starfall_Inn' }, 'уже в библиотеке');
  assert.strictEqual(by['itch:https://dev.itch.io/some-game'].game, undefined);

  // Добавили ещё раз — снимок обновляется, запись одна
  await wishlist.add({ source: 'itch', url: 'https://dev.itch.io/some-game', title: 'Some (новое название)' });
  const again = await db.all("SELECT * FROM wishlist WHERE key = 'itch:https://dev.itch.io/some-game'");
  assert.deepStrictEqual([again.length, JSON.parse(again[0].info).title], [1, 'Some (новое название)']);

  assert.strictEqual(await wishlist.remove('itch:https://dev.itch.io/some-game'), true);
  assert.strictEqual(await wishlist.remove('itch:https://dev.itch.io/some-game'), false);
  assert.strictEqual((await wishlist.list()).items.length, 1);
  assert.ok(events.includes('wishlist-changed'), 'другие устройства узнают об изменении');
});

// ============================================================================
// Поиск по названию: полные названия, слитные слова, readme, сверка
// ============================================================================

test('названия: слитные слова, хвост релиза, порядок поиска и сверка по полному', () => {
  const { splitWords, stripRelease, searchNames, bestSimilarity, titleSimilarity, presentTitle } = require('./src/utils/title.js');
  assert.strictEqual(splitWords('SkyKnight TheCrystalLabyrinth'), 'Sky Knight The Crystal Labyrinth');
  assert.strictEqual(splitWords('TinyQuest3'), 'Tiny Quest 3');
  assert.strictEqual(splitWords('RPGMaker'), 'RPG Maker');
  assert.strictEqual(splitWords("Mira's Potion Shop"), "Mira's Potion Shop");
  assert.strictEqual(splitWords('星の迷宮 第3章'), '星の迷宮 第3章');
  assert.strictEqual(stripRelease('TinyQuest3 - English Release by Marlow'), 'TinyQuest3');
  assert.strictEqual(stripRelease('Some Game TL by Marlow'), 'Some Game');
  assert.strictEqual(stripRelease('Stand by Me'), 'Stand by Me');

  // Игра зовёт себя коротко, архив — полно: сверка только по полному
  const sk = searchNames(['SkyKnight ov1.0.0', 'SkyKnight TheCrystalLabyrinth', '']);
  assert.deepStrictEqual(sk.verify, ['SkyKnight TheCrystalLabyrinth']);
  assert.deepStrictEqual(sk.search, ['Sky Knight The Crystal Labyrinth', 'SkyKnight TheCrystalLabyrinth', 'Sky Knight', 'SkyKnight']);
  assert.ok(bestSimilarity('Sky Knight Quest', sk.verify) < 0.75, 'чужая игра с тем же началом не подходит');
  assert.strictEqual(bestSimilarity('Sky Knight: The Crystal Labyrinth', sk.verify), 1);

  // readme полнее всех — и японский подзаголовок сравнивается
  const tq = searchNames(['TinyQuest3', 'TinyQuest3 English Release by Marlow', 'Tiny Quest3 ～星の迷宮～']);
  assert.deepStrictEqual(tq.verify, ['Tiny Quest3 ～星の迷宮～']);
  assert.ok(tq.search.includes('Tiny Quest 3'));
  assert.ok(bestSimilarity('Tiny Quest 3', tq.verify) >= 0.9, 'название в магазине без подзаголовка подходит');
  assert.strictEqual(titleSimilarity('Tiny Quest 3 ～星の迷宮～', 'Tiny Quest3 ～星の迷宮～'), 1);
  assert.strictEqual(titleSimilarity('Pokémon Quest', 'Pokemon Quest'), 1);
  assert.ok(titleSimilarity('星の迷宮', '雪音の旅物語') < 0.3);

  // Карточка: полное имя из архива вместо слитного сокращения
  assert.strictEqual(presentTitle('SkyKnight ov1.0.0', { folder: 'SkyKnight_TheCrystalLabyrinth_1.0_EN072p' }).title, 'Sky Knight The Crystal Labyrinth');
  assert.strictEqual(presentTitle('TinyQuest3', { folder: 'TinyQuest3_-_English_Release_by_Marlow' }).title, 'Tiny Quest 3');
  assert.strictEqual(presentTitle('WhichSwitch', { folder: 'WhichSwitch_v1.0' }).title, 'WhichSwitch', 'два слова — не повод менять название');
});

test('название из readme: 『…』 в первой строке, UTF-8 и Shift_JIS', async (t) => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const scraper = require('./src/services/scraper.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'readme-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const a = path.join(root, 'a'); fs.mkdirSync(a);
  fs.writeFileSync(path.join(a, 'Credit.txt'), '『не то』');
  fs.writeFileSync(path.join(a, 'Readme.txt'), '﻿『Tiny Quest3 ～星の迷宮～』説明書\r\n\r\nこの度は…');
  assert.strictEqual(await scraper.readmeTitle(a), 'Tiny Quest3 ～星の迷宮～');
  // Shift_JIS: «『テスト』» — байты 81 77 83 65 83 58 83 67 81 78
  const b = path.join(root, 'b'); fs.mkdirSync(path.join(b, 'www'), { recursive: true });
  fs.writeFileSync(path.join(b, 'www', '説明書.txt'), Buffer.from([0x81, 0x77, 0x83, 0x65, 0x83, 0x58, 0x83, 0x67, 0x81, 0x78, 0x0d, 0x0a]));
  assert.strictEqual(await scraper.readmeTitle(b), 'テスト');
  assert.strictEqual(await scraper.readmeTitle(path.join(root, 'нет такой')), '');
});

test('поиск по названию: игра зовёт себя коротко — ищем по полному имени архива, чужую «Sky Knight Quest» не берём', async (t) => {
  const scraper = require('./src/services/scraper.js');
  const asked = [];
  let steamKnowsIt = true;
  t.mock.method(globalThis, 'fetch', async (input) => {
    const url = decodeURIComponent(String(input));
    asked.push(url);
    const json = (body) => ({ ok: true, status: 200, json: async () => body });
    if (url.includes('api.vndb.org')) return json({ results: [] });
    if (url.includes('storesearch')) {
      return json(steamKnowsIt && url.includes('Crystal')
        ? { items: [{ id: 77, name: 'Sky Knight: The Crystal Labyrinth' }] }
        : { items: [{ id: 66, name: 'Sky Knight Quest' }] });
    }
    const id = (url.match(/appids=(\d+)/) || [])[1];
    if (id) return json({ [id]: { success: true, data: { name: 'x', short_description: `Game ${id}`, genres: [{ description: 'RPG' }], developers: ['Moon Studio'] } } });
    return { ok: false, status: 404 };
  });

  const { data } = await scraper.lookupMetadata('SkyKnight ov1.0.0', '', { altTitle: 'SkyKnight TheCrystalLabyrinth' });
  assert.strictEqual(data.link, 'https://store.steampowered.com/app/77');
  assert.deepStrictEqual([data.description, data.tags], ['Game 77', ['RPG']]);
  assert.ok(asked.some((u) => u.includes('storesearch/?term=Sky Knight The Crystal Labyrinth')), 'первым — полное название, слова раздельно');

  // В Steam только чужая «Sky Knight Quest»: с полным названием она не сходится — данных нет
  steamKnowsIt = false;
  const foreign = await scraper.lookupMetadata('SkyKnight ov1.0.0', '', { altTitle: 'SkyKnight TheCrystalLabyrinth' });
  assert.strictEqual(foreign.data, null);
});

test('картинки игры: имена по содержимому, прежние — на удаление после записи базы, своя обложка не трогается', async (t) => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const scraper = require('./src/services/scraper.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'media-'));
  const prevDir = scraper.GAMES_DIR;
  scraper.GAMES_DIR = root;
  t.after(() => { scraper.GAMES_DIR = prevDir; fs.rmSync(root, { recursive: true, force: true }); });
  // Без ffmpeg: картинка — это просто её байты, размер — как у кадра
  t.mock.method(scraper, 'toJpeg', async (raw) => raw);
  t.mock.method(scraper, 'jpegSize', () => ({ width: 1280, height: 720 }));
  t.mock.method(scraper, 'imageFingerprint', async () => null);
  const image = (name) => Buffer.alloc(4096, name);
  t.mock.method(globalThis, 'fetch', async (url) => ({ ok: true, arrayBuffer: async () => image(String(url).slice(-1)) }));
  const dir = path.join(root, '_media', 'Game');
  fs.mkdirSync(dir, { recursive: true });
  // С прошлых версий: обложка и кадры под постоянными именами
  for (const f of ['cover.jpg', '1.jpg', '2.jpg', '3.jpg']) fs.writeFileSync(path.join(dir, f), 'old');

  const first = await scraper.saveGameMedia('Game', { coverUrl: 'https://x/a', screens: ['https://x/b', 'https://x/c'] },
    '_media/Game/cover.jpg', ['_media/Game/1.jpg', '_media/Game/2.jpg']);
  assert.match(first.cover, /^_media\/Game\/cover-[0-9a-f]{10}\.jpg$/);
  assert.deepStrictEqual(first.screens.map((p) => path.basename(p).replace(/-[0-9a-f]{10}/, '')), ['1.jpg', '2.jpg']);
  // На cover.jpg, 1.jpg и 2.jpg ещё смотрит база — их удалят потом; 3.jpg не нужен никому — удалён сразу
  assert.deepStrictEqual(first.stale.map((p) => path.basename(p)).sort(), ['1.jpg', '2.jpg', 'cover.jpg']);
  assert.ok(!fs.existsSync(path.join(dir, '3.jpg')));

  // Те же картинки ещё раз — те же адреса, удалять нечего
  for (const f of first.stale) fs.unlinkSync(f);
  const same = await scraper.saveGameMedia('Game', { coverUrl: 'https://x/a', screens: ['https://x/b', 'https://x/c'] }, first.cover, first.screens);
  assert.deepStrictEqual([same.cover, same.screens, same.stale], [first.cover, first.screens, []]);

  // Своя обложка: найденную обложку не пишем, кадры — как обычно
  const custom = await scraper.saveGameMedia('Game', { coverUrl: 'https://x/d', screens: ['https://x/e'] }, '_media/Game/cover_custom_1.jpg', first.screens);
  assert.strictEqual(custom.cover, null);
  assert.strictEqual(custom.screens.length, 1);
  assert.ok(fs.existsSync(path.join(root, first.cover)), 'прежняя найденная обложка на месте');
  // Ничего не нашлось — всё прежнее остаётся
  for (const f of custom.stale) fs.unlinkSync(f);
  const none = await scraper.saveGameMedia('Game', { coverUrl: '', screens: [] }, first.cover, custom.screens);
  assert.deepStrictEqual([none.cover, none.screens, none.stale], [null, [], []]);
  assert.ok([first.cover, ...custom.screens].every((p) => fs.existsSync(path.join(root, p))));
});

// Игра в базе в памяти: все поля, которые пишет applyLookup
async function lookupTestDb(t, row) {
  const { open } = require('sqlite');
  const sqlite3 = require('sqlite3');
  const db = await open({ filename: ':memory:', driver: sqlite3.Database });
  await db.exec(`CREATE TABLE games (id TEXT PRIMARY KEY, title TEXT, cover TEXT DEFAULT '', tags TEXT DEFAULT '[]', description TEXT DEFAULT '',
    developer TEXT DEFAULT '', releaseDate TEXT DEFAULT '', link TEXT DEFAULT '', screens TEXT DEFAULT '', scraped INTEGER DEFAULT 0, ready INTEGER DEFAULT 1,
    meta_status TEXT DEFAULT 'new', meta_attempts INTEGER DEFAULT 0, meta_retry_at INTEGER, meta_checked_at INTEGER DEFAULT 0, meta_error TEXT DEFAULT '', meta_locked TEXT DEFAULT '[]')`);
  const keys = Object.keys(row);
  await db.run(`INSERT INTO games (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, keys.map((k) => row[k]));
  const scraper = require('./src/services/scraper.js');
  const prev = { db: scraper.dbService, dir: scraper.GAMES_DIR };
  scraper.dbService = { get: () => db };
  const { redisClient } = require('./src/utils/cache.js');
  t.mock.method(redisClient, 'del', async () => 1);
  t.mock.method(scraper, 'saveGameMedia', async () => ({ cover: null, screens: [], stale: [] }));
  t.after(async () => { scraper.dbService = prev.db; scraper.GAMES_DIR = prev.dir; await db.close(); });
  return { db, scraper };
}

test('повторный поиск: чужая ссылка Steam уходит, если Steam ответил; вписанные руками ссылки не трогаем', async (t) => {
  const steam = 'https://store.steampowered.com/app/3451330';
  const itch = 'https://moon-studio.itch.io/sky-knight';
  const { db, scraper } = await lookupTestDb(t, { id: 'SkyKnight', title: 'SkyKnight ov1.0.0', link: steam, developer: 'Someone Else' });
  const found = { tags: ['rpg'], description: 'Edith…', developer: 'Moon Studio', releaseDate: '2026-09-09', link: itch };
  await scraper.applyLookup('SkyKnight', { data: found, failed: [] });
  let row = await db.get('SELECT * FROM games');
  assert.deepStrictEqual([row.link, row.developer], [itch, 'Moon Studio'], 'Steam ответил и игру не подтвердил — ссылки нет');

  // Steam не ответил — прежнюю ссылку держим: знание не теряем из-за сбоя
  await db.run('UPDATE games SET link = ?', [`${itch},${steam}`]);
  await scraper.applyLookup('SkyKnight', { data: found, failed: ['store.steampowered.com'] });
  row = await db.get('SELECT * FROM games');
  assert.strictEqual(row.link, `${itch},${steam}`);

  // Ссылку вписали руками — остаётся, что бы ни ответил Steam
  await db.run(`UPDATE games SET link = ?, meta_locked = '["link"]'`, [steam]);
  await scraper.applyLookup('SkyKnight', { data: found, failed: [] });
  assert.strictEqual((await db.get('SELECT link FROM games')).link, `${steam},${itch}`);
});

test('что подаём в поиск: ссылки Steam и VNDB, найденные по названию, — не как точные; вписанные руками — все', async (t) => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { db, scraper } = await lookupTestDb(t, {
    id: 'SkyKnight_TheCrystalLabyrinth_1.0_EN072p', title: 'SkyKnight ov1.0.0',
    link: 'https://moon-studio.itch.io/sky-knight,https://store.steampowered.com/app/3451330,https://vndb.org/v123',
  });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inputs-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const game = path.join(root, 'SkyKnight_TheCrystalLabyrinth_1.0_EN072p');
  fs.mkdirSync(path.join(game, 'data'), { recursive: true });
  fs.writeFileSync(path.join(game, 'data', 'System.json'), JSON.stringify({ gameTitle: 'SkyKnight ov1.0.0' }));
  scraper.GAMES_DIR = root;

  let inputs = await scraper.lookupInputs('SkyKnight_TheCrystalLabyrinth_1.0_EN072p');
  assert.deepStrictEqual([inputs.title, inputs.altTitle, inputs.query, inputs.readmeTitle],
    ['SkyKnight ov1.0.0', 'SkyKnight TheCrystalLabyrinth', 'https://moon-studio.itch.io/sky-knight', '']);
  await db.run(`UPDATE games SET meta_locked = '["link"]'`);
  inputs = await scraper.lookupInputs('SkyKnight_TheCrystalLabyrinth_1.0_EN072p');
  assert.ok(inputs.query.includes('app/3451330') && inputs.query.includes('vndb.org/v123'));
});

test('«Изменить → Сохранить» без правки ссылок ищет как повторный поиск: Steam и VNDB — заново', () => {
  const scraper = require('./src/services/scraper.js');
  const links = 'https://moon-studio.itch.io/sky-knight, https://store.steampowered.com/app/3451330,https://vndb.org/v1,https://example.com/sky-knight';
  assert.deepStrictEqual(scraper.searchableLinks(links, false),
    ['https://moon-studio.itch.io/sky-knight', 'https://example.com/sky-knight']);
  assert.strictEqual(scraper.searchableLinks(links, true).length, 4, 'ссылки вписаны или поправлены руками — все как есть');
  assert.deepStrictEqual(scraper.searchableLinks('', false), []);
});

test('Steam: из одноимённых игр — та, чей автор известен от других источников; не совпал ни один — первая', async (t) => {
  const scraper = require('./src/services/scraper.js');
  const asked = [];
  const devs = { 1713550: ['Someone Else'], 3959930: ['Moon Studio', 'Marlow Localize'], 5001490: ['月の工房'] };
  t.mock.method(globalThis, 'fetch', async (input) => {
    const url = String(input);
    asked.push(url);
    const json = (body) => ({ ok: true, status: 200, json: async () => body });
    if (url.includes('storesearch')) {
      return json(url.includes('SKYLANTERN')
        ? { total: 1, items: [{ id: 5001490, name: 'SKYLANTERN: The Last Light' }] }
        : { total: 3, items: [{ id: 1713550, name: 'Star Lantern' }, { id: 3959930, name: 'Star Lantern' }, { id: 3936730, name: 'STARDUST: Lantern of Wishes' }] });
    }
    const id = (url.match(/appids=(\d+)/) || [])[1];
    if (id) return json({ [id]: { success: true, data: { name: 'x', developers: devs[id], publishers: [] } } });
    return { ok: false, status: 404 };
  });
  const found = await scraper.fetchSteamMetadata('Star Lantern', ['Star Lantern'], ['Moon Studio']);
  assert.deepStrictEqual([found.link, found.developer], ['https://store.steampowered.com/app/3959930', 'Moon Studio, Marlow Localize']);
  // Автор записан иначе (или неизвестен) — первая по выдаче
  const first = await scraper.fetchSteamMetadata('Star Lantern', ['Star Lantern'], ['Other Author']);
  assert.strictEqual(first.link, 'https://store.steampowered.com/app/1713550');
  // Похожая одна — одна же страница игры, автора не сверяем: Steam пишет его по-японски, itch.io — латиницей
  asked.length = 0;
  const one = await scraper.fetchSteamMetadata('SKYLANTERN', ['SKYLANTERN'], ['Moon Workshop']);
  assert.strictEqual(one.link, 'https://store.steampowered.com/app/5001490');
  assert.strictEqual(asked.filter((u) => u.includes('appdetails')).length, 1);
});

// ============================================================================
// Ревизия библиотеки
// ============================================================================

test('ревизия: одна игра в двух папках — по названию или странице магазина, по цепочке; японские названия тоже', () => {
  const { duplicateGroups, pagesOf } = require('./src/utils/audit.js');
  const steam = (id) => `https://store.steampowered.com/app/${id}`;
  const rows = [
    { id: 'Starfall-Inn-1.08', title: 'Starfall Inn', link: '', size: 1 },
    { id: 'Starfall Inn v1.1', title: 'Starfall Inn v1.1', link: '', size: 2 },
    // Английская папка и японская — названия разные, страница одна
    { id: 'Lantern.Keeper.KG', title: 'Lantern Keeper', link: steam(248754), size: 3 },
    { id: 'ランタン守り', title: 'ランタン守り', link: `${steam(248754)}/Lantern_Keeper/`, size: 4 },
    // A и B — одна страница itch.io, B и C — один номер VNDB: все трое вместе
    { id: 'A', title: 'Some Game', link: 'https://moon-studio.itch.io/some-game' },
    { id: 'B', title: 'Other Name', link: 'https://Moon-Studio.itch.io/Some-Game/devlog/2,https://vndb.org/v123' },
    { id: 'C', title: 'Third', link: 'https://vndb.org/v123' },
    { id: '霧深き村', title: '霧深き村', link: '' },
    { id: '霧深き村 v1.1', title: '霧深き村', link: '' },
    // Короткое название — не повод; одна страница дважды в ссылках одной игры — тоже
    { id: 'TOD', title: 'TOD', link: '' },
    { id: 'TOD2', title: 'TOD', link: '' },
    { id: 'Solo', title: 'Solo Game', link: `${steam(2222222)},${steam(2222222)}` },
  ];
  const groups = duplicateGroups(rows).map((g) => [g.games.map((x) => x.id).sort().join('+'), g.why.sort().join(',')]).sort();
  assert.deepStrictEqual(groups, [
    ['A+B+C', 'page'],
    ['Lantern.Keeper.KG+ランタン守り', 'page'],
    ['Starfall Inn v1.1+Starfall-Inn-1.08', 'name'],
    ['霧深き村+霧深き村 v1.1', 'name'],
  ]);
  assert.deepStrictEqual(pagesOf({ link: 'https://moon-studio.itch.io/x, https://store.steampowered.com/app/7/Name/,https://vndb.org/V9,https://example.com/' }),
    ['itch:https://moon-studio.itch.io/x', 'steam:7', 'vndb:v9']);
});

test('ревизия: «Можно дополнить» — найденные, с пробелами, искавшиеся до улучшения поиска; сводка покрытия', () => {
  const { improvable, coverage, gapsOf, LOOKUP_IMPROVED_AT } = require('./src/utils/audit.js');
  const before = LOOKUP_IMPROVED_AT - 1000;
  const after = LOOKUP_IMPROVED_AT + 1000;
  const full = { description: 'd', developer: 'x', releaseDate: '2026', screens: '["a"]', link: 'https://moon-studio.itch.io/full,https://store.steampowered.com/app/1' };
  const rows = [
    { id: 'Full', meta_status: 'ok', meta_checked_at: before, ...full },
    { id: 'NoPage', meta_status: 'ok', meta_checked_at: before, ...full, link: 'https://example.com/no-store', size: 5 },
    { id: 'Many', meta_status: 'ok', meta_checked_at: 0, title: 'Many', link: '', description: '', developer: '', releaseDate: '', screens: '[]' },
    { id: 'Fresh', meta_status: 'ok', meta_checked_at: after, link: '' },
    { id: 'Partial', meta_status: 'partial', meta_checked_at: before, link: '' },
    { id: 'Novel', meta_status: 'ok', meta_checked_at: before, ...full, link: 'https://vndb.org/v5' },
  ];
  assert.deepStrictEqual(improvable(rows).map((g) => [g.id, g.gaps]), [
    ['Many', ['link', 'description', 'devdate', 'screens']],
    ['NoPage', ['link']],
  ], 'больше пробелов — выше; искавшиеся после улучшения и неполные — не здесь');
  assert.deepStrictEqual(gapsOf(rows[5]), [], 'страница VNDB — тоже страница');
  assert.deepStrictEqual(coverage(rows), { itch: 1, steam: 1, vndb: 1 });
});

// ============================================================================
// Загрузка архивов: кусками, с продолжением после обрыва (services/uploads.js)
// ============================================================================

// Сервер загрузки на временной папке: настоящие маршруты и сервис, вместо 7-Zip — подделка,
// которая «распаковывает» игру и запоминает, какой архив ей дали. restart() — как перезапуск
// сервера: новый сервис на тех же папках
async function uploadRig(t) {
  const http = require('http');
  const express = require('express');
  const { UploadService } = require('./src/services/uploads.js');
  const createUploadsRouter = require('./src/routes/uploads.js');
  const { findGameFolder } = require('./src/utils/archive.js');
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'uploads-'));
  const rig = { dir: path.join(root, '_tmp_uploads'), gamesDir: path.join(root, 'games'), added: [], refreshed: [], archives: [], free: 1e15, entries: null, extract: null };
  await fsp.mkdir(rig.gamesDir);
  rig.restart = () => {
    rig.svc = new UploadService();
    rig.svc.setDependencies({
      dir: rig.dir, gamesDir: rig.gamesDir, findGameFolder,
      addGameToDB: async (folder) => { rig.added.push(folder); },
      refreshGame: async (folder, dest, { archiveName }) => { rig.refreshed.push([folder, archiveName]); return { version: '' }; },
      tools: {
        list: async (archive, password) => (rig.list ? rig.list(password, archive) : rig.entries || [{ path: 'Game/www/index.html', size: 10, encrypted: false }]),
        extract: async (archive, out, password) => {
          rig.archives.push(await fsp.readFile(archive));
          if (rig.extract) return rig.extract(out, password, archive);
          await fsp.mkdir(path.join(out, 'Game', 'www'), { recursive: true });
          await fsp.writeFile(path.join(out, 'Game', 'www', 'index.html'), 'game');
        },
        freeSpace: async () => rig.free,
      },
    });
    rig.router = createUploadsRouter(rig.svc);
  };
  rig.restart();
  const app = express();
  app.use(express.json());
  app.use('/u', (req, res, next) => rig.router(req, res, next));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(async () => {
    server.closeAllConnections?.();
    server.close();
    await fsp.rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}/u`;

  rig.call = (method, url, { json, body, type } = {}) => new Promise((resolve, reject) => {
    const data = json ? Buffer.from(JSON.stringify(json)) : body;
    const headers = { 'Content-Length': data ? data.length : 0, ...(json ? { 'Content-Type': 'application/json' } : {}), ...(type ? { 'Content-Type': type } : {}) };
    const req = http.request(`${base}${url}`, { method, headers }, (res) => {
      let text = '';
      res.on('data', (d) => { text += d; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text || 'null'), headers: res.headers }));
    });
    req.on('error', reject);
    req.end(data);
  });
  rig.start = (json) => rig.call('POST', '/start', { json });
  rig.chunk = (id, offset, buf) => rig.call('POST', `/chunk?id=${id}&offset=${offset}`, { body: buf });
  rig.status = async (id) => (await rig.call('GET', `/status?id=${id}`)).body;
  // Кусок, у которого ушла только часть, а дальше — тишина: телефон уснул или сменил сеть
  rig.hang = (id, offset, buf, sent) => {
    const req = http.request(`${base}/chunk?id=${id}&offset=${offset}`, { method: 'POST', headers: { 'Content-Length': buf.length } });
    req.on('error', () => {});
    req.write(buf.subarray(0, sent));
    return req;
  };
  rig.size = async (id) => (await fsp.stat(path.join(rig.dir, `${id}.archive`)).catch(() => ({ size: 0 }))).size;
  rig.until = async (cond, what) => {
    for (let i = 0; i < 250; i++) {
      if (await cond()) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`не дождались: ${what}`);
  };
  return rig;
}

test('загрузка: куски строго подряд; повтор куска — 409 и сколько получено; целиком — игра в библиотеке', async (t) => {
  const crypto = require('crypto');
  const rig = await uploadRig(t);
  const MB = 1024 * 1024;
  const file = crypto.randomBytes(3 * MB + 123);
  const start = { name: 'Моя Игра: v1.2.zip', size: file.length, fingerprint: 'abc123' };
  const s = await rig.start(start);
  assert.deepStrictEqual([s.status, s.body.state, s.body.received], [200, 'uploading', 0]);
  const { id } = s.body;

  let r = await rig.chunk(id, 0, file.subarray(0, MB));
  assert.deepStrictEqual(r.body, { received: MB, state: 'uploading' });
  r = await rig.chunk(id, 0, file.subarray(0, MB));
  assert.deepStrictEqual([r.status, r.body.received], [409, MB], 'ответ потерялся, кусок пришёл снова — второй раз не пишем');
  r = await rig.chunk(id, 2 * MB, file.subarray(2 * MB, 3 * MB));
  assert.deepStrictEqual([r.status, r.body.received], [409, MB], 'дыр в архиве не бывает');
  r = await rig.chunk(id, MB, Buffer.alloc(file.length));
  assert.strictEqual(r.status, 413, 'за размер файла не пишем');

  const again = await rig.start(start);
  assert.deepStrictEqual([again.body.id, again.body.received], [id, MB], 'тот же файл выбран снова — та же загрузка, с того же места');
  r = await rig.chunk(id, MB, file.subarray(MB));
  assert.deepStrictEqual(r.body, { received: file.length, state: 'processing' }, 'последний кусок отвечает сразу, распаковка — в фоне');
  await rig.svc.jobs.get(id);
  const st = await rig.status(id);
  assert.deepStrictEqual([st.state, st.folder], ['done', 'Моя Игра_ v1.2']);
  assert.ok(rig.archives[0].equals(file), 'архив собран байт в байт');
  assert.deepStrictEqual(rig.added, ['Моя Игра_ v1.2']);
  assert.strictEqual(await fsp.readFile(path.join(rig.gamesDir, 'Моя Игра_ v1.2', 'index.html'), 'utf8'), 'game');
  assert.deepStrictEqual(await fsp.readdir(rig.dir), [`${id}.json`], 'архив и распакованное убраны');

  const fresh = await rig.start(start);
  assert.deepStrictEqual([fresh.body.id, fresh.body.received, fresh.body.state], [id, 0, 'uploading'], 'после готовой тот же файл — новая загрузка с нуля');
});

test('загрузка: оборванный кусок — записанное остаётся, с него и продолжаем, в том числе после перезапуска сервера', async (t) => {
  const crypto = require('crypto');
  const rig = await uploadRig(t);
  const file = crypto.randomBytes(2 * 1024 * 1024);
  const start = { name: 'Game.7z', size: file.length, fingerprint: 'f1' };
  const { id } = (await rig.start(start)).body;
  const sent = 700 * 1024;
  const req = rig.hang(id, 0, file, sent);
  await rig.until(async () => (await rig.size(id)) === sent, 'первые 700 КБ на диске');
  req.destroy();
  await rig.until(() => rig.svc.writing.size === 0, 'сервер закрыл оборванный кусок');
  assert.strictEqual((await rig.status(id)).received, sent);

  rig.restart();
  const resumed = await rig.start(start);
  assert.deepStrictEqual([resumed.body.id, resumed.body.received], [id, sent], 'после перезапуска — с 700 КБ');
  assert.strictEqual((await rig.chunk(id, sent, file.subarray(sent))).body.state, 'processing');
  await rig.svc.jobs.get(id);
  assert.ok(rig.archives[0].equals(file), 'архив собран байт в байт');
  assert.deepStrictEqual(rig.added, ['Game']);
});

test('загрузка: зависшее соединение — живое держит файл (409), молчащее уступает место новому запросу, брошенное закрывается само', async (t) => {
  const crypto = require('crypto');
  const rig = await uploadRig(t);
  rig.svc.takeoverMs = 400;
  const KB = 1024;
  const file = crypto.randomBytes(1024 * KB);
  const { id } = (await rig.start({ name: 'G.zip', size: file.length, fingerprint: 'f2' })).body;
  const hung = rig.hang(id, 0, file, 100 * KB);
  let hungClosed = false;
  hung.on('close', () => { hungClosed = true; });
  await rig.until(async () => (await rig.size(id)) === 100 * KB, '100 КБ на диске');
  let r = await rig.chunk(id, 100 * KB, file.subarray(100 * KB));
  assert.deepStrictEqual([r.status, r.body.busy], [409, true], 'только что писавший запрос не перебиваем');
  await new Promise((res) => setTimeout(res, 500));
  r = await rig.chunk(id, 100 * KB, file.subarray(100 * KB));
  assert.deepStrictEqual(r.body, { received: file.length, state: 'processing' }, 'молчавший уступил место');
  await rig.until(() => hungClosed, 'зависшее соединение закрыто');
  await rig.svc.jobs.get(id);
  assert.ok(rig.archives[0].equals(file));

  rig.svc.stallMs = 300;
  const { id: id2 } = (await rig.start({ name: 'H.zip', size: file.length, fingerprint: 'f3' })).body;
  rig.hang(id2, 0, file, 64 * KB);
  await rig.until(async () => (await rig.size(id2)) === 64 * KB, '64 КБ на диске');
  await rig.until(() => rig.svc.writing.size === 0, 'сторож закрыл брошенный кусок');
  assert.strictEqual((await rig.status(id2)).received, 64 * KB, 'записанное до обрыва осталось');
});

test('загрузка: сервер перезапустился во время распаковки — доделываем; игра уже переехала — второй раз не распаковываем', async (t) => {
  const crypto = require('crypto');
  const { UploadService } = require('./src/services/uploads.js');
  const rig = await uploadRig(t);
  const file = crypto.randomBytes(4096);
  await fsp.mkdir(rig.dir, { recursive: true });
  const put = async (name, extra = {}) => {
    const id = UploadService.idFor(name, file.length, 'f4');
    await fsp.writeFile(path.join(rig.dir, `${id}.archive`), file);
    await fsp.writeFile(path.join(rig.dir, `${id}.json`), JSON.stringify({ id, name, size: file.length, state: 'processing', ...extra }));
    return id;
  };
  const a = await put('A.zip');
  const b = await put('B.zip', { folder: 'B' });
  await fsp.mkdir(path.join(rig.gamesDir, 'B'));
  rig.restart();
  await rig.svc.recover();
  await Promise.all([...rig.svc.jobs.values()]);
  const [sa, sb] = [await rig.status(a), await rig.status(b)];
  assert.deepStrictEqual([sa.state, sa.folder, sb.state, sb.folder], ['done', 'A', 'done', 'B']);
  assert.deepStrictEqual(rig.added, ['A'], 'B уже в библиотеке — её добавила сверка при старте');
  assert.strictEqual(rig.archives.length, 1, 'распакован только A');
  assert.deepStrictEqual((await fsp.readdir(rig.dir)).sort(), [`${a}.json`, `${b}.json`].sort());
});

test('загрузка: отказы — нет места, путь наружу, не игра, архив повреждён; неудачную можно убрать из списка', async (t) => {
  const crypto = require('crypto');
  const { explain7z } = require('./src/services/uploads.js');
  const rig = await uploadRig(t);
  const file = crypto.randomBytes(2048);
  let n = 0;
  const upload = async () => {
    const { id } = (await rig.start({ name: `E${++n}.rar`, size: file.length, fingerprint: 'f5' })).body;
    await rig.chunk(id, 0, file);
    await rig.svc.jobs.get(id);
    return rig.status(id);
  };
  rig.free = 1024 ** 3;
  const full = await rig.start({ name: 'Big.zip', size: file.length, fingerprint: 'f5' });
  assert.deepStrictEqual([full.status, /места на диске/.test(full.body.error)], [507, true], 'гигабайт запаса не трогаем');
  rig.free = 1e15;

  rig.entries = [{ path: 'G/../../etc/cron.d/x', size: 5, encrypted: false }];
  assert.match((await upload()).error, /путь наружу/);
  rig.entries = [{ path: 'G/www/index.html', size: 1e15, encrypted: false }];
  assert.match((await upload()).error, /места для распаковки/);
  rig.entries = null;
  rig.extract = async (out) => { await fsp.writeFile(path.join(out, 'readme.txt'), 'x'); };
  assert.match((await upload()).error, /нет игры/);
  rig.extract = async () => { throw new Error(explain7z('ERROR: CRC Failed : a.bin', 2)); };
  const broken = await upload();
  assert.match(broken.error, /Архив повреждён/);

  assert.deepStrictEqual(await fsp.readdir(rig.gamesDir), [], 'в библиотеку ничего не попало');
  assert.ok((await fsp.readdir(rig.dir)).every((f) => f.endsWith('.json')), 'ни архивов, ни распакованного');
  const list = (await rig.call('GET', '/list')).body;
  assert.deepStrictEqual(list.map((x) => x.state), ['error', 'error', 'error', 'error']);
  assert.deepStrictEqual((await rig.call('POST', `/cancel?id=${broken.id}`)).body, { cancelled: true });
  assert.strictEqual((await rig.call('GET', '/list')).body.length, 3, 'убранная из списка пропала');
});

test('загрузка: архив с паролем ждёт пароля; не тот — спрашиваем снова, верный — распаковываем; пароль нигде не остаётся', async (t) => {
  const crypto = require('crypto');
  const rig = await uploadRig(t);
  const logged = [];
  t.mock.method(console, 'log', (...args) => { logged.push(args.join(' ')); });
  const file = crypto.randomBytes(4096);
  const tried = [];
  const refuse = () => Object.assign(new Error('Архив под паролем'), { password: true });
  const unpack = async (out) => {
    await fsp.mkdir(path.join(out, 'G', 'www'), { recursive: true });
    await fsp.writeFile(path.join(out, 'G', 'www', 'index.html'), 'game');
  };
  // Зашифрованы файлы: список виден, распаковка — только с верным паролем
  rig.entries = [{ path: 'G/www/index.html', size: 5, encrypted: true }];
  rig.extract = async (out, password) => {
    tried.push(password);
    await fsp.writeFile(path.join(out, 'garbage'), '');
    if (password !== 'секрет-123') throw refuse();
    await unpack(out);
  };
  const start = { name: 'Locked.7z', size: file.length, fingerprint: 'pw1' };
  const { id } = (await rig.start(start)).body;
  await rig.chunk(id, 0, file);
  await rig.svc.jobs.get(id);
  let st = await rig.status(id);
  assert.deepStrictEqual([st.state, st.error], ['password', '']);
  assert.strictEqual(await rig.size(id), file.length, 'архив ждёт пароля на сервере');
  assert.deepStrictEqual(tried, [], 'без пароля даже не распаковываем');
  assert.strictEqual((await rig.start(start)).body.state, 'password', 'тот же файл снова — тот же архив, ждущий пароля');
  assert.deepStrictEqual((await rig.call('GET', '/list')).body.map((u) => u.state), ['password'], 'видно и после перезагрузки страницы');

  assert.strictEqual((await rig.call('POST', `/password?id=${id}`, { json: { password: '' } })).status, 400);
  assert.strictEqual((await rig.call('POST', `/password?id=${id}`, { json: { password: 'не тот' } })).status, 200);
  await rig.svc.jobs.get(id);
  st = await rig.status(id);
  assert.deepStrictEqual([st.state, st.error], ['password', 'Неверный пароль']);
  assert.ok(!(await fsp.readdir(rig.dir)).some((f) => f.startsWith('ext_')), 'пустые файлы от неверного пароля убраны');
  assert.strictEqual((await rig.call('POST', `/password?id=${id}`, { json: { password: 'секрет-123' } })).status, 200);
  await rig.svc.jobs.get(id);
  st = await rig.status(id);
  assert.deepStrictEqual([st.state, st.folder], ['done', 'Locked']);
  assert.deepStrictEqual(tried, ['не тот', 'секрет-123']);
  assert.strictEqual((await rig.call('POST', `/password?id=${id}`, { json: { password: 'x' } })).status, 409, 'готовый архив пароля не ждёт');

  // Зашифрован и список файлов: без верного пароля архив не открывается вовсе
  rig.extract = async (out) => unpack(out);
  rig.list = (password) => {
    if (password !== 'k') throw refuse();
    return [{ path: 'H/www/index.html', size: 5, encrypted: true }];
  };
  const hidden = { name: 'Hidden.7z', size: file.length, fingerprint: 'pw2' };
  const { id: id2 } = (await rig.start(hidden)).body;
  await rig.chunk(id2, 0, file);
  await rig.svc.jobs.get(id2);
  assert.strictEqual((await rig.status(id2)).state, 'password');
  await rig.call('POST', `/password?id=${id2}`, { json: { password: 'k' } });
  await rig.svc.jobs.get(id2);
  assert.strictEqual((await rig.status(id2)).state, 'done');

  assert.strictEqual(rig.svc.passwords.size, 0, 'после распаковки пароль не держим');
  const metas = await Promise.all((await fsp.readdir(rig.dir)).map((f) => fsp.readFile(path.join(rig.dir, f), 'utf8')));
  assert.ok(![...metas, ...logged].some((x) => /секрет|не тот/.test(x)), 'пароль — ни в файлах состояния, ни в журнале');
});

test('загрузка: игра во вложенном архиве — самый большой первым, многотомный с первого тома, с тем же паролем, не глубже трёх уровней', async (t) => {
  const crypto = require('crypto');
  const rig = await uploadRig(t);
  const file = crypto.randomBytes(2048);
  const opened = [];
  const name = (archive) => (archive.endsWith('.archive') ? 'загрузка' : path.basename(archive));
  // Внешний архив: readme, саундтрек поменьше и игра в многотомном rar под паролем
  rig.extract = async (out, password, archive) => {
    opened.push(name(archive));
    if (archive.endsWith('.archive')) {
      await fsp.writeFile(path.join(out, 'readme.txt'), 'x');
      await fsp.writeFile(path.join(out, 'OST.zip'), Buffer.alloc(100));
      await fsp.mkdir(path.join(out, 'Game'));
      await fsp.writeFile(path.join(out, 'Game', 'Game.part1.rar'), Buffer.alloc(1000));
      await fsp.writeFile(path.join(out, 'Game', 'Game.part2.rar'), Buffer.alloc(1000));
      return;
    }
    if (password !== 'pw') throw Object.assign(new Error('Архив под паролем'), { password: true });
    await fsp.mkdir(path.join(out, 'Game', 'www'), { recursive: true });
    await fsp.writeFile(path.join(out, 'Game', 'www', 'index.html'), 'game');
  };
  const { id } = (await rig.start({ name: 'Double.zip', size: file.length, fingerprint: 'n1' })).body;
  await rig.chunk(id, 0, file);
  await rig.svc.jobs.get(id);
  assert.strictEqual((await rig.status(id)).state, 'password', 'вложенный архив под паролем — спрашиваем пароль');
  await rig.call('POST', `/password?id=${id}`, { json: { password: 'pw' } });
  await rig.svc.jobs.get(id);
  const st = await rig.status(id);
  assert.deepStrictEqual([st.state, st.folder], ['done', 'Double']);
  assert.deepStrictEqual(opened, ['загрузка', 'Game.part1.rar', 'загрузка', 'Game.part1.rar'], 'самый большой первым, со второго тома не начинаем, саундтрек не трогаем');
  assert.strictEqual(await fsp.readFile(path.join(rig.gamesDir, 'Double', 'index.html'), 'utf8'), 'game');
  assert.deepStrictEqual(await fsp.readdir(rig.dir), [`${id}.json`], 'распакованное и вложенные архивы убраны');

  // Архив в архиве в архиве… — дальше третьего уровня не идём
  opened.length = 0;
  rig.extract = async (out, password, archive) => {
    opened.push(name(archive));
    await fsp.writeFile(path.join(out, 'deeper.zip'), Buffer.alloc(10));
  };
  const { id: id2 } = (await rig.start({ name: 'Matryoshka.zip', size: file.length, fingerprint: 'n2' })).body;
  await rig.chunk(id2, 0, file);
  await rig.svc.jobs.get(id2);
  assert.match((await rig.status(id2)).error, /во вложенных архивах тоже/);
  assert.deepStrictEqual(opened, ['загрузка', 'deeper.zip', 'deeper.zip', 'deeper.zip']);
});

test('загрузка: новая версия игры из библиотеки — та же папка, прежняя уезжает в _old, новой игры не появляется', async (t) => {
  const crypto = require('crypto');
  const rig = await uploadRig(t);
  const game = path.join(rig.gamesDir, 'Starfall_Inn_ver1.3');
  await fsp.mkdir(game);
  await fsp.writeFile(path.join(game, 'index.html'), 'v1.3');
  await fsp.symlink(game, path.join(rig.gamesDir, 'Linked'));
  // Игру, которую не обновить, видно сразу — до гигабайтов загрузки
  const refused = async (target) => (await rig.start({ name: 'x.zip', size: 10, fingerprint: 'a', target })).status;
  assert.deepStrictEqual([await refused('Nope'), await refused('Linked'), await refused('../etc'), await refused('_saves')], [404, 403, 400, 400]);

  const file = crypto.randomBytes(4096);
  const start = { name: 'Starfall_Inn_ver1.3.1.69.zip', size: file.length, fingerprint: 'u1', target: 'Starfall_Inn_ver1.3' };
  const { id } = (await rig.start(start)).body;
  const { target, ...asNew } = start;
  assert.notStrictEqual(id, (await rig.start(asNew)).body.id, `тот же архив новой игрой — другая загрузка (${target})`);
  await rig.chunk(id, 0, file);
  await rig.svc.jobs.get(id);
  const st = await rig.status(id);
  assert.deepStrictEqual([st.state, st.folder, st.target], ['done', 'Starfall_Inn_ver1.3', 'Starfall_Inn_ver1.3']);
  assert.strictEqual(await fsp.readFile(path.join(game, 'index.html'), 'utf8'), 'game', 'в папке игры — новая версия');
  const old = path.join(rig.gamesDir, '_old', 'Starfall_Inn_ver1.3');
  const stamps = await fsp.readdir(old);
  assert.strictEqual(stamps.length, 1);
  assert.strictEqual(await fsp.readFile(path.join(old, stamps[0], 'index.html'), 'utf8'), 'v1.3', 'прежняя — в _old, не в корзине');
  assert.deepStrictEqual(rig.added, [], 'новой игры не появилось');
  assert.deepStrictEqual(rig.refreshed, [['Starfall_Inn_ver1.3', 'Starfall_Inn_ver1.3.1.69.zip']], 'версию и прочее из файлов — запросили');
});

test('загрузка: сервер перезапустился посреди замены папок — доделываем по тому, где что лежит', async (t) => {
  const crypto = require('crypto');
  const { UploadService } = require('./src/services/uploads.js');
  const rig = await uploadRig(t);
  const file = crypto.randomBytes(4096);
  await fsp.mkdir(rig.dir, { recursive: true });
  const put = async (target, stamp) => {
    const id = UploadService.idFor('New.zip', file.length, 'u2', target);
    await fsp.mkdir(path.join(rig.gamesDir, '_old', target, stamp), { recursive: true });
    await fsp.writeFile(path.join(rig.gamesDir, '_old', target, stamp, 'index.html'), 'old');
    await fsp.writeFile(path.join(rig.dir, `${id}.archive`), file);
    await fsp.writeFile(path.join(rig.dir, `${id}.json`), JSON.stringify({ id, name: 'New.zip', size: file.length, state: 'processing', target, backup: path.join(target, stamp) }));
    return id;
  };
  // G: прежняя версия уже в _old, а новой в папке игры ещё нет
  const g = await put('G', '2026-09-28-10-00-00');
  // H: новая уже на месте, а записать это не успели — второй раз не меняем
  const h = await put('H', '2026-09-28-10-00-01');
  await fsp.mkdir(path.join(rig.gamesDir, 'H'));
  await fsp.writeFile(path.join(rig.gamesDir, 'H', 'index.html'), 'already new');
  rig.restart();
  await rig.svc.recover();
  await Promise.all([...rig.svc.jobs.values()]);
  assert.deepStrictEqual([(await rig.status(g)).state, (await rig.status(h)).state], ['done', 'done']);
  assert.strictEqual(await fsp.readFile(path.join(rig.gamesDir, 'G', 'index.html'), 'utf8'), 'game');
  assert.strictEqual(await fsp.readFile(path.join(rig.gamesDir, 'H', 'index.html'), 'utf8'), 'already new');
  assert.strictEqual(await fsp.readFile(path.join(rig.gamesDir, '_old', 'G', '2026-09-28-10-00-00', 'index.html'), 'utf8'), 'old');
  assert.deepStrictEqual(rig.added, []);
});

test('загрузка: имя папки — буквы любого алфавита, не длиннее 200 байт, без букв — game_…', async (t) => {
  const crypto = require('crypto');
  const rig = await uploadRig(t);
  const file = crypto.randomBytes(1024);
  const folderOf = async (name) => {
    const { id } = (await rig.start({ name, size: file.length, fingerprint: crypto.randomBytes(4).toString('hex') })).body;
    await rig.chunk(id, 0, file);
    await rig.svc.jobs.get(id);
    return (await rig.status(id)).folder;
  };
  assert.strictEqual(await folderOf('スターフォールの宿.zip'), 'スターフォールの宿');
  assert.strictEqual(await folderOf('Ведьма: v1.2.7z'), 'Ведьма_ v1.2');
  const long = await folderOf(`${'呪い'.repeat(60)}.rar`);
  assert.ok(Buffer.byteLength(long) <= 200 && long.startsWith('呪い呪い'), `${Buffer.byteLength(long)} байт`);
  assert.match(await folderOf('!!!.zip'), /^game_\d+$/);
});

test('новая версия в базе: название и своя версия — из новой версии (название, вписанное руками, не трогаем); пропавшая обложка — заново; остальное как было', async (t) => {
  const { open } = require('sqlite');
  const sqlite3 = require('sqlite3');
  const db = await open({ filename: ':memory:', driver: sqlite3.Database });
  await db.exec(`CREATE TABLE games (id TEXT PRIMARY KEY, title TEXT, cover TEXT, my_version TEXT, text_lang TEXT, playtime INTEGER, description TEXT, meta_locked TEXT DEFAULT '[]')`);
  const add = (...values) => db.run('INSERT INTO games (id, title, cover, my_version, text_lang, playtime, description) VALUES (?, ?, ?, ?, ?, ?, ?)', values);
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'refresh-'));
  const prev = { db: dbService.db, dir: dbService.GAMES_DIR };
  dbService.db = db;
  dbService.GAMES_DIR = root;
  const { redisClient } = require('./src/utils/cache.js');
  t.mock.method(redisClient, 'del', async () => 1);
  t.mock.method(dbService, 'fillTextLang', async () => {});
  t.after(async () => {
    dbService.db = prev.db;
    dbService.GAMES_DIR = prev.dir;
    await db.close();
    await fsp.rm(root, { recursive: true, force: true });
  });

  // A: версия в имени архива; обложкой был титульный экран, которого в новой версии нет
  await fsp.mkdir(path.join(root, 'A', 'img', 'titles1'), { recursive: true });
  await fsp.writeFile(path.join(root, 'A', 'img', 'titles1', 'New.png'), 'png');
  await add('A', 'Game A', 'A/img/titles1/Old.png', '1.3', '{"main":"en"}', 500, 'desc');
  assert.deepStrictEqual(await dbService.refreshGame('A', path.join(root, 'A'), { archiveName: 'Game_A_v2.03.zip' }), { version: '2.03' });
  assert.deepStrictEqual(await db.get('SELECT * FROM games WHERE id = ?', 'A'),
    { id: 'A', title: 'Game A', cover: 'A/img/titles1/New.png', my_version: '2.03', text_lang: null, playtime: 500, description: 'desc', meta_locked: '[]' },
    'названия в новой версии нет — прежнее остаётся');

  // B: в имени архива версии нет — берём из названия в System.json; обложка из _media остаётся
  await fsp.mkdir(path.join(root, 'B', 'data'), { recursive: true });
  await fsp.writeFile(path.join(root, 'B', 'data', 'System.json'), JSON.stringify({ gameTitle: 'Game B Ver1.10' }));
  await add('B', 'Game B Ver1.0', '_media/B/cover-1.jpg', '', null, 0, '');
  await dbService.refreshGame('B', path.join(root, 'B'), { archiveName: 'GameB.zip' });
  assert.deepStrictEqual(await db.get('SELECT title, cover, my_version FROM games WHERE id = ?', 'B'), { title: 'Game B Ver1.10', cover: '_media/B/cover-1.jpg', my_version: '1.10' });

  // D: название вписано руками — новая версия его не меняет
  await fsp.mkdir(path.join(root, 'D', 'data'), { recursive: true });
  await fsp.writeFile(path.join(root, 'D', 'data', 'System.json'), JSON.stringify({ gameTitle: 'Game D v2' }));
  await add('D', 'Моё название', '', '', null, 0, '');
  await db.run(`UPDATE games SET meta_locked = '["title"]' WHERE id = 'D'`);
  await dbService.refreshGame('D', path.join(root, 'D'), { archiveName: 'GameD_v2.zip' });
  assert.strictEqual((await db.get('SELECT title FROM games WHERE id = ?', 'D')).title, 'Моё название');

  // C: версии нигде нет — своя версия прежняя
  await fsp.mkdir(path.join(root, 'C'));
  await add('C', 'Game C', 'C/icon/icon.png', '1.0', null, 0, '');
  const backup = path.join(root, '_old', 'C', '2026-09-28-10-00-00');
  await fsp.mkdir(backup, { recursive: true });
  await dbService.refreshGame('C', path.join(root, 'C'), { archiveName: 'GameC.zip', backupDir: backup });
  assert.deepStrictEqual(await db.get('SELECT my_version, cover FROM games WHERE id = ?', 'C'), { my_version: '1.0', cover: null });

  // Рядом с прежней версией — какими были своя версия и обложка; повторный заход их не перезаписывает
  const saved = JSON.parse(await fsp.readFile(`${backup}.json`, 'utf8'));
  assert.deepStrictEqual(saved, { title: 'Game C', my_version: '1.0', cover: 'C/icon/icon.png' });
  await dbService.refreshGame('C', path.join(root, 'C'), { archiveName: 'GameC_v9.zip', backupDir: backup });
  assert.deepStrictEqual(JSON.parse(await fsp.readFile(`${backup}.json`, 'utf8')), saved);
  // «Вернуть прежнюю версию» возвращает и их — название тоже
  await db.run(`UPDATE games SET title = 'Game C 2.0' WHERE id = 'C'`);
  await dbService.restoreGame('C', saved);
  assert.deepStrictEqual(await db.get('SELECT title, my_version, cover, text_lang FROM games WHERE id = ?', 'C'), { title: 'Game C', my_version: '1.0', cover: 'C/icon/icon.png', text_lang: null });
});

test('загрузка: отмена обрывает идущий кусок и убирает архив; во время распаковки отменить нельзя', async (t) => {
  const crypto = require('crypto');
  const rig = await uploadRig(t);
  const file = crypto.randomBytes(512 * 1024);
  const { id } = (await rig.start({ name: 'C.zip', size: file.length, fingerprint: 'f6' })).body;
  rig.hang(id, 0, file, 64 * 1024);
  await rig.until(async () => (await rig.size(id)) === 64 * 1024, '64 КБ на диске');
  assert.deepStrictEqual((await rig.call('POST', `/cancel?id=${id}`)).body, { cancelled: true });
  assert.strictEqual(rig.svc.writing.size, 0);
  assert.deepStrictEqual(await fsp.readdir(rig.dir), [], 'недогруженное убрано сразу');
  assert.strictEqual((await rig.call('GET', `/status?id=${id}`)).status, 404);

  let unblock;
  rig.extract = () => new Promise((resolve) => { unblock = resolve; });
  const { id: id2 } = (await rig.start({ name: 'D.zip', size: file.length, fingerprint: 'f6' })).body;
  await rig.chunk(id2, 0, file);
  await rig.until(() => unblock, 'распаковка началась');
  assert.strictEqual((await rig.status(id2)).step, 'extract', 'что делает распаковка — видно в состоянии');
  const refused = await rig.call('POST', `/cancel?id=${id2}`);
  assert.deepStrictEqual([refused.status, refused.body.state], [409, 'processing']);
  unblock();
  await rig.svc.jobs.get(id2);
  assert.match((await rig.status(id2)).error, /нет игры/, 'распаковка шла своим чередом');
});

test('загрузка: непонятные запросы — отказ, на диск ничего', async (t) => {
  const rig = await uploadRig(t);
  const statuses = [];
  for (const json of [
    { name: 'game.exe', size: 10, fingerprint: 'a' },
    { name: '../x.zip', size: 10, fingerprint: 'a' },
    { name: 'x.zip', size: -1, fingerprint: 'a' },
    { name: 'x.zip', size: 1.5, fingerprint: 'a' },
    { name: 'x.zip', size: 10, fingerprint: '' },
    { name: 'x.zip', size: 10, fingerprint: 'A/B' },
  ]) statuses.push((await rig.start(json)).status);
  assert.deepStrictEqual(statuses, [400, 400, 400, 400, 400, 400]);
  assert.strictEqual((await rig.chunk('../../etc', 0, Buffer.from('x'))).status, 400);
  assert.strictEqual((await rig.chunk('0'.repeat(32), 0, Buffer.from('x'))).status, 404);
  const { id } = (await rig.start({ name: 'x.zip', size: 10, fingerprint: 'a' })).body;
  assert.strictEqual((await rig.call('POST', `/chunk?id=${id}`, { body: Buffer.from('x') })).status, 400, 'без места в файле');
  assert.strictEqual((await rig.call('POST', `/chunk?id=${id}&offset=-5`, { body: Buffer.from('x') })).status, 400);
  assert.strictEqual((await rig.call('GET', '/status?id=nope')).status, 400);
  assert.strictEqual(await rig.size(id), 0);
});

test('загрузка: журнал страницы — одной строкой в журнал сервера, без переводов строк', async (t) => {
  const rig = await uploadRig(t);
  const logged = [];
  t.mock.method(console, 'log', (...args) => { logged.push(args.join(' ')); });
  const beacon = JSON.stringify({ name: 'G.zip', why: 'кусок молчит', ua: 'iPhone OS 26', standalone: true, lines: ['0.1 начало', '0.4 → кусок 0.0–16.0 МБ (xhr)\nлишнее'] });
  const r = await rig.call('POST', '/trace', { body: Buffer.from(beacon), type: 'text/plain;charset=UTF-8' });
  t.mock.restoreAll();
  assert.strictEqual(r.status, 204);
  assert.deepStrictEqual(logged, ['[Upload] журнал «G.zip» (кусок молчит) с 127.0.0.1, iPhone OS 26, веб-приложение: 0.1 начало | 0.4 → кусок 0.0–16.0 МБ (xhr) лишнее']);
});

test('7-Zip: разбор списка и понятные причины отказа', () => {
  const { parseListing, explain7z } = require('./src/services/uploads.js');
  const listing = 'Path = g\nFolder = +\nSize = 0\nAttributes = D drwxr-xr-x\nEncrypted = -\n\n'
    + 'Path = g/www/index.html\nFolder = -\nSize = 3\nAttributes =  -rw-r--r--\nEncrypted = +\n';
  assert.deepStrictEqual(parseListing(listing), [
    { path: 'g', size: 0, encrypted: false },
    { path: 'g/www/index.html', size: 3, encrypted: true },
  ]);
  assert.match(explain7z('ERROR: e.7z Cannot open encrypted archive. Wrong password?', 2), /под паролем/);
  assert.match(explain7z('Open ERROR: Cannot open the file as [zip] archive\nERRORS: Is not archive', 2), /не открывается как архив/);
  assert.match(explain7z('ERROR: CRC Failed : g/www/a.bin', 2), /повреждён/);
  assert.match(explain7z('ERROR: Dangerous link path was ignored : g/www/up : ../../tmp', 2), /ссылка/);
  assert.match(explain7z('ERROR: something odd', 7), /7-Zip не справился: ERROR: something odd/);
});

test('резервная копия: в базе копии нет ключа входа и учётной записи — даже в свободных страницах файла', async (t) => {
  const sqlite3 = require('sqlite3');
  const { open } = require('sqlite');
  const { stripSecrets } = require('./src/routes/backup.js');
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'backup-'));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'library.db');
  const secret = 'f00d'.repeat(32);
  const db = await open({ filename: file, driver: sqlite3.Database });
  await db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE games (id TEXT PRIMARY KEY, playtime INTEGER)');
  for (const [key, value] of [['session_secret', secret], ['admin_user', 'owner'], ['admin_pass', '$2b$10$hashhashhash'], ['telegram_prefs', '{"lang":"ru"}']]) {
    await db.run('INSERT INTO settings (key, value) VALUES (?, ?)', [key, value]);
  }
  await db.run("INSERT INTO games (id, playtime) VALUES ('G', 600)");
  await db.close();

  await stripSecrets(file);

  const bytes = await fsp.readFile(file);
  assert.strictEqual(bytes.includes(secret), false);
  assert.strictEqual(bytes.includes('$2b$10$hashhashhash'), false);
  const copy = await open({ filename: file, driver: sqlite3.Database });
  t.after(() => copy.close());
  assert.deepStrictEqual(await copy.all('SELECT key, value FROM settings'), [{ key: 'telegram_prefs', value: '{"lang":"ru"}' }]);
  assert.deepStrictEqual(await copy.all('SELECT id, playtime FROM games'), [{ id: 'G', playtime: 600 }]);
});

// --- История сейвов (utils/savestore.js) ---
const savesTmp = async (t) => {
  const { createSaveStore } = require('./src/utils/savestore.js');
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'saves-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const store = createSaveStore(root);
  const hist = async (id, key) => (await fsp.readdir(path.join(root, '.history', id, encodeURIComponent(key))).catch(() => [])).sort();
  const cur = (id, key) => fsp.readFile(path.join(root, id, `${encodeURIComponent(key)}.json`), 'utf8');
  return { root, store, hist, cur };
};

test('сейвы: перезапись слота кладёт прежний в историю, время файла — время сейва', async (t) => {
  const { root, store, hist, cur } = await savesTmp(t);
  const t0 = Date.now() - 3600e3;
  assert.strictEqual(await store.write('Game', 'RPG File1', 'A', t0), 'saved');
  assert.strictEqual(Math.round((await fsp.stat(path.join(root, 'Game', 'RPG%20File1.json'))).mtimeMs), t0);
  assert.strictEqual(await store.write('Game', 'RPG File1', 'B', t0 + 1000), 'saved');
  assert.strictEqual(await cur('Game', 'RPG File1'), 'B');
  assert.deepStrictEqual(await hist('Game', 'RPG File1'), [`${t0}-saved.json`]);
  // Тот же сейв ещё раз — ни записи, ни версии
  assert.strictEqual(await store.write('Game', 'RPG File1', 'B', t0 + 2000), 'same');
  assert.strictEqual((await hist('Game', 'RPG File1')).length, 1);
  // Не слот (настройки, копия слота перед записью) — без истории
  await store.write('Game', 'RPG Config', 'c1', t0);
  await store.write('Game', 'RPG Config', 'c2', t0 + 1);
  await store.write('Game', 'RPG File1bak', 'b1', t0);
  await store.write('Game', 'RPG File1bak', 'b2', t0 + 1);
  assert.deepStrictEqual(await fsp.readdir(path.join(root, '.history', 'Game')), ['RPG%20File1']);
});

test('сейвы: сейв старше того, что на сервере, не затирает новый — ложится в историю', async (t) => {
  const { store, hist, cur } = await savesTmp(t);
  const t0 = Date.now() - 3600e3;
  await store.write('Game', 'MZ_file1', 'PC, 11:00', t0 + 60e3);
  // Телефон играл без сети и сохранился раньше, чем компьютер
  assert.strictEqual(await store.write('Game', 'MZ_file1', 'phone, 10:00', t0), 'older');
  assert.strictEqual(await cur('Game', 'MZ_file1'), 'PC, 11:00');
  assert.deepStrictEqual(await hist('Game', 'MZ_file1'), [`${t0}-conflict.json`]);
  // Время из будущего (часы устройства спешат) считается нынешним: следующий сейв с верными часами не проигрывает
  await store.write('Game', 'MZ_file2', 'fast clock', Date.now() + 3600e3);
  assert.strictEqual(await store.write('Game', 'MZ_file2', 'right clock', Date.now() + 5), 'saved');
});

test('сейвы: удалённый в игре слот уходит в историю, возврат версии меняет местами', async (t) => {
  const { root, store, hist, cur } = await savesTmp(t);
  const t0 = Date.now() - 3600e3;
  await store.write('Game', 'RPG File2', 'old', t0);
  await store.write('Game', 'RPG File2', 'new', t0 + 1000);
  const [version] = await hist('Game', 'RPG File2');
  await store.restore('Game', 'RPG File2', version);
  assert.strictEqual(await cur('Game', 'RPG File2'), 'old');
  assert.deepStrictEqual(await hist('Game', 'RPG File2'), [`${t0 + 1000}-restore.json`]);
  await assert.rejects(store.restore('Game', 'RPG File2', '../../etc/passwd'), /Такой версии нет/);
  await assert.rejects(store.restore('Game', 'RPG File2', '123-saved.json'), /Такой версии нет/);

  await store.remove('Game', 'RPG File2');
  await assert.rejects(fsp.access(path.join(root, 'Game', 'RPG%20File2.json')));
  assert.strictEqual((await hist('Game', 'RPG File2')).filter((n) => n.endsWith('-deleted.json')).length, 1);
  await store.write('Game', 'RPG Global', 'g', t0);
  await store.remove('Game', 'RPG Global');
  await assert.rejects(fsp.access(path.join(root, 'Game', 'RPG%20Global.json')));

  const slots = await store.history('Game');
  assert.deepStrictEqual(slots.map((s) => [s.key, !!s.current, s.versions.map((v) => v.reason)]), [['RPG File2', false, ['deleted', 'restore']]]);
});

test('сейвы: частые сохранения прореживаются — пять последних, дальше одна на 10 минут, всего не больше 30', async (t) => {
  const { store, hist } = await savesTmp(t);
  // Сейв каждые 2 минуты, три часа подряд
  const start = Math.floor((Date.now() - 4 * 3600e3) / 600e3) * 600e3;
  for (let i = 0; i <= 90; i++) await store.write('Game', 'RPG File1', `v${i}`, start + i * 120e3);
  const names = await hist('Game', 'RPG File1');
  const times = names.map((n) => Number(n.split('-')[0])).sort((a, b) => a - b);
  // v0…v84 — 17 отрезков по 10 минут, v85…v89 — все пять
  assert.strictEqual(names.length, 5 + 17);
  // Пять последних подряд: v85…v89
  assert.deepStrictEqual(times.slice(-5), [85, 86, 87, 88, 89].map((i) => start + i * 120e3));
  // Старше — не больше одной на 10 минут
  const buckets = times.slice(0, -5).map((x) => Math.floor(x / 600e3));
  assert.strictEqual(new Set(buckets).size, buckets.length);
  // Версии не saved не прореживаются, но общий предел — 30
  for (let i = 0; i < 40; i++) await store.write('Game', 'RPG File3', `c${i}`, Date.now() - 1e6 + i);
  for (let i = 0; i < 40; i++) await store.write('Game', 'RPG File3', `old${i}`, Date.now() - 2e6 + i);
  assert.strictEqual((await hist('Game', 'RPG File3')).length, 30);
});

test('сейвы: папки под прежними именами переезжают к своим играм, спорные остаются', async (t) => {
  const { root, store, hist, cur } = await savesTmp(t);
  const put = async (dir, key, value, at) => {
    await fsp.mkdir(path.join(root, dir), { recursive: true });
    const f = path.join(root, dir, `${encodeURIComponent(key)}.json`);
    await fsp.writeFile(f, value);
    await fsp.utimes(f, new Date(at), new Date(at));
  };
  const t0 = Date.now() - 3600e3;
  // Японское имя — одни подчёркивания; пробелы — «_»; имя в %-кодировке
  await put('____', 'MZ_file1', 'jp', t0);
  await put('Starfall_Inn', 'MZ_file1', 'older', t0);
  await put('Starfall Inn', 'MZ_file1', 'newer', t0 + 1000);
  await put("Mira's%20Potion%20Shop", 'RPG Config', 'cfg', t0);
  // Подходит двум играм — не трогаем
  await put('___', 'MZ_file1', 'two', t0);
  // Своё имя другой игры — не трогаем
  await put('Solo_Game', 'MZ_file1', 'solo', t0);

  const moved = await store.migrate(['霧深き村', 'Starfall Inn', "Mira's Potion Shop", 'アリナ', 'ありな', 'Solo_Game', 'Solo Game']);
  assert.strictEqual(moved.length, 3);
  assert.strictEqual(await cur('霧深き村', 'MZ_file1'), 'jp');
  assert.strictEqual(await cur('Starfall Inn', 'MZ_file1'), 'newer');
  assert.deepStrictEqual(await hist('Starfall Inn', 'MZ_file1'), [`${t0}-merge.json`]);
  assert.strictEqual(await cur("Mira's Potion Shop", 'RPG Config'), 'cfg');
  assert.deepStrictEqual((await fsp.readdir(root)).sort(), ['.history', 'Starfall Inn', "Mira's Potion Shop", 'Solo_Game', '___', '霧深き村'].sort());
  assert.deepStrictEqual(await store.migrate(['霧深き村', 'Starfall Inn']), []);
});

test('сейвы: импорт из архива заменяет слоты, прежние — в историю', async (t) => {
  const { store, hist, cur } = await savesTmp(t);
  await store.write('Game', 'RPG File1', 'mine', Date.now() - 5000);
  await store.importSaves('Game', [{ key: 'RPG File1', value: 'imported' }, { key: 'RPG File2', value: 'new slot' }]);
  assert.strictEqual(await cur('Game', 'RPG File1'), 'imported');
  assert.strictEqual(await cur('Game', 'RPG File2'), 'new slot');
  assert.strictEqual((await hist('Game', 'RPG File1'))[0].endsWith('-import.json'), true);
});

// --- Патчи и моды поверх игры (services/uploads.js) ---
test('патч: место для файлов — по совпадениям с игрой, без учёта регистра; программа-патчер — понятный отказ', () => {
  const { planPatch } = require('./src/services/uploads.js');
  const game = ['www/index.html', 'www/data/Map001.json', 'www/data/System.json', 'www/img/pictures/Title.png', 'www/js/plugins.js', 'Game.exe'];
  const r = planPatch(['English Patch/www/data/map001.json', 'English Patch/www/js/plugins/Walk.js', 'English Patch/Readme.txt'], game);
  assert.deepStrictEqual(r.plan, [
    { from: 'English Patch/www/data/map001.json', to: 'www/data/Map001.json', replace: true },
    { from: 'English Patch/www/js/plugins/Walk.js', to: 'www/js/plugins/Walk.js', replace: false },
  ]);
  assert.deepStrictEqual([r.replaced, r.added, r.skipped], [1, 1, 1]);
  // Патч без www — к www игры
  assert.strictEqual(planPatch(['img/pictures/Title.png'], game).plan[0].to, 'www/img/pictures/Title.png');
  // Мод только добавляет файлы — туда, где папки движка
  assert.strictEqual(planPatch(['Mod/js/plugins/Cheat.js'], game).plan[0].to, 'www/js/plugins/Cheat.js');
  assert.throws(() => planPatch(['patcher/Patch.exe', 'patcher/diff.xdelta'], game), /программа-патчер/);
  assert.throws(() => planPatch(['something/else.bin'], game), /Не понял, куда класть/);
});

test('патч: ложится поверх копии игры, прежний вид — в _old, общие файлы не занимают места дважды', async (t) => {
  const rig = await uploadRig(t);
  const g = path.join(rig.gamesDir, 'G', 'www');
  await fsp.mkdir(path.join(g, 'data'), { recursive: true });
  await fsp.mkdir(path.join(g, 'img'), { recursive: true });
  await fsp.writeFile(path.join(g, 'index.html'), 'game');
  await fsp.writeFile(path.join(g, 'data', 'Map001.json'), 'jp');
  await fsp.writeFile(path.join(g, 'img', 'a.png'), 'picture');
  const opts = [];
  rig.svc.refreshGame = async (folder, dest, o) => { opts.push([folder, o.patch, o.archiveName]); return {}; };
  const finished = [];
  rig.svc.onFinished = (info) => { finished.push(info); };
  rig.svc.unattendedMs = 0;
  rig.entries = [{ path: 'Patch/www/data/Map001.json', size: 2, encrypted: false }];
  rig.extract = async (out) => {
    await fsp.mkdir(path.join(out, 'Patch', 'www', 'data'), { recursive: true });
    await fsp.mkdir(path.join(out, 'Patch', 'www', 'js', 'plugins'), { recursive: true });
    await fsp.writeFile(path.join(out, 'Patch', 'www', 'data', 'Map001.json'), 'en');
    await fsp.writeFile(path.join(out, 'Patch', 'www', 'js', 'plugins', 'Walk.js'), 'walk');
    await fsp.writeFile(path.join(out, 'Patch', 'README.txt'), 'read me');
  };
  const file = Buffer.from('patch-archive');
  // Без игры патч не начинается
  assert.strictEqual((await rig.start({ name: 'EnglishPatch.zip', size: file.length, fingerprint: 'p1', mode: 'patch' })).status, 400);
  const { body } = await rig.start({ name: 'EnglishPatch.zip', size: file.length, fingerprint: 'p1', target: 'G', mode: 'patch' });
  await rig.chunk(body.id, 0, file);
  await rig.until(async () => (await rig.status(body.id)).state === 'done', 'патч установлен');
  const st = await rig.status(body.id);
  assert.deepStrictEqual(st.patch, { replaced: 1, added: 1, skipped: 1 });
  assert.strictEqual(await fsp.readFile(path.join(g, 'data', 'Map001.json'), 'utf8'), 'en');
  assert.strictEqual(await fsp.readFile(path.join(g, 'js', 'plugins', 'Walk.js'), 'utf8'), 'walk');
  await assert.rejects(fsp.access(path.join(rig.gamesDir, 'G', 'README.txt')));
  const [stamp] = (await fsp.readdir(path.join(rig.gamesDir, '_old', 'G'))).filter((n) => !n.endsWith('.json'));
  const old = path.join(rig.gamesDir, '_old', 'G', stamp, 'www');
  assert.strictEqual(await fsp.readFile(path.join(old, 'data', 'Map001.json'), 'utf8'), 'jp');
  await assert.rejects(fsp.access(path.join(old, 'js')));
  // Неизменённый файл — один на обе версии
  assert.strictEqual((await fsp.stat(path.join(g, 'img', 'a.png'))).nlink, 2);
  assert.deepStrictEqual(opts, [['G', true, 'EnglishPatch.zip']]);
  await rig.until(async () => finished.length === 1, 'сообщение о загрузке');
  assert.deepStrictEqual([finished[0].state, finished[0].mode, finished[0].target, finished[0].unattended], ['done', 'patch', 'G', true]);
});

// --- Telegram (services/telegram.js) ---
async function telegramRig(t, { chat = { id: 42, name: 'Me' } } = {}) {
  const sqlite3 = require('sqlite3');
  const { open } = require('sqlite');
  const { TelegramService } = require('./src/services/telegram.js');
  const db = await open({ filename: ':memory:', driver: sqlite3.Database });
  t.after(() => db.close());
  await db.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE games (id TEXT PRIMARY KEY, title TEXT, status TEXT, rating INTEGER, link TEXT, my_version TEXT, meta_locked TEXT, lastPlayed INTEGER, playtime INTEGER, size INTEGER); CREATE TABLE wishlist (key TEXT PRIMARY KEY)");
  const tg = new TelegramService();
  tg.token = 'TEST-TOKEN';
  tg.envChat = '';
  tg.gapMs = 0;
  const calls = [];
  tg.fetch = async (url, init) => {
    const method = url.split('/').pop();
    const body = init.body instanceof FormData ? Object.fromEntries([...init.body.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : `<file ${v.name}>`])) : JSON.parse(init.body);
    calls.push({ method, body });
    const result = tg.reply?.(method, body) ?? (method === 'getMe' ? { username: 'my_rpg_bot' } : true);
    return { status: 200, json: async () => ({ ok: true, result }) };
  };
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'tg-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  tg.setDependencies({ db: { get: () => db }, tmpDir: root, gamesDir: root, savesDir: path.join(root, '_saves'), buildBackup: async (dir) => {
    const file = path.join(dir, 'b.zip'); await fsp.writeFile(file, 'zip'); return { file, name: 'b.zip', size: 3, games: 2, saves: 1 };
  } });
  if (chat) await tg.setJson('telegram_chat', chat);
  return { tg, db, calls, sent: () => calls.filter((c) => c.method.startsWith('send')) };
}

test('telegram: сообщение беззвучно и без HTML-подстановок; выключенный вид не приходит; язык — из настроек', async (t) => {
  const { tg, db, sent } = await telegramRig(t);
  await db.run("INSERT INTO games (id, title, link, meta_locked) VALUES ('G', 'Game <A>', '', '[\"title\"]')");
  await tg.uploadFinished({ name: 'g.zip', state: 'done', folder: 'G', mode: 'patch', unattended: true });
  assert.strictEqual(sent().length, 1);
  const msg = sent()[0].body;
  assert.strictEqual(msg.chat_id, 42);
  assert.strictEqual(msg.disable_notification, true);
  assert.match(msg.text, /Патч установлен: <b>Game &lt;A&gt;<\/b>/);
  await tg.savePrefs({ uploads: false, lang: 'en' });
  await tg.uploadFinished({ name: 'g.zip', state: 'done', folder: 'G', unattended: true });
  assert.strictEqual(sent().length, 1);
  await tg.savePrefs({ uploads: true, library: 'http://home.lan/' });
  await tg.uploadFinished({ name: 'g.zip', state: 'done', folder: 'G', target: 'G', version: '1.2', unattended: true });
  assert.match(sent()[1].body.text, /Game updated: <b>Game &lt;A&gt;<\/b> — version 1\.2\n<a href="http:\/\/home\.lan\/">Open the library<\/a>/);
});

test('telegram: не больше 10 сообщений в час, проблемы — всегда и со звуком, одна и та же — раз в сутки', async (t) => {
  const { tg, sent } = await telegramRig(t);
  for (let i = 0; i < 12; i++) await tg.uploadFinished({ name: `g${i}.zip`, state: 'done', folder: `G${i}`, unattended: true });
  assert.strictEqual(sent().length, 10);
  assert.strictEqual(await tg.problemOnce('disk', 'мало места'), true);
  assert.strictEqual(await tg.problemOnce('disk', 'мало места'), false);
  assert.strictEqual(sent().length, 11);
  assert.strictEqual(sent()[10].body.disable_notification, false);
});

test('telegram: загрузка — только если за ней никто не следил', async (t) => {
  const { tg, db, sent } = await telegramRig(t);
  await db.run("INSERT INTO games (id, title, link, meta_locked) VALUES ('G', 'Great Game', '', '[]')");
  await tg.uploadFinished({ name: 'g.zip', state: 'done', folder: 'G', unattended: false });
  assert.strictEqual(sent().length, 0);
  await tg.uploadFinished({ name: 'g.zip', state: 'done', folder: 'G', unattended: true });
  await tg.uploadFinished({ name: 'x.rar', state: 'password', unattended: true });
  assert.match(sent()[0].body.text, /Игра добавлена: <b>Great Game<\/b>/);
  assert.strictEqual(sent()[1].body.disable_notification, false);
});

test('telegram: копия — раз в сутки и только если что-то изменилось; кнопка шлёт сразу', async (t) => {
  const { tg, db, sent } = await telegramRig(t);
  await db.run("INSERT INTO games (id, title, playtime) VALUES ('G', 'G', 10)");
  assert.deepStrictEqual(await tg.checkBackup(), { sent: true });
  assert.strictEqual(sent()[0].method, 'sendDocument');
  assert.strictEqual(sent()[0].body.document, '<file b.zip>');
  assert.deepStrictEqual(await tg.checkBackup(), { sent: false });
  await db.run("UPDATE games SET playtime = 20");
  // Изменилось, но суток не прошло
  assert.deepStrictEqual(await tg.checkBackup(), { sent: false });
  await tg.setJson('telegram_backup', { ...(await tg.getJson('telegram_backup')), at: Date.now() - 21 * 3600e3 });
  assert.deepStrictEqual(await tg.checkBackup(), { sent: true });
  assert.deepStrictEqual(await tg.checkBackup({ force: true }), { sent: true });
  assert.strictEqual(sent().length, 3);
});

test('telegram: привязка — по коду из ссылки, чужие сообщения не считаются', async (t) => {
  const { tg, calls, sent } = await telegramRig(t, { chat: null });
  const status = await tg.startLink({ lang: 'ru', library: 'http://192.168.2.99/' });
  assert.match(status.pending.url, /^https:\/\/t\.me\/my_rpg_bot\?start=\d{6}$/);
  const code = status.pending.code;
  let round = 0;
  tg.reply = (method) => {
    if (method !== 'getUpdates') return undefined;
    round++;
    if (round === 1) return [{ update_id: 1, message: { chat: { id: 7, type: 'private', first_name: 'Stranger' }, text: '/start 000000' } }];
    return [{ update_id: 2, message: { chat: { id: 9, type: 'private', first_name: 'Owner', username: 'own' }, text: `/start ${code}` } }];
  };
  await tg.poll();
  assert.deepStrictEqual(await tg.chat(), { id: 9, name: 'Owner (@own)' });
  // Второй опрос — уже после первого сообщения: оно подтверждено и больше не придёт
  assert.strictEqual(calls.filter((c) => c.method === 'getUpdates').at(-1).body.offset, 2);
  assert.match(sent()[0].body.text, /Библиотека подключена/);
  assert.strictEqual((await tg.status()).pending, null);
});

// --- Сервер игр (routes/play.js) ---
test('сервер игр: ключ подходит только к своей игре, сейвы — через ключ, запрет на чужие сайты — в заголовке', async (t) => {
  const http = require('http');
  const { createGameApp, gameKey, keyMatches } = require('./src/routes/play.js');
  const saved = [];
  const store = {
    list: async (id) => ({ 'RPG File1': { value: `save of ${id}`, updatedAt: 1 } }),
    write: async (id, key, value) => { saved.push([id, key, value]); return key === 'RPG File2' ? 'older' : 'saved'; },
    remove: async () => {},
  };
  let secret = 's1';
  const app = createGameApp({ secret: () => secret, store, publicDir: __dirname });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  // Не глобальный fetch: его подменяют другие тесты
  const fetch = (url, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers: { ...headers, ...(body ? { 'content-length': Buffer.byteLength(body) } : {}) } }, (res) => {
      let text = '';
      res.on('data', (d) => { text += d; });
      res.on('end', () => resolve({ status: res.statusCode, headers: { get: (h) => res.headers[h] }, json: async () => JSON.parse(text), text: async () => text }));
    });
    req.on('error', reject);
    req.end(body);
  });
  const key = gameKey('s1', 'Game A');
  assert.strictEqual(keyMatches('s1', 'Game A', key), true);
  assert.strictEqual(keyMatches('s1', 'Game B', key), false);
  assert.strictEqual(keyMatches('s2', 'Game A', key), false);

  let r = await fetch(`${base}/saves/${key}/${encodeURIComponent('Game A')}`);
  assert.strictEqual(r.status, 200);
  assert.match(r.headers.get('content-security-policy'), /connect-src 'self'/);
  assert.deepStrictEqual(await r.json(), { 'RPG File1': { value: 'save of Game A', updatedAt: 1 } });
  assert.strictEqual((await fetch(`${base}/saves/${key}/${encodeURIComponent('Game B')}`)).status, 403);
  assert.strictEqual((await fetch(`${base}/saves/${key}/_saves`)).status, 403);
  r = await fetch(`${base}/saves/${key}/${encodeURIComponent('Game A')}/${encodeURIComponent('RPG File2')}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: 'x', updatedAt: 5 }),
  });
  assert.deepStrictEqual(await r.json(), { success: true, kept: 'server' });
  assert.deepStrictEqual(saved, [['Game A', 'RPG File2', 'x']]);
  // Нет API библиотеки
  assert.strictEqual((await fetch(`${base}/api/games`)).status, 404);
  // Выход из библиотеки меняет ключ сессии — старый ключ игры больше не подходит
  secret = 's2';
  assert.strictEqual((await fetch(`${base}/saves/${key}/${encodeURIComponent('Game A')}`)).status, 403);
  // Отчёт о заблокированном — в журнал
  const logged = [];
  t.mock.method(console, 'log', (...a) => { logged.push(a.join(' ')); });
  r = await fetch(`${base}/csp-report`, { method: 'POST', headers: { 'content-type': 'application/csp-report' },
    body: JSON.stringify({ 'csp-report': { 'document-uri': `${base}/g/${key}/Game%20A/www/`, 'violated-directive': 'connect-src', 'blocked-uri': 'https://tracker.test' } }) });
  t.mock.restoreAll();
  assert.strictEqual(r.status, 204);
  assert.deepStrictEqual(logged, ['[CSP] Game A: заблокировано connect-src https://tracker.test']);
});

// --- Журнал ошибок игр (services/gameErrors.js) ---
test('ошибки игр: одна и та же — одна строка со счётчиком, устройство по User-Agent, ключ из адреса не хранится', async (t) => {
  const sqlite3 = require('sqlite3');
  const { open } = require('sqlite');
  const { GameErrors, deviceOf } = require('./src/services/gameErrors.js');
  const db = await open({ filename: ':memory:', driver: sqlite3.Database });
  t.after(() => db.close());
  const errs = new GameErrors();
  errs.setDependencies({ get: () => db });
  await errs.init();
  t.mock.method(console, 'log', () => {});
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1';
  const key = 'a'.repeat(32);
  for (const n of [1, 2, 3]) {
    await errs.record('Game', { kind: 'engine', message: `Cannot read properties of undefined (reading 'x${n}')`, source: `http://h:8081/g/${key}/Game/www/js/plugins/Foo.js`, line: 10, stack: `at http://h:8081/g/${key}/Game/www/js/plugins/Foo.js:10:5` }, iphone);
  }
  await errs.record('Game', { kind: 'error', message: 'Other' }, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36');
  assert.strictEqual(await errs.record('Game', { message: '' }, iphone), false);
  t.mock.restoreAll();
  const [game] = await errs.list();
  assert.strictEqual(game.game, 'Game');
  const engine = game.errors.find((e) => e.kind === 'engine');
  assert.deepStrictEqual([engine.count, engine.device, engine.source], [3, 'iPhone · Safari', '/Game/www/js/plugins/Foo.js']);
  assert.strictEqual(engine.stack.includes(key), false);
  assert.strictEqual(game.errors.find((e) => e.kind === 'error').device, 'Windows · Chrome');
  assert.strictEqual(deviceOf(iphone, true), 'iPhone · веб-приложение');
  await errs.clear('Game');
  assert.deepStrictEqual(await errs.list(), []);
});

// --- Галерея из файлов игры (services/gallery.js) ---
test('галерея: размеры из заголовка PNG и у зашифрованных, разделы по размеру, альбомы по имени, чужие пути закрыты', async (t) => {
  const { GalleryService, classify, albumKey, pngSize, decrypt } = require('./src/services/gallery.js');
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'gallery-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  // PNG нужного размера: подпись, IHDR с шириной и высотой, «тело» заданной длины
  const png = (w, h, body = 0) => {
    const b = Buffer.alloc(33 + body);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).copy(b);
    b.write('IHDR', 12, 'latin1');
    b.writeUInt32BE(w, 16);
    b.writeUInt32BE(h, 20);
    return b;
  };
  const key = '0123456789abcdef0123456789abcdef';
  const encrypt = (data) => {
    const out = Buffer.concat([Buffer.from('RPGMV\0\0\0\0\x03\x01\0\0\0\0\0', 'latin1'), data]);
    const k = key.match(/../g).map((x) => parseInt(x, 16));
    for (let i = 0; i < 16; i++) out[16 + i] ^= k[i];
    return out;
  };
  const game = path.join(root, 'G', 'www');
  for (const d of ['data', 'img/pictures', 'img/faces', 'img/parallaxes', 'img/cg_custom']) await fsp.mkdir(path.join(game, d), { recursive: true });
  await fsp.writeFile(path.join(game, 'data', 'System.json'), '﻿' + JSON.stringify({ encryptionKey: key, advanced: { screenWidth: 1280, screenHeight: 720 } }));
  const cg = png(1280, 720, 400000);
  await fsp.writeFile(path.join(game, 'img/pictures/ev01_1.rpgmvp'), encrypt(cg));
  await fsp.writeFile(path.join(game, 'img/pictures/ev01_2.rpgmvp'), encrypt(png(1280, 720, 400000)));
  await fsp.writeFile(path.join(game, 'img/pictures/layer_face.png'), png(1280, 720, 1000));
  await fsp.writeFile(path.join(game, 'img/pictures/stand_alice.png'), png(500, 720, 100000));
  await fsp.writeFile(path.join(game, 'img/pictures/icon.png'), png(64, 64, 10));
  await fsp.writeFile(path.join(game, 'img/cg_custom/074 (1).png'), png(1280, 720, 400000));
  await fsp.writeFile(path.join(game, 'img/faces/Actor1.png'), png(576, 288, 10));
  await fsp.writeFile(path.join(game, 'img/parallaxes/Sky.png'), png(1280, 1440, 900000));

  assert.deepStrictEqual(pngSize(encrypt(png(816, 624)).subarray(0, 40)), { w: 816, h: 624 });
  assert.strictEqual(albumKey('img/pictures/074 (3).png_'), 'img/pictures/074');
  assert.strictEqual(albumKey('img/pictures/SceneB_05-11.rpgmvp'), 'img/pictures/SceneB_05');
  // Номер CG — первая часть с цифрой; номер кадра в конце — не в имени альбома; порядковый номер в начале пропускаем
  assert.strictEqual(albumKey('img/pictures/eva_c132_0_1_0211013_100000_0010_0.png_'), 'img/pictures/eva_c132');
  assert.strictEqual(albumKey('img/pictures/CG_ending_14.rpgmvp'), 'img/pictures/CG_ending');
  assert.strictEqual(albumKey('img/pictures/1_受付嬢_普.png_'), 'img/pictures/受付嬢_普');
  assert.strictEqual(classify({ w: 1280, h: 720, size: 900000 }, { w: 1280, h: 720 }, 'img/pictures/Bg_Alleyway.png_'), 'backdrop');
  assert.strictEqual(classify({ w: 1280, h: 720, size: 1000 }, { w: 1280, h: 720 }), 'layer');
  assert.deepStrictEqual(decrypt(encrypt(cg), key), cg);

  const g = new GalleryService();
  g.setDependencies({ gamesDir: root });
  const t0 = t.mock.method(console, 'log', () => {});
  const index = await g.build('G').promise;
  t0.mock.restore();
  const byKey = Object.fromEntries(index.albums.map((a) => [a.key, [a.kind, a.files.length]]));
  assert.deepStrictEqual(byKey, {
    'img/pictures/ev01': ['cg', 2],
    'img/pictures/layer_face': ['layer', 1],
    'img/pictures/stand_alice': ['portrait', 1],
    'img/pictures/icon': ['other', 1],
    'img/cg_custom/074': ['cg', 1],
    'img/parallaxes/Sky': ['backdrop', 1],
  });
  assert.strictEqual(index.albums[0].key.startsWith('img/pictures/'), true);
  // Картинка целиком — расшифрованная; путь не из оглавления — нет
  const img = await g.image('G', 'img/pictures/ev01_1.rpgmvp');
  assert.deepStrictEqual([img.type, img.data.equals(cg)], ['image/png', true]);
  assert.strictEqual(await g.image('G', 'data/System.json'), null);
  assert.strictEqual(await g.image('G', '../../etc/passwd'), null);
  // Оглавление — в _media, не в папке игры
  await fsp.access(path.join(root, '_media', 'G', 'gallery.json'));
  assert.deepStrictEqual((await fsp.readdir(path.join(root, 'G', 'www'))).sort(), ['data', 'img']);
});

test('сервер игр: регистр букв подбирается у каждой папки пути — игры собирают под Windows', async (t) => {
  const { fixCase } = require('./src/routes/play.js');
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'case-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  await fsp.mkdir(path.join(root, 'Game', 'Fonts'), { recursive: true });
  await fsp.mkdir(path.join(root, 'Game', 'Audio', 'SE'), { recursive: true });
  await fsp.writeFile(path.join(root, 'Game', 'Fonts', 'mplus-1m-regular.ttf'), 'f');
  await fsp.writeFile(path.join(root, 'Game', 'Audio', 'SE', 'Cursor2.ogg'), 'a');
  assert.strictEqual(await fixCase(root, 'Game/fonts/mplus-1m-regular.ttf'), path.join(root, 'Game', 'Fonts', 'mplus-1m-regular.ttf'));
  assert.strictEqual(await fixCase(root, 'Game/audio/se/cursor2.OGG'), path.join(root, 'Game', 'Audio', 'SE', 'Cursor2.ogg'));
  // Нет такого файла — папки подобраны, имя как есть: ответит 404, а звук поищет .m4a рядом
  assert.strictEqual(await fixCase(root, 'Game/audio/se/Decision1.ogg'), path.join(root, 'Game', 'Audio', 'SE', 'Decision1.ogg'));
});

test('галерея: WebP под именем .png (репаки «Compressed») — размеры из заголовка WebP', () => {
  const { pngSize } = require('./src/services/gallery.js');
  const b = Buffer.alloc(40);
  b.write('RIFF', 0, 'latin1'); b.write('WEBP', 8, 'latin1'); b.write('VP8X', 12, 'latin1');
  b.writeUIntLE(1279, 24, 3); b.writeUIntLE(719, 27, 3);
  assert.deepStrictEqual(pngSize(b), { w: 1280, h: 720, webp: true });
  const { albumKey } = require('./src/services/gallery.js');
  // Сцена — папка, кадры в ней — номера
  assert.strictEqual(albumKey('img/pictures/CG/Garden Walk/1.png'), 'img/pictures/CG/Garden Walk');
});

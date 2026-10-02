const { createClient } = require('redis');

// Один общий клиент Redis на всё приложение: раньше их было два (games.js и scraper.js)
const redisClient = createClient({ url: process.env.REDIS_URL || 'redis://redis:6379' });
// Без обработчика 'error' любой разрыв связи с Redis роняет весь процесс
redisClient.on('error', (err) => console.error('❌ [Redis] Ошибка:', err.message));
redisClient.connect().then(() => console.log('📦 [Redis] Подключён')).catch(console.error);

const GAMES_LIST_KEY = 'api:games:list';

// Сокет отдаёт сюда server.js. Сброс кэша и рассылка «список изменился» —
// это одно и то же событие, поэтому живут в одном месте.
let io = null;
function setIo(instance) { io = instance; }
function getIo() { return io; }

// Список игр закэширован на 5 минут. Любое изменение библиотеки обязано сбросить кэш,
// иначе изменение увидят с задержкой до 5 минут.
async function invalidateGamesList() {
    try {
        await redisClient.del(GAMES_LIST_KEY);
    } catch (e) {
        console.error('❌ [Redis] Не удалось сбросить кэш списка:', e.message);
    }
    // Рассылаем событие о том, что список игр изменился
    if (io) {
        io.emit('library-changed');
    }
}

module.exports = { redisClient, invalidateGamesList, GAMES_LIST_KEY, setIo, getIo };

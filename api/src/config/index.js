require('dotenv').config();
const path = require('path');

const GAMES_DIR = process.env.GAMES_DIR || path.join(__dirname, '..', '..', '..', 'games');

// Теперь любую системную папку можно переопределить через .env!
const EXTRACT_TMP = process.env.EXTRACT_TMP || path.join(GAMES_DIR, '_tmp_uploads'); 
const UPLOAD_TMP = EXTRACT_TMP; 
const SAVES_DIR = process.env.SAVES_DIR || path.join(GAMES_DIR, '_saves');
const AUDIOCACHE = process.env.AUDIOCACHE || path.join(GAMES_DIR, '.audio-cache');
// Прежние версии игр, отложенные при обновлении (services/uploads.js), — пока человек их не удалит
const OLD_DIR = process.env.OLD_DIR || path.join(GAMES_DIR, '_old');

// Служебные папки рядом с играми: это не игры, в библиотеку их не берём
const SYSTEM_DIRS = ['_saves', '_tmp_uploads', '_media', '_old', 'node_modules', '.audio-cache'];

module.exports = {
    GAMES_DIR,
    EXTRACT_TMP,
    UPLOAD_TMP,
    SAVES_DIR,
    AUDIOCACHE,
    OLD_DIR,
    SYSTEM_DIRS,
};

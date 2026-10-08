// ============================================================================
// 1. АБСОЛЮТНАЯ ИМИТАЦИЯ ANDROID И СИСТЕМНЫХ API (УБИЙЦА ОШИБОК)
// ============================================================================
window.process = window.process || {};
window.process.platform = window.process.platform || 'browser';
window.process.cwd = function() { return '/'; };

// ============================================================================
// --- ВЗЛОМЩИК STEAM  И АЧИВОК ---
// ============================================================================
window.CycloneSteam = {
    isSteamRunning: true,
    active: true,
    isSubscribedApp: function(appId) { 
        return true; // <-- Вот эта строчка ломает антипиратскую защиту
    },
    registerAchievement: function(){},
    getAchievement: function(){ return false; },
    setAchievement: function(){},
    clearAchievement: function(){}
};
window.Greenworks = { initAPI: function(){ return true; } };

// ВОТ ЭТА СТРОЧКА СПАСЕТ ОТ КРАША process.argv[0]
window.process.argv = window.process.argv || ['/']; 

const mockPath = window.location.pathname || '/';
window.process.mainModule = { 
    filename: mockPath.endsWith('index.html') ? mockPath : mockPath + 'index.html' 
};
window.process.versions = window.process.versions || {};

// Бронежилет для process.env
let _env = { USER: 'Player' };
Object.defineProperty(window.process, 'env', {
    get: function() { return _env; },
    set: function(val) { _env = Object.assign(_env, val || {}); _env.USER = 'Player'; },
    configurable: true
});

// Подавляем ошибку Firefox/Chrome при выходе из полноэкранного режима
if (typeof document !== 'undefined') {
    const origExit = document.exitFullscreen;
    if (origExit) {
        document.exitFullscreen = function() {
            if (!document.fullscreenElement) return Promise.resolve();
            return origExit.call(this);
        };
    }
    const origMoz = document.mozCancelFullScreen;
    if (origMoz) {
        document.mozCancelFullScreen = function() {
            if (!document.mozFullScreenElement) return Promise.resolve();
            return origMoz.call(this);
        };
    }
    const origWebkit = document.webkitExitFullscreen;
    if (origWebkit) {
        document.webkitExitFullscreen = function() {
            if (!document.webkitFullscreenElement) return Promise.resolve();
            return origWebkit.call(this);
        };
    }
}

window.ExternalStorage = {
    _reply: function(cbId, res) {
        setTimeout(function() {
            if (window.AuraMZ && window.AuraMZ.Mobile && window.AuraMZ.Mobile.callbacks && window.AuraMZ.Mobile.callbacks[cbId]) {
                window.AuraMZ.Mobile.callbacks[cbId](res);
            }
        }, 10);
    },
    existsFile: function(id) { this._reply(id, "false"); return false; },
    saveFile: function(id) { this._reply(id, "true"); return false; },
    loadFile: function(id) { this._reply(id, ""); return false; },
    readFile: function(id) { this._reply(id, ""); return false; },
    removeFile: function(id) { this._reply(id, "true"); return false; },
    listFiles: function(id) { this._reply(id, "[]"); return false; },
    makeDir: function(id) { this._reply(id, "true"); return false; },
    selectExternalStorageDirectory: function(id) { this._reply(id, "null"); return false; },
    removeExternalStorageDirectory: function(id) { this._reply(id, "true"); return false; },
    writeFile: function(id) { this._reply(id, "true"); return false; }
};
window.Android = { showToast: function(){}, getVersion: function(){return "1.0";} };
// ============================================================================
// 0b. ADV_System stub — до загрузки TS_ADVsystem.js
// TS_ADVsystem.js строка 9: if(ADV_System == null) — без typeof!
// ============================================================================
if (typeof ADV_System === 'undefined') {
    window.ADV_System = null;
}



// ============================================================================
// 2. БЛОКИРОВЩИК ПЛАГИНОВ И ЛЕКАРЬ ПРОМИСОВ (Перехватчик)
// ============================================================================

// Плагины некоторых игр ждут от StorageManager.exists() промис и сразу зовут у
// ответа .then. Раньше для этого exists() и DataManager.savefileExists() всегда
// возвращали промис, а промис — всегда «истина»: ядро MV и плагины других игр считали,
// что есть любой сейв, и удалённые слоты висели в списке. Теперь ответ снова да/нет,
// а у да/нет есть .then — как у промиса с тем же значением. Обычный код это не задевает:
// промисы и await ищут .then только у объектов, а true и false — не объекты
if (!Boolean.prototype.then) {
    Object.defineProperty(Boolean.prototype, 'then', {
        value: function(onFulfilled, onRejected) { return Promise.resolve(this.valueOf()).then(onFulfilled, onRejected); },
        writable: true,
        configurable: true,
    });
}
if (!window.__rpgPluginHookInstalled) {
    window.__rpgPluginHookInstalled = true;
    
    var _origSrc = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
    if (_origSrc) {
        Object.defineProperty(HTMLScriptElement.prototype, 'src', {
            set: function(val) {
                if (val && typeof val === 'string') {
                    var lowerVal = val.toLowerCase();
                    // Список вредных и дев-плагинов, которые нужно заблокировать
                    var blockedPlugins = [
                        'auramz/mobile', 'toggle_save_dir', 'elimz_mobilecontrols', 
                        'cyclone-steam', 'drs_alldataextractor', 'ge_devonlymessageskipkey'
                    ];
                    
                    if (blockedPlugins.some(function(p) { return lowerVal.indexOf(p) > -1; })) {
                        console.log('[RPG Fixes] 🛑 Заблокирован конфликтный плагин: ' + val);
                        val = 'data:application/javascript,console.log("Blocked by RPG-Fixes!");';
                    }
                    
                    if (val.indexOf('js/plugins/') > -1) {
                        if (window.Scene_Boot && window.Scene_Boot.prototype && !window.__bootPromiseFixed) {
                            window.__bootPromiseFixed = true;
                            var _origBootLoad = window.Scene_Boot.prototype.loadPlayerData;
                            window.Scene_Boot.prototype.loadPlayerData = function() {
                                var res = _origBootLoad ? _origBootLoad.apply(this, arguments) : undefined;
                                return (res && typeof res.then === 'function') ? res : Promise.resolve(res);
                            };
                        }
                    }
                }
                
                if (_origSrc.set) {
                    return _origSrc.set.call(this, val);
                } else {
                    return this.setAttribute('src', val);
                }
            },
            get: function() { 
                if (_origSrc.get) {
                    return _origSrc.get.call(this); 
                } else {
                    return this.getAttribute('src');
                }
            }
        });
    }
}

// ============================================================================
// 3. ОСНОВНОЙ КОД RPG-FIXES (Ultimate v4.0 - Fullscreen Bulletproof)
// ============================================================================
(() => {
    if (window.__RPG_FIXES_ULTIMATE__) return;
    window.__RPG_FIXES_ULTIMATE__ = true;

    // Надписи меню и кнопок — на языке, выбранном в библиотеке. Библиотека хранит его
    // в localStorage (rpg_lang), а игры в проде открываются с того же адреса, так что
    // выбор виден и здесь. В dev игры живут на другом порту со своим localStorage —
    // туда язык приходит в адресе: ?lang=en
    const UI_TEXT = {
        ru: {
            settings: 'Настройки', home: 'В библиотеку', turbo: 'Турбо ×3', cheats: 'Чит-меню',
            restart: 'Перезапустить игру', restart_confirm: 'Ещё раз — и перезапуск',
            save: 'Сохранить', save_blocked: 'Только на карте, вне сцены', loading: 'Загрузка игры…',
            stretch: 'Растянуть экран', smooth: 'Сглаживание', fullscreen: 'На весь экран',
            touch: 'Касания по игре',
            fps: 'Счётчик кадров', spikes: 'Журнал подтормаживаний',
            stick: 'Джойстик', prev: 'Предыдущий (Q)', next: 'Следующий (W)',
            skip: 'Пропуск', skip_hint: 'Пропуск текста (Ctrl)', dash: 'Бег', dash_hint: 'Бег (Shift)',
            back: 'назад', menu: 'меню', back_hint: 'Назад, меню (X)', ok: 'ок', ok_hint: 'Выбрать (Z)', a_hint: 'Клавиша A',
            keys: 'Другие клавиши', keys_abc: 'Вся клавиатура',
            cap_auto: 'авто', cap_skip: 'пропуск', cap_log: 'журнал', cap_hide: 'скрыть',
            sync_busy: '☁️ Синхронизация…', sync_ok: '✅ Сохранено',
            sync_offline: '📡 Ждём сеть (сохранено локально)',
            sync_lost: '⚠️ Нет связи с сервером, а в браузере нет места — не закрывайте игру, пока не вернётся сеть',
            sync_error: '⚠️ Ошибка сервера',
            sync_conflict: '☁️ На сервере этот слот новее — ваш сейв сохранён в истории сейвов',
            fps_frame: 'кадр', fps_spikes: 'спайки',
            spikes_total: 'всего', spikes_clear: 'Очистить', spikes_cleared: '— Лог очищен —',
        },
        en: {
            settings: 'Settings', home: 'Back to library', turbo: 'Turbo ×3', cheats: 'Cheat menu',
            restart: 'Restart game', restart_confirm: 'Press again to restart',
            save: 'Save', save_blocked: 'Only on the map, outside scenes', loading: 'Loading game…',
            stretch: 'Stretch to screen', smooth: 'Smoothing', fullscreen: 'Full screen',
            touch: 'Touch input in game',
            fps: 'FPS counter', spikes: 'Stutter log',
            stick: 'Joystick', prev: 'Previous (Q)', next: 'Next (W)',
            skip: 'Skip', skip_hint: 'Skip text (Ctrl)', dash: 'Run', dash_hint: 'Run (Shift)',
            back: 'back', menu: 'menu', back_hint: 'Back, menu (X)', ok: 'ok', ok_hint: 'Confirm (Z)', a_hint: 'Key A',
            keys: 'More keys', keys_abc: 'Full keyboard',
            cap_auto: 'auto', cap_skip: 'skip', cap_log: 'log', cap_hide: 'hide',
            sync_busy: '☁️ Syncing…', sync_ok: '✅ Saved',
            sync_offline: '📡 Waiting for network (saved locally)',
            sync_lost: '⚠️ No connection to the server and no space left in the browser — keep the game open until the network is back',
            sync_error: '⚠️ Server error',
            sync_conflict: '☁️ The server has a newer save in this slot — yours is kept in the save history',
            fps_frame: 'frame', fps_spikes: 'spikes',
            spikes_total: 'total', spikes_clear: 'Clear', spikes_cleared: '— Log cleared —',
        },
        de: {
            settings: 'Einstellungen', home: 'Zur Bibliothek', turbo: 'Turbo ×3', cheats: 'Cheat-Menü',
            restart: 'Spiel neu starten', restart_confirm: 'Zum Neustart erneut drücken',
            save: 'Speichern', save_blocked: 'Nur auf der Karte, außerhalb von Szenen', loading: 'Spiel wird geladen…',
            stretch: 'Bild strecken', smooth: 'Glättung', fullscreen: 'Vollbild',
            touch: 'Touch-Eingabe im Spiel',
            fps: 'FPS-Anzeige', spikes: 'Ruckel-Protokoll',
            stick: 'Joystick', prev: 'Vorheriger (Q)', next: 'Nächster (W)',
            skip: 'Vorspulen', skip_hint: 'Text vorspulen (Strg)', dash: 'Rennen', dash_hint: 'Rennen (Umschalt)',
            back: 'zurück', menu: 'Menü', back_hint: 'Zurück, Menü (X)', ok: 'ok', ok_hint: 'Auswählen (Z)', a_hint: 'Taste A',
            keys: 'Weitere Tasten', keys_abc: 'Ganze Tastatur',
            cap_auto: 'auto', cap_skip: 'vorspulen', cap_log: 'Verlauf', cap_hide: 'ausblenden',
            sync_busy: '☁️ Synchronisiere…', sync_ok: '✅ Gespeichert',
            sync_offline: '📡 Warte auf Netz (lokal gespeichert)',
            sync_lost: '⚠️ Keine Verbindung zum Server und kein Platz im Browser — Spiel nicht schließen, bis das Netz zurück ist',
            sync_error: '⚠️ Serverfehler',
            sync_conflict: '☁️ Auf dem Server ist dieser Spielstand neuer — deiner liegt im Spielstand-Verlauf',
            fps_frame: 'Frame', fps_spikes: 'Ruckler',
            spikes_total: 'gesamt', spikes_clear: 'Leeren', spikes_cleared: '— Protokoll geleert —',
        },
    };
    const T = UI_TEXT[(() => {
        const known = (v) => Object.keys(UI_TEXT).includes(v);
        let lang = null;
        try { lang = new URLSearchParams(location.search).get('lang'); } catch (_) {}
        if (!known(lang)) try { lang = localStorage.getItem('rpg_lang'); } catch (_) {}
        return known(lang) ? lang : 'ru';   // 'ru' — как и в самой библиотеке по умолчанию
    })()];

    // Имя игры для её данных — папка игры. Её называет сервер (window.__RPG), без него — первая часть
    // адреса. Раньше имя «чинилось»: всё, кроме латиницы, кириллицы и цифр, становилось «_», и у
    // японских названий выходили одни подчёркивания — две игры с названиями одной длины делили бы
    // сейвы. Сервер перенёс сейвы под настоящие имена; LEGACY_GAME_ID — прежнее, для очереди сейвов
    const GAME_ID = (() => {
        if (window.__RPG && window.__RPG.id) return String(window.__RPG.id);
        const first = location.pathname.split('/').filter(Boolean)[0] || '';
        try { return decodeURIComponent(first) || 'unknown'; } catch (_) { return first || 'unknown'; }
    })();
    const LEGACY_GAME_ID = GAME_ID.replace(/[^a-zA-Z0-9._\-а-яА-Я]/g, '_');

    // Настройки, которые запоминаются для каждой игры: «Касания по игре», «Растянуть экран»,
    // раскрытая клавиатура в полоске ⌨. Раньше они сбрасывались при каждом запуске, и в
    // игре, которой нужны касания, это приходилось включать заново. Хранятся в браузере:
    // на телефоне и на компьютере они и должны быть разными
    const gameSettings = (() => {
        const key = 'rpgfix_game_' + GAME_ID;
        let data = {};
        // Раньше ключом была первая часть адреса как есть, в %-кодировке
        try { data = JSON.parse(localStorage.getItem(key) || localStorage.getItem('rpgfix_game_' + encodeURIComponent(GAME_ID)) || '{}') || {}; } catch (_) {}
        return {
            get: (name) => data[name],
            set: (name, value) => {
                data[name] = value;
                try { localStorage.setItem(key, JSON.stringify(data)); } catch (_) {}
            },
        };
    })();

    // Журнал ошибок игры — на сервер, а оттуда в «Ревизию»: игра, упавшая на телефоне, видна без
    // ручной проверки каждой. Ловим ошибки страницы, отклонённые обещания и то, что движок сам
    // показывает на экране ошибки (SceneManager.catchException, «Failed to load»). Одну и ту же — раз,
    // всего за сеанс — не больше 15
    (function setupErrorReports() {
        const base = (window.__RPG && window.__RPG.errors) || '/api/errors';
        const url = `${base}/${encodeURIComponent(GAME_ID)}`;
        const sent = new Set();
        const scene = () => { try { return SceneManager._scene.constructor.name; } catch (_) { return ''; } };
        const report = (kind, message, source, line, stack) => {
            message = String(message || '').slice(0, 500);
            if (!message || /^Script error\.?$/i.test(message) || /ResizeObserver loop/i.test(message)) return;
            const sig = `${kind}|${message}|${source || ''}|${line || 0}`;
            if (sent.has(sig) || sent.size >= 15) return;
            sent.add(sig);
            let standalone = false;
            try { standalone = !!(navigator.standalone || matchMedia('(display-mode: standalone)').matches); } catch (_) {}
            try {
                fetch(url, {
                    method: 'POST', keepalive: true, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ kind, message, source: String(source || '').slice(0, 300), line: line || 0, stack: String(stack || '').slice(0, 2000), scene: scene(), standalone }),
                }).catch(() => {});
            } catch (_) {}
        };
        window.addEventListener('error', (e) => {
            if (!(e instanceof ErrorEvent)) return;   // не загрузилась картинка или скрипт — это не ошибка кода
            report('error', e.message, e.filename, e.lineno, e.error && e.error.stack);
        });
        window.addEventListener('unhandledrejection', (e) => {
            const r = e.reason;
            report('rejection', (r && (r.message || r.toString())) || 'Promise rejected', '', 0, r && r.stack);
        });
        const hook = setInterval(() => {
            if (typeof SceneManager === 'undefined' || !SceneManager.catchException) return;
            clearInterval(hook);
            const catchException = SceneManager.catchException;
            SceneManager.catchException = function(e) {
                report('engine', e && (e.message || e.name || String(e)), '', 0, e && e.stack);
                return catchException.apply(this, arguments);
            };
            if (SceneManager.catchLoadError) {
                const catchLoadError = SceneManager.catchLoadError;
                SceneManager.catchLoadError = function(e) {
                    report('load', 'Failed to load', Array.isArray(e) ? e[1] : '', 0, '');
                    return catchLoadError.apply(this, arguments);
                };
            }
            if (typeof Graphics !== 'undefined' && Graphics.printLoadingError) {
                const printLoadingError = Graphics.printLoadingError;
                Graphics.printLoadingError = function(u) {
                    report('load', 'Failed to load', u, 0, '');
                    return printLoadingError.apply(this, arguments);
                };
            }
        }, 50);
        setTimeout(() => clearInterval(hook), 20000);
    })();

    let cloudApi = null;      // облачные сейвы (setupCloudSaves)
    let gameStorage = null;   // хранилище браузера этой игры (setupGameStorage)

    // Уйти из игры — в библиотеку, на перезапуск или по «Выходу» самой игры, — но сначала
    // дать сейвам долететь до сервера: переход страницы обрывает отправку, и свежий сейв
    // остался бы только в очереди этого устройства (уйдёт, когда игру откроют здесь снова,
    // а на другом устройстве его пока не будет). Ждём не дольше 5 секунд
    let leaving = false;
    function leaveGame(go) {
        if (leaving) return;
        leaving = true;
        const sent = cloudApi ? cloudApi.flush() : Promise.resolve();
        Promise.race([sent, new Promise(r => setTimeout(r, 5000))]).then(go, go);
    }
    // Игра на своём адресе открыта в рамке библиотеки (routes/play.js, frontend GameFrame): уход —
    // сообщение библиотеке, она закроет рамку. Открыта сама по себе — переходим по адресу библиотеки
    // из ?lib=, а по-старому (игра на адресе библиотеки) — на её главную
    const FRAMED = window.parent !== window;
    const LIBRARY_URL = (() => {
        try {
            const v = new URLSearchParams(location.search).get('lib') || '';
            return /^https?:\/\/[^\s"'<>]+$/.test(v) ? v : '/';
        } catch (_) { return '/'; }
    })();
    const toLibrary = () => leaveGame(() => {
        if (FRAMED) window.parent.postMessage({ type: 'rpg:leave' }, '*');
        else window.location.href = LIBRARY_URL;
    });
    // Библиотека просит уйти (кнопка «Назад» браузера): сначала дать сейвам долететь
    window.addEventListener('message', (e) => {
        if (e.source === window.parent && e.data && e.data.type === 'rpg:leave-request') toLibrary();
    });

    // «Выход» из самой игры — команда на титуле или в меню у ~25 игр библиотеки (плагины
    // зовут SceneManager.exit или terminate). Движок закрыл бы окно NW.js, а вкладку браузера
    // закрыть нельзя — оставался чёрный экран. Теперь выход — обратно в библиотеку
    function setupGameExit() {
        const timer = setInterval(() => {
            if (typeof SceneManager === 'undefined' || !SceneManager.terminate) return;
            clearInterval(timer);
            SceneManager.terminate = toLibrary;
        }, 50);
        setTimeout(() => clearInterval(timer), 15000);
    }

    function applyConsoleFixes() {
        function applyCanvasReadFrequently(proto) {
            if (!proto || !proto.getContext) return;
            var originalGetContext = proto.getContext;
            proto.getContext = function(type, attributes) {
                if (type === '2d') {
                    var newAttributes = Object.assign({}, attributes || {});
                    newAttributes.willReadFrequently = true;
                    return originalGetContext.call(this, type, newAttributes);
                }
                return originalGetContext.call(this, type, attributes);
            };
        }
        applyCanvasReadFrequently(HTMLCanvasElement.prototype);
        if (typeof OffscreenCanvas !== 'undefined') applyCanvasReadFrequently(OffscreenCanvas.prototype);

        var orgSetTextAlign = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'textAlign');
        if (orgSetTextAlign && orgSetTextAlign.set) {
            Object.defineProperty(CanvasRenderingContext2D.prototype, 'textAlign', {
                set: function(value) {
                    var safeValue = (value === 'undefined' || !value) ? 'left' : String(value).toLowerCase();
                    orgSetTextAlign.set.call(this, safeValue);
                }
            });
        }

        var orgWarn = console.warn;
        console.warn = function() {
            if (arguments[0] && typeof arguments[0] === 'string') {
                if (arguments[0].indexOf('Unsupported skeleton data') > -1) return;
            }
            orgWarn.apply(console, arguments);
        };
        // ====================================================================
        // ФИКС КРАША СНИМКОВ ЭКРАНА (getImageData non-finite / type 'long')
        // ====================================================================
        var origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
        CanvasRenderingContext2D.prototype.getImageData = function(sx, sy, sw, sh) {
            // Строгая проверка: если это Бесконечность (Infinity) или NaN -> превращаем в 0
            var x = (isFinite(sx) && !isNaN(sx)) ? Math.round(sx) : 0;
            var y = (isFinite(sy) && !isNaN(sy)) ? Math.round(sy) : 0;
            var w = (isFinite(sw) && !isNaN(sw)) ? Math.round(sw) : 1;
            var h = (isFinite(sh) && !isNaN(sh)) ? Math.round(sh) : 1;
            
            // Canvas ненавидит нулевую ширину или высоту
            if (w === 0) w = 1;
            if (h === 0) h = 1;

            try {
                // Пытаемся сделать снимок с отфильтрованными координатами
                return origGetImageData.call(this, x, y, w, h);
            } catch (e) {
                // Если Canvas всё равно недоволен, отдаем пустой прозрачный квадрат
                console.warn('[RPG Fixes] 🛡️ Перехвачен краш getImageData:', e.message);
                return this.createImageData(Math.abs(w) || 1, Math.abs(h) || 1);
            }
        };
    }

    function applyCoreEnginePatches() {
        const pmTimer = setInterval(() => {
            if (window.PluginManager && typeof PluginManager.setup === 'function' && !window.__pmHooked) {
                window.__pmHooked = true;
                
                // 🛑 Глушим плагин AudioStreaming еще до его запуска!
                if (!PluginManager._parameters) PluginManager._parameters = {};
                PluginManager._parameters['audiostreaming'] = { mode: "00" };

                const origSetup = PluginManager.setup;
                PluginManager.setup = function(plugins) {
                    if (Array.isArray(plugins)) {
                        plugins = plugins.filter(p => !['EliMZ_MobileControls', 'ToggleSaveDirectory', 'Mobile', 'AudioStreaming'].includes(p.name));
                    }
                    origSetup.call(this, plugins);
                };
                clearInterval(pmTimer);
            }
        }, 10);
        // Не игра RPG Maker (или сломанная) — не опрашиваем вечно
        setTimeout(() => clearInterval(pmTimer), 30000);
    }

    function setupBrowserStubs() {
        if (typeof window.Logger === 'undefined') {
            const dummyLog = function() {};
            window.Logger = {
                createDefaultLogger: function() { return { info: dummyLog, warn: dummyLog, error: dummyLog, debug: dummyLog, fatal: dummyLog, trace: dummyLog }; },
                default: { createDefaultLogger: function() { return { info: dummyLog, warn: dummyLog, error: dummyLog, debug: dummyLog, fatal: dummyLog, trace: dummyLog }; } }
            };
        }
        
        window.__import_meta = { url: location.href, env: {} };

        // Модуль path из Node — как в NW.js (пути через «/»). Плагины зовут не только join и dirname:
        // DKTools после выбора языка берёт path.parse и path.sep, и без них игра вставала на ошибке
        // «this.path.parse is not a function»
        const nodePath = (() => {
            const clean = (p) => String(p == null ? '' : p).replace(/\\/g, '/');
            const normalize = (p) => {
                p = clean(p);
                // Пустой путь — пустая строка, как в прежней замене (Node вернул бы «.»)
                if (!p) return '';
                const abs = p.startsWith('/');
                const trail = p.endsWith('/');
                const out = [];
                for (const part of p.split('/')) {
                    if (!part || part === '.') continue;
                    if (part === '..') { if (out.length && out[out.length - 1] !== '..') out.pop(); else if (!abs) out.push('..'); }
                    else out.push(part);
                }
                const joined = (abs ? '/' : '') + out.join('/');
                return (joined || (abs ? '/' : '.')) + (trail && out.length ? '/' : '');
            };
            const basename = (p, ext) => {
                const b = clean(p).replace(/\/+$/, '').split('/').pop() || '';
                return ext && b.endsWith(ext) && b !== ext ? b.slice(0, -ext.length) : b;
            };
            const extname = (p) => { const b = basename(p); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i) : ''; };
            const dirname = (p) => {
                const s = clean(p).replace(/\/+$/, '');
                const i = s.lastIndexOf('/');
                return i < 0 ? '.' : i === 0 ? '/' : s.slice(0, i);
            };
            const isAbsolute = (p) => clean(p).startsWith('/');
            const join = (...a) => normalize(a.filter((x) => x !== '' && x != null).map(clean).join('/'));
            const resolve = (...a) => {
                let r = '';
                for (let i = a.length - 1; i >= 0 && !isAbsolute(r); i--) if (a[i]) r = r ? `${clean(a[i])}/${r}` : clean(a[i]);
                if (!isAbsolute(r)) r = `${dirname(location.pathname)}/${r}`;
                return normalize(r).replace(/(.)\/$/, '$1');
            };
            const relative = (from, to) => {
                const f = resolve(from).split('/').filter(Boolean);
                const t = resolve(to).split('/').filter(Boolean);
                let i = 0;
                while (i < f.length && i < t.length && f[i] === t[i]) i++;
                return [...f.slice(i).map(() => '..'), ...t.slice(i)].join('/');
            };
            const parse = (p) => {
                const s = clean(p);
                const root = s.startsWith('/') ? '/' : '';
                const base = basename(s);
                const ext = extname(s);
                let dir = dirname(s);
                if (dir === '.' && !s.includes('/')) dir = '';
                return { root, dir, base, ext, name: ext ? base.slice(0, -ext.length) : base };
            };
            const format = (o) => {
                const dir = o.dir || o.root || '';
                const base = o.base || `${o.name || ''}${o.ext || ''}`;
                return dir ? (dir.endsWith('/') ? dir + base : `${dir}/${base}`) : base;
            };
            const api = { sep: '/', delimiter: ':', normalize, join, resolve, relative, dirname, basename, extname, isAbsolute, parse, format, toNamespacedPath: (p) => p };
            api.posix = api;
            api.win32 = api;
            return api;
        })();

        if (typeof require === 'undefined') {
            // Кэш для fs: файлы игры во время игры не меняются, повторно не спрашиваем
            const fsCache = new Map();
            window.require = function (m) {
                if (m === 'path') return nodePath;
                if (m === 'util') return {
                    promisify: function(fn) { 
                        return function(...args) { 
                            return new Promise((resolve, reject) => { 
                                fn(...args, (err, res) => err ? reject(err) : resolve(res)); 
                            }); 
                        }; 
                    }
                };
                if (m === 'fs') {
                    // Читаем файлы игры с сервера синхронным запросом — так же синхронно, как fs.*Sync
                    // в NW.js. Относительный путь считается от папки игры (адреса страницы).
                    // Нужно плагинам, которые читают свои файлы через fs (Hendrix_Localization: game_messages.csv).
                    const fetchSync = (p, method) => {
                        const key = method + ' ' + p;
                        if (fsCache.has(key)) return fsCache.get(key);
                        let result = { status: 0, text: '' };
                        try {
                            const xhr = new XMLHttpRequest();
                            xhr.open(method, String(p).replace(/\\/g, '/'), false);
                            xhr.overrideMimeType('text/plain; charset=utf-8');
                            xhr.send();
                            result = { status: xhr.status, text: xhr.responseText };
                        } catch (e) {}
                        fsCache.set(key, result);
                        return result;
                    };
                    // Папка save/ игры — в браузере. Плагины вроде TS_CommonSave (общая комната
                    // воспоминаний на все сохранения) пишут туда свои файлы, а раньше
                    // запись уходила в никуда, и открытое пропадало с каждым запуском. Файл
                    // хранится как ключ игры (setupGameStorage): в её хранилище и в облаке
                    const saveName = (p) => { const x = /(?:^|\/)save\/(.*)$/i.exec(String(p).replace(/\\/g, '/')); return x ? x[1] : null; };
                    const fileKey = (name) => 'FILE save:' + name;
                    const saved = (p) => { const n = saveName(p); return n && gameStorage ? gameStorage.get(fileKey(n)) : null; };
                    return {
                        // Файла нет — по-прежнему '[]': на это рассчитывают старые плагины
                        readFileSync: p => { const v = saved(p); if (v !== null) return v; const r = fetchSync(p, 'GET'); return r.status === 200 ? r.text : '[]'; },
                        existsSync: p => { const n = saveName(p); if (n === '' || (n && saved(p) !== null)) return true; return fetchSync(p, 'HEAD').status === 200; },
                        writeFileSync: (p, data) => { const n = saveName(p); if (n && gameStorage) gameStorage.set(fileKey(n), String(data)); },
                        unlinkSync: p => { const n = saveName(p); if (n && gameStorage) gameStorage.remove(fileKey(n)); },
                        readdirSync: p => {
                            const dir = saveName(String(p).replace(/[\\/]*$/, '/'));
                            if (dir === null || !gameStorage) return [];
                            return gameStorage.list(fileKey(dir)).map(k => k.slice(fileKey(dir).length)).filter(n => n && !n.includes('/'));
                        },
                        mkdirSync: () => {},
                        statSync: () => ({ isDirectory: () => false })
                    };
                }
                if (m === 'nw.gui' || m === 'nw') return { 
                    Window: { get: () => ({ on() {}, maximize() {}, restore() {}, removeAllListeners() {}, close() {} }) }, 
                    App: { quit() { toLibrary(); }, argv: [], manifest: {} }, 
                    Screen: { Init() {}, on() {} }, 
                    Shell: { openExternal: url => window.open(url, '_blank') } 
                };
                if (m.includes('greenworks')) return {
                    initAPI: () => false, isSteamRunning: () => false, getAppId: () => 0,
                    getSteamId: () => ({ accountId: 0, screenName: 'Player' }), activateAchievement: () => {}, on: () => {}
                };
                return {};
            };
            window.nw = window.require('nw');
        }
    }

    function fixDevicePixelRatio() {
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        if (!isIOS) return;
        const TARGET = 1;
        // Настоящую плотность запоминаем до подмены: по ней масштабирование решает,
        // чёткими пикселями рисовать картинку или со сглаживанием (см. applyScale)
        window.__realDevicePixelRatio = window.devicePixelRatio;
        try { Object.defineProperty(window, 'devicePixelRatio', { get: () => TARGET, configurable: true }); } catch(e) {}
        const pixi_t = setInterval(() => {
            if (typeof PIXI === 'undefined') return;
            clearInterval(pixi_t);
            const gfx_t = setInterval(() => {
                if (typeof Graphics === 'undefined') return;
                const r = (Graphics._app && Graphics._app.renderer) || Graphics._renderer;
                if (!r) return;
                clearInterval(gfx_t);
                if (r.resolution === TARGET) return; 
                const logW = r.width  / r.resolution; const logH = r.height / r.resolution; r.resolution = TARGET;
                try { r.resize(logW, logH); } catch(e) {}
                try { if (r.plugins && r.plugins.interaction) r.plugins.interaction.resolution = TARGET; } catch(e) {}
            }, 100);
            setTimeout(() => clearInterval(gfx_t), 15000);
        }, 50);
        setTimeout(() => clearInterval(pixi_t), 15000);
    }

    function setupModernViewport() {
        let meta = document.querySelector('meta[name="viewport"]');
        if (!meta) { meta = document.createElement('meta'); meta.name = 'viewport'; document.head.appendChild(meta); }
        meta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover';

        const style = document.createElement('style');
        style.textContent = `
            html, body { margin:0!important; padding:0!important; width:100vw!important; height:100dvh!important; background:#000!important; overflow:hidden!important; touch-action:none!important; overscroll-behavior: none; -webkit-text-size-adjust: none; }
            #GameCanvas, canvas { display:block!important; position:absolute!important; top:50%!important; left:50%!important; transform-origin:center center!important; margin:0!important; padding:0!important; will-change: transform; -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; }
        `;
        document.head.appendChild(style);

        let isStretched = !!gameSettings.get('stretch'); let targetCanvas = null;
        window.__toggleRpgStretch = () => { isStretched = !isStretched; gameSettings.set('stretch', isStretched); forceScaleUpdate(); };
        window.__rpgIsStretched = () => isStretched;

        // Сглаживание при растягивании. Раньше картинка всегда растягивалась без него
        // (image-rendering: pixelated), и при дробном увеличении — 1,5 на экране 1080p —
        // каждый второй пиксель игры становился двойным: буквы разной толщины, края
        // лесенкой. Теперь «auto»: чёткие пиксели, только когда увеличение целое
        // (×2, ×3 — там они ровные), иначе плавно. «off» — всегда чёткие, как раньше.
        // Выбор общий для всех игр: они открываются с одного адреса
        const SMOOTH_KEY = 'rpgfix_smoothing';
        let smoothMode = 'auto';
        try { if (localStorage.getItem(SMOOTH_KEY) === 'off') smoothMode = 'off'; } catch(e) {}
        window.__rpgSmoothing = () => smoothMode;
        window.__toggleRpgSmoothing = () => {
            smoothMode = smoothMode === 'auto' ? 'off' : 'auto';
            try { localStorage.setItem(SMOOTH_KEY, smoothMode); } catch(e) {}
            forceScaleUpdate();
            return smoothMode;
        };

        // Вырез, «островок» и скруглённые углы iPhone. Страница растянута на весь экран
        // (viewport-fit=cover), и раньше картинка игры считалась по всему экрану: растянутая,
        // она уходила под вырез — на iPhone 13 лёжа по 47 px с каждой стороны. Теперь игра
        // встаёт в безопасную зону. Снизу отступ не берём: там только тонкая полоска «домой»,
        // а игра на телефоне лёжа из-за неё стала бы мельче
        const safeProbe = document.createElement('div');
        safeProbe.id = '_safe_area_probe';
        safeProbe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) 0 env(safe-area-inset-left);';
        document.documentElement.appendChild(safeProbe);
        function safeInsets() {
            const cs = getComputedStyle(safeProbe);
            return { left: parseFloat(cs.paddingLeft) || 0, right: parseFloat(cs.paddingRight) || 0, top: parseFloat(cs.paddingTop) || 0 };
        }

        // Где сейчас холст: сдвиг и масштаб. Нужно, чтобы поставить поверх него видео
        const placed = { left: 0, top: 0, sx: 1, sy: 1 };

        // Где и в каком масштабе встаёт картинка игры размером w×h в нынешнем окне
        function fit(w, h) {
            const safe = safeInsets();
            const areaW = window.innerWidth - safe.left - safe.right, areaH = window.innerHeight - safe.top;
            let sx = areaW / w, sy = areaH / h;
            if (!isStretched) sx = sy = Math.min(sx, sy);
            // Считаем в настоящих пикселях экрана: на iPhone и ноутбуке с масштабом 125%
            // один пиксель CSS — это 3 и 1,25 физических. На iPhone devicePixelRatio
            // подменён на 1 (fixDevicePixelRatio), поэтому берём сохранённый
            const dpr = window.__realDevicePixelRatio || window.devicePixelRatio || 1;
            // По центру, но с точностью до пикселя экрана: при центровке через 50% холст
            // на нечётной ширине окна вставал на полпикселя, и даже при ×2 пиксели выходили неровными
            const left = Math.round((safe.left + (areaW - w * sx) / 2) * dpr) / dpr;
            const top = Math.round((safe.top + (areaH - h * sy) / 2) * dpr) / dpr;
            return { sx, sy, left, top, dpr };
        }

        const resizeObserver = new ResizeObserver(() => { if (targetCanvas) requestAnimationFrame(applyScale); });
        function applyScale() {
            if (!targetCanvas || !targetCanvas.width) return;
            const w = targetCanvas.width, h = targetCanvas.height;
            const { sx: scaleX, sy: scaleY, left, top, dpr } = fit(w, h);
            const whole = (v) => v >= 1 && Math.abs(v - Math.round(v)) < 0.01;
            const crisp = smoothMode === 'off' || (whole(scaleX * dpr) && whole(scaleY * dpr));
            // Второй холст движка MV (на нём «Now Loading…» при долгой загрузке) — туда же,
            // где картинка игры. Раньше он стоял левым верхним углом в центре окна: надпись
            // уходила в правый нижний угол, за край экрана
            const canvases = [targetCanvas];
            const upper = typeof Graphics !== 'undefined' && Graphics._upperCanvas;
            if (upper && upper !== targetCanvas && upper.style) canvases.push(upper);
            for (const c of canvases) {
                c.style.setProperty('width', w + 'px', 'important');
                c.style.setProperty('height', h + 'px', 'important');
                c.style.setProperty('image-rendering', crisp ? 'pixelated' : 'auto', 'important');
                c.style.setProperty('left', '0px', 'important');
                c.style.setProperty('top', '0px', 'important');
                c.style.setProperty('transform-origin', '0 0', 'important');
                c.style.setProperty('transform', `translate(${left}px, ${top}px) scale(${scaleX}, ${scaleY})`, 'important');
            }
            Object.assign(placed, { left, top, sx: scaleX, sy: scaleY });
            syncEngineScale(Math.min(scaleX, scaleY));
            placeVideo();
        }
        function forceScaleUpdate() { if (targetCanvas) requestAnimationFrame(applyScale); }

        // Масштаб у движка — тот, с которым картинка на самом деле на экране. Раньше движок
        // считал свой: на компьютере 1, в MZ на телефоне на 10% меньше, с плагином YEP —
        // округлённый. А игры и плагины по нему ставят поверх картинки свои поля и кнопки:
        // поле ввода имени в Kirstin уходило за край экрана
        function syncEngineScale(s) {
            if (typeof Graphics === 'undefined' || typeof Graphics._updateRealScale !== 'function') return;
            if (!Graphics._updateRealScale.__rpg) {
                // Меняется окно — движок пересчитывает масштаб сам; даём ему наш
                const own = Graphics._updateRealScale;
                Graphics._updateRealScale = function() {
                    own.apply(this, arguments);
                    if (this._width > 0 && this._height > 0) { const f = fit(this._width, this._height); this._realScale = Math.min(f.sx, f.sy); }
                };
                Graphics._updateRealScale.__rpg = true;
            }
            if (Graphics._realScale === s) return;
            Graphics._realScale = s;
            // Экран ошибки и видео движок ставит по масштабу — переставляем
            try { if (Graphics._errorPrinter && Graphics._updateErrorPrinter) Graphics._updateErrorPrinter(); } catch (_) {}
            try { if (Graphics._updateVideo) Graphics._updateVideo(); } catch (_) {}
        }

        // Видео движка — поверх картинки игры. Движок (и плагины вроде MovieManager) ставит
        // его по своей схеме: картинка игры по центру окна в масштабе Graphics._realScale.
        // А холст ставит rpg-fixes — со своим масштабом, растяжением и отступом от выреза.
        // Переводим положение видео из одной схемы в другую. Раньше ролик стоял мимо
        // картинки, а на телефоне — в исходном размере, срезанный краем экрана
        let watchedVideo = null;
        function placeVideo() {
            const v = (typeof Graphics !== 'undefined' && Graphics._video) || (typeof Video !== 'undefined' && Video._element);
            if (!v || !targetCanvas || !targetCanvas.width) return;
            if (watchedVideo !== v) {
                watchedVideo = v;
                // Движок и плагины двигают видео и сами — тогда пересчитываем
                new MutationObserver(placeVideo).observe(v, { attributes: true, attributeFilter: ['style', 'width', 'height'] });
                v.addEventListener('loadedmetadata', placeVideo);
            }
            const rs = (typeof Graphics !== 'undefined' && Graphics._realScale) || 1;
            const engineX = (window.innerWidth - targetCanvas.width * rs) / 2;
            const engineY = (window.innerHeight - targetCanvas.height * rs) / 2;
            let L = 0, T = 0;
            for (let e = v; e; e = e.offsetParent) { L += e.offsetLeft; T += e.offsetTop; }
            const kx = placed.sx / rs, ky = placed.sy / rs;
            const x = placed.left + (L - engineX) * kx, y = placed.top + (T - engineY) * ky;
            const t = `translate(${x - L}px, ${y - T}px) scale(${kx}, ${ky})`;
            // Сравниваем со своим прошлым значением, а не со style.transform: браузер
            // записывает его по-своему, и наблюдатель крутился бы бесконечно
            if (v.__rpgTransform !== t) {
                v.__rpgTransform = t;
                v.style.transformOrigin = '0 0';
                v.style.transform = t;
            }
        }

        const domObserver = new MutationObserver((mutations, obs) => {
            const c = document.getElementById('GameCanvas') || document.querySelector('canvas');
            if (c) {
                targetCanvas = c; resizeObserver.observe(document.body);
                // Сразу, а не к следующему кадру: плагины, которые на изменение окна
                // переставляют свои поля, должны видеть картинку уже на новом месте
                window.addEventListener('resize', () => { applyScale(); forceScaleUpdate(); });
                const canvasObserver = new MutationObserver(() => forceScaleUpdate());
                canvasObserver.observe(targetCanvas, { attributes: true, attributeFilter: ['width', 'height'] });
                const hookTimer = setInterval(() => {
                    if (typeof Graphics !== 'undefined') {
                        Graphics.pageToCanvasX = function (x) { if (!this._canvas) return 0; const rect = this._canvas.getBoundingClientRect(); return Math.round((x - rect.left) * (this._canvas.width / rect.width)); };
                        Graphics.pageToCanvasY = function (y) { if (!this._canvas) return 0; const rect = this._canvas.getBoundingClientRect(); return Math.round((y - rect.top) * (this._canvas.height / rect.height)); };
                        // Холсты ставит rpg-fixes (applyScale). Всё остальное — видео, окно ошибки —
                        // движок ставит сам, как привык. Раньше отключалось и это, и ролик
                        // оставался там, где оказался при создании
                        if (Graphics._centerElement && !Graphics._centerElement.__rpg) {
                            const center = Graphics._centerElement;
                            Graphics._centerElement = function(el) {
                                if (el && el.tagName === 'CANVAS') return;
                                return center.apply(this, arguments);
                            };
                            Graphics._centerElement.__rpg = true;
                        }
                        clearInterval(hookTimer);
                    }
                }, 100);
                setTimeout(() => clearInterval(hookTimer), 5000);
                let bootTicks = 0;
                const bootTimer = setInterval(() => { forceScaleUpdate(); if (++bootTicks > 20) clearInterval(bootTimer); }, 100);
                obs.disconnect();
            }
        });
        domObserver.observe(document.body, { childList: true, subtree: true });
        const forceModeTimer = setInterval(() => { if (typeof Utils !== 'undefined') { Utils.isNwjs = () => false; Utils.isLocal = () => false; clearInterval(forceModeTimer); } }, 50);
        setTimeout(() => clearInterval(forceModeTimer), 10000);
    }

    // Видеопамять убирает сам PIXI, как задумано в движке. Раньше здесь его уборка
    // переводилась на ручную и запускалась из changeScene — а движок зовёт его каждый кадр.
    // В MV (ядро считает мусором всё, что кадр не рисовалось) кадры анимаций на картинках
    // заново грузились в видеопамять при каждой смене: 60 загрузок вместо 3. В MZ уборка
    // не запускалась вовсе, и показанные CG копились в памяти до перезагрузки страницы
    function applyPerformanceOptimizations() {
        // ====================================================================
        // 🔥 ФИКС СНА (БЛОКИРОВКИ ЭКРАНА И СВОРАЧИВАНИЯ) 🔥
        // ====================================================================
        if (!window.__abortShieldInstalled) {
            window.__abortShieldInstalled = true;
            
            // 1. Глушим экран ошибки, который игра показывает на сбой загрузки
            const origAddListener = window.addEventListener;
            const origRemoveListener = window.removeEventListener;
            // Обёртка на каждый слушатель одна — по ней его и снимаем. Раньше снять
            // слушатель ошибок было нельзя: removeEventListener искал исходную функцию,
            // а на окне висела обёртка
            const safeListeners = new WeakMap();
            window.addEventListener = function(type, listener, options) {
                if ((type === 'unhandledrejection' || type === 'error') && listener) {
                    let safeListener = safeListeners.get(listener);
                    if (!safeListener) {
                        safeListener = function(event) {
                            const err = event.reason || event.error || event;
                            if (err && (err.name === 'AbortError' || (err.message && err.message.toLowerCase().includes('aborted')))) {
                                event.preventDefault(); event.stopPropagation(); return;
                            }
                            if (typeof listener === 'function') return listener.apply(this, arguments);
                            if (listener && typeof listener.handleEvent === 'function') return listener.handleEvent(event);
                        };
                        safeListeners.set(listener, safeListener);
                    }
                    return origAddListener.call(this, type, safeListener, options);
                }
                return origAddListener.call(this, type, listener, options);
            };
            window.removeEventListener = function(type, listener, options) {
                if ((type === 'unhandledrejection' || type === 'error') && listener && safeListeners.has(listener)) {
                    listener = safeListeners.get(listener);
                }
                return origRemoveListener.call(this, type, listener, options);
            };

            // 2. Бронируем декодер (Умный авто-повтор после сна)
            if (typeof Image !== 'undefined' && Image.prototype.decode && !Image.prototype.__safeDecode) {
                Image.prototype.__safeDecode = true;
                const origDecode = Image.prototype.decode;
                Image.prototype.decode = function() {
                    return origDecode.call(this).catch(e => {
                        if (e.name === 'AbortError' || (e.message && e.message.toLowerCase().includes('aborted'))) {
                            // Не зависаем вечно! Ждем включения экрана и пробуем загрузить картинку снова
                            return new Promise(resolve => {
                                const retry = () => resolve(origDecode.call(this).catch(()=>{}));
                                if (document.hidden) {
                                    const handler = () => { if (!document.hidden) { document.removeEventListener('visibilitychange', handler); retry(); } };
                                    document.addEventListener('visibilitychange', handler);
                                } else {
                                    setTimeout(retry, 100);
                                }
                            });
                        }
                        throw e;
                    });
                };
            }
        }
    }

    // ============================================================================
    // 4. СИСТЕМА ОБЛАЧНЫХ СОХРАНЕНИЙ
    // ============================================================================
    function setupCloudSaves() {
        // Куда слать сейвы — говорит сервер: у игры на своём адресе это её собственный вход
        const CLOUD_BASE = (window.__RPG && window.__RPG.saves) || '/api/saves';
        const CLOUD_INIT_GRACE_MS = 1800;
        const CLOUD_RETRY_MAX = 3;

        const fastCoreTimer = setInterval(() => {
            if (typeof StorageManager !== 'undefined') StorageManager.isLocalMode = () => false;
            if (typeof DataManager !== 'undefined') { 
                if (!DataManager.setAutoSaveFileId) DataManager.setAutoSaveFileId = () => {}; 
                if (!DataManager.autoSaveFileId) DataManager.autoSaveFileId = () => 1; 
                clearInterval(fastCoreTimer);
            }
        }, 5);
        setTimeout(() => clearInterval(fastCoreTimer), 10000);

        const gameId = GAME_ID;
        let pulledSaves = {}; 
        let cloudReady = false; 
        let cloudFetchFailed = false; 
        const cloudInitStartedAt = Date.now();

        const QUEUE_KEY = `_rpg_offline_queue_${gameId}`;
        function getQueue() { try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '{}'); } catch(e) { return {}; } }
        // Очередь под прежним, «исправленным» именем игры (см. GAME_ID) — в очередь под настоящим
        if (LEGACY_GAME_ID !== gameId) {
            try {
                const legacyKey = `_rpg_offline_queue_${LEGACY_GAME_ID}`;
                const legacy = JSON.parse(localStorage.getItem(legacyKey) || 'null');
                if (legacy && typeof legacy === 'object') {
                    const q = getQueue();
                    for (const k of Object.keys(legacy)) {
                        if (!q[k] || (Number(legacy[k] && legacy[k].updatedAt) || 0) > (Number(q[k].updatedAt) || 0)) q[k] = legacy[k];
                    }
                    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
                    localStorage.removeItem(legacyKey);
                }
            } catch (e) {}
        }
        // localStorage один на все игры библиотеки и всего около 5 МБ, а сейв большой
        // игры — мегабайт. Не влезло — не повод срывать сохранение: отправка на сервер
        // всё равно уходит. Раньше исключение отсюда прерывало сохранение ещё до отправки
        function saveQueue(q) {
            try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); return true; }
            catch (e) { return false; }
        }
        // То, что не влезло в очередь, держим в памяти вкладки: вернётся сеть — отправим
        const memQueue = {};

        const syncDiv = document.createElement('div');
        syncDiv.id = '_cloud_sync_ui';
        syncDiv.style.cssText = 'display:none; position:fixed; top:15px; left:50%; transform:translateX(-50%); background:rgba(0,0,0,0.85); color:#fff; padding:6px 20px; border-radius:20px; z-index:2147483647; font-size:13px; font-family:sans-serif; font-weight:bold; border:1px solid rgba(255,255,255,0.2); pointer-events:none; box-shadow:0 4px 10px rgba(0,0,0,0.5); transition:background 0.3s;';
        document.body.appendChild(syncDiv);

        let syncCount = 0;
        function showSync(active, status = 'ok') {
            if (!syncDiv) return;
            if (active) { 
                syncCount++; syncDiv.textContent = T.sync_busy; syncDiv.style.background = 'rgba(0,0,0,0.85)'; syncDiv.style.display = 'block'; 
            } else { 
                syncCount--; 
                if (syncCount <= 0) { 
                    syncCount = 0; 
                    if (status === 'ok') { syncDiv.textContent = T.sync_ok; syncDiv.style.background = 'rgba(40,140,40,0.9)'; }
                    else if (status === 'offline') { syncDiv.textContent = T.sync_offline; syncDiv.style.background = 'rgba(200,140,20,0.9)'; }
                    else if (status === 'lost') { syncDiv.textContent = T.sync_lost; syncDiv.style.background = 'rgba(170,60,60,0.95)'; }
                    else if (status === 'conflict') { syncDiv.textContent = T.sync_conflict; syncDiv.style.background = 'rgba(200,120,20,0.95)'; }
                    else { syncDiv.textContent = T.sync_error; syncDiv.style.background = 'rgba(170,60,60,0.9)'; }
                    // Предупреждение о несохранённом висит дольше: его нельзя пропустить
                    setTimeout(() => { if (syncCount === 0) syncDiv.style.display = 'none'; }, status === 'lost' ? 8000 : status === 'conflict' ? 6000 : 2000); 
                } 
            }
        }

        async function retryFetch(url, init, retries = CLOUD_RETRY_MAX) {
            let lastErr;
            for (let i = 0; i <= retries; i++) { 
                try { return await fetch(url, init); } 
                catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 250 * Math.pow(2, i))); } 
            }
            throw lastErr;
        }

        function normalizeCloudPayload(raw) {
            const out = {}; 
            if (!raw || typeof raw !== 'object') return out;
            for (const k of Object.keys(raw)) {
                const v = raw[k];
                out[k] = (v && typeof v === 'object' && 'value' in v) ? { value: String(v.value ?? ''), updatedAt: Number(v.updatedAt || 0) } : { value: String(v ?? ''), updatedAt: 0 };
            }
            return out;
        }

        function chooseNewer(a, b) { if (!a) return b; if (!b) return a; return (b.updatedAt || 0) >= (a.updatedAt || 0) ? b : a; }
        function getEntry(key) { return pulledSaves[key]; } 
        function hasEntry(key) { return pulledSaves[key] !== undefined; }

        async function processOfflineQueue() {
            if (!navigator.onLine) return;
            const q = getQueue();
            const pending = { ...q };
            for (const k of Object.keys(memQueue)) pending[k] = chooseNewer(pending[k], memQueue[k]);
            const keys = Object.keys(pending);
            if (keys.length === 0) return;

            showSync(true);
            let allOk = true;
            let conflict = false;

            for (const key of keys) {
                try {
                    const res = await retryFetch(`${CLOUD_BASE}/${encodeURIComponent(gameId)}/${encodeURIComponent(key)}`, { 
                        method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pending[key]) 
                    });
                    if (res.ok) {
                        // Сейв из очереди старше того, что на сервере: сервер положил его в историю
                        if ((await res.json().catch(() => ({}))).kept === 'server') conflict = true;
                        delete q[key];
                        if (memQueue[key] && memQueue[key].updatedAt <= pending[key].updatedAt) delete memQueue[key];
                    } else allOk = false;
                } catch(e) { allOk = false; }
            }
            saveQueue(q);
            showSync(false, !allOk ? 'error' : conflict ? 'conflict' : 'ok');
        }

        window.addEventListener('online', () => track(processOfflineQueue()));

        async function fetchCloudSaves() {
            try {
                const res = await retryFetch(`${CLOUD_BASE}/${encodeURIComponent(gameId)}?_t=${Date.now()}`, { method: 'GET', credentials: 'same-origin', cache: 'no-store' });
                if (!res.ok) throw new Error('HTTP ' + res.status);
                
                const cloudData = normalizeCloudPayload(await res.json());
                const localQueue = getQueue();
                
                for (const k of Object.keys(cloudData)) pulledSaves[k] = chooseNewer(pulledSaves[k], cloudData[k]);
                for (const k of Object.keys(localQueue)) pulledSaves[k] = chooseNewer(pulledSaves[k], localQueue[k]);

                cloudReady = true; cloudFetchFailed = false;
                try { const sc = (typeof SceneManager !== 'undefined' && SceneManager._scene) ? SceneManager._scene : null; if (sc?.refresh) sc.refresh(); if (sc?._listWindow?.refresh) sc._listWindow.refresh(); } catch (_) {}
                track(processOfflineQueue());
            } catch (e) { 
                cloudFetchFailed = true; cloudReady = true; 
                const localQueue = getQueue();
                for (const k of Object.keys(localQueue)) pulledSaves[k] = chooseNewer(pulledSaves[k], localQueue[k]);
            }
        }

        // Запросы к облаку, которые ещё идут: перед уходом из игры их дожидаемся (leaveGame)
        const inflight = new Set();
        const track = (p) => { const done = () => inflight.delete(p); inflight.add(p); p.then(done, done); return p; };

        // Данные плагинов (общие сейвы, настройки — см. setupGameStorage) уходят тихо и не
        // чаще раза в полсекунды: плагин может писать их подряд, а значок «Сохранено» — для сейвов
        const pendingSend = {};
        function uploadToCloud(key, value, opts = {}) {
            const payload = { value: String(value), updatedAt: Date.now() };
            pulledSaves[key] = chooseNewer(pulledSaves[key], payload); 
            const q = getQueue(); q[key] = payload;
            // Не влезло в localStorage — сейв держится в памяти, пока вкладка открыта
            const queued = saveQueue(q);
            if (queued) delete memQueue[key]; else memQueue[key] = payload;
            const ui = opts.quiet ? () => {} : showSync;
            const send = () => {
                delete pendingSend[key];
                ui(true);
                if (!navigator.onLine) { ui(false, queued ? 'offline' : 'lost'); return; }
                track(retryFetch(`${CLOUD_BASE}/${encodeURIComponent(gameId)}/${encodeURIComponent(key)}`, { 
                    method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) 
                }).then(async r => {
                    if (r.ok) {
                        // Пока шёл запрос, могли записать новее — его из очереди не убираем
                        const qNew = getQueue();
                        if (qNew[key] && qNew[key].updatedAt <= payload.updatedAt) { delete qNew[key]; saveQueue(qNew); }
                        if (memQueue[key] === payload) delete memQueue[key];
                        // На сервере этот слот новее (сохранялись на другом устройстве): присланный — в истории
                        const body = await r.json().catch(() => ({}));
                        ui(false, body.kept === 'server' ? 'conflict' : 'ok');
                    } else ui(false, queued ? 'error' : 'lost');
                }).catch(() => ui(false, queued ? 'offline' : 'lost')));
            };
            if (pendingSend[key]) clearTimeout(pendingSend[key].timer);
            if (opts.quiet) pendingSend[key] = { timer: setTimeout(send, 500), send }; else send();
        }

        function deleteFromCloud(key, opts = {}) {
            if (pendingSend[key]) clearTimeout(pendingSend[key].timer);
            delete pendingSend[key];
            delete pulledSaves[key]; delete memQueue[key];
            const q = getQueue(); delete q[key]; saveQueue(q);
            const ui = opts.quiet ? () => {} : showSync;
            ui(true);
            if (!navigator.onLine) { ui(false, 'offline'); return; }

            track(retryFetch(`${CLOUD_BASE}/${encodeURIComponent(gameId)}/${encodeURIComponent(key)}`, { method: 'DELETE', credentials: 'same-origin', cache: 'no-store' })
                .then(r => ui(false, r.ok ? 'ok' : 'error')).catch(() => ui(false, 'offline')));
        }

        // Ключи, под которыми сейвы пишет сам движок MV: их в облако отправляет обёртка движка
        // (injectMVEngine). Имена бывают свои — «RPG Moonlit Harbor ov1.0.3 File1», —
        // поэтому запоминаем их, когда движок ими пользуется
        const engineKeys = new Set();
        cloudApi = {
            ready: () => cloudReady,
            engineKey: (key) => engineKeys.has(key.replace(/bak$/, '')),
            get: (key) => (pulledSaves[key] !== undefined ? pulledSaves[key].value : null),
            keys: () => Object.keys(pulledSaves),
            put: (key, value) => uploadToCloud(key, value, { quiet: true }),
            remove: (key) => deleteFromCloud(key, { quiet: true }),
            // Отложенное — отправить сразу; ответ — когда всё, что в пути, долетело
            flush: () => {
                Object.values(pendingSend).forEach(p => { clearTimeout(p.timer); p.send(); });
                return Promise.allSettled([...inflight]);
            },
        };

        function canOptimisticallyShowExists(localExists) {
            if (cloudReady) return false;
            return ((Date.now() - cloudInitStartedAt) <= CLOUD_INIT_GRACE_MS) ? true : !!localExists;
        }

        function injectMZEngine() {
            const _saveToForage = StorageManager.saveToForage; 
            StorageManager.saveToForage = function(saveName, zip) { uploadToCloud(`MZ_${saveName}`, zip); return _saveToForage.apply(this, arguments); };
            const _loadFromForage = StorageManager.loadFromForage; 
            StorageManager.loadFromForage = function(saveName) { const key = `MZ_${saveName}`; if (cloudReady && hasEntry(key)) return Promise.resolve(getEntry(key).value); return _loadFromForage.apply(this, arguments); };
            const _removeForage = StorageManager.removeForage; 
            StorageManager.removeForage = function(saveName) { deleteFromCloud(`MZ_${saveName}`); return _removeForage.apply(this, arguments); };
            const _forageExists = StorageManager.forageExists; 
            StorageManager.forageExists = function(saveName) { const local = _forageExists.apply(this, arguments); if (!cloudReady) return canOptimisticallyShowExists(local); return hasEntry(`MZ_${saveName}`) || local; };
        }

        function injectMVEngine() {
            const _loadFromWebStorage = StorageManager.loadFromWebStorage; 
            StorageManager.loadFromWebStorage = function(saveFileId) { 
                const key = this.webStorageKey(saveFileId); 
                engineKeys.add(key);
                if (cloudReady && hasEntry(key)) {
                    let val = getEntry(key).value;
                    if (val && typeof val === 'string' && !val.trim().startsWith('{') && !val.trim().startsWith('[')) {
                        try { if (typeof LZString !== 'undefined') { const decompressed = LZString.decompressFromBase64(val); if (decompressed) val = decompressed; } } catch(e) {}
                    }
                    return val;
                }
                return _loadFromWebStorage.apply(this, arguments); 
            };
            if (StorageManager.webStorageExists) { 
                const _webStorageExists = StorageManager.webStorageExists; 
                StorageManager.webStorageExists = function(saveFileId) { engineKeys.add(this.webStorageKey(saveFileId)); const local = _webStorageExists.apply(this, arguments); if (!cloudReady) return canOptimisticallyShowExists(local); return hasEntry(this.webStorageKey(saveFileId)) || local; }; 
            }
            // Копия в браузере — запасная: сейв уже ушёл на сервер (или в очередь).
            // localStorage один на все игры и быстро кончается: слот большой игры весит
            // мегабайт. Раньше переполнение здесь
            // бросало исключение, движок считал сохранение проваленным и в блоке спасения
            // удалял слот — вместе с его копией на сервере
            const _saveToWebStorage = StorageManager.saveToWebStorage; 
            StorageManager.saveToWebStorage = function(saveFileId, json) {
                engineKeys.add(this.webStorageKey(saveFileId));
                uploadToCloud(this.webStorageKey(saveFileId), json);
                try { return _saveToWebStorage.apply(this, arguments); }
                catch (e) { console.warn('[RPG Fixes] Копия сейва в браузере не записана (нет места), на сервере он есть:', e && e.name); }
            };
            // Резервная копия слота перед записью — тоже только в браузере и тоже не повод
            // срывать сохранение
            if (StorageManager.backup) {
                const _backup = StorageManager.backup;
                StorageManager.backup = function() {
                    try { return _backup.apply(this, arguments); }
                    catch (e) { console.warn('[RPG Fixes] Резервная копия слота в браузере не записана:', e && e.name); }
                };
            }

            // Если сохранение всё же упало (например, ошибка плагина), MV в блоке спасения
            // удаляет слот и возвращает резервную копию. Это удаление на сервер не пускаем:
            // там лежит предыдущий, целый сейв этого слота. Обёртку ставим и сейчас, и
            // после загрузки плагинов — плагин мог заменить saveGame своей версией
            let saving = 0;
            const guardSaveGame = () => {
                if (typeof DataManager === 'undefined' || !DataManager.saveGame || DataManager.saveGame.__rpgGuarded) return;
                const _saveGame = DataManager.saveGame;
                DataManager.saveGame = function() {
                    saving++;
                    try { return _saveGame.apply(this, arguments); } finally { saving--; }
                };
                DataManager.saveGame.__rpgGuarded = true;
            };
            guardSaveGame();
            const guardTimer = setInterval(guardSaveGame, 500);
            setTimeout(() => clearInterval(guardTimer), 30000);

            const _removeWebStorage = StorageManager.removeWebStorage; 
            StorageManager.removeWebStorage = function(saveFileId) {
                engineKeys.add(this.webStorageKey(saveFileId));
                if (!saving) deleteFromCloud(this.webStorageKey(saveFileId));
                return _removeWebStorage.apply(this, arguments);
            };
        }

        fetchCloudSaves();
        // Игра стартует, когда сейвы из облака уже пришли. Иначе то, что игра и плагины
        // читают при запуске (список сохранений MZ, общий сейв, открытые сцены), на новом
        // устройстве оказалось бы пустым, и первая же запись затёрла бы облачную копию.
        // Обычно облако приходит раньше, чем игра загрузится; без сети ждать нечего, и
        // дольше 4 секунд не ждём. Проверка — до исходной: MZ в ней и читает сохранения
        const bootGate = setInterval(() => {
            if (typeof Scene_Boot === 'undefined' || !Scene_Boot.prototype.isReady) return;
            clearInterval(bootGate);
            const _isReady = Scene_Boot.prototype.isReady;
            Scene_Boot.prototype.isReady = function() {
                if (!cloudReady && Date.now() - cloudInitStartedAt < 4000) return false;
                return _isReady.apply(this, arguments);
            };
        }, 20);
        setTimeout(() => clearInterval(bootGate), 15000);
        const hookTimer = setInterval(() => {
            if (typeof StorageManager === 'undefined') return;
            if (StorageManager.saveToForage) { clearInterval(hookTimer); injectMZEngine(); } 
            else if (StorageManager.saveToWebStorage) { clearInterval(hookTimer); injectMVEngine(); }
        }, 100);
        setTimeout(() => clearInterval(hookTimer), 15000);
        window.addEventListener('pageshow', () => { if (cloudFetchFailed) fetchCloudSaves(); });
    }

    // Хранилище браузера — своё у каждой игры. Все игры библиотеки открываются с одного
    // адреса, а localStorage у адреса один. MV хранит сейвы под одинаковыми для всех игр
    // ключами («RPG File1», «RPG Global», «RPG Config»), плагины — под своими: «RPG Common»
    // у UTA_CommonSave один на 11 игр. Игры видели чужие сейвы, затирали друг другу слоты,
    // общие сейвы и громкость, а без сети игра загружала то, что записала другая. Теперь
    // ключи игры живут под её именем («rpgm:<игра>:RPG File1»), как на компьютере в папке
    // игры. Свои ключи rpg-fixes (rpg_*, rpgfix*, _rpg*) остаются общими
    function setupGameStorage() {
        let ls = null;
        try { ls = window.localStorage; } catch (_) {}
        const P = window.Storage && Storage.prototype;
        if (!ls || !P || P.__rpgGameStorage) return;
        const raw = { get: P.getItem, set: P.setItem, remove: P.removeItem, key: P.key, clear: P.clear };
        const lengthOf = Object.getOwnPropertyDescriptor(P, 'length').get;
        const NS = `rpgm:${GAME_ID}:`;
        const ours = (k) => /^(rpg_|rpgfix|_rpg|rpgm:)/.test(k);
        const rget = (k) => { try { return raw.get.call(ls, k); } catch (_) { return null; } };
        const rkeys = () => { const out = []; try { for (let i = 0; i < lengthOf.call(ls); i++) out.push(raw.key.call(ls, i)); } catch (_) {} return out; };
        // Сейвы MV уходят в облако обёрткой движка (setupCloudSaves). Здесь через облако идут
        // остальные ключи игры — общие сейвы и настройки плагинов, файлы её папки save/ — под
        // приставкой «LS:»: в том же виде, что в браузере, и не путаясь с ключами движка
        const mvSave = (k) => /^RPG (File\d+(bak)?|Global)$/.test(k);
        const viaCloud = (k) => !/^RPG (File\d+(bak)?|Global|Config)$/.test(k) && !k.includes('/') && !/^localforage/.test(k) && !(cloudApi && cloudApi.engineKey(k));
        const CK = (k) => 'LS:' + k;

        // Какие ключи игра уже трогала. Прежнее общее значение ключа она забирает себе
        // один раз — иначе удалённое игрой возвращалось бы из общего
        const SEEN = NS + '~seen';
        let seen;
        try { seen = new Set(JSON.parse(rget(SEEN) || '[]')); } catch (_) { seen = new Set(); }
        const markSeen = (k) => {
            if (seen.has(k)) return;
            seen.add(k);
            try { raw.set.call(ls, SEEN, JSON.stringify([...seen])); } catch (_) {}
        };

        // Прежние сейвы MV лежат под общими ключами. Свои — те, где записано название этой
        // игры (MV пишет его в список сохранений): переносим их к ней один раз, пока их нет
        // в её части. Чужие не трогаем — их заберёт своя игра
        let mvAdopted = false;
        function adoptMvSaves() {
            if (mvAdopted) return;
            const DONE = NS + '~mv';
            if (rget(DONE)) { mvAdopted = true; return; }
            // Название — из данных игры: до их загрузки не понять, какие сейвы её
            if (!window.$dataSystem || typeof LZString === 'undefined') return;
            mvAdopted = true;
            try { raw.set.call(ls, DONE, '1'); } catch (_) {}
            const unpack = (s) => { try { return s ? JSON.parse(LZString.decompressFromBase64(s)) : null; } catch (_) { return null; } };
            const pack = (v) => LZString.compressToBase64(JSON.stringify(v));
            const old = unpack(rget('RPG Global'));
            if (!Array.isArray(old)) return;
            const mine = unpack(rget(NS + 'RPG Global'));
            const list = Array.isArray(mine) ? mine : [];
            let moved = 0;
            old.forEach((info, i) => {
                if (!i || !info || info.title !== $dataSystem.gameTitle || list[i]) return;
                const file = rget('RPG File' + i);
                if (!file || rget(NS + 'RPG File' + i) !== null) return;
                try {
                    raw.set.call(ls, NS + 'RPG File' + i, file);
                    const bak = rget('RPG File' + i + 'bak');
                    if (bak) raw.set.call(ls, NS + 'RPG File' + i + 'bak', bak);
                    list[i] = info;
                    old[i] = null;
                    moved++;
                    // Перенесённое из общего убираем: место в localStorage одно на все игры
                    raw.remove.call(ls, 'RPG File' + i);
                    raw.remove.call(ls, 'RPG File' + i + 'bak');
                } catch (_) {}
            });
            if (!moved) return;
            try { raw.set.call(ls, NS + 'RPG Global', pack(list)); } catch (_) {}
            try { if (old.some(Boolean)) raw.set.call(ls, 'RPG Global', pack(old)); else raw.remove.call(ls, 'RPG Global'); } catch (_) {}
            console.log(`[RPG Fixes] 💾 Прежние сейвы этой игры перенесены в её хранилище: ${moved}`);
        }

        function get(k) {
            if (mvSave(k)) adoptMvSaves();
            if (viaCloud(k) && cloudApi && cloudApi.ready()) {
                const c = cloudApi.get(CK(k));
                if (c !== null) {
                    if (rget(NS + k) !== c) { try { raw.set.call(ls, NS + k, c); } catch (_) {} }
                    return c;
                }
            }
            let v = rget(NS + k);
            if (v === null && !mvSave(k) && !seen.has(k)) {
                markSeen(k);
                const shared = rget(k);
                if (shared !== null) { try { raw.set.call(ls, NS + k, shared); } catch (_) {} v = shared; }
            }
            return v;
        }
        function set(k, v) {
            v = String(v);
            markSeen(k);
            // Сначала в облако: не влезет в браузер — не пропадёт
            if (viaCloud(k) && cloudApi) cloudApi.put(CK(k), v);
            raw.set.call(ls, NS + k, v);
        }
        function remove(k) {
            markSeen(k);
            if (viaCloud(k) && cloudApi) cloudApi.remove(CK(k));
            raw.remove.call(ls, NS + k);
        }
        // clear() стёр бы данные всех игр и самой библиотеки — стираем только эту игру
        function clearGame() {
            rkeys().filter(k => k && k.startsWith(NS) && !k.startsWith(NS + '~')).forEach(k => { try { raw.remove.call(ls, k); } catch (_) {} });
        }

        P.getItem = function(k) { if (this !== ls || ours(String(k))) return raw.get.apply(this, arguments); return get(String(k)); };
        P.setItem = function(k, v) { if (this !== ls || ours(String(k))) return raw.set.apply(this, arguments); return set(String(k), v); };
        P.removeItem = function(k) { if (this !== ls || ours(String(k))) return raw.remove.apply(this, arguments); return remove(String(k)); };
        P.clear = function() { if (this !== ls) return raw.clear.apply(this, arguments); return clearGame(); };
        // «Есть ли ключ» плагины спрашивают и так: localStorage.hasOwnProperty(key) (DKTools.IO.WebStorage).
        // Ключи игры лежат под её приставкой, и обычный ответ был бы «нет» всегда: DKTools_Localization
        // не видел сохранённого языка и после выбора возвращал к выбору языка по кругу. Отвечаем
        // по хранилищу игры. Повесить функцию прямо на
        // localStorage нельзя — присвоение там становится записью строки, — поэтому на прототип
        const ownHas = Object.prototype.hasOwnProperty;
        P.hasOwnProperty = function(k) {
            if (this !== ls || ours(String(k))) return ownHas.call(this, k);
            return get(String(k)) !== null;
        };
        P.__rpgGameStorage = true;

        gameStorage = {
            get, set, remove,
            // Ключи игры с этим началом — в браузере и в облаке (для fs.readdirSync)
            list: (prefix) => {
                const out = new Set();
                rkeys().forEach(k => { if (k && k.startsWith(NS + prefix)) out.add(k.slice(NS.length)); });
                if (cloudApi && cloudApi.ready()) cloudApi.keys().forEach(k => { if (k.startsWith(CK(prefix))) out.add(k.slice(3)); });
                return [...out];
            },
        };
    }

    // ============================================================================
    // 5. ИНТЕРФЕЙС: МЕНЮ ⚙ И ЭКРАННОЕ УПРАВЛЕНИЕ
    // ============================================================================
    const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const IS_MOBILE = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || IS_IOS;
    // По строке браузера телефон узнаётся не всегда: Chrome на больших Android-планшетах
    // (Lenovo IdeaTab Pro и т. п.) по умолчанию открывает сайты «как на компьютере» и
    // называет себя Linux — экранного управления там не было вовсе. Поэтому смотрим и на
    // сам экран: есть ли сенсор и чем в основном управляют — пальцем или мышью
    const HAS_TOUCH = IS_MOBILE || navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
    const TOUCH_FIRST = IS_MOBILE || !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
    // Экранное управление показывает себя само при касании экрана (setupTouchControls); это
    // касание ловим здесь, раньше перехватчика касаний по игре — он их глотает
    let showTouchControls = () => {};
    // Наши окна и кнопки поверх игры. И окно чит-меню: без этого его на телефоне нельзя
    // было нажать пальцем
    const OUR_UI = '#_sys_menu_container, #_mob_ctrl, #_fps_monitor, #_spike_panel, #_cheats';
    // Поля и кнопки, которые ставит поверх картинки сама игра: «Retry» на экране ошибки
    // загрузки, окна ввода имени и пароля у плагинов
    const GAME_CONTROLS = 'button, input, textarea, select, a[href], label, [contenteditable="true"]';
    const isGameControl = (el) => !!(el && el.closest && el.closest(GAME_CONTROLS) && !el.closest(OUR_UI));

    // Значки одной тонкой линией, цвет берут от текста. Раньше у каждого пункта был
    // свой смайлик: на каждой платформе они рисуются по-своему и выглядели случайными
    const ICONS = {
        gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
        home: '<path d="M3 11l9-7 9 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5h4v5"/>',
        restart: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4v4h4"/>',
        save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8.5 4v4.5h6V4"/><path d="M8.5 20v-6h7v6"/>',
        fullscreen: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
        stretch: '<path d="M3 12h18"/><path d="M7 8l-4 4 4 4M17 8l4 4-4 4"/>',
        smooth: '<path d="M3 15c3-6 6-6 9 0s6 6 9 0"/>',
        turbo: '<path d="M4 6l7 6-7 6zM13 6l7 6-7 6z"/>',
        tap: '<circle cx="12" cy="12" r="2.5"/><circle cx="12" cy="12" r="7"/>',
        keys: '<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 11h.01M11 11h.01M15 11h.01M8 14h8"/>',
        skip: '<path d="M4 7l6 5-6 5M11 7l6 5-6 5"/>',
        wand: '<path d="M4 20L15 9"/><path d="M15 3v3M18.5 5.5l-2 2M21 9h-3M18.5 12.5l-2-2"/>',
        fps: '<path d="M4 20h16M7 16v-4M12 16V8M17 16v-6"/>',
        pulse: '<path d="M3 12h4l2.5-6 4 12 2.5-6H21"/>',
        chevron: '<path d="M7 14.5l5-5 5 5"/>',
        prev: '<path d="M14.5 6l-6 6 6 6"/>',
        next: '<path d="M9.5 6l6 6-6 6"/>',
    };
    const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;

    // Нажатие — когда палец отпустили там же, где коснулись. Раньше пункт срабатывал
    // в момент касания: лёжа на телефоне меню не влезает по высоте, и, листая его,
    // человек включал всё, до чего дотронулся. Сдвинул палец — это прокрутка, не нажатие
    function onTap(el, fn) {
        let start = null;
        el.addEventListener('pointerdown', (e) => {
            start = e.button === 0 ? { id: e.pointerId, x: e.clientX, y: e.clientY } : null;
        });
        el.addEventListener('pointermove', (e) => {
            if (start && e.pointerId === start.id && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) start = null;
        });
        // Браузер начал прокрутку — касание уже не наше
        el.addEventListener('pointercancel', () => { start = null; });
        el.addEventListener('pointerup', (e) => {
            if (!start || e.pointerId !== start.id) return;
            start = null;
            fn();
        });
    }

    // Пункты меню приходят из разных частей файла (экран, управление, диагностика,
    // читы), а рисуются здесь, по разделам и всегда в одном порядке. Разделы собраны
    // в две колонки: на высоком экране они идут одна под другой, на низком (телефон
    // лёжа) — рядом, и листать меню не нужно. Колонки примерно поровну: лёжа
    // на iPhone 13 в высоту помещается шесть пунктов
    const MENU_COLUMNS = [['nav', 'game'], ['screen', 'controls', 'debug']];
    const menuItems = [];
    function addMenuItem(item) { menuItems.push(item); renderMenu(); }
    function closeMenu() {
        document.getElementById('_sys_panel')?.classList.remove('_open');
        document.getElementById('_sys_btn')?.classList.remove('_open');
    }
    function menuButton(item) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = '_sys_item';
        el.id = item.id;
        el.innerHTML = `<span class="_sys_ico">${icon(item.icon)}</span><span class="_sys_label">${item.label}</span>` + (item.isOn ? '<span class="_sys_switch"></span>' : '');
        if (item.isOn) el.classList.toggle('_on', !!item.isOn());
        onTap(el, () => {
            // onClick вернул true — меню остаётся открытым (подтверждение перезапуска)
            const keepOpen = item.onClick(el);
            if (item.isOn) el.classList.toggle('_on', !!item.isOn());
            else if (!keepOpen) closeMenu();
        });
        return el;
    }
    function renderMenu() {
        const panel = document.getElementById('_sys_panel');
        if (!panel) return;
        panel.innerHTML = '';
        for (const sections of MENU_COLUMNS) {
            const col = document.createElement('div');
            col.className = '_sys_col';
            for (const section of sections) {
                const items = menuItems.filter(i => i.section === section);
                if (!items.length) continue;
                const group = document.createElement('div');
                group.className = '_sys_group';
                items.forEach(item => group.appendChild(menuButton(item)));
                col.appendChild(group);
            }
            if (col.childElementCount) panel.appendChild(col);
        }
    }

    function setupUIAndGamepad() {
        // Касание экрана показывает экранное управление, если его спрятали клавиатура или
        // геймпад. Слушаем раньше перехватчика касаний по игре (setupTouchModeToggle)
        window.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') showTouchControls(); }, { capture: true, passive: true });
        document.addEventListener('DOMContentLoaded', () => {
            if (document.getElementById('_sys_menu_container')) return;

            const style = document.createElement('style');
            style.textContent = `
                #_sys_menu_container, #_mob_ctrl { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
                /* Игра — картинка, выделять на странице нечего. Без этого iOS на долгое касание
                   (палец держит джойстик) показывала лупу выделения текста. Поля ввода (имя
                   героя и т. п.) выделяются, как обычно */
                html, body { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; }
                input, textarea, [contenteditable="true"] { -webkit-user-select: text; user-select: text; }
                #_sys_menu_container svg, #_mob_ctrl svg { fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }

                #_sys_menu_container { position: fixed; top: max(12px, env(safe-area-inset-top)); right: max(12px, env(safe-area-inset-right)); z-index: 2147483647; display: flex; flex-direction: column; align-items: flex-end; font-size: 14px; font-weight: 500; touch-action: manipulation; }
                #_sys_btn { width: 40px; height: 40px; padding: 0; border-radius: 50%; border: 1px solid rgba(255,255,255,0.22); background: rgba(14,14,18,0.45); color: rgba(255,255,255,0.9); display: flex; align-items: center; justify-content: center; cursor: pointer; opacity: 0.65; transition: opacity .2s, background .2s; -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); }
                #_sys_btn svg { width: 20px; height: 20px; }
                #_sys_btn._open, #_sys_btn:hover { opacity: 1; background: rgba(14,14,18,0.7); }
                #_sys_panel { display: none; margin-top: 8px; min-width: 250px; max-height: calc(100vh - 80px); max-height: calc(100dvh - 80px); overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; touch-action: pan-y; padding: 6px; border-radius: 14px; background: rgba(14,14,18,0.88); border: 1px solid rgba(255,255,255,0.12); box-shadow: 0 16px 40px rgba(0,0,0,0.5); -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); }
                #_sys_panel._open { display: block; }
                ._sys_item { display: flex; align-items: center; gap: 12px; width: 100%; padding: 10px; border: 0; border-radius: 9px; background: transparent; color: rgba(255,255,255,0.9); font: inherit; text-align: left; cursor: pointer; }
                ._sys_item:active { background: rgba(255,255,255,0.12); }
                @media (hover: hover) { ._sys_item:hover { background: rgba(255,255,255,0.07); } }
                ._sys_ico { display: flex; flex-shrink: 0; color: rgba(255,255,255,0.55); }
                ._sys_ico svg { width: 20px; height: 20px; }
                ._sys_label { flex: 1; white-space: nowrap; }
                ._sys_switch { position: relative; flex-shrink: 0; width: 30px; height: 18px; border-radius: 9px; background: rgba(255,255,255,0.16); transition: background .2s; }
                ._sys_switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: rgba(255,255,255,0.75); transition: transform .2s; }
                ._sys_item._on ._sys_switch { background: #d9b45e; }
                ._sys_item._on ._sys_switch::after { transform: translateX(12px); background: #fff; }
                ._sys_item._warn { color: #f0b35e; }
                ._sys_item._warn ._sys_ico { color: #f0b35e; }
                ._sys_group + ._sys_group::before, ._sys_col + ._sys_col::before { content: ''; display: block; height: 1px; margin: 5px 8px; background: rgba(255,255,255,0.08); }
                /* Лёжа на телефоне меню в одну колонку не влезает по высоте — колонки встают рядом */
                @media (max-height: 500px) and (min-width: 560px) {
                    #_sys_panel._open { display: grid; grid-template-columns: 1fr 1fr; }
                    ._sys_col + ._sys_col { margin-left: 5px; padding-left: 5px; border-left: 1px solid rgba(255,255,255,0.08); }
                    ._sys_col + ._sys_col::before { display: none; }
                    ._sys_item { padding: 7px 10px; }
                }

                /* Экранное управление. Единица --u — от короткой стороны экрана: на телефоне
                   кнопки не закрывают полэкрана, на планшете не теряются в углу */
                #_mob_ctrl { --u: clamp(38px, 10.5vmin, 58px); position: fixed; left: 0; right: 0; bottom: 0; height: 0; z-index: 2147483646; pointer-events: none; touch-action: none; opacity: 0.92; transition: opacity .4s; }
                /* Без касаний управление гаснет, чтобы не закрывать текст диалогов */
                #_mob_ctrl._idle { opacity: 0.38; }
                ._glass { background: rgba(14,14,18,0.3); border: 1.5px solid rgba(255,255,255,0.26); color: rgba(255,255,255,0.92); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }

                /* Джойстик встаёт под палец в любом месте левого нижнего угла — целиться в
                   него не нужно. Когда касания идут в игру (или открыто чит-меню), угол
                   отдаём им, и джойстик работает только на своём месте */
                #_stick_zone { position: fixed; left: 0; bottom: 0; width: min(45vw, 440px); height: min(72vh, calc(100vh - 70px)); pointer-events: auto; touch-action: none; }
                #_mob_ctrl._zone_off #_stick_zone { pointer-events: none; }
                #_stick { position: fixed; left: calc(max(14px, env(safe-area-inset-left)) + 6px); bottom: calc(max(14px, env(safe-area-inset-bottom)) + 6px); width: calc(var(--u) * 2.35); height: calc(var(--u) * 2.35); border-radius: 50%; pointer-events: auto; touch-action: none; transition: transform .18s ease-out; }
                #_stick._float { transition: none; }
                ._stick_dir { position: absolute; width: 22%; height: 22%; color: rgba(255,255,255,0.4); transition: color .12s; }
                ._stick_dir svg { display: block; width: 100%; height: 100%; }
                ._stick_dir[data-dir="up"] { top: 3%; left: 39%; }
                ._stick_dir[data-dir="down"] { bottom: 3%; left: 39%; transform: rotate(180deg); }
                ._stick_dir[data-dir="left"] { left: 3%; top: 39%; transform: rotate(-90deg); }
                ._stick_dir[data-dir="right"] { right: 3%; top: 39%; transform: rotate(90deg); }
                ._stick_dir._on { color: #fff; }
                #_stick_knob { position: absolute; left: 29%; top: 29%; width: 42%; height: 42%; border-radius: 50%; background: rgba(255,255,255,0.18); border: 1.5px solid rgba(255,255,255,0.5); box-shadow: 0 2px 10px rgba(0,0,0,0.35); transition: transform .14s ease-out, background .12s, border-color .12s; }
                #_stick._drag #_stick_knob { transition: background .12s, border-color .12s; background: rgba(255,255,255,0.28); }
                /* Палец у самого края — бег */
                #_stick._run #_stick_knob { background: rgba(217,180,94,0.55); border-color: #d9b45e; }

                /* Справа — только то, что нужно всё время: Z, X и A дугой вокруг большого
                   пальца (Z — под ним, X — ниже и левее, A — выше и левее) и маленький
                   «Пропуск» над Z. Всё остальное — в полоске ⌨ */
                #_pad { position: fixed; right: calc(max(14px, env(safe-area-inset-right)) + 6px); bottom: calc(max(14px, env(safe-area-inset-bottom)) + 6px); width: calc(var(--u) * 2.45); height: calc(var(--u) * 2.85); pointer-events: none; }
                ._btn { position: absolute; padding: 0; border-radius: 50%; display: flex; align-items: center; justify-content: center; font: 600 calc(var(--u) * 0.42) -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; pointer-events: auto; touch-action: none; transition: transform .08s, background .08s; }
                ._btn._on { transform: scale(0.93); background: rgba(255,255,255,0.3); }
                #_btn_z { right: 0; bottom: calc(var(--u) * 0.55); width: calc(var(--u) * 1.25); height: calc(var(--u) * 1.25); border-color: rgba(255,255,255,0.42); }
                #_btn_x { right: calc(var(--u) * 1.375); bottom: calc(var(--u) * 0.05); width: calc(var(--u) * 1.05); height: calc(var(--u) * 1.05); font-size: calc(var(--u) * 0.36); }
                #_btn_a { right: calc(var(--u) * 1.305); bottom: calc(var(--u) * 1.52); width: calc(var(--u) * 0.95); height: calc(var(--u) * 0.95); font-size: calc(var(--u) * 0.34); }
                #_btn_skip { right: calc(var(--u) * 0.22); bottom: calc(var(--u) * 2.02); width: calc(var(--u) * 0.8); height: calc(var(--u) * 0.8); }
                #_btn_skip svg { width: 52%; height: 52%; }
                /* Маленькие кнопки: попасть можно и чуть мимо рисунка */
                #_btn_skip::after, #_btn_keys::after { content: ''; position: absolute; inset: -7px; border-radius: 50%; }
                ._cap { position: absolute; top: 100%; left: 50%; transform: translateX(-50%); margin-top: 2px; font-size: 9px; font-weight: 500; letter-spacing: .08em; text-transform: uppercase; color: rgba(255,255,255,0.6); white-space: nowrap; pointer-events: none; }
                /* Включённый переключатель видно издалека */
                ._btn._latched, #_btn_keys._latched, ._key._latched { background: rgba(255,255,255,0.9); color: #141414; border-color: transparent; }

                /* ⌨ — рядом с ⚙: нужна изредка, и место внизу у пальцев она не занимает */
                #_btn_keys { position: fixed; top: max(12px, env(safe-area-inset-top)); right: calc(max(12px, env(safe-area-inset-right)) + 48px); width: 40px; height: 40px; padding: 0; border-radius: 50%; display: flex; align-items: center; justify-content: center; pointer-events: auto; touch-action: none; opacity: 0.65; }
                #_btn_keys._latched { opacity: 1; }
                #_btn_keys svg { width: 20px; height: 20px; }

                /* Полоска ⌨ сверху по центру: бег, листание и клавиши этой игры. Вся
                   клавиатура — только по «A–Z» */
                #_keys_panel { position: fixed; top: calc(max(12px, env(safe-area-inset-top)) + 48px); left: 50%; transform: translateX(-50%); width: max-content; max-width: min(94vw, 560px); display: none; padding: 5px; border-radius: 12px; background: rgba(14,14,18,0.88); border: 1px solid rgba(255,255,255,0.14); box-shadow: 0 8px 24px rgba(0,0,0,0.45); pointer-events: auto; }
                #_keys_panel._open { display: block; }
                ._kb_quick { display: flex; flex-wrap: wrap; justify-content: center; gap: 4px; }
                ._kb_full { display: none; width: min(86vw, 340px); margin: 5px auto 0; padding-top: 5px; border-top: 1px solid rgba(255,255,255,0.1); }
                #_keys_panel._abc ._kb_full { display: block; }
                ._kb_row { display: flex; gap: 3px; }
                ._kb_row + ._kb_row { margin-top: 3px; }
                ._key { height: 30px; min-width: 30px; padding: 0 9px; border-radius: 7px; display: flex; align-items: center; justify-content: center; gap: 4px; font: 600 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; white-space: nowrap; touch-action: none; }
                ._key svg { width: 15px; height: 15px; }
                ._key small { font-size: 10px; font-weight: 500; opacity: .7; }
                ._kb_row ._key { flex: 1 1 0; min-width: 0; padding: 0; }
                ._kb_row ._key._wide { flex-grow: 3; }
                ._key._on { background: rgba(255,255,255,0.3); }

                /* Играют с клавиатуры или геймпада — кнопки не нужны и только закрывают картинку */
                #_mob_ctrl._off { display: none !important; }
            `;
            document.head.appendChild(style);

            // --- Меню ⚙ ---
            const menu = document.createElement('div');
            menu.id = '_sys_menu_container';
            menu.innerHTML = `<button type="button" id="_sys_btn" aria-label="${T.settings}" title="${T.settings}">${icon('gear')}</button><div id="_sys_panel" role="menu"></div>`;
            document.body.appendChild(menu);
            const sysBtn = document.getElementById('_sys_btn');
            const sysPanel = document.getElementById('_sys_panel');
            onTap(sysBtn, () => {
                const open = !sysPanel.classList.contains('_open');
                sysPanel.classList.toggle('_open', open);
                sysBtn.classList.toggle('_open', open);
                if (open) renderMenu();   // состояние переключателей могло поменяться с клавиатуры
            });
            // Касания и прокрутка меню — не игре: иначе MV принял бы их за касание экрана,
            // а MZ отменял бы прокрутку колесом. mousedown без действия по умолчанию —
            // чтобы кнопка не забирала фокус: иначе пробел в игре снова нажимал бы её
            ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'mousedown', 'mousemove', 'mouseup',
             'touchstart', 'touchmove', 'touchend', 'touchcancel', 'wheel', 'click', 'contextmenu'].forEach(t => menu.addEventListener(t, (e) => {
                e.stopPropagation();
                if (t === 'contextmenu' || t === 'mousedown') e.preventDefault();
            }, { passive: !(t === 'contextmenu' || t === 'mousedown') }));
            document.addEventListener('pointerdown', (e) => { if (!menu.contains(e.target)) closeMenu(); });

            addMenuItem({ id: '_sys_home', section: 'nav', icon: 'home', label: T.home, onClick: toLibrary });

            // Перезапуск. В приложении с экрана «Домой» у Safari нет кнопки обновления,
            // и зависшую игру можно было только закрыть. Несохранённое пропадёт, поэтому
            // с подтверждением: первое нажатие меняет надпись, второе в течение 3 секунд
            // перезапускает
            addMenuItem({
                id: '_sys_restart', section: 'nav', icon: 'restart', label: T.restart,
                onClick: (el) => {
                    // «Взведён» — это сам пункт с новой надписью: меню при открытии рисуется
                    // заново, и старое первое нажатие не превращает новое в перезапуск
                    if (el.classList.contains('_warn')) { leaveGame(() => window.location.reload()); return true; }
                    const label = el.querySelector('._sys_label');
                    label.textContent = T.restart_confirm;
                    el.classList.add('_warn');
                    setTimeout(() => { label.textContent = T.restart; el.classList.remove('_warn'); }, 3000);
                    return true;
                },
            });

            window.__rpgTurbo = false;
            addMenuItem({
                id: '_sys_turbo', section: 'game', icon: 'turbo', label: T.turbo,
                isOn: () => window.__rpgTurbo,
                onClick: () => {
                    window.__rpgTurbo = !window.__rpgTurbo;
                    if (window.__turboHookInjected) return;
                    window.__turboHookInjected = true;
                    const turboHook = setInterval(() => {
                        if (typeof SceneManager !== 'undefined' && SceneManager.updateMain && !SceneManager.__turboPatched) {
                            SceneManager.__turboPatched = true;
                            const origUpdate = SceneManager.updateMain;
                            SceneManager.updateMain = function() {
                                origUpdate.call(this);
                                if (window.__rpgTurbo) {
                                    for (let i = 0; i < 2; i++) {
                                        if (this.updateInputData) this.updateInputData();
                                        if (this.updateManagers) this.updateManagers();
                                        if (this.updateScene) this.updateScene();
                                    }
                                }
                            };
                            clearInterval(turboHook);
                        }
                    }, 500);
                },
            });

            // Сохранить где угодно: многие игры дают сохраняться только в особых местах.
            // Открываем обычный экран сохранения игры — но только на карте или из меню игры
            // и вне сцены: сохранение посреди события может сломать сюжет. Нельзя — пункт
            // на пару секунд говорит, почему
            addMenuItem({
                id: '_sys_save', section: 'game', icon: 'save', label: T.save,
                onClick: (el) => {
                    const scene = typeof SceneManager !== 'undefined' && SceneManager._scene;
                    const place = scene && ((typeof Scene_Map !== 'undefined' && scene instanceof Scene_Map) || (typeof Scene_Menu !== 'undefined' && scene instanceof Scene_Menu));
                    const calm = place && !$gameMap.isEventRunning() && !$gameMessage.isBusy() && !$gamePlayer.isTransferring();
                    if (calm && typeof Scene_Save !== 'undefined') {
                        SceneManager.push(Scene_Save);
                        return false;
                    }
                    const label = el.querySelector('._sys_label');
                    label.textContent = T.save_blocked;
                    el.classList.add('_warn');
                    setTimeout(() => { label.textContent = T.save; el.classList.remove('_warn'); }, 2500);
                    return true;
                },
            });

            addMenuItem({
                id: '_sys_stretch', section: 'screen', icon: 'stretch', label: T.stretch,
                isOn: () => !!(window.__rpgIsStretched && window.__rpgIsStretched()),
                onClick: () => window.__toggleRpgStretch && window.__toggleRpgStretch(),
            });
            // Сглаживание: «вкл» — плавно при дробном увеличении и чётко при целом,
            // «выкл» — всегда чёткие пиксели. Выбор запоминается (см. setupModernViewport)
            addMenuItem({
                id: '_sys_smooth', section: 'screen', icon: 'smooth', label: T.smooth,
                isOn: () => !window.__rpgSmoothing || window.__rpgSmoothing() === 'auto',
                onClick: () => window.__toggleRpgSmoothing && window.__toggleRpgSmoothing(),
            });
            if (!IS_IOS) {
                const isFull = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
                addMenuItem({
                    id: '_sys_fs', section: 'screen', icon: 'fullscreen', label: T.fullscreen,
                    isOn: isFull,
                    onClick: () => {
                        const el = document.documentElement;
                        const p = !isFull() ? (el.requestFullscreen || el.webkitRequestFullscreen).call(el) : (document.exitFullscreen || document.webkitExitFullscreen).call(document);
                        if (p && p.catch) p.catch(() => {});
                    },
                });
                document.addEventListener('fullscreenchange', renderMenu);
                document.addEventListener('webkitfullscreenchange', renderMenu);
            }

            if (HAS_TOUCH) setupTouchControls();
        });
    }

    // Экранное управление для телефона и планшета: джойстик слева, клавиши справа.
    // Кнопки подписаны клавишами клавиатуры — Z, X, A, — как их называют сами игры в
    // подсказках («Z — выбрать, X — меню, A — автотекст»). Нажать такую кнопку — то же,
    // что нажать клавишу, а что она значит, решает раскладка игры. Раньше были A и B,
    // которые слали пробел и Esc, — и в игре, где пробел прячет окно сообщения, «A»
    // прятала текст вместо «Далее». На экране только самое нужное; остальное — в полоске
    // ⌨: бег, листание и клавиши, которые плагины этой игры повесили на свои действия,
    // а вся клавиатура — по «A–Z»
    function setupTouchControls() {
        // Клавиши, которые умеет нажимать экранное управление: код → [key, code]
        const KEYBOARD = {
            8: ['Backspace', 'Backspace'], 9: ['Tab', 'Tab'], 13: ['Enter', 'Enter'], 16: ['Shift', 'ShiftLeft'],
            17: ['Control', 'ControlLeft'], 18: ['Alt', 'AltLeft'], 27: ['Escape', 'Escape'], 32: [' ', 'Space'],
            33: ['PageUp', 'PageUp'], 34: ['PageDown', 'PageDown'], 35: ['End', 'End'], 36: ['Home', 'Home'],
            37: ['ArrowLeft', 'ArrowLeft'], 38: ['ArrowUp', 'ArrowUp'], 39: ['ArrowRight', 'ArrowRight'], 40: ['ArrowDown', 'ArrowDown'],
            45: ['Insert', 'Insert'], 46: ['Delete', 'Delete'],
        };
        for (let i = 0; i < 10; i++) KEYBOARD[48 + i] = [String(i), 'Digit' + i];
        for (let i = 0; i < 26; i++) { const c = String.fromCharCode(97 + i); KEYBOARD[65 + i] = [c, 'Key' + c.toUpperCase()]; }
        for (let i = 1; i <= 12; i++) KEYBOARD[111 + i] = ['F' + i, 'F' + i];
        const SHORT = { 8: '⌫', 9: 'Tab', 13: 'Enter', 16: 'Shift', 17: 'Ctrl', 18: 'Alt', 27: 'Esc', 32: 'Space', 33: 'PgUp', 34: 'PgDn', 35: 'End', 36: 'Home', 45: 'Ins', 46: 'Del' };
        const keyLabel = (kc) => SHORT[kc] || KEYBOARD[kc][0].toUpperCase();
        const mapper = () => (typeof Input !== 'undefined' && Input.keyMapper) || {};

        function sendPhys(kc, isDown) {
            const k = KEYBOARD[kc];
            if (!k) return;
            const ev = new KeyboardEvent(isDown ? 'keydown' : 'keyup', { bubbles: true, cancelable: true, key: k[0], code: k[1] });
            Object.defineProperty(ev, 'keyCode', { get: () => kc });
            Object.defineProperty(ev, 'which', { get: () => kc });
            document.dispatchEvent(ev);
        }
        function setState(name, isDown) {
            if (typeof Input === 'undefined') return;
            if (Input._currentState) Input._currentState[name] = isDown;
            if (Input.currentState) Input.currentState[name] = isDown;
        }

        // «Бег», «Пропуск» и листание — действия, а не клавиши. Жмём ту клавишу, которая
        // в этой игре значит это действие. Своя занята чужим (бывает, что Ctrl
        // листает страницы) — не жмём ничего, а сообщаем движку действие напрямую
        const ACTIONS = { dash: ['shift', 16], skip: ['control', 17, 18], pageup: ['pageup', 81, 33], pagedown: ['pagedown', 87, 34] };
        const actionAs = {};          // чем нажали — тем и отпускаем
        const actHeld = new Set();    // зажатые действия
        const physHeld = new Set();   // зажатые клавиши
        const latched = new Set();    // включённые переключатели «Бег» и «Пропуск»
        function sendAction(act, isDown) {
            const [name, ...codes] = ACTIONS[act];
            if (isDown) {
                const map = mapper();
                const kc = codes.find(c => map[c] === name);
                actionAs[act] = kc ? { kc } : { state: name, kc: map[codes[0]] === undefined ? codes[0] : 0 };
                actHeld.add(act);
            } else actHeld.delete(act);
            const how = actionAs[act];
            if (!how) return;
            if (how.state) setState(how.state, isDown);
            if (how.kc) sendPhys(how.kc, isDown);
            if (!isDown) delete actionAs[act];
        }
        // Стрелка — это стрелка. Если игра её никуда не привязала, направление — движку напрямую
        const DIRS = { up: 38, down: 40, left: 37, right: 39 };
        function sendDir(dir, isDown) {
            if (mapper()[DIRS[dir]] === undefined) setState(dir, isDown);
            sendPhys(DIRS[dir], isDown);
        }

        const root = document.createElement('div');
        root.id = '_mob_ctrl';
        root.innerHTML = `
            <div id="_stick_zone"></div>
            <div id="_stick" class="_glass" role="application" aria-label="${T.stick}">
                ${['up', 'down', 'left', 'right'].map(d => `<i class="_stick_dir" data-dir="${d}">${icon('chevron')}</i>`).join('')}
                <div id="_stick_knob"></div>
            </div>
            <div id="_pad">
                <button type="button" id="_btn_skip" class="_btn _glass" data-act="skip" data-latch="1" aria-label="${T.skip_hint}">${icon('skip')}</button>
                <button type="button" id="_btn_a" class="_btn _glass" data-kc="65" aria-label="${T.a_hint}">A<span class="_cap"></span></button>
                <button type="button" id="_btn_x" class="_btn _glass" data-kc="88" aria-label="${T.back_hint}">X<span class="_cap">${T.back}</span></button>
                <button type="button" id="_btn_z" class="_btn _glass" data-kc="90" aria-label="${T.ok_hint}">Z<span class="_cap">${T.ok}</span></button>
            </div>
            <button type="button" id="_btn_keys" class="_glass" aria-label="${T.keys}">${icon('keys')}</button>
            <div id="_keys_panel" role="dialog" aria-label="${T.keys}"></div>`;
        document.body.appendChild(root);

        // Касания по управлению — не игре: иначе MV увидел бы их как касание экрана. И не iOS:
        // долгое касание (палец держит джойстик) она начинала как выделение текста и
        // показывала лупу. Фон полоски клавиш — исключение, его можно листать
        ['touchstart', 'touchmove', 'touchend', 'touchcancel', 'pointerdown', 'pointermove', 'pointerup', 'mousedown', 'mousemove', 'mouseup', 'click', 'contextmenu'].forEach(t => {
            root.addEventListener(t, (e) => {
                e.stopPropagation();
                if (t === 'contextmenu') e.preventDefault();
                if (t === 'touchstart' && !(e.target.closest('#_keys_panel') && !e.target.closest('._key'))) e.preventDefault();
            }, { passive: false });
        });

        // Без касаний управление гаснет — меньше закрывает текст
        let idleTimer = 0;
        const wake = () => { root.classList.remove('_idle'); clearTimeout(idleTimer); };
        const sleepSoon = () => {
            clearTimeout(idleTimer);
            idleTimer = setTimeout(() => { if (!actHeld.size && !physHeld.size && stickId === null) root.classList.add('_idle'); }, 3500);
        };

        // --- Джойстик ---
        const zone = document.getElementById('_stick_zone');
        const stick = document.getElementById('_stick');
        const knob = document.getElementById('_stick_knob');
        const dirEls = {};
        stick.querySelectorAll('._stick_dir').forEach(el => { dirEls[el.dataset.dir] = el; });
        let stickId = null, stickDir = null, origin = null, running = false;
        sleepSoon();

        // Ось меняется, только когда другая явно перевешивает: у диагонали направление
        // иначе дрожало бы между двумя, и герой шёл бы рывками
        function pickDir(dx, dy, current) {
            const ax = Math.abs(dx), ay = Math.abs(dy);
            const horiz = dx > 0 ? 'right' : 'left', vert = dy > 0 ? 'down' : 'up';
            if (current === horiz) return ay > ax * 1.25 ? vert : horiz;
            if (current === vert) return ax > ay * 1.25 ? horiz : vert;
            return ax >= ay ? horiz : vert;
        }
        function setStickDir(dir) {
            if (dir === stickDir) return;
            if (stickDir) { sendDir(stickDir, false); dirEls[stickDir].classList.remove('_on'); }
            stickDir = dir;
            if (dir) { sendDir(dir, true); dirEls[dir].classList.add('_on'); }
        }
        // Палец у самого края — бег, как на джойстиках в мобильных играх. Только на карте
        // и если игра и так не бежит: при «всегда бегом» в её настройках Shift, наоборот,
        // переводит героя на шаг
        function setRun(on) {
            if (on) {
                const onMap = typeof Scene_Map !== 'undefined' && typeof SceneManager !== 'undefined' && SceneManager._scene instanceof Scene_Map;
                const always = typeof ConfigManager !== 'undefined' && ConfigManager.alwaysDash;
                if (!onMap || always || latched.has('dash')) on = false;
            }
            if (on === running) return;
            running = on;
            stick.classList.toggle('_run', on);
            if (!latched.has('dash')) sendAction('dash', on);
        }
        let tap = null;   // касание стрелки на джойстике — может оказаться шагом
        function moveStick(e) {
            const radius = stick.offsetWidth / 2;
            const dx = e.clientX - origin.x, dy = e.clientY - origin.y;
            const dist = Math.hypot(dx, dy), travel = radius * 0.42;
            if (tap && dist > 8) tap.moved = true;
            const k = dist > travel ? travel / dist : 1;
            knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
            // Мёртвая зона в центре: палец, просто лежащий на джойстике, героя не двигает
            const dir = dist < radius * 0.22 ? null : pickDir(dx, dy, stickDir);
            setStickDir(dir);
            setRun(!!dir && dist > radius * (running ? 0.62 : 0.8));
        }
        function startStick(e) {
            if (stickId !== null) return;
            e.preventDefault();
            stickId = e.pointerId;
            try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
            // Место джойстика без сдвига: offset* не видят transform
            const r = stick.offsetWidth / 2;
            const rest = { x: stick.offsetLeft + r, y: stick.offsetTop + r };
            // Направление считается от места, куда лёг палец: касание всегда начинается с
            // покоя, и куда потянул — туда и пошёл. Раньше касание внутри джойстика считалось
            // от его середины, а у края экрана — от сдвинутой середины: палец, лёгший на
            // нижний край, сразу вёл героя вниз, и пойти вверх было трудно
            origin = { x: e.clientX, y: e.clientY };
            // Рисуем джойстик под пальцем, но целиком на экране
            const base = { x: Math.min(Math.max(origin.x, r + 4), innerWidth - r - 4), y: Math.min(Math.max(origin.y, r + 4), innerHeight - r - 4) };
            stick.classList.add('_float', '_drag');
            stick.style.transform = `translate(${base.x - rest.x}px, ${base.y - rest.y}px)`;
            // Короткое касание стрелки на джойстике — один шаг, как кнопкой крестовины:
            // так удобно листать меню по одному пункту
            const fx = e.clientX - rest.x, fy = e.clientY - rest.y, fd = Math.hypot(fx, fy);
            tap = fd <= r && fd > r * 0.5 ? { dir: pickDir(fx, fy, null), at: performance.now(), moved: false } : null;
            wake();
            moveStick(e);
        }
        function stepOnce(dir) {
            sendDir(dir, true);
            dirEls[dir].classList.add('_on');
            setTimeout(() => { if (stickDir !== dir) { sendDir(dir, false); dirEls[dir].classList.remove('_on'); } }, 90);
        }
        function releaseStick(e) {
            const t = tap;
            tap = null;
            stickId = null;
            stick.classList.remove('_float', '_drag');
            stick.style.transform = '';
            knob.style.transform = '';
            setStickDir(null);
            setRun(false);
            if (e && t && !t.moved && performance.now() - t.at < 300) stepOnce(t.dir);
        }
        [zone, stick].forEach(el => {
            el.addEventListener('pointerdown', startStick, { passive: false });
            el.addEventListener('pointermove', (e) => { if (e.pointerId === stickId) { e.preventDefault(); moveStick(e); } }, { passive: false });
            ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(t => el.addEventListener(t, (e) => {
                if (e.pointerId !== stickId) return;
                releaseStick(t === 'pointerup' ? e : null);
                sleepSoon();
            }));
        });

        // --- Кнопки и клавиши ---
        function bindButton(btn) {
            const kc = +btn.dataset.kc || 0, act = btn.dataset.act, latch = btn.dataset.latch === '1';
            const send = (isDown) => {
                if (!kc) return sendAction(act, isDown);
                if (isDown) physHeld.add(kc); else physHeld.delete(kc);
                sendPhys(kc, isDown);
            };
            btn.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                wake();
                if (latch) {
                    // Держать «Пропуск» или «Бег» пальцем неудобно — большой палец нужен
                    // на Z. Поэтому они включаются касанием и выключаются следующим
                    const on = !latched.has(act);
                    if (on) latched.add(act); else latched.delete(act);
                    btn.classList.toggle('_latched', on);
                    // Бег от джойстика теперь держит переключатель
                    if (act === 'dash') { running = false; stick.classList.remove('_run'); }
                    send(on);
                    btn.classList.add('_on');
                    setTimeout(() => btn.classList.remove('_on'), 120);
                    sleepSoon();
                    return;
                }
                if (btn._pid != null) return;
                btn._pid = e.pointerId;
                try { btn.setPointerCapture(e.pointerId); } catch (_) {}
                btn.classList.add('_on');
                send(true);
            }, { passive: false });
            if (latch) return;
            ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(t => btn.addEventListener(t, (e) => {
                if (e.pointerId !== btn._pid) return;
                btn._pid = null;
                btn.classList.remove('_on');
                send(false);
                sleepSoon();
            }));
        }
        root.querySelectorAll('#_pad [data-kc], #_pad [data-act]').forEach(bindButton);

        // --- Панель остальных клавиш ---
        // Что значат клавиши, которые плагины вешают на свои действия, — для подписей
        const CAPTION = {
            messageAuto: T.cap_auto, AutoTextButton: T.cap_auto, auto_toggle: T.cap_auto, messageSkip: T.cap_skip,
            log: T.cap_log, backlog: T.cap_log, hakubox_history: T.cap_log, msgHide: T.cap_hide, hide: T.cap_hide,
        };
        const STANDARD = new Set(['ok', 'escape', 'cancel', 'shift', 'control', 'pageup', 'pagedown', 'up', 'down', 'left', 'right', 'menu', 'tab', 'debug']);
        const DEV_NAMES = new Set(['copy', 'messagedebug', 'languagereload']);   // инструменты разработчика
        // Какие кнопки игра спрашивает у движка: так видно, что клавиша ей правда нужна
        const asked = new Set();
        const hookAsk = () => {
            if (typeof Input === 'undefined') return;
            for (const fn of ['isPressed', 'isTriggered', 'isRepeated', 'isLongPressed']) {
                const orig = Input[fn];
                if (typeof orig !== 'function' || orig.__rpgAsk) continue;
                Input[fn] = function(name) { asked.add(name); return orig.apply(this, arguments); };
                Input[fn].__rpgAsk = true;
            }
        };
        hookAsk();
        const askTimer = setInterval(hookAsk, 500);
        setTimeout(() => clearInterval(askTimer), 30000);
        // ...и какие проверяют её события (условие «Кнопка нажата»)
        function eventButtons() {
            const out = new Set();
            const scan = (list) => { for (const c of list || []) if (c && c.code === 111 && c.parameters && c.parameters[0] === 11) out.add(c.parameters[1]); };
            try { (window.$dataCommonEvents || []).forEach(ce => ce && scan(ce.list)); } catch (_) {}
            try { ((window.$dataMap && window.$dataMap.events) || []).forEach(ev => ev && (ev.pages || []).forEach(p => scan(p.list))); } catch (_) {}
            return out;
        }
        function gameKeys() {
            const map = mapper(), used = eventButtons();
            asked.forEach(n => used.add(n));
            const out = [];
            for (const code of Object.keys(map)) {
                const kc = +code, name = map[code];
                if (!KEYBOARD[kc] || !name || kc === 90 || kc === 88 || kc === 65) continue;   // Z, X и A и так на экране
                if (STANDARD.has(name) || DEV_NAMES.has(name)) continue;
                // Плагины «всей клавиатуры» вешают буквы и цифры на все клавиши подряд — такие
                // берём, только если игра их спрашивает или клавиша названа сама собой (R → 'R')
                if (name.length === 1 && name !== String.fromCharCode(kc) && !used.has(name)) continue;
                out.push({ kc, caption: CAPTION[name] || '' });
            }
            // Tab у движка есть всегда, но на экране его нет — показываем, если игра его спрашивает
            if (map[9] === 'tab' && used.has('tab')) out.push({ kc: 9, caption: '' });
            return out.sort((a, b) => a.kc - b.kc);
        }
        // Вся клавиатура — привычными рядами, как на телефонной клавиатуре. Листание —
        // в полоске кнопками ‹ ›, а Home, End и прочие редкие клавиши игры, которым они
        // нужны, покажутся среди её клавиш
        const QWERTY = [
            [...'1234567890'].map(c => c.charCodeAt(0)),
            [...'QWERTYUIOP'].map(c => c.charCodeAt(0)),
            [...'ASDFGHJKL'].map(c => c.charCodeAt(0)).concat(8),
            [...'ZXCVBNM'].map(c => c.charCodeAt(0)).concat(32),
            [9, 27, 13, 16, 17, 18],
        ];
        const keyBtn = (kc, cap) => `<button type="button" class="_key _glass${kc === 32 ? ' _wide' : ''}" data-kc="${kc}">${keyLabel(kc)}${cap ? `<small>${cap}</small>` : ''}</button>`;
        const actBtn = (act, label, hint, latch) => `<button type="button" class="_key _glass${latched.has(act) ? ' _latched' : ''}" data-act="${act}"${latch ? ' data-latch="1"' : ''} aria-label="${hint}">${label}</button>`;
        const panel = document.getElementById('_keys_panel');
        const keysBtn = document.getElementById('_btn_keys');
        function setPanel(open) {
            if (open) {
                panel.innerHTML = `<div class="_kb_quick">`
                    + actBtn('dash', T.dash, T.dash_hint, true) + actBtn('pageup', icon('prev'), T.prev) + actBtn('pagedown', icon('next'), T.next)
                    + gameKeys().map(g => keyBtn(g.kc, g.caption)).join('')
                    + `<button type="button" class="_key _glass _kb_toggle" aria-label="${T.keys_abc}">A–Z</button></div>`
                    + `<div class="_kb_full">${QWERTY.map(row => `<div class="_kb_row">${row.map(kc => keyBtn(kc)).join('')}</div>`).join('')}</div>`;
                panel.querySelectorAll('[data-kc], [data-act]').forEach(bindButton);
                // Раскрытая клавиатура запоминается для игры: кому она нужна, тому нужна всегда
                const abc = panel.querySelector('._kb_toggle');
                const setAbc = (on) => { panel.classList.toggle('_abc', on); abc.classList.toggle('_latched', on); };
                setAbc(!!gameSettings.get('abc'));
                abc.addEventListener('pointerdown', (e) => { e.preventDefault(); const on = !panel.classList.contains('_abc'); setAbc(on); gameSettings.set('abc', on); }, { passive: false });
            }
            panel.classList.toggle('_open', open);
            keysBtn.classList.toggle('_latched', open);
        }
        keysBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); wake(); setPanel(!panel.classList.contains('_open')); sleepSoon(); }, { passive: false });

        // Подписи под кнопками — по раскладке игры и сцене: на карте X открывает меню
        const capA = root.querySelector('#_btn_a ._cap'), capX = root.querySelector('#_btn_x ._cap');
        setInterval(() => {
            const onMap = typeof Scene_Map !== 'undefined' && typeof SceneManager !== 'undefined' && SceneManager._scene instanceof Scene_Map;
            const x = onMap ? T.menu : T.back, a = CAPTION[mapper()[65]] || '';
            if (capX.textContent !== x) capX.textContent = x;
            if (capA.textContent !== a) capA.textContent = a;
            // Касания идут в игру, открыто чит-меню или игра поставила в этот угол свои поля и
            // кнопки — угол экрана не забираем под джойстик. Раньше кнопка OK в окне пароля
            // одной из игр попадала под него и не нажималась
            root.classList.toggle('_zone_off', !!window.__rpgTouchEnabled || !!window.__rpgCheatsOpen || gameControlsOver(zone));
        }, 400);
        function gameControlsOver(area) {
            const z = area.getBoundingClientRect();
            if (!z.width) return false;
            for (const el of document.querySelectorAll(GAME_CONTROLS)) {
                if (!isGameControl(el)) continue;
                const r = el.getBoundingClientRect();
                if (r.width && r.height && r.right > z.left && r.left < z.right && r.bottom > z.top && r.top < z.bottom && getComputedStyle(el).visibility !== 'hidden') return true;
            }
            return false;
        }

        // Свернули игру или заблокировали экран — отпускаем всё, что было зажато, иначе
        // герой продолжил бы идти. Движок при потере фокуса сбрасывает свои клавиши, так
        // что включённые «Бег» и «Пропуск» по возвращении нажимаем заново
        function releaseHeld() {
            releaseStick();
            root.querySelectorAll('[data-kc], [data-act]').forEach(b => { if (!b.classList.contains('_latched')) { b.classList.remove('_on'); b._pid = null; } });
            for (const kc of [...physHeld]) { physHeld.delete(kc); sendPhys(kc, false); }
            for (const act of [...actHeld]) if (!latched.has(act)) sendAction(act, false);
        }
        const restoreLatched = () => { for (const act of latched) sendAction(act, true); };
        document.addEventListener('visibilitychange', () => { if (document.hidden) releaseHeld(); else restoreLatched(); });
        window.addEventListener('blur', releaseHeld);
        window.addEventListener('focus', restoreLatched);

        // Кнопки — по тому, чем играют: коснулись экрана — есть, нажали настоящую клавишу или
        // кнопку геймпада — спрятаны и не закрывают картинку (планшет с клавиатурой, геймпад).
        // Там, где основной ввод — мышь (ноутбук с сенсором, планшет с тачпадом), сначала спрятаны
        function setShown(on) {
            if (root.classList.contains('_off') !== on) return;
            if (!on) { releaseHeld(); setPanel(false); }
            root.classList.toggle('_off', !on);
        }
        if (!TOUCH_FIRST) root.classList.add('_off');
        showTouchControls = () => setShown(true);
        window.addEventListener('keydown', (e) => {
            // Наши же нажатия с экранных кнопок — не настоящие; ввод текста — не игра
            const t = e.target;
            if (!e.isTrusted || (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable))) return;
            setShown(false);
        }, { capture: true, passive: true });
        // Геймпад событий о нажатиях не шлёт — пока он подключён, смотрим на кнопки и стики
        let padTimer = 0;
        const watchPads = () => {
            clearInterval(padTimer);
            padTimer = setInterval(() => {
                const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
                if (!pads.length) { clearInterval(padTimer); return; }
                if (pads.some(p => p.buttons.some(b => b.pressed) || p.axes.some(a => Math.abs(a) > 0.5))) setShown(false);
            }, 250);
        };
        window.addEventListener('gamepadconnected', watchPads);
        if (navigator.getGamepads && [...navigator.getGamepads()].some(Boolean)) watchPads();
    }

    // «Пропуск» во всех играх. Пока зажат Ctrl — или включена экранная кнопка «Пропуск»,
    // она и шлёт Ctrl, — текст появляется сразу и листается сам, а на выборе ответа
    // останавливается: окно выбора движок ждёт отдельно. Заодно быстрее идут журнал боя
    // и бегущие титры. Раньше кнопка работала только там, где у игры есть свой плагин
    // пропуска на Ctrl, — а он есть не у всех, и клавиши у них разные
    function setupTextSkip() {
        const skipping = () => typeof Input !== 'undefined' && !!Input.isPressed && Input.isPressed('control');
        const orSkip = (proto, name) => {
            const orig = proto && proto[name];
            if (typeof orig !== 'function' || orig.__rpgSkip) return;
            proto[name] = function() { return orig.apply(this, arguments) || skipping(); };
            proto[name].__rpgSkip = true;
        };
        const apply = () => {
            if (typeof Window_Message === 'undefined') return;
            // Движок спрашивает «нажали?», когда решает показать текст сразу и перелистнуть страницу
            orSkip(Window_Message.prototype, 'isTriggered');
            if (typeof Window_BattleLog !== 'undefined') orSkip(Window_BattleLog.prototype, 'isFastForward');
            if (typeof Window_ScrollText !== 'undefined') orSkip(Window_ScrollText.prototype, 'isFastForward');
            // Паузы внутри текста (\. и \|) тоже пропускаем
            const wait = Window_Message.prototype.updateWait;
            if (typeof wait === 'function' && !wait.__rpgSkip) {
                Window_Message.prototype.updateWait = function() {
                    if (skipping()) this._waitCount = 0;
                    return wait.apply(this, arguments);
                };
                Window_Message.prototype.updateWait.__rpgSkip = true;
            }
        };
        // Плагины сообщений подменяют эти методы своими — поэтому ставим и после них
        apply();
        const timer = setInterval(apply, 500);
        setTimeout(() => clearInterval(timer), 30000);
    }

    // Экран не гаснет, пока игра на экране: иначе телефон блокируется посреди сцены или
    // длинного диалога, если долго его не касаться. Скрыли вкладку — браузер снимает
    // блокировку сам, вернулись — ставим снова. Safari может дать её только после касания
    // страницы, поэтому просим и по касанию. Но если 10 минут никто ничего не нажимал —
    // отошли или уснули с открытой игрой, — экрану можно погаснуть: иначе он горел бы
    // часами. Первое же касание снова не даёт ему гаснуть
    function setupWakeLock() {
        if (!navigator.wakeLock || !navigator.wakeLock.request) return;
        const IDLE_MS = 10 * 60 * 1000;
        let lock = null, asking = false, lastInput = Date.now();
        // Последнее действие игрока: касания и клавиши — здесь, геймпад — по отметке движка
        const idle = () => Date.now() - Math.max(lastInput,
            (typeof Input !== 'undefined' && Input.date) || 0,
            (typeof TouchInput !== 'undefined' && TouchInput.date) || 0) > IDLE_MS;
        const acquire = () => {
            if (lock || asking || document.visibilityState !== 'visible' || idle()) return;
            asking = true;
            navigator.wakeLock.request('screen').then((l) => {
                lock = l;
                l.addEventListener('release', () => { if (lock === l) lock = null; });
            }).catch(() => {}).finally(() => { asking = false; });
        };
        const onInput = () => { lastInput = Date.now(); acquire(); };
        acquire();
        document.addEventListener('visibilitychange', onInput);
        ['touchend', 'click', 'keydown'].forEach(t => window.addEventListener(t, onInput, { capture: true, passive: true }));
        setInterval(() => {
            if (lock && idle()) { const l = lock; lock = null; l.release().catch(() => {}); }
            else acquire();   // геймпад будит только отметкой движка — проверяем и её
        }, 30000);
    }

    // Пока игра грузится, экран чёрный — иногда секунды, а с большим шрифтом на медленной
    // сети и дольше: непонятно, грузится она или зависла. Через полсекунды внизу появляется
    // «Загрузка игры…» и держится, пока не начнётся первая сцена после загрузочной.
    // Внизу, а не по центру: в центре движок рисует свою картинку загрузки
    function setupLoadingHint() {
        const style = document.createElement('style');
        style.textContent = `
            #_loading_hint { position: fixed; left: 50%; bottom: calc(max(20px, env(safe-area-inset-bottom)) + 12px); transform: translateX(-50%); z-index: 2147483645; display: flex; align-items: center; gap: 10px; padding: 8px 16px; border-radius: 999px; background: rgba(20,20,24,0.72); color: rgba(255,255,255,0.85); font: 500 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; white-space: nowrap; pointer-events: none; opacity: 0; transition: opacity .3s; }
            #_loading_hint._show { opacity: 1; }
            #_loading_hint i { width: 13px; height: 13px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.22); border-top-color: rgba(255,255,255,0.9); animation: _rpg_spin .8s linear infinite; }
            @keyframes _rpg_spin { to { transform: rotate(360deg); } }
        `;
        document.head.appendChild(style);
        const hint = document.createElement('div');
        hint.id = '_loading_hint';
        hint.innerHTML = `<i></i>${T.loading}`;
        document.body.appendChild(hint);

        const done = () => {
            // Игра упала — показывает свой экран ошибки, наша надпись там лишняя
            if (typeof Graphics !== 'undefined' && Graphics._errorPrinter && Graphics._errorPrinter.innerHTML.trim()) return true;
            if (typeof SceneManager === 'undefined' || !SceneManager._scene) return false;
            if (SceneManager._stopped) return true;
            const scene = SceneManager._scene;
            if (typeof Scene_Boot !== 'undefined' && scene instanceof Scene_Boot) return false;
            return scene.isStarted ? scene.isStarted() : !!SceneManager._sceneStarted;
        };
        const show = setTimeout(() => hint.classList.add('_show'), 500);
        const hide = () => { clearInterval(watch); clearTimeout(show); hint.classList.remove('_show'); setTimeout(() => hint.remove(), 400); };
        const watch = setInterval(() => { if (done()) hide(); }, 200);
        setTimeout(hide, 120000);
    }

    // --- 6. ДИАГНОСТИКА, ТАЧ-РЕЖИМ, МОНИТОРЫ ---
    // Счётчик кадров считает, только пока он на экране. Раньше он и журнал ниже
    // работали на каждом кадре всю игру, даже скрытые, — лишняя работа для телефона
    function setupFpsMonitor() {
        let visible = false;
        let raf = 0;

        const monitor = document.createElement('div');
        monitor.id = '_fps_monitor';
        monitor.style.cssText = `display: none; position: fixed; top: max(64px, env(safe-area-inset-top) + 48px); right: max(16px, env(safe-area-inset-right)); z-index: 2147483647; background: rgba(0,0,0,0.75); color: #0f0; font-family: 'Courier New', monospace; font-size: 11px; line-height: 1.5; padding: 8px 10px; border-radius: 8px; min-width: 130px; pointer-events: none; border: 1px solid rgba(255,255,255,0.1); backdrop-filter: blur(4px);`;
        document.body.appendChild(monitor);

        const HISTORY = 60;
        let fpsHistory, frameTimes, lastFrame, frameCount, lastFpsUpdate, lagSpikes;
        function reset() {
            fpsHistory = new Array(HISTORY).fill(60);
            frameTimes = []; lastFrame = performance.now(); frameCount = 0; lastFpsUpdate = performance.now(); lagSpikes = 0;
        }

        function sparkline(data) {
            const bars = ['▁','▂','▃','▄','▅','▆','▇','█'];
            const min = Math.min(...data), max = Math.max(...data) || 1;
            return data.slice(-20).map(v => bars[Math.max(0, Math.min(Math.round(((v - min) / (max - min)) * (bars.length - 1)), bars.length - 1))]).join('');
        }

        function getColor(fps) { return fps >= 55 ? '#0f0' : fps >= 40 ? '#ff0' : fps >= 25 ? '#f80' : '#f00'; }

        function tick() {
            const now = performance.now(), frameTime = now - lastFrame;
            lastFrame = now;
            frameCount++; frameTimes.push(frameTime);

            if (frameTimes.length > HISTORY) frameTimes.shift();
            if (frameTime > 50) lagSpikes++;

            if (now - lastFpsUpdate >= 500) {
                const currentFps = Math.round(frameCount / ((now - lastFpsUpdate) / 1000));
                frameCount = 0; lastFpsUpdate = now;

                fpsHistory.push(currentFps);
                if (fpsHistory.length > HISTORY) fpsHistory.shift();

                const avgFps = Math.round(fpsHistory.reduce((a, b) => a + b, 0) / fpsHistory.length);
                const avgFrameTime = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
                const color = getColor(currentFps);
                monitor.innerHTML = `
                    <span style="color:${color};font-size:16px;font-weight:bold">${currentFps} FPS</span><br>
                    <span style="color:#aaa">${T.fps_frame}: ${avgFrameTime.toFixed(1)}ms</span><br>
                    <span style="color:#888">min:${Math.min(...fpsHistory)} avg:${avgFps} max:${Math.max(...fpsHistory)}</span><br>
                    <span style="color:#f44;font-size:10px">${T.fps_spikes}: ${lagSpikes}</span><br>
                    <span style="color:${color};letter-spacing:0;font-size:10px">${sparkline(fpsHistory)}</span>
                `;
            }
            if (visible) raf = requestAnimationFrame(tick);
        }

        function setVisible(v) {
            visible = v;
            monitor.style.display = v ? 'block' : 'none';
            cancelAnimationFrame(raf);
            raf = 0;
            if (v) { reset(); raf = requestAnimationFrame(tick); }
        }
        window.__toggleFpsMonitor = () => setVisible(!visible);

        addMenuItem({ id: '_sys_fps', section: 'debug', icon: 'fps', label: T.fps, isOn: () => visible, onClick: () => setVisible(!visible) });
        if (location.search.includes('fps') || location.search.includes('dev')) setVisible(true);
    }

    // Журнал подтормаживаний пишет, пока открыт
    function setupSpikeDiagnostics() {
        const SPIKE_THRESHOLD_MS = 40;
        const MAX_LOG = 30;
        const log = [];
        let lastFrameTime = performance.now();
        const sessionStart = performance.now();
        let recording = false;
        let raf = 0;
        window.__spikeLog = log;

        const panel = document.createElement('div');
        // id нужен перехватчику касаний на телефоне: без него он глотал нажатия
        // по этой панели, и кнопка «Очистить» не работала
        panel.id = '_spike_panel';
        panel.style.cssText = `display: none; position: fixed; bottom: 10px; left: 10px; right: 10px; max-height: 45vh; background: rgba(0,0,0,0.92); border: 1px solid rgba(255,100,0,0.4); border-radius: 10px; z-index: 2147483647; font-family: 'Courier New', monospace; font-size: 10px; color: #ddd; overflow-y: auto; -webkit-overflow-scrolling: touch; pointer-events: auto;`;
        panel.innerHTML = `<div style="position:sticky;top:0;background:rgba(0,0,0,0.95);padding:6px 10px;border-bottom:1px solid rgba(255,100,0,0.3);display:flex;justify-content:space-between;align-items:center;"><span style="color:#f80;font-weight:bold">${T.spikes}</span><span id="_spike_count" style="color:#f44">${T.spikes_total}: 0</span><button id="_spike_clear" style="background:rgba(255,80,0,0.3);border:1px solid rgba(255,80,0,0.5);border-radius:4px;color:#fff;padding:2px 8px;font-size:10px;">${T.spikes_clear}</button></div><div id="_spike_log_body" style="padding:6px 10px;"></div>`;
        document.body.appendChild(panel);
        // Касания и прокрутка журнала — не игре: иначе на карте герой шёл бы туда, где нажали «Очистить»
        ['pointerdown', 'mousedown', 'mouseup', 'touchstart', 'touchmove', 'touchend', 'wheel', 'click'].forEach(t => {
            panel.addEventListener(t, (e) => e.stopPropagation(), { passive: true });
        });

        onTap(document.getElementById('_spike_clear'), () => {
            log.length = 0;
            document.getElementById('_spike_log_body').innerHTML = `<span style="color:#666">${T.spikes_cleared}</span>`;
            document.getElementById('_spike_count').textContent = `${T.spikes_total}: 0`;
        });

        function getGameState(frameMs) {
            const state = { ms: frameMs.toFixed(1), t: ((performance.now() - sessionStart) / 1000).toFixed(1) };
            try {
                const sm = window.SceneManager;
                if (!sm) return state;
                state.scene = sm._scene?.constructor?.name || '?';
                if (window.$gameMap) {
                    state.map = $gameMap._mapId || 0;
                    const events = $gameMap._events?.filter(Boolean) || [];
                    state.events = events.length;
                    state.parallelEvents = events.filter(e => e?._trigger === 4 && e?._interpreter?.isRunning?.()).length;
                    state.runningEvents = events.filter(e => e?._interpreter?.isRunning?.()).length;
                }
                if (window.$gameMessage) state.msg = $gameMessage.isBusy() ? 'ДА' : 'нет';
                if (window.$gameScreen) state.pics = ($gameScreen._pictures?.filter(Boolean) || []).length;
                if (window.PIXI?.utils?.TextureCache) state.textures = Object.keys(PIXI.utils.TextureCache).length;
                if (window.FilterController !== undefined) state.fc = FilterController.enabledAll ? 'ON' : 'off';
            } catch(e) {}
            return state;
        }

        function detectLoop() {
            const now = performance.now();
            const delta = now - lastFrameTime;
            lastFrameTime = now;

            if (delta > SPIKE_THRESHOLD_MS) {
                log.unshift(getGameState(delta));
                if (log.length > MAX_LOG) log.pop();
                const body = document.getElementById('_spike_log_body');
                if (body) body.innerHTML = log.map((s, i) => `<div style="border-bottom:1px solid rgba(255,255,255,0.05);padding:3px 0"><span style="color:#666">#${i+1} +${s.t}s</span><span style="color:${s.ms > 80 ? '#f44' : s.ms > 60 ? '#f80' : '#ff0'};font-weight:bold"> ${s.ms}ms</span><span style="color:#aaa"> ${s.scene || '?'}</span> ${s.parallelEvents > 0 ? `<span style="color:#f44"> ⚠️ parallel:${s.parallelEvents}</span>` : ''} ${s.textures > 200 ? `<span style="color:#f44"> tex:${s.textures}⚠️</span>` : (s.textures ? ` tex:${s.textures}` : '')}</div>`).join('');
                const countEl = document.getElementById('_spike_count');
                if (countEl) countEl.textContent = `${T.spikes_total}: ${log.length}`;
            }
            if (recording) raf = requestAnimationFrame(detectLoop);
        }

        function setOpen(open) {
            recording = open;
            panel.style.display = open ? 'block' : 'none';
            cancelAnimationFrame(raf);
            raf = 0;
            if (open) { lastFrameTime = performance.now(); raf = requestAnimationFrame(detectLoop); }
        }

        addMenuItem({ id: '_sys_spikes', section: 'debug', icon: 'pulse', label: T.spikes, isOn: () => recording, onClick: () => setOpen(!recording) });
        if (location.search.includes('dev')) setOpen(true);
    }

    function setupTouchModeToggle() {
        if (!TOUCH_FIRST) return;

        window.__rpgTouchEnabled = !!gameSettings.get('touch');

        const interceptor = (e) => {
            // Касание мимо меню ⚙ закрывает его. Проверка здесь, а не только в обработчике
            // на document: перехватчик глотает касание раньше, и меню оставалось открытым
            if ((e.type === 'pointerdown' || e.type === 'touchstart') && !(e.target && e.target.closest && e.target.closest('#_sys_menu_container'))) closeMenu();
            if (window.__rpgTouchEnabled) return;
            // Наше меню и кнопки — и поля с кнопками самой игры: касание по ним — им. Раньше
            // «Retry» на экране ошибки загрузки в MV не нажимался (он ждёт само касание,
            // а не «клик»), и выйти можно было только перезапуском
            if (e.target && e.target.closest && (e.target.closest(OUR_UI) || isGameControl(e.target))) return;
            e.stopPropagation();
            e.stopImmediatePropagation();
        };

        const TYPES = ['touchstart', 'touchmove', 'touchend', 'mousedown', 'mousemove', 'mouseup', 'pointerdown', 'pointermove', 'pointerup'];
        TYPES.forEach(ev => {
            window.addEventListener(ev, interceptor, { capture: true, passive: false });
        });
        // ...но дальше самого поля или кнопки касание не идёт: движок принял бы его за
        // касание картинки — на карте герой пошёл бы туда, а на iPhone поле не получило бы фокус
        const keepToControl = (e) => { if (!window.__rpgTouchEnabled && isGameControl(e.target)) e.stopPropagation(); };
        TYPES.forEach(ev => document.documentElement.addEventListener(ev, keepToControl, { passive: true }));

        window.__toggleRpgTouchMode = function() {
            window.__rpgTouchEnabled = !window.__rpgTouchEnabled;
            gameSettings.set('touch', window.__rpgTouchEnabled);
        };
        addMenuItem({ id: '_sys_touch', section: 'controls', icon: 'tap', label: T.touch, isOn: () => window.__rpgTouchEnabled, onClick: () => window.__toggleRpgTouchMode() });
    }

    // Чит-меню (cheats.js — своё, панель поверх игры) — при первом нажатии пункта в меню ⚙: в каждую игру
    // заранее его не грузим, пользуются им не все
    function injectCheats() {
        let state = 'idle';   // idle → loading → ready
        addMenuItem({
            id: '_sys_cheat', section: 'game', icon: 'wand', label: T.cheats,
            onClick: () => {
                if (state === 'ready') { if (window.__rpgCheats) window.__rpgCheats.toggle(); return; }
                if (state === 'loading') return;
                state = 'loading';
                const script = document.createElement('script');
                script.src = '/cheats.js';
                script.onload = () => { state = 'ready'; if (window.__rpgCheats) window.__rpgCheats.open(); };
                script.onerror = () => { state = 'idle'; console.warn('[RPG Fixes] Чит-меню не загрузилось'); };
                document.body.appendChild(script);
            },
        });
    }

    // ============================================================================
    // 7. ЧИСТОЕ АУДИО + AUTO-FALLBACK + ЗАЩИТА ОТ АВТО-МУТА ПРИ СНЕ
    // ============================================================================
    // Для проверки, умеет ли браузер Ogg (см. ниже): 100 мс тишины, Vorbis 8 кГц моно.
    // Короче нельзя: из одного пакета Vorbis звука не получается, и Chromium отвечает
    // «не могу декодировать», хотя Ogg умеет
    const OGG_PROBE = 'T2dnUwACAAAAAAAAAAAAAAAAAAAAAOEUWLYBHgF2b3JiaXMAAAAAAUAfAAAAAAAAgFcAAAAAAACZAU9nZ1MAAAAAAAAAAAAAAAAAAAEAAADSMjkZCzD///////////+1A3ZvcmJpcwYAAABmZm1wZWcBAAAAFgAAAGVuY29kZXI9TGF2YyBsaWJ2b3JiaXMBBXZvcmJpcxJCQ1YBAAABAAxSFCElGVNKYwiVUlIpBR1jUFtHHWPUOUYhZBBTiEkZpXtPKpVYSsgRUlgpRR1TTFNJlVKWKUUdYxRTSCFT1jFloXMUS4ZJCSVsTa50FkvomWOWMUYdY85aSp1j1jFFHWNSUkmhcxg6ZiVkFDpGxehifDA6laJCKL7H3lLpLYWKW4q91xpT6y2EGEtpwQhhc+211dxKasUYY4wxxsXiUyiC0JBVAAABAABABAFCQ1YBAAoAAMJQDEVRgNCQVQBABgCAABRFcRTHcRxHkiTLAkJDVgEAQAAAAgAAKI7hKJIjSZJkWZZlWZameZaouaov+64u667t6roOhIasBADIAAAYhiGH3knMkFOQSSYpVcw5CKH1DjnlFGTSUsaYYoxRzpBTDDEFMYbQKYUQ1E45pQwiCENInWTOIEs96OBi5zgQGrIiAIgCAACMQYwhxpBzDEoGIXKOScggRM45KZ2UTEoorbSWSQktldYi55yUTkompbQWUsuklNZCKwUAAAQ4AAAEWAiFhqwIAKIAABCDkFJIKcSUYk4xh5RSjinHkFLMOcWYcowx6CBUzDHIHIRIKcUYc0455iBkDCrmHIQMMgEAAAEOAAABFkKhISsCgDgBAIMkaZqlaaJoaZooeqaoqqIoqqrleabpmaaqeqKpqqaquq6pqq5seZ5peqaoqp4pqqqpqq5rqqrriqpqy6ar2rbpqrbsyrJuu7Ks256qyrapurJuqq5tu7Js664s27rkearqmabreqbpuqrr2rLqurLtmabriqor26bryrLryratyrKua6bpuqKr2q6purLtyq5tu7Ks+6br6rbqyrquyrLu27au+7KtC7vourauyq6uq7Ks67It67Zs20LJ81TVM03X9UzTdVXXtW3VdW1bM03XNV1XlkXVdWXVlXVddWVb90zTdU1XlWXTVWVZlWXddmVXl0XXtW1Vln1ddWVfl23d92VZ133TdXVblWXbV2VZ92Vd94VZt33dU1VbN11X103X1X1b131htm3fF11X11XZ1oVVlnXf1n1lmHWdMLqurqu27OuqLOu+ruvGMOu6MKy6bfyurQvDq+vGseu+rty+j2rbvvDqtjG8um4cu7Abv+37xrGpqm2brqvrpivrumzrvm/runGMrqvrqiz7uurKvm/ruvDrvi8Mo+vquirLurDasq/Lui4Mu64bw2rbwu7aunDMsi4Mt+8rx68LQ9W2heHVdaOr28ZvC8PSN3a+AACAAQcAgAATykChISsCgDgBAAYhCBVjECrGIIQQUgohpFQxBiFjDkrGHJQQSkkhlNIqxiBkjknIHJMQSmiplNBKKKWlUEpLoZTWUmotptRaDKG0FEpprZTSWmopttRSbBVjEDLnpGSOSSiltFZKaSlzTErGoKQOQiqlpNJKSa1lzknJoKPSOUippNJSSam1UEproZTWSkqxpdJKba3FGkppLaTSWkmptdRSba21WiPGIGSMQcmck1JKSamU0lrmnJQOOiqZg5JKKamVklKsmJPSQSglg4xKSaW1kkoroZTWSkqxhVJaa63VmFJLNZSSWkmpxVBKa621GlMrNYVQUgultBZKaa21VmtqLbZQQmuhpBZLKjG1FmNtrcUYSmmtpBJbKanFFluNrbVYU0s1lpJibK3V2EotOdZaa0ot1tJSjK21mFtMucVYaw0ltBZKaa2U0lpKrcXWWq2hlNZKKrGVklpsrdXYWow1lNJiKSm1kEpsrbVYW2w1ppZibLHVWFKLMcZYc0u11ZRai621WEsrNcYYa2415VIAAMCAAwBAgAlloNCQlQBAFAAAYAxjjEFoFHLMOSmNUs45JyVzDkIIKWXOQQghpc45CKW01DkHoZSUQikppRRbKCWl1losAACgwAEAIMAGTYnFAQoNWQkARAEAIMYoxRiExiClGIPQGKMUYxAqpRhzDkKlFGPOQcgYc85BKRljzkEnJYQQQimlhBBCKKWUAgAAChwAAAJs0JRYHKDQkBUBQBQAAGAMYgwxhiB0UjopEYRMSielkRJaCylllkqKJcbMWomtxNhICa2F1jJrJcbSYkatxFhiKgAA7MABAOzAQig0ZCUAkAcAQBijFGPOOWcQYsw5CCE0CDHmHIQQKsaccw5CCBVjzjkHIYTOOecghBBC55xzEEIIoYMQQgillNJBCCGEUkrpIIQQQimldBBCCKGUUgoAACpwAAAIsFFkc4KRoEJDVgIAeQAAgDFKOSclpUYpxiCkFFujFGMQUmqtYgxCSq3FWDEGIaXWYuwgpNRajLV2EFJqLcZaQ0qtxVhrziGl1mKsNdfUWoy15tx7ai3GWnPOuQAA3AUHALADG0U2JxgJKjRkJQCQBwBAIKQUY4w5h5RijDHnnENKMcaYc84pxhhzzjnnFGOMOeecc4wx55xzzjnGmHPOOeecc84556CDkDnnnHPQQeicc845CCF0zjnnHIQQCgAAKnAAAAiwUWRzgpGgQkNWAgDhAACAMZRSSimllFJKqKOUUkoppZRSAiGllFJKKaWUUkoppZRSSimllFJKKaWUUkoppZRSSimllFJKKaWUUkoppZRSSimllFJKKaWUUkoppZRSSimllFJKKaWUUkoppZRSSimllFJKKaWUUkoppZRSSimllFJKKaWUUkoppZRSSimVUkoppZRSSimllFJKKaUAIN8KBwD/BxtnWEk6KxwNLjRkJQAQDgAAGMMYhIw5JyWlhjEIpXROSkklNYxBKKVzElJKKYPQWmqlpNJSShmElGILIZWUWgqltFZrKam1lFIoKcUaS0qppdYy5ySkklpLrbaYOQelpNZaaq3FEEJKsbXWUmuxdVJSSa211lptLaSUWmstxtZibCWlllprqcXWWkyptRZbSy3G1mJLrcXYYosxxhoLAOBucACASLBxhpWks8LR4EJDVgIAIQEABDJKOeecgxBCCCFSijHnoIMQQgghREox5pyDEEIIIYSMMecghBBCCKGUkDHmHIQQQgghhFI65yCEUEoJpZRSSucchBBCCKWUUkoJIYQQQiillFJKKSGEEEoppZRSSiklhBBCKKWUUkoppYQQQiillFJKKaWUEEIopZRSSimllBJCCKGUUkoppZRSQgillFJKKaWUUkooIYRSSimllFJKCSWUUkoppZRSSikhlFJKKaWUUkoppQAAgAMHAIAAI+gko8oibDThwgMQAAAAAgACTACBAYKCUQgChBEIAAAAAAAIAPgAAEgKgIiIaOYMDhASFBYYGhweICIkAAAAAAAAAAAAAAAABE9nZ1MABCADAAAAAAAAAAAAAAIAAAB1uGc9BQEBAQEBAAAAAAA=';

    function setupSecureAudio() {
        if (typeof AudioManager !== 'undefined' && !AudioManager.__SafeCheckPatched) {
            AudioManager.__SafeCheckPatched = true; 
            const orig = AudioManager.checkErrors; 
            AudioManager.checkErrors = function () { try { if (orig) orig.apply(this, arguments); } catch (e) {} };
        }

        // Блок decTimer отсюда удален, чтобы не ломать картинки!

        // --- Формат звука: Ogg или m4a ---
        // Звук в играх — Ogg. Safari научился его играть только в iOS 18.4, и «умею» от
        // тега <audio> ещё не значит, что умеет Web Audio, через который звучат игры.
        // Поэтому проверяем по-настоящему: декодируем крошечный Ogg (2,6 КБ тишины).
        // Это миллисекунды — проверка заканчивается раньше, чем игра попросит первый звук.
        // Умеет — игра получает свой Ogg как есть. Не умеет (iPhone до iOS 18.4, старые Mac):
        // MV просит .m4a (сервер отдаст готовый или перекодирует), а MZ разбирает Ogg
        // своим встроенным декодером. Раньше формат угадывал сервер по User-Agent: iPhone
        // всегда получал перекодированный m4a — каждая мелодия в первый раз ждала FFmpeg,
        // а MZ на старых iOS получал m4a вместо Ogg для своего декодера и молчал
        const oggAudio = { ok: false };
        try { oggAudio.ok = !!document.createElement('audio').canPlayType('audio/ogg; codecs="vorbis"'); } catch (_) {}
        if (oggAudio.ok) {
            try {
                const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
                const bytes = Uint8Array.from(atob(OGG_PROBE), (c) => c.charCodeAt(0));
                const fail = () => { oggAudio.ok = false; };
                const p = new OAC(1, 1, 22050).decodeAudioData(bytes.buffer, () => {}, fail);
                if (p && p.catch) p.catch(fail);
            } catch (_) { oggAudio.ok = false; }
        }
        window.__rpgOggAudio = oggAudio;

        const formatTimer = setInterval(() => {
            if (typeof WebAudio !== 'undefined' && typeof AudioManager !== 'undefined') {
                if (typeof Utils !== 'undefined' && Utils.RPGMAKER_NAME === 'MZ') {
                    // MZ всегда просит .ogg и сам решает, декодировать ли его своим декодером
                    Utils.canPlayOgg = () => oggAudio.ok;
                } else {
                    // MV на телефонах по умолчанию просит .m4a, а в сборках для Windows
                    // его обычно нет — поэтому Ogg всегда, когда браузер его умеет
                    WebAudio.canPlayOgg = () => oggAudio.ok;
                    AudioManager.audioFileExt = () => (oggAudio.ok ? '.ogg' : '.m4a');
                }
                clearInterval(formatTimer);
            }
        }, 50);

        // 🔥 ОТКЛЮЧАЕМ ВСТРОЕННЫЙ АВТО-МУТ ДВИЖКА ПРИ СВОРАЧИВАНИИ
        // Игра больше не будет пытаться плавно затушить звук (из-за чего он ломался после сна)
        const blurTimer = setInterval(() => {
            if (typeof WebAudio !== 'undefined') {
                if (WebAudio._onHide) WebAudio._onHide = function() {}; 
                if (WebAudio._onShow) WebAudio._onShow = function() {}; 
                if (WebAudio._shouldMuteOnHide) WebAudio._shouldMuteOnHide = function() { return false; }; 
                if (typeof AudioManager !== 'undefined' && AudioManager.shouldMuteOnFocus) {
                    AudioManager.shouldMuteOnFocus = function() { return false; };
                }
                clearInterval(blurTimer);
            }
        }, 50);

        // Свернули игру на телефоне или планшете — звук на паузу, вернулись — дальше. Сам
        // движок плавно глушил звук при сворачивании, но после сна телефона звук из-за этого
        // ломался, и приглушение выключено (выше) — свёрнутая игра так и играла. Пауза самого
        // звука — без затуханий; если после сна он не проснётся сам, разбудит касание
        // (forceAudioWakeUp). На компьютере звук, как и в движке, при сворачивании не глушим
        if (TOUCH_FIRST) {
            let pausedByUs = false;
            document.addEventListener('visibilitychange', () => {
                const ctx = typeof WebAudio !== 'undefined' && WebAudio._context;
                if (!ctx) return;
                if (document.hidden) {
                    if (ctx.state === 'running') { pausedByUs = true; ctx.suspend().catch(() => {}); }
                } else if (pausedByUs) {
                    pausedByUs = false;
                    ctx.resume().catch(() => {});
                }
            });
        }

        // 4) УМНЫЙ АВТО-FALLBACK (С ожиданием пробуждения)
        const fallbackTimer = setInterval(() => {
            if (typeof WebAudio !== 'undefined') {
                clearInterval(fallbackTimer);
                
                if (window.fetch && !window.__fetchAudioPatched) {
                    window.__fetchAudioPatched = true;
                    const origFetch = window.fetch;
                    window.fetch = async function(...args) {
                        let res;
                        try {
                            res = await origFetch(...args);
                        } catch (e) {
                            if (e.name === 'AbortError' || (e.message && e.message.toLowerCase().includes('aborted'))) {
                                await new Promise(resolve => {
                                    const handler = () => { if (!document.hidden) { document.removeEventListener('visibilitychange', handler); resolve(); } };
                                    if (document.hidden) document.addEventListener('visibilitychange', handler); else resolve();
                                });
                                return window.fetch(...args);
                            }
                            throw e;
                        }
                        
                        if (!res.ok && typeof args[0] === 'string' && args[0].match(/\.(ogg|rpgmvo)$/i)) {
                            const fbUrl = args[0].replace(/\.ogg$/i, '.m4a').replace(/\.rpgmvo$/i, '.rpgmvm');
                            try { const fbRes = await origFetch(fbUrl, args[1]); if (fbRes.ok) return fbRes; } catch(e) {}
                        }
                        return res;
                    };
                }

                if (WebAudio.prototype._load && !WebAudio.prototype.__loadPatched) {
                    WebAudio.prototype.__loadPatched = true;
                    WebAudio.prototype._load = function(url) {
                        const self = this;
                        const encrypted = typeof Decrypter !== 'undefined' && Decrypter.hasEncryptedAudio;
                        // Шифрованный звук для браузера без Ogg просим обычным .m4a: сервер
                        // сам расшифрует и перекодирует. Раньше просили .rpgmvm, которого
                        // в сборках для Windows нет, — и на старых iPhone было тихо
                        const plainM4a = encrypted && !oggAudio.ok && /\.m4a$/i.test(url);
                        const finalUrl = encrypted && !plainM4a ? Decrypter.extToEncryptExt(url) : url;
                        const onLoad = (x) => {
                            if (!plainM4a) return self._onXhrLoad(x);
                            // Ответ уже расшифрован. _onXhrLoad смотрит на флаг сразу, ещё до
                            // декодирования, — на это время его и снимаем
                            Decrypter.hasEncryptedAudio = false;
                            try { self._onXhrLoad(x); } finally { Decrypter.hasEncryptedAudio = true; }
                        };
                        const get = (u, ok, bad) => {
                            const xhr = new XMLHttpRequest();
                            xhr.open('GET', u);
                            xhr.responseType = 'arraybuffer';
                            xhr.onload = () => (xhr.status < 400 ? ok(xhr) : bad(xhr.status));
                            xhr.onerror = () => bad(0);
                            xhr.send();
                        };
                        // Не загрузился — ещё раз (audioFailed). Раньше MV здесь сам пробовал
                        // снова, а эта замена его загрузки — нет, и мелодия молчала
                        const failed = (status) => audioFailed(self, () => self._load(url), status >= 400 && status < 500);
                        get(finalUrl, onLoad, (status) => {
                            // Нет .ogg — может, есть .m4a
                            if (status >= 400 && status < 500 && /\.(ogg|rpgmvo)$/i.test(finalUrl)) {
                                get(finalUrl.replace(/\.ogg$/i, '.m4a').replace(/\.rpgmvo$/i, '.rpgmvm'), (x) => self._onXhrLoad(x), failed);
                            } else failed(status);
                        });
                    };
                }

                // MZ грузит звук сам, нам — только узнать, что не вышло, и ответ сервера
                if (!WebAudio.prototype._load && WebAudio.prototype._onError && WebAudio.prototype.retry && !WebAudio.prototype.__retryPatched) {
                    WebAudio.prototype.__retryPatched = true;
                    const onFetch = WebAudio.prototype._onFetch;
                    if (onFetch) WebAudio.prototype._onFetch = function(response) {
                        this.__rpgStatus = response ? response.status : 0;
                        return onFetch.apply(this, arguments);
                    };
                    const onError = WebAudio.prototype._onError;
                    WebAudio.prototype._onError = function() {
                        onError.apply(this, arguments);
                        const status = this.__rpgStatus || 0;
                        this.__rpgStatus = 0;
                        audioFailed(this, () => {
                            // Недокачанное в прошлый раз с новым не склеиваем
                            try { this._removeNodes(); } catch (_) {}
                            this._data = null; this._fetchedSize = 0; this._fetchedData = []; this._buffers = []; this._totalTime = 0;
                            this.retry();
                        }, status >= 400 && status < 500);
                    };
                }
            }
        }, 50);

        // Звук не загрузился (сбой сети, телефон уснул посреди загрузки) — пробуем ещё через
        // 1, 3, 10 и 30 секунд, а дальше — как только вернутся сеть или экран. Раньше мелодия
        // молчала до следующей, а незагруженные фанфары не давали включиться и новой музыке:
        // движок ждёт их конца. Повторяем только музыку, фоновый звук и системные звуки: удар
        // или шаг, скачанные поздно, прозвучали бы невпопад. Фанфарам — одна попытка, дальше
        // без них: пусть вернётся музыка
        const AUDIO_RETRY_MS = [1000, 3000, 10000, 30000];
        const audioWaiting = new Map();   // звук → как загрузить его снова
        const audioRole = (b) => {
            if (typeof AudioManager === 'undefined' || !b) return null;
            const A = AudioManager;
            if (b === A._bgmBuffer || b === A._bgsBuffer) return 'music';
            if (b === A._meBuffer) return 'me';
            return (A._staticBuffers || []).includes(b) ? 'system' : null;
        };
        const reloadAudio = (b, reload) => {
            // Системный звук — только загрузить: нажатие, которое его ждало, давно прошло
            if (audioRole(b) === 'system') { try { b.stop(); } catch (_) {} }
            reload();
        };
        // missing — файла на сервере нет, повторять незачем
        function audioFailed(b, reload, missing) {
            const role = audioRole(b);
            if (!role || b.__rpgRetryAt) return;
            const tries = b.__rpgTries || 0;
            const delays = role === 'me' ? AUDIO_RETRY_MS.slice(0, 1) : AUDIO_RETRY_MS;
            if (missing || tries >= delays.length) {
                if (role === 'me') AudioManager.stopMe();
                else if (!missing) audioWaiting.set(b, reload);
                return;
            }
            b.__rpgTries = tries + 1;
            b.__rpgRetryAt = setTimeout(() => {
                b.__rpgRetryAt = 0;
                const now = audioRole(b);
                if (!now) return;
                if (!document.hidden) reloadAudio(b, reload);
                else if (now === 'me') AudioManager.stopMe();
                else audioWaiting.set(b, reload);   // экран погас — дождёмся его
            }, delays[tries]);
        }
        const retryWaiting = () => {
            if (document.hidden || !navigator.onLine) return;
            for (const [b, reload] of audioWaiting) {
                audioWaiting.delete(b);
                if (audioRole(b)) { b.__rpgTries = 0; reloadAudio(b, reload); }
            }
        };
        window.addEventListener('online', retryWaiting);
        document.addEventListener('visibilitychange', retryWaiting);

        // 5) ЗВУК ВКЛЮЧАЕТСЯ С ПЕРВОГО КАСАНИЯ
        // Браузер не пускает звук, пока человек не коснулся страницы, а iPhone засчитывает
        // только конец касания — touchend или click, начало (touchstart) не считается.
        // Движок включает звук сам, но на телефоне касания по экрану до него не доходят:
        // их перехватывает setupTouchModeToggle. Поэтому включаем здесь, на window в фазе
        // захвата: этот слушатель ставится раньше перехватчика и раньше экранных кнопок.
        // Раньше тут слушались только touchstart и pointerdown, а пауза в 500 мс после
        // них отбрасывала click того же касания, — на iPhone звук не появлялся, пока
        // не нажмёшь экранную кнопку
        function forceAudioWakeUp() {
            const ctx = (typeof WebAudio !== 'undefined' && WebAudio._context) ? WebAudio._context : null;
            // 'interrupted' — iOS: звонок, Siri, выключенный экран
            if (!ctx || ctx.state === 'running' || ctx.state === 'closed') return;
            try {
                ctx.resume().catch(() => {});
                // Пустой звук — старый способ отпереть его на iOS, для движков постарше
                const src = ctx.createBufferSource();
                src.buffer = ctx.createBuffer(1, 1, 22050);
                src.connect(ctx.destination);
                src.start(0);
            } catch (err) {}
        }

        ['touchstart', 'touchend', 'pointerdown', 'pointerup', 'mousedown', 'click', 'keydown'].forEach(ev => {
            window.addEventListener(ev, forceAudioWakeUp, { capture: true, passive: true });
        });

        // Видео со звуком iPhone тоже запускает только из касания. Но разрешение даётся
        // плееру, а не ролику: стоит один раз запустить плеер в касании — дальше он играет
        // сам. Плеер у движка один на все ролики, его и «разрешаем» первым касанием. Ролик,
        // который уже идёт без звука (начался до касания), этим касанием получает звук.
        // Только конец касания, клик и клавиша: начало касания iPhone не засчитывает
        function unlockVideo(e) {
            if (!e.isTrusted) return;
            // Ролики, которые начались до касания и идут без звука, получают звук. Каждым
            // касанием, а не только первым: плагины заводят для роликов свои плееры, и
            // каждому новому iPhone заново не даёт звук
            for (const muted of mutedVideos) muted.muted = false;
            mutedVideos.clear();
            const v = (typeof Graphics !== 'undefined' && Graphics._video) || (typeof Video !== 'undefined' && Video._element);
            if (!v || v.__rpgUnlocked || !v.paused) return;
            v.__rpgUnlocked = true;
            try {
                const p = _originalVideoPlay.call(v);
                if (p && p.catch) p.catch(() => {});
                v.pause();
            } catch (_) {}
        }
        ['touchend', 'click', 'keydown'].forEach(ev => {
            window.addEventListener(ev, unlockVideo, { capture: true, passive: true });
        });

        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) setTimeout(forceAudioWakeUp, 100);
        });
    }

    // ============================================================================
    // ФИКС КРАША СНИМКОВ ЭКРАНА (Броня на уровне движка RPG Maker)
    // ============================================================================
    const bitmapShieldTimer = setInterval(() => {
        // Ждем, пока движок загрузит класс Bitmap
        if (typeof Bitmap !== 'undefined' && Bitmap.prototype && Bitmap.prototype.getPixel) {
            clearInterval(bitmapShieldTimer);
            
            // 1. Защита функции getPixel (Часто ломается при определении клика по картинке)
            const origGetPixel = Bitmap.prototype.getPixel;
            Bitmap.prototype.getPixel = function(x, y) {
                x = (isFinite(x) && !isNaN(x)) ? Math.round(x) : 0;
                y = (isFinite(y) && !isNaN(y)) ? Math.round(y) : 0;
                try {
                    return origGetPixel.call(this, x, y);
                } catch(e) {
                    return '#000000'; // Возвращаем черный цвет при ошибке
                }
            };

            // 2. Защита функции getAlphaPixel (Проверка прозрачности)
            const origGetAlphaPixel = Bitmap.prototype.getAlphaPixel;
            Bitmap.prototype.getAlphaPixel = function(x, y) {
                x = (isFinite(x) && !isNaN(x)) ? Math.round(x) : 0;
                y = (isFinite(y) && !isNaN(y)) ? Math.round(y) : 0;
                try {
                    return origGetAlphaPixel.call(this, x, y);
                } catch(e) {
                    return 0; // Возвращаем полную прозрачность при ошибке
                }
            };
            
            // 3. Защита функции clearRect (Очистка экрана)
            const origClearRect = Bitmap.prototype.clearRect;
            Bitmap.prototype.clearRect = function(x, y, width, height) {
                x = (isFinite(x) && !isNaN(x)) ? Math.round(x) : 0;
                y = (isFinite(y) && !isNaN(y)) ? Math.round(y) : 0;
                width = (isFinite(width) && !isNaN(width)) ? Math.round(width) : 1;
                height = (isFinite(height) && !isNaN(height)) ? Math.round(height) : 1;
                try {
                    origClearRect.call(this, x, y, width, height);
                } catch(e) {}
            };

            console.log('[RPG Fixes] 🛡️ Броня Bitmap (getPixel/clearRect) активирована!');
        }
    }, 100);
    setTimeout(() => clearInterval(bitmapShieldTimer), 30000);

    // Картинка в MZ не загрузилась (сбой сети) — ещё две тихие попытки, через 1 и 3 секунды,
    // и только потом экран ошибки. MV так делает сам. Пока пробуем, игра ждёт, как при
    // обычной загрузке
    const imageRetryTimer = setInterval(() => {
        if (typeof Bitmap === 'undefined' || typeof Utils === 'undefined' || !Utils.RPGMAKER_NAME) return;
        clearInterval(imageRetryTimer);
        const P = Bitmap.prototype;
        if (Utils.RPGMAKER_NAME !== 'MZ' || typeof P.retry !== 'function' || typeof P._onError !== 'function' || P._onError.__rpg) return;
        const RETRY_MS = [1000, 3000];
        const onError = P._onError;
        P._onError = function() {
            const tries = this.__rpgTries || 0;
            if (tries < RETRY_MS.length && this._url && !this.__rpgGone) {
                this.__rpgTries = tries + 1;
                setTimeout(() => { if (!this.__rpgGone && this._loadingState === 'loading') this.retry(); }, RETRY_MS[tries]);
                return;
            }
            return onError.apply(this, arguments);
        };
        P._onError.__rpg = true;
        // Картинку уже выбросили — снова не грузим
        const destroy = P.destroy;
        P.destroy = function() { this.__rpgGone = true; return destroy.apply(this, arguments); };
    }, 20);
    setTimeout(() => clearInterval(imageRetryTimer), 30000);

    // ============================================================================
    // ИНИЦИАЛИЗАЦИЯ
    // ============================================================================

    function initUltimateFixes() {
        applyConsoleFixes();
        applyCoreEnginePatches();
        setupBrowserStubs();
        fixDevicePixelRatio();
        setupModernViewport();
        applyPerformanceOptimizations();
        setupSecureAudio(); 
        // Слушает касания на window раньше перехватчика касаний (setupTouchModeToggle)
        setupWakeLock();
        setupCloudSaves();
        setupGameStorage();
        setupGameExit();
        setupUIAndGamepad();
        setupLoadingHint();
        setupTextSkip();
        setupFpsMonitor();
        setupSpikeDiagnostics();
        setupTouchModeToggle();
        injectCheats();
        console.log('✅ RPG-Fixes Ultimate v4.1 успешно загружен!');
    }

    // ============================================================================
    // ПАТЧ ДЛЯ ПЛАГИНА TS_ADVsystem / TS_Decode (ПРАВИЛЬНЫЙ PROTOTYPE)
    // ============================================================================
    var aggressiveAdvPatch = setInterval(function() {
        if (typeof ADV_System === 'undefined' || !ADV_System || !ADV_System.prototype) return;
        clearInterval(aggressiveAdvPatch);
        console.log('[RPG Fixes] ADV_System.prototype patch activated!');

        // 1. localFileDirectoryPath — всегда возвращает 'scenario/'
        Object.defineProperty(ADV_System.prototype, 'localFileDirectoryPath', {
            value: function() { return 'scenario/'; },
            writable: false,
            configurable: false
        });

        // 2. УМНЫЙ fileLoad: перебор расширений, XHR и XOR-дешифровка
        ADV_System.prototype.fileLoad = function(filename) {
            // На веб-серверах важен регистр и точное расширение
            var variants = [
                'scenario/' + filename + '.txt',
                'scenario/' + filename + '.sl',
                'Scenario/' + filename + '.txt',
                'Scenario/' + filename + '.sl'
            ];
            
            var file_data = '';
            var successUrl = '';
            
            // Пробуем найти файл по всем вариантам путей
            for (var i = 0; i < variants.length; i++) {
                var xhr = new XMLHttpRequest();
                xhr.open('GET', variants[i], false); 
                xhr.overrideMimeType('text/plain; charset=utf-8');
                try {
                    xhr.send();
                    // Сервер по IPv4 может вернуть статус 200 (ОК) или 0 (если CORS/локалка)
                    if (xhr.status === 200 || xhr.status === 0) {
                        if (xhr.responseText) {
                            file_data = xhr.responseText;
                            successUrl = variants[i];
                            break; // Файл найден!
                        }
                    }
                } catch(e) { }
            }
            
            if (!file_data) {
                console.error('[RPG Fixes] 🔴 Сценарий не найден (404) ни в одном из форматов:', filename);
                return '';
            }
            
            console.log('[RPG Fixes] 🟢 Сценарий скачан:', successUrl);
            
            // Восстанавливаем логику TS_Decode.js для расшифровки текста!
            if (typeof PluginManager !== 'undefined') {
                var parameters = PluginManager.parameters('TS_Decode');
                var argTsDecodeDebug = eval(parameters['Decode'] || 'false');
                var argTsDecodeKey = parseInt(parameters['Key'] || '255');
                
                if (argTsDecodeDebug) {
                    var text_ary = file_data.split('');
                    for (var j = 0; j < text_ary.length; j++) {
                        text_ary[j] = String.fromCharCode(text_ary[j].charCodeAt(0) ^ argTsDecodeKey);
                    }
                    file_data = text_ary.join('');
                    console.log('[RPG Fixes] 🔓 Текст сценария успешно расшифрован!');
                }
            }
            
            return file_data;
        };
        console.log('[RPG Fixes] ADV_System.fileLoad + localFileDirectoryPath patched!');
    }, 10);
    setTimeout(function() { clearInterval(aggressiveAdvPatch); }, 15000);

    // ============================================================================
    // --- УЛЬТИМАТИВНЫЙ ФИКС ВИДЕО ДЛЯ IOS ---
    // ============================================================================

    // 1. Перехватываем само рождение видео-элемента (самый надежный способ для iPhone)
    const _origCreateElement = document.createElement;
    document.createElement = function(tagName, options) {
        const el = _origCreateElement.call(this, tagName, options);
        if (tagName && tagName.toLowerCase() === 'video') {
            // Намертво прибиваем атрибуты до того, как Safari о них узнает
            el.setAttribute('playsinline', 'playsinline');
            el.setAttribute('webkit-playsinline', 'playsinline');
            el.setAttribute('disablePictureInPicture', 'true');
            el.controls = false; // Отключаем элементы управления плеера
        }
        return el;
    };

    // 2. Запуск ролика. Движок включает ролик из игрового цикла, а не из касания, и iPhone
    //    отказывал ролику со звуком — rpg-fixes тогда имитировал конец, и ролик пропускался.
    //    Теперь ролик, начатый до первого касания, идёт без звука, а касание возвращает звук
    //    (unlockVideo в setupSecureAudio); после первого касания плеер играет со звуком сам
    const _originalVideoPlay = HTMLVideoElement.prototype.play;
    const mutedVideos = new Set();   // заглушены нами: звук им вернёт следующее касание
    HTMLVideoElement.prototype.play = function() {
        // Дублируем защиту на всякий случай
        this.setAttribute('playsinline', 'playsinline');
        this.setAttribute('webkit-playsinline', 'playsinline');

        const promise = _originalVideoPlay.apply(this, arguments);

        if (promise !== undefined) {
            promise.catch(error => {
                // Запуск прервали паузой или следующим роликом — это не отказ. Раньше и тут
                // имитировался конец, и мог оборваться уже следующий ролик
                if (error && error.name === 'AbortError') return;
                if (error && error.name === 'NotAllowedError' && !this.muted) {
                    this.muted = true;
                    mutedVideos.add(this);
                    const retry = _originalVideoPlay.call(this);
                    if (retry && retry.catch) retry.catch(() => this.dispatchEvent(new Event('ended')));
                    return;
                }
                console.warn('[RPG-Fixes] Видео не запустилось:', error);
                // Совсем не играет — имитируем конец, чтобы игра не зависла
                setTimeout(() => {
                    this.dispatchEvent(new Event('ended'));
                }, 100);
            });
        }
        return promise;
    };

    // 3. MV на телефонах всегда просит ролик в .mp4, а в сборках для Windows ролики только
    //    .webm — на iPhone каждый ролик MV упирался в 404 и пропускался. Safari играет WebM
    //    с iOS 17.4, так что просим .webm всегда, когда браузер его умеет. MZ так и делает сам
    let canWebm = false;
    try { canWebm = !!_origCreateElement.call(document, 'video').canPlayType('video/webm'); } catch (_) {}
    const videoExtTimer = setInterval(() => {
        if (typeof Game_Interpreter === 'undefined' || typeof Utils === 'undefined') return;
        clearInterval(videoExtTimer);
        if (Utils.RPGMAKER_NAME === 'MZ') return;
        Game_Interpreter.prototype.videoFileExt = () => (canWebm ? '.webm' : '.mp4');
    }, 50);
    setTimeout(() => clearInterval(videoExtTimer), 30000);

    // 4. Библиотека iphone-inline-video из MV нужна была iPhone до iOS 10, где видео внутри
    //    страницы не играло: она подменяет плееру play() и сама листает кадры. Старый iPhone
    //    она узнаёт по признаку, который есть только у Safari, — у любого другого браузера
    //    с iPhone в User-Agent она включается зря и ломает ролик. Где браузер играет видео
    //    внутри страницы сам, отключаем её
    if ('playsInline' in HTMLVideoElement.prototype) {
        const inlineVideoTimer = setInterval(() => {
            if (typeof window.makeVideoPlayableInline !== 'function') return;
            clearInterval(inlineVideoTimer);
            window.makeVideoPlayableInline = function() {};
        }, 20);
        setTimeout(() => clearInterval(inlineVideoTimer), 30000);
    }

   // ============================================================================
    // 🛡️ БРОНЯ ОТ ПОВРЕЖДЕННЫХ СЕЙВОВ И ОШИБОК ПЛАГИНОВ (V5 HYPER-SPEED)
    // ============================================================================
    const saveFixInterval = setInterval(() => {
        
        // 1. Лечим ядро StorageManager (global -> array). Пустой или повреждённый общий список
        //    сейвов, настройки и данные плагинов — не повод падать, подставляем пустые. А сами
        //    сейвы (file1, file2…) не трогаем: раньше повреждённый сейв тоже подменялся пустым
        //    объектом, игра «загружала» пустоту — $gameSystem и $gameParty пропадали, и дальше
        //    она падала. Без подмены MZ честно отвечает, что загрузить не удалось
        if (window.StorageManager && window.StorageManager.loadObject && !window.StorageManager.loadObject._isSafe) {
            const origLoad = window.StorageManager.loadObject;
            window.StorageManager.loadObject = function(saveName) {
                const loading = origLoad.apply(this, arguments);
                if (/^file\d+$/.test(saveName)) return loading;
                return loading.then(contents => {
                    if (saveName === 'global') return (contents && Array.isArray(contents)) ? contents : [];
                    return contents || {}; 
                }).catch(e => {
                    return saveName === 'global' ? [] : {};
                });
            };
            window.StorageManager.loadObject._isSafe = true;
            console.log('[RPG Fixes] 🛡️ Ядро StorageManager защищено (global -> array)');
        }

        // 2. Лечим плагин UTA_CommonSaveMZ
        if (window.utakata && window.utakata.CommonSave && !window.utakata.CommonSave._isSafe) {
            const origLoadS = window.utakata.CommonSave.loadCommonSaveSwitches;
            window.utakata.CommonSave.loadCommonSaveSwitches = function(contents) {
                if (!contents) return;
                return origLoadS.apply(this, arguments);
            };
            const origLoadV = window.utakata.CommonSave.loadCommonSaveVariables;
            window.utakata.CommonSave.loadCommonSaveVariables = function(contents) {
                if (!contents) return;
                return origLoadV.apply(this, arguments);
            };
            window.utakata.CommonSave._isSafe = true;
            console.log('[RPG Fixes] 🛡️ Плагин UTA_CommonSaveMZ вылечен');
        }

        // 3. Железобетонная защита от краша NUUN_SaveScreen (Восстанавливающийся щит)
        if (window.DataManager && window.DataManager.loadBackground && !window.DataManager.loadBackground._isSafe) {
            const origLoadBg = window.DataManager.loadBackground;
            window.DataManager.loadBackground = function(savefileId) {
                if (!this._globalInfo || !this._globalInfo[savefileId]) return null;
                try { return origLoadBg.apply(this, arguments); } catch(e) { return null; }
            };
            window.DataManager.loadBackground._isSafe = true;
            console.log('[RPG Fixes] 🛡️ DataManager.loadBackground (NUUN) вылечен');
        }

        // Патчим отрисовку фона. Метод фона берём в момент вызова, а не запоминаем:
        // щит встаёт раньше плагинов, и запомненный заранее метод меню обходил бы их
        // обёртки — экран сохранения из-за этого падал (плагин Drill
        // не находил фона, который создаёт его обёртка)
        if (window.Scene_File && window.Scene_File.prototype.createBackground && !window.Scene_File.prototype.createBackground._isSafe) {
            const ownBg = Object.prototype.hasOwnProperty.call(window.Scene_File.prototype, 'createBackground') ? window.Scene_File.prototype.createBackground : null;
            window.Scene_File.prototype.createBackground = function() {
                try {
                    (ownBg || Object.getPrototypeOf(window.Scene_File.prototype).createBackground).apply(this, arguments);
                } catch(e) {
                    console.warn('[RPG Fixes] 🛡️ Предотвращен краш фона меню сохранений:', e);
                    if (!this._backgroundSprite) {
                        this._backgroundSprite = new window.Sprite(); 
                        this.addChild(this._backgroundSprite);
                    }
                }
            };
            window.Scene_File.prototype.createBackground._isSafe = true;
            console.log('[RPG Fixes] 🛡️ Scene_File.createBackground защищен');
        }

        // 4. Шрифты MV: не ждать вечно шрифт, который не загрузится (нет файла, битый), и не
        //    бросать медленный. Раньше через секунду любой недогрузившийся шрифт считался
        //    «мёртвым»: а шрифт бывает весом 7,5 МБ, и на телефоне меню титула
        //    рисовалось запасным шрифтом. Теперь смотрим, что с ним на самом деле:
        //    загрузился — дальше, ошибка или его вовсе нет — дальше без него,
        //    грузится — ждём, но не дольше 20 секунд
        if (window.Graphics && typeof window.Graphics.isFontLoaded === 'function' && !window.Graphics._fontPatchActive) {
            const _origIsFontLoaded = window.Graphics.isFontLoaded;
            const fontWaitStart = Date.now();
            const skipped = new Set();
            const fontState = (name) => {
                const want = String(name).replace(/["']/g, '').toLowerCase();
                const faces = [];
                try {
                    document.fonts.forEach(f => { if (f.family.replace(/["']/g, '').toLowerCase() === want) faces.push(f); });
                } catch (_) { return 'unknown'; }
                if (!faces.length) return 'missing';
                if (faces.some(f => f.status === 'loaded')) return 'loaded';
                if (faces.every(f => f.status === 'error')) return 'error';
                // Объявлен, но никто его ещё не попросил — просим сами, иначе ждали бы зря
                faces.forEach(f => { if (f.status === 'unloaded') f.load().catch(() => {}); });
                return 'loading';
            };
            const skip = (name, why) => {
                if (!skipped.has(name)) {
                    skipped.add(name);
                    console.warn(`[RPG Fixes] 🛡️ Шрифт ${name}: ${why} — игра стартует без него`);
                }
                return true;
            };

            window.Graphics.isFontLoaded = function(name) {
                if (_origIsFontLoaded.apply(this, arguments)) return true;
                const state = fontState(name);
                if (state === 'loaded') return true;
                if (state === 'error') return skip(name, 'файл не загрузился');
                if (state === 'missing') return skip(name, 'игра его не объявила');
                if (Date.now() - fontWaitStart > 20000) return skip(name, 'не догрузился за 20 секунд');
                return false;
            };
            window.Graphics._fontPatchActive = true;
            console.log('[RPG Fixes] 🛡️ Защита шрифтов (MV) активирована');
        }

        // 5. Защита от вечной загрузки при пропавших шрифтах (Для новых игр MZ)
        if (window.FontManager && window.FontManager.startLoading && !window.FontManager._fontPatchActive) {
            const _origStartLoading = window.FontManager.startLoading;
            window.FontManager.startLoading = function(family, url) {
                const source = "url(" + url + ")";
                const font = new FontFace(family, source);
                this._urls[family] = url;
                this._states[family] = "loading";
                font.load()
                    .then(() => {
                        document.fonts.add(font);
                        this._states[family] = "loaded";
                    })
                    .catch((e) => {
                        console.warn(`[RPG Fixes] 🛡️ Пропущен сломанный шрифт: ${url}`);
                        this._states[family] = "loaded"; // Обманываем движок MZ
                    });
            };
            window.FontManager._fontPatchActive = true;
            console.log('[RPG Fixes] 🛡️ Защита от вечной загрузки шрифтов (MZ) активирована');
        }

    }, 5); // Часто — чтобы успеть до первого использования этих функций при загрузке игры
    // ...но только пока игра загружается. Раньше проверка крутилась 200 раз в секунду
    // до самого закрытия вкладки и не давала процессору телефона отдыхать. Всё, что
    // она латает, появляется при загрузке ядра и плагинов — за первые секунды
    setTimeout(() => clearInterval(saveFixInterval), 15000);

    // ============================================================================
    // 🛡️ БРОНЯ ОТ КРИВЫХ ПЛАГИНОВ (ГЛОБАЛЬНЫЙ ПАТЧ JSON.parse - ТИХИЙ РЕЖИМ)
    // ============================================================================
    if (!window._jsonPatchActive) {
        const _origJSONParse = JSON.parse;
        JSON.parse = function(text, reviver) {
            try {
                return _origJSONParse.apply(this, arguments);
            } catch (e) {
                if (typeof text === 'string') {
                    const trimmed = text.trim();
                    
                    // 1. Пустая строка — возвращаем её же, без ошибки: у плагинов с пустыми
                    //    параметрами JSON.parse('') иначе ронял игру при загрузке
                    if (trimmed === '') {
                        return text; 
                    }
                    
                    // 2. Спасаем математические формулы (типа "816 / 1000")
                    if (/^[\d\s\.\/\*\+\-\(\)]+$/.test(trimmed) && trimmed.length > 0) {
                        try {
                            const result = eval(trimmed);
                            console.warn(`[RPG Fixes] 🛡️ Спасен JSON (формула): "${text}" -> ${result}`);
                            return result;
                        } catch (err) {}
                    }
                }
                throw e; // Если это реально сломанный объект, кидаем ошибку дальше
            }
        };
        window._jsonPatchActive = true;
        console.log('[RPG Fixes] 🛡️ Глобальная защита JSON.parse активирована (Тихий режим)');
    }

    initUltimateFixes();

})();

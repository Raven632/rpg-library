// Чит-меню Mimikin — для игр RPG Maker MV и MZ. Открывается пунктом «Чит-меню» в меню ⚙ (rpg-fixes.js грузит этот
// файл при первом нажатии). Панель поверх игры: отряд (бессмертие, лечение, уровень, опыт, характеристики, деньги),
// предметы с поиском, переменные и переключатели, мир (скорость, сквозь стены, без случайных боёв, бой, телепорт).
// Сделано для пальца и мыши: касания и клавиши в панели до игры не доходят. Сохраняется только то, что игра
// сохраняет сама (деньги, предметы, переменные); бессмертие, скорость и прочие режимы — до перезапуска игры
(() => {
    if (window.__rpgCheats) return;

    const TEXT = {
        ru: {
            title: 'Чит-меню', close: 'Закрыть', not_started: 'Откроется, когда начнётся игра: на титульном экране ещё нет героев.',
            tab_party: 'Отряд', tab_items: 'Предметы', tab_vars: 'Переменные', tab_world: 'Мир',
            god: 'Бессмертие', god_all: 'Бессмертие всему отряду', god_hint: 'HP, MP и TP не убывают, герой не погибает',
            heal: 'Вылечить отряд', clear_states: 'Снять состояния', level: 'Уровень', exp: 'Опыт', stats: 'Характеристики',
            gold: 'Деньги', params: ['Макс. HP', 'Макс. MP', 'Атака', 'Защита', 'Маг. атака', 'Маг. защита', 'Ловкость', 'Удача'],
            kind_items: 'Предметы', kind_weapons: 'Оружие', kind_armors: 'Броня', search: 'Поиск по названию или номеру',
            have: 'есть', nothing: 'Ничего не нашлось', more: (n) => `и ещё ${n} — уточни поиск`,
            kind_vars: 'Переменные', kind_switches: 'Переключатели',
            speed: 'Скорость героя', speed_lock: 'Не сбрасывать (события её не меняют)', noclip: 'Сквозь стены', no_encounters: 'Без случайных боёв',
            battle: 'Бой', win: 'Победить сразу', enemy_one: 'Врагам 1 HP', not_in_battle: 'Сейчас не бой',
            teleport: 'Телепорт', map: 'Карта', go: 'Перенести', places: 'Запомненные места', remember: 'Запомнить', recall: 'Вернуться',
            empty_slot: 'пусто', only_map: 'Только на карте', done: 'Готово',
        },
        en: {
            title: 'Cheat menu', close: 'Close', not_started: 'Opens once the game has started: there are no heroes on the title screen yet.',
            tab_party: 'Party', tab_items: 'Items', tab_vars: 'Variables', tab_world: 'World',
            god: 'God mode', god_all: 'God mode for the whole party', god_hint: 'HP, MP and TP never drop, the hero cannot die',
            heal: 'Heal the party', clear_states: 'Clear states', level: 'Level', exp: 'EXP', stats: 'Stats',
            gold: 'Gold', params: ['Max HP', 'Max MP', 'Attack', 'Defense', 'M. Attack', 'M. Defense', 'Agility', 'Luck'],
            kind_items: 'Items', kind_weapons: 'Weapons', kind_armors: 'Armor', search: 'Search by name or number',
            have: 'have', nothing: 'Nothing found', more: (n) => `and ${n} more — narrow the search`,
            kind_vars: 'Variables', kind_switches: 'Switches',
            speed: 'Hero speed', speed_lock: 'Keep it (events cannot change it)', noclip: 'Walk through walls', no_encounters: 'No random battles',
            battle: 'Battle', win: 'Win now', enemy_one: 'Enemies to 1 HP', not_in_battle: 'Not in battle',
            teleport: 'Teleport', map: 'Map', go: 'Go', places: 'Saved places', remember: 'Remember', recall: 'Go back',
            empty_slot: 'empty', only_map: 'Only on the map', done: 'Done',
        },
        de: {
            title: 'Cheat-Menü', close: 'Schließen', not_started: 'Öffnet sich, sobald das Spiel begonnen hat: Auf dem Titelbildschirm gibt es noch keine Helden.',
            tab_party: 'Gruppe', tab_items: 'Gegenstände', tab_vars: 'Variablen', tab_world: 'Welt',
            god: 'Unsterblich', god_all: 'Ganze Gruppe unsterblich', god_hint: 'HP, MP und TP sinken nicht, der Held stirbt nicht',
            heal: 'Gruppe heilen', clear_states: 'Zustände entfernen', level: 'Stufe', exp: 'EP', stats: 'Werte',
            gold: 'Geld', params: ['Max. HP', 'Max. MP', 'Angriff', 'Verteidigung', 'Mag. Angriff', 'Mag. Abwehr', 'Agilität', 'Glück'],
            kind_items: 'Gegenstände', kind_weapons: 'Waffen', kind_armors: 'Rüstung', search: 'Nach Name oder Nummer suchen',
            have: 'hast', nothing: 'Nichts gefunden', more: (n) => `und ${n} weitere — Suche eingrenzen`,
            kind_vars: 'Variablen', kind_switches: 'Schalter',
            speed: 'Tempo des Helden', speed_lock: 'Beibehalten (Ereignisse ändern es nicht)', noclip: 'Durch Wände', no_encounters: 'Keine Zufallskämpfe',
            battle: 'Kampf', win: 'Sofort gewinnen', enemy_one: 'Gegner auf 1 HP', not_in_battle: 'Gerade kein Kampf',
            teleport: 'Teleport', map: 'Karte', go: 'Los', places: 'Gemerkte Orte', remember: 'Merken', recall: 'Zurück',
            empty_slot: 'leer', only_map: 'Nur auf der Karte', done: 'Erledigt',
        },
    };
    // Язык — тот же, что у меню ⚙ (rpg-fixes): из адреса (?lang=) или выбранный в библиотеке
    const LANG = (() => {
        let lang = null;
        try { lang = new URLSearchParams(location.search).get('lang'); } catch (e) { /* без адреса */ }
        if (!TEXT[lang]) try { lang = localStorage.getItem('rpg_lang'); } catch (e) { /* без хранилища */ }
        return TEXT[lang] ? lang : 'ru';
    })();
    const T = TEXT[LANG];
    const num = (n) => Number(n).toLocaleString(LANG);

    // ------------------------------------------------------------------------------------------------------------
    // Режимы, которые держатся, пока игра открыта: бессмертие, скорость, сквозь стены, без случайных боёв
    const mode = { god: new Set(), speed: 0, lockSpeed: false, noclip: false, noEncounters: false };
    let patched = false;
    function patchGame() {
        if (patched || typeof Game_BattlerBase === 'undefined') return;
        patched = true;
        const isGod = (b) => typeof Game_Actor !== 'undefined' && b instanceof Game_Actor && mode.god.has(b.actorId());
        const wrap = (proto, name, make) => { if (proto && typeof proto[name] === 'function') proto[name] = make(proto[name]); };
        // Любая потеря HP, MP и TP идёт через setHp/setMp/setTp — у бессмертного они не убывают. Перехват — у самого
        // героя (Game_Actor), поверх плагинов: они переопределяют setHp героя и зовут запомненную базовую функцию,
        // так что перехват у базового класса обошли бы
        const actor = typeof Game_Actor !== 'undefined' ? Game_Actor.prototype : null;
        wrap(actor, 'setHp', (orig) => function(v) { return orig.call(this, isGod(this) ? Math.max(v, this.mhp) : v); });
        wrap(actor, 'setMp', (orig) => function(v) { return orig.call(this, isGod(this) ? Math.max(v, this.mmp) : v); });
        wrap(actor, 'setTp', (orig) => function(v) { return orig.call(this, isGod(this) ? Math.max(v, this.maxTp()) : v); });
        // Смерть — состояние: бессмертному его не дать
        wrap(actor, 'addState', (orig) => function(id) {
            if (isGod(this) && id === this.deathStateId()) return undefined;
            return orig.apply(this, arguments);
        });
        if (typeof Game_Player !== 'undefined') {
            wrap(Game_Player.prototype, 'setMoveSpeed', (orig) => function(v) { return orig.call(this, mode.lockSpeed && mode.speed ? mode.speed : v); });
            wrap(Game_Player.prototype, 'isThrough', (orig) => function() { return mode.noclip || orig.apply(this, arguments); });
            wrap(Game_Player.prototype, 'canEncounter', (orig) => function() { return !mode.noEncounters && orig.apply(this, arguments); });
        }
    }

    const started = () => typeof $gameParty !== 'undefined' && $gameParty && typeof $gameParty.members === 'function' && $gameParty.members().length > 0;
    // Название без кодов игры («\I[12]Зелье» → «Зелье»)
    const plain = (s) => String(s || '').replace(/\\[A-Za-z]+\[[^\]]*\]|\\[A-Za-z{}|.!<>^$]/g, '').trim();

    // Действия — отдельно от панели: их проверяют тесты (server.test.js), без страницы
    const actions = {
        setGod(actor, on) {
            patchGame();
            if (on) mode.god.add(actor.actorId()); else mode.god.delete(actor.actorId());
            if (on) actor.recoverAll();
        },
        isGod: (actor) => mode.god.has(actor.actorId()),
        heal() { for (const a of $gameParty.members()) { a.recoverAll(); a.refresh(); } },
        clearStates() { for (const a of $gameParty.members()) { a.clearStates(); a.refresh(); } },
        level(actor, delta) {
            const max = typeof actor.maxLevel === 'function' ? actor.maxLevel() : 99;
            actor.changeLevel(Math.max(1, Math.min(max, actor.level + delta)), false);
            actor.refresh();
        },
        exp(actor, amount) { actor.changeExp(Math.max(0, actor.currentExp() + amount), false); actor.refresh(); },
        param(actor, id, delta) { actor.addParam(id, delta); actor.refresh(); },
        gold(delta) { if (delta >= 0) $gameParty.gainGold(delta); else $gameParty.loseGold(-delta); },
        give(item, n) { $gameParty.gainItem(item, n, false); },
        setVariable(id, value) {
            const v = typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value)) ? Number(value) : value;
            $gameVariables.setValue(id, v);
        },
        toggleSwitch(id) { $gameSwitches.setValue(id, !$gameSwitches.value(id)); },
        speed(v) {
            patchGame();
            mode.speed = v;
            if (typeof $gamePlayer !== 'undefined' && $gamePlayer) $gamePlayer.setMoveSpeed(v);
        },
        lockSpeed(on) { patchGame(); mode.lockSpeed = on; },
        noclip(on) { patchGame(); mode.noclip = on; },
        noEncounters(on) { patchGame(); mode.noEncounters = on; },
        // Бой: врагам — 0 HP (и падают, как от удара) или 1 HP. Победу засчитает сам движок на следующем кадре
        win() {
            for (const e of $gameTroop.aliveMembers()) {
                e.setHp(0);
                e.refresh();
                if (e.isDead() && typeof e.performCollapse === 'function') e.performCollapse();
            }
        },
        enemiesToOne() { for (const e of $gameTroop.aliveMembers()) { e.setHp(1); e.refresh(); } },
        teleport(mapId, x, y) {
            $gamePlayer.reserveTransfer(mapId, x, y, $gamePlayer.direction(), 0);
            if (typeof $gameTemp !== 'undefined' && $gameTemp.clearDestination) $gameTemp.clearDestination();
        },
        mode,
    };

    // Запомненные места — на эту игру, в браузере
    const placesKey = () => `rpgCheatsPlaces_${(window.__RPG && window.__RPG.id) || location.pathname}`;
    const loadPlaces = () => { try { return JSON.parse(localStorage.getItem(placesKey()) || '[]') || []; } catch (e) { return []; } };
    const savePlaces = (list) => { try { localStorage.setItem(placesKey(), JSON.stringify(list)); } catch (e) { /* без хранилища — до перезапуска */ } };

    // ------------------------------------------------------------------------------------------------------------
    // Панель
    const CSS = `
        #_cheats { position: fixed; z-index: 2147483647; top: max(12px, env(safe-area-inset-top)); right: max(12px, env(safe-area-inset-right));
            width: min(380px, calc(100vw - 24px)); max-height: calc(100vh - 24px); max-height: calc(100dvh - 24px); display: flex; flex-direction: column;
            border-radius: 14px; background: rgba(14,14,18,0.94); border: 1px solid rgba(217,180,94,0.35); box-shadow: 0 16px 40px rgba(0,0,0,0.55);
            -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); color: rgba(255,255,255,0.92); font: 500 14px/1.35 system-ui, -apple-system, 'Segoe UI', sans-serif;
            touch-action: pan-y; -webkit-user-select: none; user-select: none; }
        #_cheats * { box-sizing: border-box; }
        #_cheats ._ch_head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 12px 6px; }
        #_cheats ._ch_title { color: #d9b45e; font-weight: 600; font-size: 15px; letter-spacing: .02em; }
        #_cheats ._ch_x { width: 32px; height: 32px; border-radius: 50%; border: 1px solid rgba(255,255,255,0.18); background: transparent; color: inherit; font-size: 18px; line-height: 1; cursor: pointer; }
        #_cheats ._ch_tabs, #_cheats ._ch_chips { display: flex; gap: 6px; flex-wrap: wrap; }
        #_cheats ._ch_tabs { padding: 0 12px 8px; border-bottom: 1px solid rgba(255,255,255,0.08); }
        #_cheats ._ch_body { overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 12px; }
        #_cheats ._ch_chip, #_cheats ._ch_btn { min-height: 32px; padding: 5px 11px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.18); background: transparent; color: inherit; font: inherit; cursor: pointer; white-space: nowrap; }
        #_cheats ._ch_chip._on { border-color: #d9b45e; color: #d9b45e; background: rgba(217,180,94,0.1); }
        #_cheats ._ch_btn { border-radius: 9px; border-color: rgba(217,180,94,0.45); }
        #_cheats ._ch_btn:disabled { opacity: .4; cursor: default; }
        #_cheats ._ch_btn:active:not(:disabled), #_cheats ._ch_chip:active { background: rgba(217,180,94,0.18); }
        #_cheats ._ch_sec { display: flex; flex-direction: column; gap: 6px; }
        #_cheats ._ch_label { color: rgba(255,255,255,0.55); font-size: 12px; text-transform: none; }
        #_cheats ._ch_row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        #_cheats ._ch_grow { flex: 1 1 auto; min-width: 0; }
        #_cheats ._ch_dim { color: rgba(255,255,255,0.55); font-size: 12px; }
        #_cheats ._ch_val { min-width: 48px; text-align: center; font-variant-numeric: tabular-nums; }
        #_cheats input[type=text], #_cheats input[type=number], #_cheats select { min-height: 32px; padding: 5px 8px; border-radius: 9px; border: 1px solid rgba(255,255,255,0.18);
            background: rgba(0,0,0,0.35); color: inherit; font: inherit; -webkit-user-select: text; user-select: text; min-width: 0; }
        #_cheats input:focus, #_cheats select:focus { outline: none; border-color: #d9b45e; }
        #_cheats ._ch_toggle { display: flex; align-items: center; gap: 10px; width: 100%; padding: 6px 0; border: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
        #_cheats ._ch_sw { position: relative; flex-shrink: 0; width: 30px; height: 18px; border-radius: 9px; background: rgba(255,255,255,0.16); }
        #_cheats ._ch_sw::after { content: ''; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: rgba(255,255,255,0.75); transition: transform .15s; }
        #_cheats ._ch_toggle._on ._ch_sw { background: #d9b45e; }
        #_cheats ._ch_toggle._on ._ch_sw::after { transform: translateX(12px); background: #fff; }
        #_cheats ._ch_list { display: flex; flex-direction: column; gap: 2px; }
        #_cheats ._ch_item { display: flex; align-items: center; gap: 6px; padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
        #_cheats ._ch_item ._ch_btn { min-height: 28px; padding: 3px 9px; }
        #_cheats ._ch_item input { width: 96px; }
        #_cheats ._ch_note { color: #d9b45e; font-size: 12px; min-height: 16px; padding: 0 12px 8px; }
        @media (max-height: 500px) { #_cheats { width: min(460px, calc(100vw - 24px)); } }
    `;

    let root = null;
    let body = null;
    let note = null;
    let tab = 'party';
    const state = { actor: 0, param: 0, step: 10, goldStep: 1000, itemKind: 'items', itemQuery: '', varKind: 'vars', varQuery: '', expStep: 1000 };

    const el = (tag, props = {}, kids = []) => {
        const node = document.createElement(tag);
        for (const [k, v] of Object.entries(props)) {
            if (k === 'class') node.className = v;
            else if (k === 'text') node.textContent = v;
            else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
            else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? '' : v);
        }
        for (const kid of [].concat(kids)) if (kid) node.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
        return node;
    };
    const flash = (msg) => {
        if (!note) return;
        note.textContent = msg;
        clearTimeout(flash.t);
        flash.t = setTimeout(() => { if (note) note.textContent = ''; }, 2500);
    };
    // Действие → перерисовать вкладку и показать «Готово» (или ошибку — в игре бывает всякое)
    const act = (fn, msg = T.done) => () => {
        try { fn(); flash(msg); } catch (e) { flash(String(e && e.message || e)); }
        render();
    };
    const btn = (label, fn, opts = {}) => el('button', { type: 'button', class: '_ch_btn', disabled: opts.disabled, title: opts.title, onclick: act(fn, opts.msg) }, label);
    const chips = (items, current, onPick) => el('div', { class: '_ch_chips' }, items.map(([key, label]) =>
        el('button', { type: 'button', class: `_ch_chip${key === current ? ' _on' : ''}`, onclick: () => { onPick(key); render(); } }, label)));
    const toggle = (label, on, fn, hint) => el('button', { type: 'button', class: `_ch_toggle${on ? ' _on' : ''}`, title: hint, onclick: act(() => fn(!on)) },
        [el('span', { class: '_ch_sw' }), el('span', { class: '_ch_grow' }, label)]);
    // Числа, которые меняет сама игра (HP, деньги), — обновляются на месте, без перерисовки вкладки: перерисовка
    // между касанием и отпусканием пальца съела бы нажатие кнопки
    let lives = [];
    const live = (node, text) => { node.textContent = text(); lives.push([node, text]); return node; };
    const section = (label, kids) => el('div', { class: '_ch_sec' }, [label ? el('div', { class: '_ch_label' }, label) : null, ...kids]);
    const row = (kids) => el('div', { class: '_ch_row' }, kids);

    function partyTab() {
        const members = $gameParty.members();
        const actor = members[Math.min(state.actor, members.length - 1)];
        const out = [];
        out.push(chips(members.map((a, i) => [i, plain(a.name()) || `#${a.actorId()}`]), members.indexOf(actor), (i) => { state.actor = i; }));
        out.push(live(el('div', { class: '_ch_dim' }), () => `${T.level} ${actor.level} · HP ${actor.hp}/${actor.mhp} · MP ${actor.mp}/${actor.mmp}`));
        const allGod = members.every((a) => actions.isGod(a));
        out.push(section(null, [
            toggle(`${T.god}: ${plain(actor.name())}`, actions.isGod(actor), (on) => actions.setGod(actor, on), T.god_hint),
            toggle(T.god_all, allGod, (on) => members.forEach((a) => actions.setGod(a, on)), T.god_hint),
            row([btn(T.heal, actions.heal), btn(T.clear_states, actions.clearStates)]),
        ]));
        out.push(section(T.level, [row([btn('−1', () => actions.level(actor, -1)), el('span', { class: '_ch_val' }, String(actor.level)), btn('+1', () => actions.level(actor, 1)), btn('+10', () => actions.level(actor, 10))])]));
        out.push(section(T.exp, [row([
            chips([100, 1000, 10000].map((v) => [v, num(v)]), state.expStep, (v) => { state.expStep = v; }),
            btn(`+${num(state.expStep)}`, () => actions.exp(actor, state.expStep)),
        ])]));
        const select = el('select', { onchange: (e) => { state.param = Number(e.target.value); render(); } },
            T.params.map((p, i) => el('option', { value: i, selected: i === state.param }, `${p}: ${actor.param(i)}`)));
        out.push(section(T.stats, [
            row([select]),
            row([chips([[1, '1'], [10, '10'], [100, '100']], state.step, (v) => { state.step = v; }),
                btn(`−${state.step}`, () => actions.param(actor, state.param, -state.step)), btn(`+${state.step}`, () => actions.param(actor, state.param, state.step))]),
        ]));
        out.push(section(null, [live(el('div', { class: '_ch_label' }), () => `${T.gold}: ${num($gameParty.gold())}`), row([
            chips([100, 1000, 100000].map((v) => [v, num(v)]), state.goldStep, (v) => { state.goldStep = v; }),
            btn(`−${num(state.goldStep)}`, () => actions.gold(-state.goldStep)), btn(`+${num(state.goldStep)}`, () => actions.gold(state.goldStep)),
        ])]));
        return out;
    }

    // Поле поиска: перерисовываем только список под ним, иначе поле теряло бы фокус на каждой букве
    function searchList(value, onInput, fill) {
        const list = el('div', { class: '_ch_list' });
        const input = el('input', { type: 'text', value, placeholder: T.search, 'aria-label': T.search, enterkeyhint: 'search',
            oninput: (e) => { onInput(e.target.value); list.replaceChildren(...fill()); } });
        list.replaceChildren(...fill());
        return [input, list];
    }
    const matches = (query, id, name) => {
        const q = query.trim().toLowerCase();
        return !q || String(id) === q || name.toLowerCase().includes(q);
    };
    const LIMIT = 60;

    function itemsTab() {
        const data = { items: typeof $dataItems !== 'undefined' ? $dataItems : [], weapons: typeof $dataWeapons !== 'undefined' ? $dataWeapons : [], armors: typeof $dataArmors !== 'undefined' ? $dataArmors : [] };
        const fill = () => {
            const found = (data[state.itemKind] || []).filter((it) => it && plain(it.name) && matches(state.itemQuery, it.id, plain(it.name)));
            if (!found.length) return [el('div', { class: '_ch_dim' }, T.nothing)];
            const rows = found.slice(0, LIMIT).map((it) => {
                const count = el('span', { class: '_ch_dim' }, `${T.have} ${$gameParty.numItems(it)}`);
                const give = (n) => el('button', { type: 'button', class: '_ch_btn', onclick: () => {
                    try { actions.give(it, n); count.textContent = `${T.have} ${$gameParty.numItems(it)}`; flash(T.done); } catch (e) { flash(String(e.message || e)); }
                } }, n > 0 ? `+${n}` : String(n));
                return el('div', { class: '_ch_item' }, [el('span', { class: '_ch_grow' }, `${it.id}. ${plain(it.name)}`), count, give(-1), give(1), give(10)]);
            });
            if (found.length > LIMIT) rows.push(el('div', { class: '_ch_dim' }, T.more(found.length - LIMIT)));
            return rows;
        };
        return [chips([['items', T.kind_items], ['weapons', T.kind_weapons], ['armors', T.kind_armors]], state.itemKind, (k) => { state.itemKind = k; }),
            ...searchList(state.itemQuery, (v) => { state.itemQuery = v; }, fill)];
    }

    function varsTab() {
        const names = state.varKind === 'vars' ? $dataSystem.variables : $dataSystem.switches;
        const fill = () => {
            const found = [];
            for (let id = 1; id < (names || []).length; id++) {
                const name = plain(names[id]);
                if ((name || state.varQuery.trim()) && matches(state.varQuery, id, name)) found.push([id, name]);
            }
            if (!found.length) return [el('div', { class: '_ch_dim' }, T.nothing)];
            const rows = found.slice(0, LIMIT).map(([id, name]) => {
                if (state.varKind === 'switches') {
                    return el('div', { class: '_ch_item' }, [toggle(`${id}. ${name || '—'}`, !!$gameSwitches.value(id), () => actions.toggleSwitch(id))]);
                }
                const label = el('span', { class: '_ch_grow' }, `${id}. ${name || '—'}`);
                const input = el('input', { type: 'text', value: String($gameVariables.value(id)), 'aria-label': `${id}. ${name}`,
                    onchange: (e) => { try { actions.setVariable(id, e.target.value); flash(T.done); } catch (err) { flash(String(err.message || err)); } },
                    onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); } });
                return el('div', { class: '_ch_item' }, [label, input]);
            });
            if (found.length > LIMIT) rows.push(el('div', { class: '_ch_dim' }, T.more(found.length - LIMIT)));
            return rows;
        };
        return [chips([['vars', T.kind_vars], ['switches', T.kind_switches]], state.varKind, (k) => { state.varKind = k; state.varQuery = ''; }),
            ...searchList(state.varQuery, (v) => { state.varQuery = v; }, fill)];
    }

    function worldTab() {
        const out = [];
        const speed = mode.speed || ($gamePlayer && $gamePlayer.moveSpeed ? $gamePlayer.moveSpeed() : 4);
        out.push(section(`${T.speed}: ${num(speed)}`, [
            chips([[3, '3'], [4, '4'], [5, '5'], [6, '6']], speed, (v) => actions.speed(v)),
            toggle(T.speed_lock, mode.lockSpeed, (on) => { if (on && !mode.speed) actions.speed(speed); actions.lockSpeed(on); }),
        ]));
        out.push(section(null, [toggle(T.noclip, mode.noclip, actions.noclip), toggle(T.no_encounters, mode.noEncounters, actions.noEncounters)]));
        const inBattle = $gameParty.inBattle();
        out.push(section(T.battle, [row([btn(T.win, actions.win, { disabled: !inBattle }), btn(T.enemy_one, actions.enemiesToOne, { disabled: !inBattle }),
            inBattle ? null : el('span', { class: '_ch_dim' }, T.not_in_battle)])]));
        // Телепорт: карта по названию, клетка — по умолчанию та, где стоит герой
        const onMap = typeof SceneManager !== 'undefined' && typeof Scene_Map !== 'undefined' && SceneManager._scene instanceof Scene_Map;
        const infos = (typeof $dataMapInfos !== 'undefined' ? $dataMapInfos : []).filter(Boolean);
        const mapName = (id) => { const m = infos.find((x) => x.id === id); return m ? plain(m.name) : `#${id}`; };
        const here = $gameMap.mapId();
        const mapSel = el('select', { 'aria-label': T.map, class: '_ch_grow' }, infos.map((m) => el('option', { value: m.id, selected: m.id === here }, `${m.id}. ${plain(m.name)}`)));
        const xIn = el('input', { type: 'number', value: $gamePlayer.x, min: 0, 'aria-label': 'X', style: 'width: 64px' });
        const yIn = el('input', { type: 'number', value: $gamePlayer.y, min: 0, 'aria-label': 'Y', style: 'width: 64px' });
        out.push(section(T.teleport, [row([mapSel]), row([xIn, yIn, btn(T.go, () => { actions.teleport(Number(mapSel.value), Number(xIn.value) || 0, Number(yIn.value) || 0); close(); },
            { disabled: !onMap || !infos.length, title: onMap ? '' : T.only_map })])]));
        const places = loadPlaces();
        out.push(section(T.places, [0, 1, 2].map((i) => {
            const p = places[i];
            return row([el('span', { class: '_ch_grow _ch_dim' }, p ? `${mapName(p.m)} (${p.x}, ${p.y})` : T.empty_slot),
                btn(T.remember, () => { const list = loadPlaces(); list[i] = { m: $gameMap.mapId(), x: $gamePlayer.x, y: $gamePlayer.y }; savePlaces(list); }, { disabled: !onMap }),
                btn(T.recall, () => { actions.teleport(p.m, p.x, p.y); close(); }, { disabled: !p || !onMap, title: onMap ? '' : T.only_map })]);
        })));
        return out;
    }

    function render() {
        if (!root) return;
        root.querySelectorAll('._ch_tabs ._ch_chip').forEach((b) => b.classList.toggle('_on', b.dataset.tab === tab));
        lives = [];
        let kids;
        if (!started()) kids = [el('div', { class: '_ch_dim' }, T.not_started)];
        else {
            try {
                kids = { party: partyTab, items: itemsTab, vars: varsTab, world: worldTab }[tab]();
            } catch (e) {
                kids = [el('div', { class: '_ch_dim' }, String(e && e.message || e))];
            }
        }
        const scroll = body.scrollTop;
        body.replaceChildren(...kids);
        body.scrollTop = scroll;
    }

    function build() {
        const style = el('style', { id: '_cheats_css' }, CSS);
        document.head.appendChild(style);
        root = el('div', { id: '_cheats', role: 'dialog', 'aria-label': T.title });
        const head = el('div', { class: '_ch_head' }, [el('span', { class: '_ch_title' }, T.title),
            el('button', { type: 'button', class: '_ch_x', 'aria-label': T.close, title: T.close, onclick: close }, '×')]);
        const tabs = el('div', { class: '_ch_tabs', role: 'tablist' }, [['party', T.tab_party], ['items', T.tab_items], ['vars', T.tab_vars], ['world', T.tab_world]]
            .map(([key, label]) => el('button', { type: 'button', role: 'tab', class: '_ch_chip', 'data-tab': key, onclick: () => { tab = key; body.scrollTop = 0; render(); } }, label)));
        body = el('div', { class: '_ch_body' });
        note = el('div', { class: '_ch_note', 'aria-live': 'polite' });
        root.append(head, tabs, body, note);
        // Клавиши и касания в панели — только ей: игра слушает документ и приняла бы буквы поиска за управление,
        // а касание — за шаг героя. Escape закрывает панель
        for (const type of ['keydown', 'keyup', 'keypress']) root.addEventListener(type, (e) => e.stopPropagation());
        for (const type of ['mousedown', 'mouseup', 'mousemove', 'touchstart', 'touchmove', 'touchend', 'pointerdown', 'pointerup', 'pointermove', 'wheel', 'click', 'contextmenu']) {
            root.addEventListener(type, (e) => e.stopPropagation(), { passive: true });
        }
        document.body.appendChild(root);
    }

    let timer = null;
    // Escape закрывает панель, где бы ни был фокус (щёлкнули по панели мимо поля — фокус на странице), и до игры
    // не доходит: там он открыл бы меню
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && window.__rpgCheatsOpen) { close(); e.preventDefault(); e.stopPropagation(); }
    }, true);
    function open() {
        if (!root) build();
        // Клавиша, зажатая в игре до щелчка по панели, не залипает: её отпускание панель до игры не пустит
        try { if (typeof Input !== 'undefined' && Input.clear) Input.clear(); } catch (e) { /* без сброса */ }
        root.style.display = '';
        window.__rpgCheatsOpen = true;
        render();
        // Значения отряда и денег меняются в игре — освежаем, пока в панели ничего не печатают
        clearInterval(timer);
        timer = setInterval(() => {
            for (const [node, text] of lives) { try { node.textContent = text(); } catch (e) { /* игра сменила сцену */ } }
        }, 1000);
    }
    function close() {
        if (!root) return;
        root.style.display = 'none';
        window.__rpgCheatsOpen = false;
        clearInterval(timer);
        if (root.contains(document.activeElement)) document.activeElement.blur();
    }
    const toggleOpen = () => (root && root.style.display !== 'none' ? close() : open());

    window.__rpgCheats = { open, close, toggle: toggleOpen, actions };
})();

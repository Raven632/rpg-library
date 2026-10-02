import { useState, useEffect, useMemo, useRef, lazy, Suspense } from 'react'
import { io } from 'socket.io-client'
import Header from './components/Header'
import Toolbar from './components/Toolbar'
import GameCard from './components/GameCard'
import GameModal from './components/GameModal'
// Редкие окна — отдельными кусками: грузятся при первом открытии, а не вместе со страницей
const LoginModal = lazy(() => import('./components/LoginModal'))
import Toast from './components/Toast'
import { locales } from './components/locales'
import StorageMonitor from './components/StorageMonitor';
import ContinueCard from './components/ContinueCard';
const LibraryModal = lazy(() => import('./components/LibraryModal'));
const TelegramModal = lazy(() => import('./components/TelegramModal'));
import GameFrame from './components/GameFrame';
const PlayPicker = lazy(() => import('./components/PlayPicker'));
import { launchGame } from './launchGame';
import { IconStats, IconUpload, IconNews, IconDownload, IconSend, IconDice } from './components/icons';
import { effectiveStatus } from './gameStatus';
import StatusChips from './components/StatusChips';
const Catalog = lazy(() => import('./components/Catalog'));
import { languageKey } from './formatLanguage';

const socket = io();

function App() {
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lang, setLang] = useState(localStorage.getItem('rpg_lang') || 'ru');
  // Скрытие обложек: помним выбор между заходами, как и язык
  const [blurCovers, setBlurCovers] = useState(() => localStorage.getItem('rpg_blur') === '1');
  // Окно «Статистика и ревизия»: null — закрыто, иначе открытая вкладка
  const [libraryTab, setLibraryTab] = useState(null);
  const [telegramOpen, setTelegramOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const closePicker = useMemo(() => () => setPickerOpen(false), []);
  // Игра в рамке на весь экран (launchGame → событие rpg-play): { game, url, origin }
  const [playing, setPlaying] = useState(null);
  useEffect(() => {
    const onPlay = (e) => setPlaying(e.detail);
    window.addEventListener('rpg-play', onPlay);
    return () => window.removeEventListener('rpg-play', onPlay);
  }, []);
  // Стабильная функция: окно Telegram подписывается на сокет в эффекте с ней в зависимостях
  const closeTelegram = useMemo(() => () => setTelegramOpen(false), []);
  // Окно «Новинки игр» (itch.io) со списком «Хочу поиграть» — отложенными оттуда играми
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [wishlist, setWishlist] = useState({ items: [] });
  // Сколько игр ещё ждёт сбора метаданных — приходит с сервера по сокету
  const [scrapeLeft, setScrapeLeft] = useState(0);
  
  useEffect(() => {
    localStorage.setItem('rpg_lang', lang);
  }, [lang]);
  
  useEffect(() => {
    localStorage.setItem('rpg_blur', blurCovers ? '1' : '0');
  }, [blurCovers]);

  const t = locales[lang] || locales['ru'];
  // Обработчики сокета заводятся один раз, а язык могут сменить потом
  const tRef = useRef(t);
  useEffect(() => { tRef.current = t; }, [t]);

  const [searchQuery, setSearchQuery] = useState(() => sessionStorage.getItem('rpg_search') || '');
  const [selectedTag, setSelectedTag] = useState(() => sessionStorage.getItem('rpg_tag') || 'all');
  const [currentSort, setCurrentSort] = useState(() => sessionStorage.getItem('rpg_sort') || 'newest');
  // «Избранное» убрано — сохранённый с тех пор фильтр по нему становится «Все»
  const [statusFilter, setStatusFilter] = useState(() => {
    const saved = sessionStorage.getItem('rpg_status');
    return saved && saved !== 'fav' ? saved : 'all';
  });
  // Язык по тексту самой игры: «всё, во что можно играть на русском» — одним выбором
  const [langFilter, setLangFilter] = useState(() => sessionStorage.getItem('rpg_langf') || 'all');

  useEffect(() => {
    sessionStorage.setItem('rpg_search', searchQuery);
    sessionStorage.setItem('rpg_tag', selectedTag);
    sessionStorage.setItem('rpg_sort', currentSort);
    sessionStorage.setItem('rpg_status', statusFilter);
    sessionStorage.setItem('rpg_langf', langFilter);
  }, [searchQuery, selectedTag, currentSort, statusFilter, langFilter]);

  const filtersActive = !!searchQuery || selectedTag !== 'all' || statusFilter !== 'all' || langFilter !== 'all';
  const resetFilters = () => {
    setSearchQuery('');
    setSelectedTag('all');
    setStatusFilter('all');
    setLangFilter('all');
  };

  // Кнопку «Добавить игру» на телефоне убрали в меню, а сама загрузка живёт в панели:
  // панель кладёт сюда функцию, которая открывает выбор файла
  const openUploadRef = useRef(null);

  const [selectedGame, setSelectedGame] = useState(null);
  const [authMode, setAuthMode] = useState(null);
    // Вошёл ли пользователь: виджеты, которым нужен вход (StorageMonitor), показываем только после него
  const [isAuthed, setIsAuthed] = useState(false);

  // --- ЛЕНИВАЯ ЗАГРУЗКА (PAGINATION) ---
  const [page, setPage] = useState(1);
  const itemsPerPage = 24;
  const loaderRef = useRef(null);

  // Сбрасываем страницу на первую при любом изменении фильтров
  useEffect(() => {
    setPage(1);
  }, [searchQuery, selectedTag, currentSort, statusFilter, langFilter]);

  const [toast, setToast] = useState({ message: '', type: 'success', visible: false });
  const toastTimerRef = useRef(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type, visible: true });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToast(prev => ({ ...prev, visible: false }));
    }, 4000);
  };

  // «Хочу поиграть»: отложенные из новинок игры и число непросмотренных новостей
  const fetchWishlist = async () => {
    try {
      const res = await fetch('/api/wishlist');
      if (res.ok) setWishlist(await res.json());
    } catch { /* подтянется со следующим событием сервера */ }
  };

  // Из игры вернулись: наигранное время и прогресс поменялись
  const closeGame = () => {
    setPlaying(null);
    fetchGames({ silent: true });
  };

  // Сейвы, которые игра на адресе библиотеки (до сервера игр) не успела отправить без сети, лежат
  // в хранилище этого адреса, а игры теперь на другом — туда их не увидят. Досылаем отсюда: сервер
  // сам решит, чей сейв новее, и старый не затрёт. Имя игры в ключе бывает прежним, «исправленным»
  useEffect(() => {
    if (!games.length) return;
    const legacy = (id) => id.replace(/[^a-zA-Z0-9._\-а-яА-Я]/g, '_');
    const byName = new Map();
    for (const g of games) { byName.set(g.id, g.id); if (!byName.has(legacy(g.id))) byName.set(legacy(g.id), g.id); }
    let keys = [];
    try { keys = Object.keys(localStorage).filter((k) => k.startsWith('_rpg_offline_queue_')); } catch { return; }
    for (const storageKey of keys) {
      const id = byName.get(storageKey.slice('_rpg_offline_queue_'.length));
      let queue = null;
      try { queue = JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch { /* битая — пропускаем */ }
      if (!id || !queue || typeof queue !== 'object') continue;
      Promise.all(Object.entries(queue).map(([key, payload]) => fetch(`/api/saves/${encodeURIComponent(id)}/${encodeURIComponent(key)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      }).then((r) => { if (!r.ok) throw new Error(r.status); })))
        .then(() => localStorage.removeItem(storageKey))
        .catch(() => { /* попробуем при следующем открытии */ });
    }
  }, [games.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // Страницу открыли с «?play=<игра>» (обновили её во время игры) — открыть игру снова, когда список
  // загрузится. Ключ игры выдаётся заново: старый адрес рамки после выхода из библиотеки не годится
  const playParamRef = useRef(new URLSearchParams(window.location.search).get('play'));
  useEffect(() => {
    const id = playParamRef.current;
    if (!id || !games.length) return;
    playParamRef.current = null;
    // Сам «?play=» из адреса убираем: рамка поставит его заново, а выход из игры вернёт чистый адрес
    const params = new URLSearchParams(window.location.search);
    params.delete('play');
    window.history.replaceState(null, '', `${window.location.pathname}${params.size ? `?${params}` : ''}`);
    const game = games.find((g) => g.id === id);
    if (game) launchGame(game).catch(() => {});
  }, [games]);

  const fetchGames = async ({ silent = false } = {}) => {
    // Тихое обновление — без индикатора: данные приехали сами, пользователь ничего не ждёт
    if (!silent) setLoading(true);
    try {
      const statusRes = await fetch('/api/setup/status');
      const statusData = await statusRes.json();

      if (!statusData.initialized) {
        setAuthMode('setup');
        setIsAuthed(false);
        setLoading(false);
        return;
      }

      const response = await fetch('/api/games');
      if (response.status === 401) {
        setAuthMode('login');
        setIsAuthed(false);
        setLoading(false);
        return;
      }

      const data = await response.json();
      setGames(data);
      // Игру могли изменить или удалить с другого устройства, пока окно открыто
      setSelectedGame(prev => {
        if (!prev) return null;
        const fresh = data.find(g => g.id === prev.game.id);
        return fresh ? { ...prev, game: fresh } : null;
      });
      setAuthMode(null);
      setIsAuthed(true);
      // «Хочу поиграть» — вместе с играми: и после входа, и когда вкладку снова открыли
      fetchWishlist();
    } catch (error) {
      console.error("Ошибка загрузки игр:", error);
    } finally {
      setLoading(false);
    }
  };

  // События от сервера прилетают пачкой: игра добавлена, посчитан размер, найдены теги.
  // Обновляем список один раз, через 800 мс после последнего события.
  const refetchTimer = useRef(null);
  const scheduleRefetch = () => {
    clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(() => fetchGames({ silent: true }), 800);
  };

  useEffect(() => {
    fetchGames();
    socket.on('scrape-success', (data) => {
      showToast(data.message, 'success');
      scheduleRefetch();
    });

    // Кто-то изменил библиотеку с другого устройства — тихо подтягиваем список
    socket.on('library-changed', () => scheduleRefetch());
    socket.on('scrape-progress', ({ left }) => setScrapeLeft(left));

    // Список «Хочу поиграть» поменяли на другом устройстве
    socket.on('wishlist-changed', () => fetchWishlist());

    const handleVisibilityChange = () => {
      if (!document.hidden) fetchGames({ silent: true });
    };
    const handlePageShow = (event) => {
      if (event.persisted) fetchGames({ silent: true });
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pageshow', handlePageShow);

    return () => {
      clearTimeout(refetchTimer.current);
      socket.off('scrape-success');
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pageshow', handlePageShow);
      socket.off('library-changed');
      socket.off('scrape-progress');
      socket.off('wishlist-changed');
    };
  }, []);

  // «Хочу поиграть» из окна новинок: отложить игру или убрать.
  // Убираем сразу, не дожидаясь сервера: звёздочка гаснет под пальцем
  const handleWishAdd = async (item) => {
    try {
      const res = await fetch('/api/wishlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const entry = await res.json();
      setWishlist(prev => ({ ...prev, items: [entry, ...prev.items.filter(x => x.key !== entry.key)] }));
    } catch {
      showToast(t.wish_error, 'error');
    }
  };
  const handleWishRemove = async (key) => {
    setWishlist(prev => ({ ...prev, items: prev.items.filter(x => x.key !== key) }));
    try {
      const res = await fetch(`/api/wishlist?key=${encodeURIComponent(key)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      showToast(t.wish_error, 'error');
      fetchWishlist();
    }
  };
  // Возвращает, удалилась ли игра: окно игры закрывается только после настоящего удаления
  const handleDeleteGame = async (game) => {
    if (!window.confirm(t.burn_confirm(game.displayTitle || game.title))) return false;

    try {
      const res = await fetch(`/api/games/${encodeURIComponent(game.id)}`, { method: 'DELETE' });
      const data = await res.json();
      
      if (data.success) {
        setGames(prevGames => prevGames.filter(g => g.id !== game.id));
        showToast(lang === 'ru' ? 'Том обратился в пепел' : 'Scroll turned to ashes', 'success');
        return true;
      }
      showToast(`Ошибка: ${data.error}`, 'error');
    } catch (err) {
      showToast(t.burn_err, 'error');
    }
    return false;
  };

  const handleRateGame = async (id, ratingValue) => {
    setGames(prevGames => prevGames.map(g => g.id === id ? { ...g, rating: ratingValue } : g));
    try {
      await fetch(`/api/games/${encodeURIComponent(id)}/meta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: ratingValue })
      });
    } catch (err) {}
  };

  // Правим поле сразу на экране и следом отправляем на сервер.
  // Ждать ответ нельзя: звезда «моргала» бы на каждый клик.
  const patchGame = async (id, patch) => {
    setGames(prev => prev.map(g => g.id === id ? { ...g, ...patch } : g));
    setSelectedGame(prev => prev && prev.game.id === id ? { ...prev, game: { ...prev.game, ...patch } } : prev);
    try {
      await fetch(`/api/games/${encodeURIComponent(id)}/meta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      });
    } catch (err) {
      showToast(t.err_net, 'error');
    }
  };

  const handleUpdateGame = (index, updatedGame) => {
    // 1. Обновляем игру в общем списке (чтобы на главной странице обложка поменялась)
    setGames(prev => prev.map(g => g.id === updatedGame.id ? updatedGame : g));
    
    // 2. КРИТИЧЕСКИ ВАЖНО: Обновляем снимок в выбранной игре, чтобы модалка сразу перерисовала обложку!
    setSelectedGame(prev => prev ? { ...prev, game: updatedGame } : null);
  };

  // Ключ сессии на сервере один на всех, поэтому выход закрывает доступ сразу
  // и на телефоне, и на компьютере. Предупреждаем, чтобы это не было сюрпризом.
  const handleLogout = async () => {
    if (!window.confirm(t.logout_confirm)) return;
    // Сеть упала — всё равно выходим локально: кука без ключа на сервере бесполезна
    try { await fetch('/api/logout', { method: 'POST' }); } catch { /* см. выше */ }
    setIsAuthed(false);
    setAuthMode('login');
  };

  // Ревизия знает только id, а окну игры нужен сам объект и его номер в списке
  const handleOpenGameById = (id) => {
    const index = games.findIndex(g => g.id === id);
    if (index >= 0) setSelectedGame({ game: games[index], index });
  };

  // Клик по тегу в окне игры. Заодно сбрасываем поиск и статус: иначе после клика
  // библиотека может оказаться пустой по причине, которой не видно — например,
  // остался фильтр «пройдено» или строка поиска от прошлого раза.
  const handleTagClick = (tag) => {
    setSelectedGame(null);
    setSearchQuery('');
    setStatusFilter('all');
    setLangFilter('all');
    setSelectedTag(tag);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };


  const availableTags = useMemo(() => {
    const tagCounts = {};
    games.forEach(g => {
      if (g.tags && g.tags.length > 0) {
        g.tags.forEach(tg => { tagCounts[tg] = (tagCounts[tg] || 0) + 1; });
      }
    });
    return Object.keys(tagCounts)
      // Теги-одиночки только засоряют список. Найти такую игру по-прежнему можно поиском,
      // а выбранный тег оставляем всегда — иначе он исчезнет из списка прямо под курсором.
      .filter(tag => tagCounts[tag] >= 2 || tag === selectedTag)
      .sort((a, b) => a.localeCompare(b))
      .map(tag => ({ name: tag, count: tagCounts[tag] }));
  }, [games, selectedTag]);

  // Языки, которые есть в библиотеке, — для фильтра. Самые частые первыми
  const availableLangs = useMemo(() => {
    const counts = {};
    games.forEach(g => (g.textLang?.langs || []).forEach(code => { counts[code] = (counts[code] || 0) + 1; }));
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([code, count]) => ({ code, count }));
  }, [games]);

  // Язык большинства игр — его на карточках не подписываем (см. GameCard)
  const usualLang = useMemo(() => {
    const counts = {};
    games.forEach(g => { const key = languageKey(g); if (key) counts[key] = (counts[key] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  }, [games]);

  // Последняя запущенная игра. Прячем блок, когда человек ищет или фильтрует:
  // он уже знает, что хочет найти, и большая карточка только мешает.
  const continueGame = useMemo(() => {
    if (filtersActive) return null;
    return [...games].filter(g => g.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed)[0] || null;
  }, [games, filtersActive]);

  const processedGames = useMemo(() => {
    let result = games;
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(game => {
        // Ищем и по показанному названию, и по исходному: японское, версия и имя папки
        // тоже находят игру
        const matchTitle = [game.displayTitle, game.originalTitle, game.title, game.id]
          .some(s => s?.toLowerCase().includes(query));
        const matchTags = game.tags?.some(tag => tag.toLowerCase().includes(query));
        return matchTitle || matchTags;
      });
    }
    if (langFilter !== 'all') {
      result = result.filter(g => g.textLang?.langs?.includes(langFilter));
    }
    if (selectedTag !== 'all') {
      result = result.filter(g => g.tags && g.tags.includes(selectedTag));
    }

    // Фильтруем по статусу
    if (statusFilter !== 'all') {
      result = result.filter(g => effectiveStatus(g) === statusFilter);
    }
        // При равных значениях упорядочиваем по id: иначе порядок одинаковых игр «прыгает»
    const byId = (a, b) => a.id.localeCompare(b.id);
    result = [...result].sort((a, b) => {
      switch (currentSort) {
        case 'newest':      return (b.addedAt || 0) - (a.addedAt || 0) || byId(a, b);
        case 'oldest':      return (a.addedAt || 0) - (b.addedAt || 0) || byId(a, b);
        case 'recent':      return (b.lastPlayed || 0) - (a.lastPlayed || 0) || byId(a, b);
        case 'rating_desc': return (b.rating || 0) - (a.rating || 0) || byId(a, b);
        case 'name':        return (a.displayTitle || a.title || a.id).localeCompare(b.displayTitle || b.title || b.id);
        case 'size_desc':   return (b.size || 0) - (a.size || 0) || byId(a, b);
        case 'size_asc':    return (a.size || 0) - (b.size || 0) || byId(a, b);
        case 'playtime':    return (b.playtime || 0) - (a.playtime || 0) || byId(a, b);
        default:            return 0;
      }
    });
    return result;
  }, [games, searchQuery, selectedTag, currentSort, statusFilter, langFilter]);

  // Высчитываем, какие игры показывать на текущей странице
  const visibleGames = processedGames.slice(0, page * itemsPerPage);

  // Настройка IntersectionObserver
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      const target = entries[0];
      // Подгружаем следующую страницу, если элемент пересек границу видимости
      if (target.isIntersecting && processedGames.length > page * itemsPerPage) {
        setPage(p => p + 1);
      }
    }, { rootMargin: '400px' });

    if (loaderRef.current) observer.observe(loaderRef.current);
    return () => { if (loaderRef.current) observer.unobserve(loaderRef.current); };
  }, [processedGames.length, page, itemsPerPage]);

  return (
    <div className={`app-container${blurCovers ? ' covers-hidden' : ''}`}>
      <Header
        currentLang={lang}
        onLangChange={setLang}
        t={t}
        // «Хочу поиграть» — вкладка «Новинок»; язык, место на диске и «Выйти» — мелкой
        // строкой внизу меню
        menuItems={isAuthed ? [
          // Только на телефоне: там кнопка на панели убрана, игры с телефона добавляют редко
          { key: 'upload', icon: <IconUpload />, label: t.add_game, onClick: () => openUploadRef.current?.(), className: 'mobile-only' },
          { key: 'news', icon: <IconNews />, label: t.catalog_title, onClick: () => setCatalogOpen(true) },
          // Случайная из не начатых — когда их много и выбрать трудно
          { key: 'pick', icon: <IconDice />, label: t.pick_title, onClick: () => setPickerOpen(true) },
          { key: 'library', icon: <IconStats />, label: t.stats_audit, onClick: () => setLibraryTab('stats') },
          // Свежая копия базы и сейвов — к себе на компьютер или телефон: ночная лежит на том же диске
          { key: 'backup', icon: <IconDownload />, label: t.backup_download, onClick: () => { window.location.href = '/api/backup'; } },
          // Готовые загрузки и копия базы с сейвами — в Telegram, без спама
          { key: 'telegram', icon: <IconSend />, label: t.tg_title, onClick: () => setTelegramOpen(true) },
        ] : []}
        onLogout={isAuthed ? handleLogout : null}
      >
        {isAuthed && <StorageMonitor t={t} />}
      </Header>
      {scrapeLeft > 0 && <div className="scrape-progress">{t.scrape_left(scrapeLeft)}</div>}
      
      <Toolbar 
        blurCovers={blurCovers} setBlurCovers={setBlurCovers}
        searchQuery={searchQuery} setSearchQuery={setSearchQuery} 
        availableTags={availableTags} selectedTag={selectedTag} setSelectedTag={setSelectedTag}
        availableLangs={availableLangs} langFilter={langFilter} setLangFilter={setLangFilter} lang={lang}
        openUploadRef={openUploadRef}
        onTargetPicked={() => setSelectedGame(null)}
        currentSort={currentSort} setCurrentSort={setCurrentSort}
        onUploadSuccess={() => fetchGames({ silent: true })}
        t={t}
        showToast={showToast}
        canUpload={isAuthed}
      />
      
      <main className="content">
        {/* Чипы статусов и «Продолжить» делят одну строку: раньше это были два ряда
            высотой 160px, а справа от чипов пустовало полэкрана */}
        <div className="library-bar">
          <StatusChips value={statusFilter} onChange={setStatusFilter} t={t} />
          {!loading && (
            <ContinueCard
              game={continueGame}
              t={t}
              onUpdateGame={(updated) => setGames(prev => prev.map(g => g.id === updated.id ? updated : g))}
            />
          )}
        </div>
        {loading ? (
          // Пустые «тома» вместо надписи: сетка та же, поэтому карточки не сдвигают вёрстку
          <div className="library">
            {Array.from({ length: 8 }, (_, i) => <div key={i} className="card-skeleton" />)}
          </div>
        ) : (
          <>
            <div className="library">
              {visibleGames.map((game, index) => (
                <GameCard 
                  key={game.id} game={game} index={index}
                  onClick={() => setSelectedGame({ game, index })} 
                  onRate={handleRateGame}
                  t={t} lang={lang} usualLang={usualLang}
                />
              ))}
              {processedGames.length === 0 && (
                <div className="empty-state">
                  <p>{t.not_found}</p>
                  {/* Без кнопки пустой экран был тупиком: какой из четырёх фильтров
                      всё отсеял, приходилось вспоминать и сбрасывать по одному */}
                  {filtersActive && (
                    <button type="button" className="chip active empty-reset" onClick={resetFilters}>{t.reset_filters}</button>
                  )}
                </div>
              )}
            </div>
            
            {/* Невидимый блок-якорь для Observer'а */}
            <div ref={loaderRef} style={{ height: '20px' }}></div>

            {processedGames.length > 0 && (
              <div className="library-info">
                {t.shown(Math.min(page * itemsPerPage, processedGames.length), games.length)}
              </div>
            )}
          </>
        )}
      </main>
      
      <Suspense fallback={null}>
      {authMode && (
        <LoginModal 
          mode={authMode} 
          onSuccess={() => { setAuthMode(null); fetchGames(); }} 
          t={t}
          showToast={showToast}
        />
      )}
      
      {libraryTab && (
        <LibraryModal
          tab={libraryTab} games={games} t={t} lang={lang}
          onClose={() => setLibraryTab(null)} onOpenGame={handleOpenGameById}
        />
      )}

      {playing && (
        <GameFrame
          key={playing.url}
          game={playing.game} url={playing.url} origin={playing.origin}
          onClose={closeGame}
        />
      )}

      {pickerOpen && (
        <PlayPicker games={games} t={t} onClose={closePicker} onOpenGame={handleOpenGameById} />
      )}

      {telegramOpen && (
        <TelegramModal t={t} lang={lang} socket={socket} onClose={closeTelegram} showToast={showToast} />
      )}

      {catalogOpen && (
        <Catalog
          t={t} lang={lang}
          wishlist={wishlist.items}
          onWishAdd={handleWishAdd} onWishRemove={handleWishRemove}
          onClose={() => setCatalogOpen(false)}
          onOpenGame={(id) => { setCatalogOpen(false); handleOpenGameById(id); }}
        />
      )}

      {selectedGame && (
        <GameModal 
          game={selectedGame.game} index={selectedGame.index} 
          onClose={() => setSelectedGame(null)} onUpdateGame={handleUpdateGame}
          t={t} lang={lang}
          showToast={showToast}
          onPatch={patchGame}
          onDelete={handleDeleteGame}
          onTagClick={handleTagClick}
          onUploadNewVersion={(g) => openUploadRef.current?.({ id: g.id, title: g.displayTitle || g.title })}
          onUploadPatch={(g) => openUploadRef.current?.({ id: g.id, title: g.displayTitle || g.title, mode: 'patch' })}
        />
      )}

      </Suspense>

      <Toast message={toast.message} type={toast.type} visible={toast.visible} />
    </div>
  )
}

export default App

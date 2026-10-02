import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const PAGE = 48;
const TABS = ['cg', 'portrait', 'backdrop', 'all'];
const FPS = 8;

const api = (id, what, file) => `/api/gallery/${encodeURIComponent(id)}/${what}?f=${encodeURIComponent(file)}`;

// Галерея из файлов игры (сервер: services/gallery.js). Вкладки: CG, персонажи в полный рост, фоны
// и всё подряд (со слоями, из которых игра собирает CG, и интерфейсом). Альбом — одна сцена со всеми
// вариантами и кадрами: листается подряд, за последним кадром — следующий альбом; кадры можно
// проиграть, как анимацию. Сетка догружается сама при прокрутке
const GameGallery = ({ game, t, onClose }) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState(null);
  const [shown, setShown] = useState(PAGE);
  const [view, setView] = useState(null);      // { album, index } — открытая картинка
  const [playing, setPlaying] = useState(false);
  // «Скрыть обложки» касается и этого окна (оно рисуется в body, вне страницы с этим классом)
  const [hidden] = useState(() => !!document.querySelector('.covers-hidden'));
  const touch = useRef(null);
  const more = useRef(null);

  // Оглавление: строится при первом открытии — спрашиваем, пока не будет готово
  useEffect(() => {
    let alive = true;
    let timer = null;
    const load = () => fetch(`/api/gallery/${encodeURIComponent(game.id)}`)
      .then((r) => r.json().then((d) => { if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`); return d; }))
      .then((d) => {
        if (!alive) return;
        setData(d);
        if (d.state !== 'ready') timer = setTimeout(load, 1000);
      })
      .catch((e) => { if (alive) setError(e.message); });
    load();
    return () => { alive = false; clearTimeout(timer); };
  }, [game.id]);

  const ready = data?.state === 'ready';
  const count = (key) => (ready ? (key === 'all' ? data.albums : data.albums.filter((a) => a.kind === key)).length : 0);
  // Первая непустая вкладка — сама, пока человек не выбрал свою
  const current = tab || TABS.find((k) => count(k) > 0) || 'all';
  const albums = useMemo(() => {
    if (!ready) return [];
    return current === 'all' ? data.albums : data.albums.filter((a) => a.kind === current);
  }, [data, ready, current]);

  // Прокрутили до конца сетки — показать ещё
  useEffect(() => {
    const el = more.current;
    if (!el) return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setShown((n) => n + PAGE);
    }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [albums, shown]);

  const step = (dir) => setView((v) => {
    if (!v) return v;
    let { album, index } = v;
    index += dir;
    if (index >= albums[album].files.length) { album += 1; index = 0; }
    if (index < 0) { album -= 1; index = album >= 0 ? albums[album].files.length - 1 : 0; }
    if (album < 0 || album >= albums.length) return v;
    return { album, index };
  });

  // Анимация: кадры альбома по кругу
  useEffect(() => {
    if (!playing || !view) return undefined;
    const timer = setInterval(() => setView((v) => (v ? { ...v, index: (v.index + 1) % albums[v.album].files.length } : v)), 1000 / FPS);
    return () => clearInterval(timer);
  }, [playing, view?.album, albums]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { if (view) { setView(null); setPlaying(false); } else onClose(); }
      else if (view && e.key === 'ArrowRight') { setPlaying(false); step(1); }
      else if (view && e.key === 'ArrowLeft') { setPlaying(false); step(-1); }
      else if (view && e.key === ' ') { e.preventDefault(); setPlaying((p) => !p); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const album = view ? albums[view.album] : null;
  const file = album ? album.files[view.index] : null;

  // Следующие картинки — заранее; для анимации — весь альбом
  useEffect(() => {
    if (!album) return;
    const next = playing
      ? album.files
      : [album.files[view.index + 1], album.files[view.index + 2], albums[view.album + 1]?.files[0]].filter(Boolean);
    next.forEach((f) => { const img = new Image(); img.src = api(game.id, 'image', f); });
  }, [album, view, playing, albums, game.id]);

  const open = (i) => { setPlaying(false); setView({ album: i, index: 0 }); };
  const close = () => { setPlaying(false); setView(null); };

  return createPortal(
    // Окно нарисовано в body, но события React идут по дереву компонентов — до фона окна игры, а
    // нажатие по фону его закрывает. Поэтому дальше галереи нажатия не пускаем
    <div className={`gallery${hidden ? ' covers-hidden' : ''}`} role="dialog" aria-label={t.gallery_title} onClick={(e) => e.stopPropagation()}>
      <div className="gallery-head">
        <h2>{t.gallery_title}</h2>
        <button type="button" className="gallery-close" onClick={onClose} aria-label={t.cancel}>×</button>
        <div className="gallery-tabs" role="tablist">
          {TABS.filter((key) => !ready || key === 'all' || count(key) > 0).map((key) => (
            <button
              key={key} type="button" role="tab" aria-selected={current === key}
              className={`chip${current === key ? ' active' : ''}`}
              onClick={() => { setTab(key); setShown(PAGE); }}
            >
              {t.gallery_tabs[key]} {ready ? count(key) : ''}
            </button>
          ))}
        </div>
        {ready && <p className="gallery-hint">{t.gallery_hint}</p>}
      </div>

      {error && <p className="gallery-note">{error}</p>}
      {!error && data?.state === 'building' && (
        <p className="gallery-note">{t.gallery_building(data.done, data.total)}</p>
      )}
      {ready && albums.length === 0 && <p className="gallery-note">{t.gallery_empty}</p>}

      {ready && (
        <div className="gallery-grid">
          {albums.slice(0, shown).map((a, i) => (
            <button key={a.key} type="button" className={`gallery-tile ${a.kind}`} onClick={() => open(i)}>
              <img
                src={api(game.id, 'thumb', a.cover || a.files[0])} alt="" loading="lazy"
                // Не собралась миниатюра — ещё раз через секунду, один раз
                onError={(e) => { if (!e.currentTarget.dataset.retry) { const img = e.currentTarget; img.dataset.retry = '1'; setTimeout(() => { img.src = `${img.src}&r=1`; }, 1000); } }}
              />
              {/* Имя сцены — если оно человеческое («Garden Walk», папка сцены), а не «eva_c132» */}
              {/\s/.test(a.key.split('/').pop()) && <span className="gallery-name">{a.key.split('/').pop()}</span>}
              {a.files.length > 1 && <span className="gallery-count">{t.gallery_frames(a.files.length)}</span>}
            </button>
          ))}
        </div>
      )}
      {albums.length > shown && <div ref={more} className="gallery-more-sentinel" />}

      {file && (
        <div
          className="gallery-view"
          onClick={close}
          onTouchStart={(e) => { touch.current = e.touches[0].clientX; }}
          onTouchEnd={(e) => {
            const dx = e.changedTouches[0].clientX - (touch.current ?? e.changedTouches[0].clientX);
            if (Math.abs(dx) > 40) { e.preventDefault(); setPlaying(false); step(dx < 0 ? 1 : -1); }
          }}
        >
          <img src={api(game.id, 'image', file)} alt="" onClick={(e) => { e.stopPropagation(); setPlaying(false); step(1); }} />
          <button type="button" className="lightbox-nav prev" onClick={(e) => { e.stopPropagation(); setPlaying(false); step(-1); }}>‹</button>
          <button type="button" className="lightbox-nav next" onClick={(e) => { e.stopPropagation(); setPlaying(false); step(1); }}>›</button>
          <div className="gallery-bar" onClick={(e) => e.stopPropagation()}>
            <span>{t.gallery_position(view.album + 1, albums.length, view.index + 1, album.files.length)}</span>
            {album.files.length >= 3 && (
              <button type="button" className="gallery-play" onClick={() => setPlaying((p) => !p)}>
                {playing ? t.gallery_pause : t.gallery_play}
              </button>
            )}
            <button type="button" className="gallery-play" onClick={close} aria-label={t.gallery_back} title={t.gallery_back}>✕</button>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
};

export default GameGallery;

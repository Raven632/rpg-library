import { useEffect, useRef, useState } from 'react';
import Picker from './Picker';
import { timeAgo } from '../formatAgo';
import { IconStar } from './icons';

const fmtCount = (n) => (
  n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n)
);
const options = (list) => list.map(([value, label]) => ({ value, label }));
// «Хочу поиграть»: недавно отложенные — первыми
const sortWish = (list) => [...list].sort((a, b) => b.addedAt - a.addedAt);
// Запись списка — в вид карточки новинок: то, что показывало окно, плюс ключ и «в библиотеке»
const wishItem = (e) => ({ ...e.info, source: e.source, key: e.key, url: e.url, game: e.game });

// Новинки игр на RPG Maker с itch.io: свежие, популярные, со скидкой, по тегам. Показывает, что
// из этого уже есть в библиотеке. Скачивать — на самом itch.io.
// Понравившееся откладывают звёздочкой в «Хочу поиграть» — это вторая вкладка
const Catalog = ({ t, lang, wishlist = [], onWishAdd, onWishRemove, onClose, onOpenGame }) => {
  const [source, setSource] = useState('itch');      // itch | list
  const [itchSort, setItchSort] = useState('popular');
  const [itchDays, setItchDays] = useState(0);
  const [itchPrice, setItchPrice] = useState('');
  const [itchPlatform, setItchPlatform] = useState('');
  const [itchTags, setItchTags] = useState([]);
  const [itchMeta, setItchMeta] = useState({ tags: [], details: false });
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(false);
  const [state, setState] = useState('loading');     // loading | more | ready | error | limited
  // «Хочу поиграть» снимаем, когда открыли вкладку: убранная звёздочкой игра остаётся на месте
  // до ухода с вкладки — её можно вернуть той же звёздочкой
  const [listSnap, setListSnap] = useState([]);
  const [open, setOpen] = useState(null);            // игра в подробном просмотре
  const [shot, setShot] = useState(0);               // какая картинка там крупно: 0 — обложка
  const [details, setDetails] = useState(null);      // страница игры: null — ещё нет, false — не открылась
  const request = useRef(0);
  const lastPage = useRef(1);

  useEffect(() => {
    let alive = true;
    fetch('/api/itch/meta').then(r => r.json()).then(d => { if (alive) setItchMeta(d); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const load = async (nextPage) => {
    // «Хочу поиграть» грузить не нужно: список уже есть
    if (source === 'list') return;
    // Фильтры меняют быстрее, чем отвечает сайт: берём только ответ на последний запрос
    const my = ++request.current;
    lastPage.current = nextPage;
    setState(nextPage > 1 ? 'more' : 'loading');
    // Новые фильтры — прежний список уже не про них
    if (nextPage === 1) setItems([]);
    const params = new URLSearchParams({ page: nextPage, sort: itchSort });
    if (itchDays) params.set('days', itchDays);
    if (itchPrice) params.set('price', itchPrice);
    if (itchPlatform === 'web') params.set('web', '1');
    if (itchTags.length) params.set('tags', itchTags.join(','));
    try {
      const res = await fetch(`/api/itch/latest?${params}`);
      if (res.status === 429) { if (my === request.current) setState('limited'); return; }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (my !== request.current) return;
      // Ключ тот же, что у сервера в «Хочу поиграть», — по нему звёздочка знает, отложена ли игра
      const fresh = data.items.map(item => ({ ...item, source: 'itch', key: `itch:${String(item.url).toLowerCase()}` }));
      setItems(prev => {
        if (nextPage === 1) return fresh;
        // Лента живая: пока листали, игры сдвигаются, и одна может прийти второй раз
        const seen = new Set(prev.map(x => x.key));
        return [...prev, ...fresh.filter(x => !seen.has(x.key))];
      });
      setPage(data.page);
      setMore(!!data.more);
      setState('ready');
    } catch {
      if (my === request.current) setState('error');
    }
  };

  useEffect(() => { load(1); }, [source, itchSort, itchDays, itchPrice, itchPlatform, itchTags]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Escape закрывает сначала подробный просмотр, потом окно
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (open) setOpen(null); else onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Игру открыли — подтягиваем её страницу: кадры, теги, оценку, описание (через ScraperAPI,
  // если он есть)
  const openItem = (item) => {
    setShot(0);
    setDetails(null);
    setOpen(item);
    if (!itchMeta.details) return;
    // 429 с budget — дневной запас ScraperAPI на страницы itch.io кончился: скажем об этом
    fetch(`/api/itch/game?url=${encodeURIComponent(item.url)}`)
      .then(r => (r.ok ? r.json() : r.status === 429 ? r.json().then(b => (b.budget ? 'budget' : false), () => false) : false))
      .then(d => setDetails(prev => (prev === null ? d : prev)))
      .catch(() => setDetails(false));
  };

  const switchSource = (next) => {
    if (next === source) return;
    setOpen(null);
    setItems([]);
    setMore(false);
    setState(next === 'list' ? 'ready' : 'loading');
    if (next === 'list') setListSnap(sortWish(wishlist));
    setSource(next);
  };

  // --- Хочу поиграть ---
  const wished = new Set(wishlist.map(x => x.key));
  const toggleWish = (item) => (wished.has(item.key) ? onWishRemove?.(item.key) : onWishAdd?.(item));

  // --- Фильтры ---
  const sortOptions = options([
    ['popular', t.itch_sort_popular], ['newest', t.itch_sort_newest], ['top-rated', t.itch_sort_top_rated],
    ['top-sellers', t.itch_sort_top_sellers], ['featured', t.itch_sort_featured],
  ]);
  // Период у itch.io один из двух: неделя или месяц
  const periodOptions = options([[0, t.catalog_days_all], [7, t.catalog_days_7], [30, t.catalog_days_30]]);
  const priceOptions = options([['', t.itch_price_any], ['free', t.itch_price_free], ['sale', t.itch_price_sale]]);
  const platformOptions = options([['', t.itch_platform_any], ['web', t.itch_platform_web]]);
  const tagOptions = [
    { value: 'all', label: t.catalog_tag_with },
    ...itchMeta.tags.filter(tag => !itchTags.includes(tag)).map(tag => ({ value: tag, label: tag.replace(/-/g, ' ') })),
  ];
  // itch.io ищет по тегам только вместе, не больше трёх
  const addTag = (tag) => { if (tag !== 'all' && itchTags.length < 3) setItchTags(prev => [...prev, tag]); };
  const platformLabel = (p) => (p === 'html' ? t.itch_pl_web : ({ windows: 'Windows', osx: 'macOS', linux: 'Linux', android: 'Android' })[p] || p);
  const priceLabel = (item) => item.price || t.itch_free;

  const owned = (item) => item.game && <span className="catalog-owned">{t.catalog_in_lib}</span>;

  const detail = open && (() => {
    const page = details && typeof details === 'object' ? details : null;
    const pics = [page?.coverUrl || open.cover, ...(page?.screens || [])].filter(Boolean);
    const main = pics[Math.min(shot, pics.length - 1)];
    const line = [open.genre || page?.genre, page?.developer || open.creator, priceLabel(open), ...(open.platforms || []).map(platformLabel),
      t.catalog_updated(timeAgo(open.updatedAt, lang))];
    const about = page?.description || open.description;
    // Клик по тегу — искать ещё игры с ним (теги из фильтра; из «Хочу поиграть» — на вкладку новинок)
    const tags = (page?.tags || []).map(name => {
      const slug = name.toLowerCase().replace(/\s+/g, '-');
      const usable = itchMeta.tags.includes(slug) && !itchTags.includes(slug) && itchTags.length < 3;
      return (
        <button key={name} type="button" className="tag tag-link" disabled={!usable}
          onClick={() => { if (source !== 'itch') switchSource('itch'); addTag(slug); setOpen(null); }}>{name}</button>
      );
    });
    return (
      <div className="catalog-detail">
        <button type="button" className="catalog-back" onClick={() => setOpen(null)}>← {t.catalog_back}</button>
        <h2 className="stats-title catalog-detail-title">{open.title}</h2>
        <div className="catalog-detail-meta">{line.filter(Boolean).join(' · ')}</div>
        <div className="catalog-detail-meta">
          {page?.rating && <span>{t.itch_rating(page.rating.value, fmtCount(page.rating.count))}</span>}
          {itchMeta.details && details === null && <span>{t.itch_details_loading}</span>}
          {details === 'budget' && <span>{t.itch_budget}</span>}
          {owned(open)}
        </div>
        {main && (
          <div className="catalog-detail-media">
            <img className="catalog-detail-main" src={main} alt={open.title} referrerPolicy="no-referrer" />
            {pics.length > 1 && (
              <div className="catalog-detail-thumbs">
                {pics.map((src, i) => (
                  <button key={src} type="button" className={`catalog-thumb${i === shot ? ' active' : ''}`} onClick={() => setShot(i)}>
                    <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {about && <p className="modal-description catalog-detail-text">{about}</p>}
        {tags.length > 0 && <div className="modal-tags catalog-detail-tags">{tags}</div>}
        <div className="catalog-detail-actions">
          <a className="meta-status-btn" href={open.url} target="_blank" rel="noopener noreferrer">{t.itch_open}</a>
          <button type="button" className={`meta-status-btn catalog-wish-btn${wished.has(open.key) ? ' on' : ''}`}
            aria-pressed={wished.has(open.key)} onClick={() => toggleWish(open)}>
            <IconStar /> {wished.has(open.key) ? t.wish_in : t.wish_add}
          </button>
          {open.game && (
            <button type="button" className="meta-status-btn" onClick={() => onOpenGame(open.game.id)}>{t.catalog_open_game}</button>
          )}
        </div>
      </div>
    );
  })();

  const text = source === 'list'
    ? { hint: t.wish_hint, loading: '', error: '' }
    : { hint: t.itch_cat_hint, loading: t.itch_loading, error: t.itch_error, limited: t.itch_limited };
  // Выбранные теги — чипами с крестиком
  const chosenChips = source === 'itch'
    ? itchTags.map(tag => ({ key: tag, label: `+ ${tag.replace(/-/g, ' ')} ×`, name: tag, drop: () => setItchTags(prev => prev.filter(x => x !== tag)) }))
    : [];
  // Что показываем сеткой: выдачу сайта или снятый список — с актуальными данными тех игр,
  // что в нём остались
  const current = new Map(wishlist.map(e => [e.key, e]));
  // Список пришёл позже, чем открыли вкладку, — показываем его как есть
  const snap = listSnap.length ? listSnap : sortWish(wishlist);
  const shown = source === 'list' ? snap.map(e => wishItem(current.get(e.key) || e)) : items;

  return (
    <div className="modal-overlay active" onClick={onClose}>
      <div className="stats-content catalog-content" onClick={e => e.stopPropagation()}>
        <div className="modal-actions-top"><div className="modal-close" onClick={onClose}>×</div></div>
        {/* Подробный просмотр поверх списка: список со всеми подгруженными страницами
            остаётся, и «Назад» возвращает туда же, где остановились */}
        {detail}
        <div hidden={!!open}>
          <h2 className="stats-title">{t.catalog_title}</h2>
          <div className="filter-chips catalog-sources">
            {[['itch', t.src_itch], ['list', `★ ${t.wish_title}${wishlist.length ? ` · ${wishlist.length}` : ''}`]].map(([key, label]) => (
              <button key={key} type="button" aria-pressed={source === key} onClick={() => switchSource(key)}
                className={`chip ${source === key ? 'active' : ''}`}>{label}</button>
            ))}
          </div>
          <p className="audit-hint">{text.hint}</p>

          {source === 'itch' && (
            <div className="catalog-filters">
              <Picker options={sortOptions} value={itchSort} onChange={setItchSort} label={t.catalog_sort} />
              <Picker options={periodOptions} value={itchDays} onChange={setItchDays} label={t.catalog_period} highlight={itchDays !== 0} />
              <Picker options={priceOptions} value={itchPrice} onChange={setItchPrice} label={t.itch_price} highlight={!!itchPrice} />
              <Picker options={platformOptions} value={itchPlatform} onChange={setItchPlatform} label={t.itch_platform} highlight={!!itchPlatform} />
              <Picker
                options={tagOptions} value="all" onChange={addTag} label={t.catalog_tag_with}
                searchable searchPlaceholder={t.catalog_tag_search} emptyText={t.catalog_tag_none}
              />
            </div>
          )}

          {chosenChips.length > 0 && (
            <div className="filter-chips catalog-chosen">
              {chosenChips.map(chip => (
                <button key={chip.key} type="button" className="chip active" title={t.catalog_tag_remove(chip.name)}
                  onClick={chip.drop}>{chip.label}</button>
              ))}
            </div>
          )}

          {state === 'loading' && <div className="audit-hint catalog-state">{text.loading}</div>}
          {(state === 'error' || state === 'limited') && (
            <div className="audit-hint catalog-state">
              {state === 'limited' ? text.limited : text.error}{' '}
              <button type="button" className="chip" onClick={() => load(lastPage.current)}>{t.catalog_retry}</button>
            </div>
          )}
          {state === 'ready' && shown.length === 0 && <div className="audit-clean">{source === 'list' ? t.wish_empty : t.catalog_empty}</div>}

          {state !== 'loading' && shown.length > 0 && (
            <div className="catalog-grid">
              {/* Звёздочка — рядом с карточкой, а не внутри: кнопка в кнопке недопустима */}
              {shown.map(item => (
                <div key={item.key} className="catalog-card-box">
                  <button type="button" className="catalog-card" onClick={() => openItem(item)}>
                    <div className="catalog-cover">
                      {item.cover ? <img src={item.cover} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <div className="catalog-cover-empty">RPGM</div>}
                      <span className={`catalog-price ${item.price ? 'paid' : 'free'}`}>{priceLabel(item)}</span>
                      {owned(item)}
                    </div>
                    <div className="catalog-card-info">
                      <span className="catalog-card-title">{item.title}</span>
                      <span className="catalog-card-line">{[item.genre, item.creator].filter(Boolean).join(' · ')}</span>
                      <span className="catalog-card-line">{[...(item.platforms || []).map(platformLabel), timeAgo(item.updatedAt || item.createdAt, lang)].filter(Boolean).join(' · ')}</span>
                      {item.description && <span className="catalog-card-tags">{item.description}</span>}
                    </div>
                  </button>
                  <button type="button" className={`catalog-wish${wished.has(item.key) ? ' on' : ''}`} aria-pressed={wished.has(item.key)}
                    title={wished.has(item.key) ? t.wish_star_remove : t.wish_star_add} aria-label={wished.has(item.key) ? t.wish_star_remove : t.wish_star_add}
                    onClick={() => toggleWish(item)}><IconStar /></button>
                </div>
              ))}
            </div>
          )}

          {state !== 'loading' && state !== 'error' && state !== 'limited' && more && (
            <button type="button" className="audit-retry catalog-more" disabled={state === 'more'} onClick={() => load(page + 1)}>
              {state === 'more' ? text.loading : t.catalog_more}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default Catalog;

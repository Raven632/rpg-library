import React, { useState, useRef, useEffect, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';

import { getCoverUrl, getMediaUrl } from '../coverUrl';

import { formatPlaytime } from '../formatPlaytime';

import { launchGame } from '../launchGame';

import { IconEdit, IconDownload, IconUpload, IconTrash, IconRefresh, IconHistory, IconImage } from './icons';
// Открывают редко — грузим при первом открытии
const SaveHistory = lazy(() => import('./SaveHistory'));
const GameGallery = lazy(() => import('./GameGallery'));
import { autoStatus } from '../gameStatus';

import { describeMeta } from '../formatRetry';
import { languageLine } from '../formatLanguage';

const ROMAN_NUMERALS = ['Ⅰ','Ⅱ','Ⅲ','Ⅳ','Ⅴ','Ⅵ','Ⅶ','Ⅷ','Ⅸ','Ⅹ','Ⅺ','Ⅻ'];
// Ссылки источников: в базе — одна строка через запятую, в форме — список
const splitLinks = (s) => String(s || '').split(/[\s,]+/).map(x => x.trim()).filter(Boolean);

// Что человек вставил в поле «добавить»: ссылку или несколько ссылок.
// Непонятный кусок — null: лучше переспросить, чем молча сохранить мусор
function parseLinkInput(text) {
  const out = [];
  for (const part of String(text).split(/[\s,]+/).filter(Boolean)) {
    if (/^https?:\/\/\S+$/i.test(part)) out.push(part);
    else return null;
  }
  return out.length ? out : null;
}

// Логотип сайта для ссылки
function linkIcon(url) {
  if (url.includes('vndb.org')) return '/vndb-logo.png';
  if (url.includes('steampowered.com')) return '/steam-logo.png';
  if (/\.itch\.io\//.test(url)) return '/itch-logo.svg';
  return '';
}

// Подпись ссылки в форме: сайт и что именно — номер в магазине, новелла, игра автора
function describeLink(url) {
  let host;
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { return { host: url, label: '' }; }
  const app = url.match(/app\/(\d+)/);
  if (app) return { host, label: `app ${app[1]}` };
  const vn = url.match(/vndb\.org\/(v\d+)/i);
  if (vn) return { host, label: vn[1] };
  // itch.io: «автор.itch.io/игра» — подписываем автора и игру
  const itch = url.match(/\/\/([^./]+)\.itch\.io\/([^/?#]+)/i);
  if (itch) return { host: 'itch.io', label: `${itch[1]} · ${itch[2].replace(/-/g, ' ')}` };
  return { host, label: '' };
}

// Сколько тегов видно сразу. Раньше показывались все — по 27 крупных плашек, и
// блок прокручивался внутри окна, которое само прокручивается
const TAGS_SHOWN = 12;

const GameModal = ({ game, index, onClose, onUpdateGame, onPatch, onDelete, onTagClick, onUploadNewVersion, onUploadPatch, t, lang, showToast }) => {
  const [isActive, setIsActive] = useState(false);
  const [showAllTags, setShowAllTags] = useState(false);
  // Звезда под курсором: подсвечиваем, какой будет оценка, ещё до клика
  const [hoverStar, setHoverStar] = useState(0);
  // Номер раскрытой картинки или null. Раньше кадр открывался новой вкладкой —
  // игру при этом приходилось терять из виду и возвращаться назад руками.
  const [lightbox, setLightbox] = useState(null);
  
  const importRef = useRef(null);
  const coverInputRef = useRef(null);

  useEffect(() => {
    const timer = setTimeout(() => setIsActive(true), 10);
    return () => clearTimeout(timer);
  }, []);

  // Обработчик живёт только пока картинка раскрыта: Esc закрывает просмотрщик,
  // а не всё окно игры, стрелки листают кадры по кругу
  useEffect(() => {
    if (lightbox === null) return undefined;
    const total = game.screens?.length || 0;
    const onKey = (e) => {
      if (e.key === 'Escape') setLightbox(null);
      else if (e.key === 'ArrowRight' && total) setLightbox(i => (i + 1) % total);
      else if (e.key === 'ArrowLeft' && total) setLightbox(i => (i - 1 + total) % total);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox, game.screens]);

  const handleCloseModal = () => {
    setIsActive(false);
    setTimeout(onClose, 300);
  };

  const formatDate = (ms) => {
    if (!ms) return t.never || 'Неизвестно';
    const locale = lang === 'en' ? 'en-US' : lang === 'de' ? 'de-DE' : 'ru-RU';
    return new Date(ms).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
  };

  const formatReleaseDate = (dateStr) => {
    if (!dateStr) return '—';
    if (/^\d{4}$/.test(dateStr)) return dateStr;
    try {
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        const locale = lang === 'en' ? 'en-US' : lang === 'de' ? 'de-DE' : 'ru-RU';
        return date.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
      }
    } catch (e) {}
    return dateStr;
  };

  const formatSize = (bytes) => {
    if (!bytes) return 'Неизвестно';
    const mb = bytes / (1024 * 1024);
    if (mb > 1024) return (mb / 1024).toFixed(2) + ' GB';
    return mb.toFixed(2) + ' MB';
  };

  const notify = (msg, type = 'info') => {
    if (showToast) showToast(msg, type);
    else alert(msg);
  };

  const [isEditing, setIsEditing] = useState(false);
  // «Искать сейчас» нажата: запоминаем время последней проверки на момент нажатия.
  // Пока оно не сменилось, воркер ещё не записал новый итог — поиск идёт.
  // Вычисляем, а не сбрасываем эффектом: так не бывает лишнего прохода рендера.
  const [queuedFrom, setQueuedFrom] = useState(null);
  const searchQueued = queuedFrom !== null && (game.meta?.checkedAt || 0) === queuedFrom;

  const handleRescrape = async () => {
    setQueuedFrom(game.meta?.checkedAt || 0);
    try {
      const res = await fetch(`/api/games/${encodeURIComponent(game.id)}/rescrape`, { method: 'POST' });
      if (!res.ok) throw new Error();
    } catch {
      setQueuedFrom(null);
      showToast?.(t.err_net, 'error');
    }
  };
  const [editTitle, setEditTitle] = useState(game.title || '');
  const [editDeveloper, setEditDeveloper] = useState(game.developer || '');
  const [editLanguage, setEditLanguage] = useState(game.language || '');
  const [editReleaseDate, setEditReleaseDate] = useState(game.releaseDate || '');
  const [editMyVersion, setEditMyVersion] = useState(game.myVersion || '');
  // Источники списком: каждая ссылка — своей строкой, одно поле «добавить»
  const [editLinks, setEditLinks] = useState(() => splitLinks(game.link));
  const [linkDraft, setLinkDraft] = useState('');
  const [linkError, setLinkError] = useState('');
  
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingCover, setIsUploadingCover] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  // «Бэкап», «Импорт», «Удалить» — в меню «⋯»: нужны редко, а «Удалить» не должно стоять
  // рядом с частой кнопкой, где его легко нажать по ошибке
  const [moreOpen, setMoreOpen] = useState(false);
  // «История сейвов» — вместо сведений об игре, пока открыта
  const [historyOpen, setHistoryOpen] = useState(false);
  // Галерея из файлов игры — поверх всего окна
  const [galleryOpen, setGalleryOpen] = useState(false);
  const moreRef = useRef(null);
  useEffect(() => {
    if (!moreOpen) return undefined;
    const onDown = (e) => { if (!moreRef.current?.contains(e.target)) setMoreOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [moreOpen]);
  const moreAction = (fn) => () => { setMoreOpen(false); fn(); };

  // Прежние версии, отложенные при обновлении игры: сколько места занимают — узнаём, когда открыли «⋯»
  const [oldSize, setOldSize] = useState(0);
  // Последняя прежняя версия ушла в запас из-за патча — «Вернуть» тогда значит «убрать патч»
  const [oldPatch, setOldPatch] = useState('');
  useEffect(() => {
    if (!moreOpen || !game.oldVersions) return;
    fetch(`/api/games/${encodeURIComponent(game.id)}/old`)
      .then((res) => res.json())
      .then((data) => {
        const versions = data.versions || [];
        setOldSize(versions.reduce((sum, v) => sum + v.size, 0));
        setOldPatch(versions.at(-1)?.patch || '');
      })
      .catch(() => {});
  }, [moreOpen, game.id, game.oldVersions]);
  const handleRestoreOld = async () => {
    if (!window.confirm(t.old_restore_confirm)) return;
    try {
      const res = await fetch(`/api/games/${encodeURIComponent(game.id)}/old/restore`, { method: 'POST' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || t.err_net);
      notify(t.old_restored, 'success');
    } catch (e) {
      notify(e.message, 'error');
    }
  };
  const handleDeleteOld = async () => {
    if (!window.confirm(t.old_delete_confirm)) return;
    try {
      const res = await fetch(`/api/games/${encodeURIComponent(game.id)}/old`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      notify(t.old_deleted, 'success');
      onUpdateGame(index, { ...game, oldVersions: 0 });
    } catch {
      notify(t.err_net, 'error');
    }
  };

  // Поля заполняем в момент нажатия «Изменить», а не эффектом: эффект переписывал
  // бы их при каждом обновлении игры с сервера — прямо поверх того, что человек печатает
  const startEditing = () => {
    setEditTitle(game.title || '');
    setEditDeveloper(game.developer || '');
    setEditLanguage(game.language || '');
    setEditReleaseDate(game.releaseDate || '');
    setEditMyVersion(game.myVersion || '');
    setEditLinks(splitLinks(game.link));
    setLinkDraft('');
    setLinkError('');
    setIsEditing(true);
  };

  const addLinks = (urls) => {
    const fresh = urls.filter(u => !editLinks.includes(u));
    if (!fresh.length) { setLinkError(t.edit_link_dup); return false; }
    setEditLinks(prev => [...prev, ...fresh]);
    setLinkError('');
    return true;
  };

  const addDraft = () => {
    const parsed = parseLinkInput(linkDraft);
    if (!parsed) { setLinkError(t.edit_link_bad); return; }
    if (addLinks(parsed)) setLinkDraft('');
  };

  const handleBackup = () => {
    // Бэкенд ждет путь /export/:id (с учетом префикса роутера это /api/saves/export/)
    window.location.href = `/api/saves/export/${game.id}`; 
  };

  const handleImportSelect = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setIsImporting(true);
    const formData = new FormData();
    formData.append('saves', file);
    try {
      const res = await fetch(`/api/saves/import/${game.id}`, { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
        notify(t.import_success, 'success');
        onUpdateGame(index, game);
      } else {
        notify(data.error || 'Ошибка импорта', 'error');
      }
    } catch (err) {
      notify('Ошибка сети при импорте', 'error');
    } finally {
      setIsImporting(false);
      e.target.value = '';
    }
  };

  const handleCoverClick = () => {
    if (isEditing && !isUploadingCover && coverInputRef.current) {
      coverInputRef.current.click();
    }
  };

  const handleCoverChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      notify('Выберите файл изображения!', 'error');
      e.target.value = '';
      return;
    }

    setIsUploadingCover(true);
    const formData = new FormData();
    formData.append('cover', file);

    try {
      const res = await fetch(`/api/games/${game.id}/cover`, { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
        onUpdateGame(index, { ...game, cover: data.coverPath });
        notify('Обложка успешно изменена!', 'success');
      } else {
        notify(data.error || 'Ошибка при загрузке обложки', 'error');
      }
    } catch (err) {
      notify('Ошибка соединения с сервером', 'error');
    } finally {
      setIsUploadingCover(false);
      e.target.value = ''; 
    }
  };

  const handleCoverDelete = async () => {
    if (!window.confirm(`${t.cover_reset}?`)) return;

    setIsUploadingCover(true);
    try {
      const res = await fetch(`/api/games/${game.id}/cover`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        onUpdateGame(index, { ...game, cover: data.coverPath });
        notify('Обложка сброшена!', 'success');
      } else {
        notify(data.error || 'Ошибка', 'error');
      }
    } catch (err) {
      notify('Ошибка сети', 'error');
    } finally {
      setIsUploadingCover(false);
    }
  };

  const handleSave = async () => {
    // Ссылку вписали, а «Добавить» не нажали — частая история. Забираем её сами
    const pending = linkDraft.trim() ? parseLinkInput(linkDraft) : [];
    if (pending === null) { setLinkError(t.edit_link_bad); return; }
    const links = [...editLinks, ...pending.filter(u => !editLinks.includes(u))];
    const linkStr = links.join(',');

    setIsSaving(true);
    try {
      const res = await fetch(`/api/games/${game.id}/edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          title: editTitle, 
          developer: editDeveloper,
          language: editLanguage,
          releaseDate: editReleaseDate,
          myVersion: editMyVersion,
          // По списку ссылок сервер и ищет
          link: linkStr
        })
      });
      const data = await res.json();
      if (data.success) {
        // Сервер возвращает итог целиком: что человек ввёл, что нашлось и состояние поиска
        onUpdateGame(index, { ...game, ...(data.game || {}) });

        // Раньше при неудаче здесь всё равно писалось «Успешно», хотя сервер в этот
        // момент стирал теги. Теперь данные не трогаются, а человек узнаёт, что поиск
        // ничего не дал. Молчим, если он искать и не просил — просто поправил поле.
        const askedToSearch = linkStr !== splitLinks(game.link).join(',');
        if (!data.found && askedToSearch) {
          notify(data.failed?.length ? t.edit_unreachable(data.failed.join(', ')) : t.edit_not_found, 'error');
        } else {
          notify(t.saved_ok, 'success');
        }
        setIsEditing(false);
        setLinkDraft('');
      } else {
        notify(data.error || 'Ошибка при сохранении', 'error');
      }
    } catch (e) {
      notify('Ошибка соединения с сервером', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handlePlay = async () => {
    setIsPlaying(true);
    try {
      await launchGame(game, (updated) => onUpdateGame(index, updated));
    } catch (e) {
      notify(e.message || t.err_net, 'error');
    }
    // Игра открылась в рамке поверх — кнопка снова «Играть», когда из неё вернутся
    setIsPlaying(false);
  };

  // Удаление живёт здесь, а не на карточке: там корзина стояла вплотную к звезде
  // «Избранное», и промахнуться было проще простого
  const handleDelete = async () => {
    if (await onDelete?.(game)) handleCloseModal();
  };

  // Повторный клик по той же звезде снимает оценку
  const rate = (n) => onPatch(game.id, { rating: game.rating === n ? 0 : n });

  // --- НОВАЯ ЛОГИКА ОПРЕДЕЛЕНИЯ САЙТА ДЛЯ ССЫЛКИ ---
  const renderSourceLink = () => {
    if (!game.link) return null;
    
    // Разбиваем строку по запятым на массив ссылок
    const links = game.link.split(/[, ]+/).filter(Boolean);
    
    return (
      <div style={{ display: 'flex', gap: '10px' }}>
        {links.map((url, idx) => {
          const iconSrc = linkIcon(url);

          return (
            <a key={idx} href={url} target="_blank" rel="noopener noreferrer" className="grimoire-source-link" title={url}>
              {iconSrc ? <img src={iconSrc} alt="Source" className="grimoire-source-logo" /> : '🔗'}
            </a>
          );
        })}
      </div>
    );
  };

  const coverUrl = getCoverUrl(game, 720);
  const roman = ROMAN_NUMERALS[index % ROMAN_NUMERALS.length] || String(index + 1);

  return (
    <div className={`modal-overlay ${isActive ? 'active' : ''}`} onClick={handleCloseModal}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        
        {/* В углу остаётся только крестик — его там ищут по привычке в любом окне.
            Шестерёнка висела рядом и заезжала на длинное название: теперь это
            обычная кнопка «Изменить» в ряду с остальными действиями над игрой */}
        <div className="modal-actions-top">
          <div className="modal-close" onClick={handleCloseModal}>×</div>
        </div>

        <div className="modal-header">
          {/* Левая колонка закреплена: обложка и всё, что делают с игрой, — «Играть»,
              оценка, статус — остаются под рукой, пока справа читаешь описание */}
          <aside className="modal-side">
            <div className={`modal-cover-wrapper ${isEditing ? 'editable' : ''}`} onClick={handleCoverClick}>
              {coverUrl ? (
                <img id="modal-cover" src={coverUrl} alt={game.displayTitle || game.title} />
              ) : (
                <div className="cover-placeholder modal-placeholder"><span className="rune">{roman}</span></div>
              )}
              {isEditing && <div className="cover-edit-overlay">{isUploadingCover ? '⏳' : '📷'}</div>}
              <input type="file" ref={coverInputRef} accept="image/*" style={{ display: 'none' }} onChange={handleCoverChange} disabled={isUploadingCover}/>
            </div>

            {isEditing && (
              <div className="modal-cover-edit">
                <p className="modal-cover-hint">{t.edit_cover_hint}</p>
                {/* Раньше здесь был красный ✖ прямо на обложке — похож на «закрыть» или
                    «удалить», а делал третье. Теперь это слова, и только когда есть что возвращать */}
                {/cover_custom/.test(game.cover || '') && (
                  <button type="button" className="cover-reset-btn" onClick={handleCoverDelete} disabled={isUploadingCover}>
                    {t.cover_reset}
                  </button>
                )}
              </div>
            )}

            {!isEditing && (
              <div className="modal-primary">
                {/* Главное действие окна — первым и залитым. Раньше «Играть» стояла
                    в самом низу контуром и выглядела второстепенной */}
                <button id="modal-play-btn" onClick={handlePlay} disabled={isPlaying}>
                  <span>{isPlaying ? t.launching : t.play}</span> <span className="launch-arrow">→</span>
                </button>

                {formatPlaytime(game.playtime, t) && (
                  <div className="modal-progress">
                    <span className="meta-label">{t.playtime}</span> <b>{formatPlaytime(game.playtime, t)}</b>
                    {game.progress?.level != null && <> · <span className="meta-label">{t.progress_level}</span> <b>{game.progress.level}</b></>}
                    {game.progress?.gold != null && <> · <span className="meta-label">{t.progress_gold}</span> <b>{game.progress.gold.toLocaleString(lang === 'en' ? 'en-US' : lang === 'de' ? 'de-DE' : 'ru-RU')}</b></>}
                  </div>
                )}

                {/* Оценка: на карточке звёзды 16px, пальцем в них не попасть */}
                <div className="modal-rating" role="group" aria-label={t.rating_label} onMouseLeave={() => setHoverStar(0)}>
                  <span className="meta-label">{t.rating_label}</span>
                  {[1, 2, 3, 4, 5].map(n => (
                    <button
                      key={n}
                      type="button"
                      className={`rating-star ${n <= (hoverStar || game.rating || 0) ? 'active' : ''}`}
                      aria-label={t.rate_star(n)}
                      aria-pressed={game.rating === n}
                      onMouseEnter={() => setHoverStar(n)}
                      onClick={() => rate(n)}
                    >
                      ★
                    </button>
                  ))}
                </div>

                {/* Статус, вписанный руками, — подсвечен; найденный сам («Играю», gameStatus.js) —
                    пунктиром: нажатие закрепляет его руками */}
                <div className="status-row">
                  {['playing', 'done', 'dropped', 'wish'].map(key => (
                    <button
                      key={key}
                      type="button"
                      className={`chip ${game.status === key ? 'active' : ''}${!game.status && autoStatus(game) === key ? ' auto' : ''}`}
                      aria-pressed={game.status === key}
                      title={!game.status && autoStatus(game) === key ? t.status_auto_hint : undefined}
                      onClick={() => onPatch(game.id, { status: game.status === key ? '' : key })}
                    >
                      {t[`status_${key}`]}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </aside>

          <div className="modal-info">
            {isEditing ? (
              <div className="grimoire-form">
                {/* Сведения: подписи над полями. Раньше были только подсказки внутри
                    полей, и заполненное поле было не опознать — «ミライユカイ堂» что это? */}
                <section className="edit-section">
                  <h3 className="edit-section-title">{t.edit_section_info}</h3>
                  <label className="edit-field">
                    <span className="edit-label">{t.edit_f_title}</span>
                    <input type="text" value={editTitle} onChange={e => setEditTitle(e.target.value)} />
                  </label>
                  <div className="edit-row">
                    <label className="edit-field">
                      <span className="edit-label">{t.edit_f_dev}</span>
                      <input type="text" value={editDeveloper} onChange={e => setEditDeveloper(e.target.value)} />
                    </label>
                    <label className="edit-field">
                      <span className="edit-label">{t.edit_f_release}</span>
                      <input type="text" value={editReleaseDate} onChange={e => setEditReleaseDate(e.target.value)} placeholder={t.edit_f_release_ph} />
                    </label>
                  </div>
                  <label className="edit-field">
                    <span className="edit-label">{t.edit_f_myversion}</span>
                    {/* Пустое поле — версия из названия папки; в подсказке видно, какая нашлась */}
                    <input
                      type="text"
                      value={editMyVersion}
                      maxLength={40}
                      onChange={e => setEditMyVersion(e.target.value)}
                      placeholder={!game.myVersion && game.version ? t.edit_f_myversion_auto(game.version) : t.edit_f_myversion_ph}
                    />
                  </label>
                  <label className="edit-field">
                    <span className="edit-label">{t.edit_f_lang}</span>
                    {/* Пустое поле — язык определяется по тексту игры; в подсказке видно, что определилось */}
                    <input
                      type="text"
                      value={editLanguage}
                      onChange={e => setEditLanguage(e.target.value)}
                      placeholder={languageLine({ ...game, language: '' }, t, lang) ? t.edit_f_lang_auto(languageLine({ ...game, language: '' }, t, lang)) : t.edit_lang_auto_empty}
                    />
                  </label>
                </section>

                {/* Источники: список ссылок и одно поле «добавить». Всё про ссылки — в одном месте */}
                <section className="edit-section">
                  <h3 className="edit-section-title">{t.edit_section_sources}</h3>
                  <p className="edit-hint">{t.edit_sources_hint}</p>

                  {editLinks.length > 0 ? (
                    <ul className="edit-links">
                      {editLinks.map(url => {
                        const info = describeLink(url);
                        const icon = linkIcon(url);
                        return (
                          <li key={url} className="edit-link">
                            <span className="edit-link-logo">{icon ? <img src={icon} alt="" /> : '🔗'}</span>
                            <a href={url} target="_blank" rel="noopener noreferrer" className="edit-link-text" title={url}>
                              <b>{info.host}</b>{info.label && <span> · {info.label}</span>}
                            </a>
                            <button
                              type="button"
                              className="edit-link-remove"
                              aria-label={t.edit_remove}
                              title={t.edit_remove}
                              onClick={() => setEditLinks(prev => prev.filter(x => x !== url))}
                            >×</button>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="edit-empty">{t.edit_no_links}</p>
                  )}

                  <form className="edit-add" onSubmit={(e) => { e.preventDefault(); addDraft(); }}>
                    <input
                      type="text"
                      value={linkDraft}
                      onChange={e => { setLinkDraft(e.target.value); setLinkError(''); }}
                      placeholder={t.edit_add_ph}
                      aria-invalid={!!linkError}
                    />
                    <button type="submit" className="edit-add-btn" disabled={!linkDraft.trim()}>{t.edit_add}</button>
                  </form>
                  {linkError && <p className="edit-error" role="alert">{linkError}</p>}
                </section>

                <div className="form-actions">
                  <button onClick={handleSave} disabled={isSaving} className="save-btn">{isSaving ? '⏳...' : t.save}</button>
                  <button onClick={() => setIsEditing(false)} className="cancel-btn">{t.cancel}</button>
                </div>
              </div>
            ) : historyOpen ? (
              <Suspense fallback={null}><SaveHistory
                game={game}
                t={t}
                lang={lang}
                notify={notify}
                onClose={() => setHistoryOpen(false)}
                onRestored={() => onUpdateGame(index, game)}
              /></Suspense>
            ) : (
              <>
                <div className="modal-title-block">
                  <h2 id="modal-title">{game.displayTitle || game.title}</h2>
                  {/* Японское название, которое заменили английским, — мелко под ним */}
                  {game.originalTitle && <div className="modal-original-title" lang="ja">{game.originalTitle}</div>}
                </div>

                <div className="grimoire-metadata">
                  <div className="meta-row">
                    <div className="meta-item">
                      <span className="meta-label">{t.meta_dev}</span>
                      <span className="meta-value gold">{game.developer || t.meta_unknown}</span>
                    </div>
                    <div className="meta-item">
                      <span className="meta-label">{t.meta_release}</span>
                      <span className="meta-value gold">{formatReleaseDate(game.releaseDate)}</span>
                    </div>
                    {/* Язык неизвестен — строки нет: «Язык: —» ничего не говорит */}
                    {languageLine(game, t, lang) && (
                      <div className="meta-item">
                        <span className="meta-label">{t.meta_lang}</span>
                        <span className="meta-value gold">{languageLine(game, t, lang)}</span>
                      </div>
                    )}
                  </div>

                  <div className="meta-row">
                    {game.version && (
                      <div className="meta-item">
                        <span className="meta-label">{t.meta_version}</span>
                        <span className="meta-value">{game.version}</span>
                      </div>
                    )}
                    <div className="meta-item">
                      <span className="meta-label">{t.meta_size}</span>
                      <span className="meta-value">{formatSize(game.size)}</span>
                    </div>
                    <div className="meta-item">
                      <span className="meta-label">{t.meta_added}</span>
                      <span className="meta-value">{formatDate(game.addedAt)}</span>
                    </div>
                  </div>
                </div>

                {game.link && <div className="modal-sources">{renderSourceLink()}</div>}

                {/* Если метаданные не полные — видно, почему и что будет дальше. Раньше
                    это было не узнать: пометки «не найдено» жили в Redis и никуда не выводились */}
                {(() => {
                  const info = describeMeta(game.meta, t, lang);
                  if (!info) return null;
                  const busy = info.searching || searchQueued;
                  return (
                    <div className={`meta-status ${game.meta.status}`}>
                      <div className="meta-status-text">
                        <b>{busy ? t.meta_line_new : info.text}</b>
                        {!busy && info.details && <span>{info.details}</span>}
                        {!busy && game.meta.status !== 'partial' && <span className="meta-status-hint">{t.meta_manual_hint}</span>}
                      </div>
                      {!busy && (
                        <button type="button" className="meta-status-btn" onClick={handleRescrape}>{t.meta_search_now}</button>
                      )}
                    </div>
                  );
                })()}

                {/* Сначала — о чём игра, потом кадры и теги. Раньше описание стояло
                    последним, под тегами и кадрами */}
                {game.description && (
                  <div className="modal-description">{game.description}</div>
                )}

                {game.screens && game.screens.length > 0 && (
                  <div className="game-screens">
                    {game.screens.map((src, i) => (
                      <button key={src} type="button" className="screen-thumb" onClick={() => setLightbox(i)} title={t.screens_open}>
                        <img src={getMediaUrl(src, 360)} alt={`${game.displayTitle || game.title} — ${i + 1}`} loading="lazy" />
                      </button>
                    ))}
                  </div>
                )}

                <div className="modal-tags">
                  {game.tags && game.tags.length > 0 ? (
                    <>
                      {(showAllTags ? game.tags : game.tags.slice(0, TAGS_SHOWN)).map(tag => (
                        // Тег — кнопка, а не текст: клик уводит в библиотеку, отфильтрованную
                        // по нему. Раньше «а что ещё есть такого же» приходилось искать руками
                        // в выпадающем списке, хотя ответ был прямо перед глазами.
                        <button
                          key={tag}
                          type="button"
                          className="tag tag-link"
                          onClick={() => onTagClick?.(tag)}
                          title={t.tag_filter_by(tag)}
                        >
                          {tag}
                        </button>
                      ))}
                      {game.tags.length > TAGS_SHOWN && (
                        <button type="button" className="tag tag-more" onClick={() => setShowAllTags(v => !v)}>
                          {showAllTags ? t.tags_less : t.tags_more(game.tags.length - TAGS_SHOWN)}
                        </button>
                      )}
                    </>
                  ) : (
                    <span className="tag" style={{ opacity: 0.5, borderColor: 'transparent' }}>{t.no_tags}</span>
                  )}
                </div>

                {/* Внизу: «Изменить» на виду, остальное — в «⋯» */}
                <div className="grimoire-actions-row">
                  <button type="button" onClick={() => setGalleryOpen(true)} className="grimoire-action-btn" title={t.gallery_title}><IconImage />{t.gallery_btn}</button>
                  <button onClick={startEditing} className="grimoire-action-btn" title={t.edit_meta}><IconEdit />{t.edit_btn}</button>
                  <div className="modal-more" ref={moreRef}>
                    <button
                      type="button"
                      className={`grimoire-action-btn modal-more-btn${moreOpen ? ' open' : ''}`}
                      onClick={() => setMoreOpen(v => !v)}
                      aria-haspopup="menu"
                      aria-expanded={moreOpen}
                      aria-label={t.more_actions}
                      title={t.more_actions}
                    >
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm12 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm-6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
                    </button>
                    {moreOpen && (
                      <div className="modal-more-list" role="menu">
                        <button type="button" role="menuitem" className="modal-more-item" onClick={moreAction(handleBackup)}><IconDownload />{t.backup}</button>
                        <button type="button" role="menuitem" className="modal-more-item" onClick={moreAction(() => importRef.current.click())}><IconUpload />{isImporting ? t.import_wait : t.import}</button>
                        <button type="button" role="menuitem" className="modal-more-item" onClick={moreAction(() => setHistoryOpen(true))}><IconHistory />{t.saves_history}</button>
                        <button type="button" role="menuitem" className="modal-more-item" onClick={moreAction(() => onUploadNewVersion?.(game))}><IconRefresh />{t.update_game}</button>
                        <button type="button" role="menuitem" className="modal-more-item" onClick={moreAction(() => onUploadPatch?.(game))}><IconUpload />{t.patch_game}</button>
                        {game.oldVersions > 0 && (
                          <button type="button" role="menuitem" className="modal-more-item" onClick={moreAction(handleRestoreOld)}><IconRefresh />{oldPatch ? t.old_restore_patch(oldPatch.replace(/\.(zip|7z|rar)$/i, '')) : t.old_restore}</button>
                        )}
                        {game.oldVersions > 0 && (
                          <button type="button" role="menuitem" className="modal-more-item danger" onClick={moreAction(handleDeleteOld)}><IconTrash />{t.old_delete(oldSize ? formatSize(oldSize) : '')}</button>
                        )}
                        <button type="button" role="menuitem" className="modal-more-item danger" onClick={moreAction(handleDelete)}><IconTrash />{t.delete_btn}</button>
                      </div>
                    )}
                  </div>
                  <input type="file" ref={importRef} accept=".zip" style={{ display: 'none' }} onChange={handleImportSelect} />
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Просмотрщик рисуем прямо в body: у окна игры есть backdrop-filter, а он
          становится точкой отсчёта для position: fixed внутри — картинка выросла бы
          не во весь экран, а в рамку окна за вычетом его отступов */}
      {galleryOpen && <Suspense fallback={null}><GameGallery game={game} t={t} onClose={() => setGalleryOpen(false)} /></Suspense>}

      {lightbox !== null && game.screens?.length > 0 && createPortal(
        <div className="lightbox" onClick={(e) => { e.stopPropagation(); setLightbox(null); }}>
          <button type="button" className="lightbox-close" onClick={(e) => { e.stopPropagation(); setLightbox(null); }}>×</button>

          {game.screens.length > 1 && (
            <>
              <button
                type="button"
                className="lightbox-nav prev"
                onClick={(e) => { e.stopPropagation(); setLightbox(i => (i - 1 + game.screens.length) % game.screens.length); }}
              >‹</button>
              <button
                type="button"
                className="lightbox-nav next"
                onClick={(e) => { e.stopPropagation(); setLightbox(i => (i + 1) % game.screens.length); }}
              >›</button>
            </>
          )}

          {/* Клик по самой картинке не закрывает: промахнуться мимо мелкой кнопки легко */}
          <img
            src={getMediaUrl(game.screens[lightbox])}
            alt={`${game.displayTitle || game.title} — ${lightbox + 1}`}
            onClick={(e) => e.stopPropagation()}
          />

          {game.screens.length > 1 && (
            <div className="lightbox-counter">{lightbox + 1} / {game.screens.length}</div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
};

export default GameModal;

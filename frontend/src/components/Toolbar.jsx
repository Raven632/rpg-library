import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { languageTitle } from '../formatLanguage';
import { uploadArchive, listUploads, cancelUpload, sendPassword, UploadError } from '../resumableUpload';
import Picker from './Picker';

const GB = 1024 ** 3;
const fmtSize = (bytes) => (bytes >= GB ? `${(bytes / GB).toFixed(2)} GB` : `${Math.round(bytes / 1048576)} MB`);
const IDLE = { active: false };
// Пока байты в пути, закрыть страницу — значит оборвать загрузку (продолжить потом можно, но зачем)
const SENDING = ['start', 'upload', 'resync', 'retry'];

// Пароль архива: поле и кнопка «Распаковать». Пароль уходит серверу и на странице не остаётся
const PasswordForm = ({ t, onSubmit }) => {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!value || busy) return;
    setBusy(true);
    try { await onSubmit(value); } finally { setBusy(false); setValue(''); }
  };
  return (
    <form className="upload-password" onSubmit={submit}>
      <input
        type="password" value={value} onChange={(e) => setValue(e.target.value)}
        placeholder={t.up_pw_placeholder} aria-label={t.up_pw_placeholder}
        autoComplete="off" autoCapitalize="off" spellCheck={false}
      />
      <button type="submit" className="upload-card-btn" disabled={!value || busy}>{t.up_pw_submit}</button>
    </form>
  );
};

const Toolbar = ({ 
  searchQuery, setSearchQuery, availableTags, selectedTag, setSelectedTag,
  currentSort, setCurrentSort, onUploadSuccess, t, showToast,
  blurCovers, setBlurCovers, canUpload,
  availableLangs = [], langFilter, setLangFilter, lang, openUploadRef, onTargetPicked
}) => {
  const fileInputRef = useRef(null);

  // Варианты трёх списков панели. Жанры — самые частые первыми: по алфавиту
  // нужное приходилось искать среди сотни строк
  const genreOptions = useMemo(() => [
    { value: 'all', label: t.all_genres },
    ...[...availableTags]
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .map(tag => ({ value: tag.name, label: tag.name, count: tag.count })),
  ], [availableTags, t]);
  const langOptions = useMemo(() => [
    { value: 'all', label: t.all_langs },
    ...availableLangs.map(({ code, count }) => ({ value: code, label: languageTitle(code, lang), count })),
  ], [availableLangs, lang, t]);
  const sortOptions = [
    ['newest', t.sort_new], ['oldest', t.sort_old], ['recent', t.sort_rec], ['playtime', t.sort_playtime],
    ['rating_desc', t.sort_rat], ['name', t.sort_alp], ['size_desc', t.sort_size_desc], ['size_asc', t.sort_size_asc],
  ].map(([value, label]) => ({ value, label }));

  // Выбор архива: для новой игры или для новой версии игры из библиотеки (target — { id, title }).
  // Кому архив, запоминаем до выбора: отменённый выбор файла ничего не оставит — следующий
  // выбор всё равно скажет, кому он
  const targetRef = useRef(null);
  const openUpload = (target = null) => {
    targetRef.current = target;
    fileInputRef.current?.click();
  };
  // На телефоне кнопка «Добавить игру» живёт в меню шапки, «Обновить игру» — в окне игры:
  // отдаём им открытие выбора файла
  useEffect(() => {
    if (!openUploadRef) return undefined;
    openUploadRef.current = (target) => {
      targetRef.current = target || null;
      fileInputRef.current?.click();
    };
    return () => { openUploadRef.current = null; };
  }, [openUploadRef]);
  // На телефоне жанр, язык, сортировка и «глаз» — за кнопкой «Фильтры»: в четыре ряда панель
  // отодвигала первую игру на полэкрана. Число на кнопке — сколько фильтров включено
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilters = (selectedTag !== 'all' ? 1 : 0) + (langFilter !== 'all' ? 1 : 0);
  const [isDragging, setIsDragging] = useState(false);
  // Загрузка: phase — start, upload, resync, retry, processing, done, failed (resumableUpload.js)
  const [upload, setUpload] = useState(IDLE);
  // Недогруженные, распаковывающиеся и неудачные загрузки с сервера — видны и после перезагрузки
  // страницы: айфон выгружает её из памяти, пока смотришь другое приложение
  const [pending, setPending] = useState([]);
  const abortRef = useRef(null);
  // Загрузка ждёт пароль архива: сюда кладётся, кому его отдать
  const passwordRef = useRef(null);
  // Номер загрузки: таймер, закрывающий карточку прошлой, не закроет карточку новой
  const runRef = useRef(0);
  const onUploadSuccessRef = useRef(onUploadSuccess);
  useEffect(() => { onUploadSuccessRef.current = onUploadSuccess; }, [onUploadSuccess]);

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    const target = targetRef.current;
    targetRef.current = null;
    if (file) {
      // Архив для новой версии выбран — окно игры закрываем: на телефоне карточка загрузки
      // легла бы поверх его крестика, а ход обновления и так виден на карточке
      if (target) onTargetPicked?.(target);
      uploadFile(file, target);
    }
    e.target.value = '';
  };

  // Обработчики ниже вешаются на окно один раз, а uploadFile пересоздаётся на каждом
  // рендере (в нём язык, тосты, колбэки). Через ref они всегда зовут свежую версию,
  // иначе после смены языка загрузка писала бы сообщения на старом.
  const uploadFileRef = useRef(null);
  const uploadActiveRef = useRef(false);

  // Архив можно бросить в любое место страницы, а не только на кнопку: кнопка
  // на телефоне и на широком экране — маленькая цель, а при прокрутке её вообще не видно.
  useEffect(() => {
    if (!canUpload) return undefined;

    // dragenter и dragleave приходят на каждый дочерний элемент по пути курсора.
    // Без счётчика оверлей мигал бы на каждой границе карточки.
    let depth = 0;
    // Картинку со страницы тоже можно потащить, и браузер тоже назовёт её «файлом».
    // Такие перетаскивания начинаются внутри документа — их отличаем по dragstart.
    let internal = false;

    const hasFiles = (e) => !internal && Array.from(e.dataTransfer?.types || []).includes('Files');

    const onStart = () => { internal = true; };
    const onEnd = () => { internal = false; };
    const onEnter = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth += 1;
      setIsDragging(true);
    };
    const onOver = (e) => {
      if (!hasFiles(e)) return;
      // Без preventDefault браузер не разрешит бросить файл и просто откроет его во вкладке
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    };
    const onLeave = (e) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setIsDragging(false);
    };
    const onDrop = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setIsDragging(false);
      if (uploadActiveRef.current) {
        showToast(t.up_busy, 'error');
        return;
      }
      const file = e.dataTransfer.files[0];
      if (file) uploadFileRef.current(file);
    };

    window.addEventListener('dragstart', onStart);
    window.addEventListener('dragend', onEnd);
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragstart', onStart);
      window.removeEventListener('dragend', onEnd);
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [canUpload, showToast, t]);

  const refreshPending = useCallback(() => {
    if (canUpload) listUploads().then(setPending).catch(() => {});
  }, [canUpload]);
  useEffect(() => { refreshPending(); }, [refreshPending]);

  // Распаковка, начатая до перезагрузки страницы, и загрузка, идущая с другого устройства: следим,
  // пока не кончатся. Готовая уходит из списка — значит, игра уже в библиотеке
  useEffect(() => {
    const going = pending.filter((u) => u.state === 'processing' || u.busy);
    if (!going.length) return undefined;
    const timer = setInterval(async () => {
      const list = await listUploads().catch(() => null);
      if (!list) return;
      if (going.some((u) => !list.some((x) => x.id === u.id))) onUploadSuccessRef.current();
      setPending(list);
    }, 3000);
    return () => clearInterval(timer);
  }, [pending]);

  useEffect(() => {
    if (!upload.active || !SENDING.includes(upload.phase)) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [upload.active, upload.phase]);

  const uploadErrorText = (e) => {
    if (e.kind === 'read') return t.up_read(e.received ? fmtSize(e.received) : '');
    const text = e.message || t.up_err;
    return e.received > 0 && !e.processed ? `${text}. ${t.up_resume_hint(fmtSize(e.received))}` : text;
  };

  const uploadFile = async (file, target = null) => {
    if (!/\.(zip|7z|rar)$/i.test(file.name)) {
      showToast(t.wrong_ext, 'error');
      return;
    }
    const run = ++runRef.current;
    const closeLater = (ms) => setTimeout(() => { if (runRef.current === run) setUpload(IDLE); }, ms);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let id = null;
    setUpload({ active: true, name: file.name, size: file.size, received: 0, phase: 'start', target });
    try {
      const result = await uploadArchive(file, {
        signal: ctrl.signal,
        target: target?.id,
        mode: target?.mode,
        onState: (state) => {
          if (state.id) id = state.id;
          if (state.resumed) showToast(t.up_resumed(fmtSize(state.received), fmtSize(state.size)), 'success');
          setUpload((prev) => ({ ...prev, ...state }));
        },
        // Ответ — из поля пароля на карточке; отмена загрузки обрывает ожидание
        askPassword: () => new Promise((resolve, reject) => {
          passwordRef.current = resolve;
          ctrl.signal.addEventListener('abort', () => reject(new UploadError('cancelled')), { once: true });
        }),
      });
      setUpload((prev) => ({ ...prev, phase: 'done', patch: result?.patch || null }));
      onUploadSuccess();
      closeLater(2500);
    } catch (e) {
      if (e.kind === 'cancelled') {
        // Список обновит сама отмена — когда сервер удалит полученное
        setUpload(IDLE);
        showToast(t.up_cancelled, 'success');
        return;
      }
      const text = uploadErrorText(e);
      showToast(text, 'error');
      setUpload((prev) => ({ ...prev, phase: 'failed', text }));
      // Ошибку распаковки уже показали — из списка неудачных её убираем
      if (e.processed && id) await cancelUpload(id).catch(() => {});
      closeLater(8000);
    } finally {
      abortRef.current = null;
      passwordRef.current = null;
    }
    refreshPending();
  };

  const submitPassword = (password) => {
    const give = passwordRef.current;
    passwordRef.current = null;
    give?.(password);
  };
  // Пароль для архива из карточки «не догружено»: страницу, с которой его грузили, уже закрыли
  const submitPendingPassword = async (u, password) => {
    try {
      await sendPassword(u.id, password);
    } catch (e) {
      showToast(e.message || t.up_err, 'error');
    }
    refreshPending();
  };
  useEffect(() => {
    uploadFileRef.current = uploadFile;
    uploadActiveRef.current = upload.active;
  });

  // Отменить идущую загрузку: полученное сервер удалит. Случайное касание на телефоне стоило бы
  // гигабайтов, поэтому — с вопросом
  const cancelCurrent = () => {
    if (!window.confirm(t.up_cancel_confirm)) return;
    abortRef.current?.abort();
    if (upload.id) cancelUpload(upload.id).catch(() => {}).finally(refreshPending);
  };

  // Убрать из списка: недогруженную или ждущую пароля — удалить с сервера (тоже с вопросом),
  // неудачную — просто скрыть
  const forgetPending = (u) => {
    if ((u.state === 'uploading' || u.state === 'password') && !window.confirm(t.up_forget_confirm(u.name))) return;
    cancelUpload(u.id).catch(() => {}).finally(refreshPending);
  };

  const pct = ['processing', 'password', 'done'].includes(upload.phase) ? 100 : Math.floor(((upload.received || 0) / (upload.size || 1)) * 100);
  const uploadText = {
    start: t.up_trans(upload.name),
    retry: t.up_retry(upload.retryIn),
    password: upload.wrong ? t.up_pw_wrong : t.up_pw_need,
    processing: (upload.step && t.up_steps[upload.step]) || t.up_wait,
    done: upload.target?.mode === 'patch'
      ? t.up_patched(upload.patch?.replaced ?? 0, upload.patch?.added ?? 0)
      : upload.target ? t.up_updated : t.up_done,
    failed: upload.text,
  }[upload.phase] || t.up_prog(fmtSize(upload.received || 0), fmtSize(upload.size || 0));
  const shownPending = pending.filter((u) => u.id !== upload.id);

  return (
    <div className={`controls-zone${filtersOpen ? ' filters-open' : ''}`}>
      <div className="search-box">
        <svg className="search-icon" viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
        <input type="text" placeholder={t.search} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
      </div>

      {/* Видна только на телефоне (index.css): на широком экране всё стоит в ряд и так */}
      <button
        type="button"
        className={`filters-toggle${filtersOpen ? ' open' : ''}${activeFilters ? ' active' : ''}`}
        onClick={() => setFiltersOpen(v => !v)}
        aria-expanded={filtersOpen}
        aria-controls="toolbar-filters"
      >
        <svg viewBox="0 0 24 24"><path d="M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z"/></svg>
        {t.filters}
        {activeFilters > 0 && <span className="filters-count">{activeFilters}</span>}
      </button>

      <div className="toolbar-filters" id="toolbar-filters">
      {/* Три списка одного вида: жанры с поиском (их под сотню), языки и сортировка —
          без него. Подсветка кнопки — знак, что фильтр включён */}
      <Picker
        options={genreOptions} value={selectedTag} onChange={setSelectedTag} label={t.list_genre}
        searchable searchPlaceholder={t.genre_search} emptyText={t.genre_none}
        highlight={selectedTag !== 'all'}
      />

      {/* Язык по тексту самой игры, а не по магазину */}
      {availableLangs.length > 1 && (
        <Picker
          options={langOptions} value={langFilter} onChange={setLangFilter} label={t.list_lang}
          highlight={langFilter !== 'all'} className="lang-filter"
        />
      )}

      <Picker options={sortOptions} value={currentSort} onChange={setCurrentSort} label={t.list_sort} className="sort-order" />

      {/* Кнопка без текста, поэтому смысл — в подсказке и в aria-label:
          иначе назначение приходится угадывать, а экранный диктор читает «кнопка» */}
      <button
        type="button"
        className={`cover-toggle ${blurCovers ? 'active' : ''}`}
        onClick={() => setBlurCovers(v => !v)}
        title={blurCovers ? t.covers_show : t.covers_hide}
        aria-label={blurCovers ? t.covers_show : t.covers_hide}
        aria-pressed={blurCovers}
      >
        {blurCovers ? (
          <svg viewBox="0 0 24 24"><path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2z"/></svg>
        ) : (
          <svg viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
        )}
      </button>

      <div 
        className="upload-btn" 
        onClick={() => openUpload()}
        style={upload.active ? { pointerEvents: 'none', opacity: 0.5 } : {}}
      >
        <svg viewBox="0 0 24 24"><path d="M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z"/></svg>
        {t.add_game}
      </div>
      </div>

      <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept=".zip,.7z,.rar,application/zip,application/x-rar-compressed,application/vnd.rar,application/x-7z-compressed,application/octet-stream" onChange={handleFileSelect}/>

      {/* Оверлей и карточка загрузки рисуются прямо в body: бросить архив можно
          с любого места страницы, и ход загрузки должен быть виден там же,
          а не в панели, до которой надо прокручивать */}
      {isDragging && !upload.active && createPortal(
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-overlay-frame">
            <svg className="drop-overlay-icon" viewBox="0 0 24 24"><path d="M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z"/></svg>
            <div className="drop-overlay-title">{t.drop_title}</div>
            <div className="drop-overlay-hint">{t.drop_hint}</div>
          </div>
        </div>,
        document.body
      )}

      {upload.active && createPortal(
        <div className={`upload-card${upload.phase === 'failed' ? ' failed' : ''}`} role="status" aria-live="polite">
          <div className="upload-card-head">
            <svg className="upload-card-icon" viewBox="0 0 24 24"><path d="M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM12 17.5L6.5 12H10v-2h4v2h3.5L12 17.5zM5.12 5l.81-1h12l.94 1H5.12z"/></svg>
            <div className="upload-card-text">
              <div className="upload-card-name" title={upload.name}>{upload.target ? (upload.target.mode === 'patch' ? t.up_patch_of : t.up_update_of)(upload.target.title) : upload.name}</div>
              <div className={`upload-card-status${upload.phase === 'password' && upload.wrong ? ' failed' : ''}`}>{uploadText}</div>
            </div>
            <div className="upload-card-pct">{pct}%</div>
            {(SENDING.includes(upload.phase) || upload.phase === 'password') && (
              <button type="button" className="upload-card-x" onClick={cancelCurrent} title={t.up_cancel} aria-label={t.up_cancel}>×</button>
            )}
          </div>
          {upload.phase === 'password' ? (
            <PasswordForm t={t} onSubmit={submitPassword} />
          ) : (
            <div className="upload-card-track">
              <div className="progress-bar" style={{ width: `${pct}%` }}></div>
            </div>
          )}
        </div>,
        document.body
      )}

      {/* Что осталось с прошлого раза: выбрать тот же файл — загрузка продолжится с того же места */}
      {!upload.active && shownPending.length > 0 && createPortal(
        <div className="upload-card upload-pending" role="status" aria-live="polite">
          {shownPending.slice(0, 3).map((u) => (
            <React.Fragment key={u.id}>
            <div className="upload-card-head">
              <svg className="upload-card-icon" viewBox="0 0 24 24"><path d="M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM12 17.5L6.5 12H10v-2h4v2h3.5L12 17.5zM5.12 5l.81-1h12l.94 1H5.12z"/></svg>
              <div className="upload-card-text">
                <div className="upload-card-name" title={u.name}>{u.target ? (u.mode === 'patch' ? t.up_patch_of : t.up_update_of)(u.target) : u.name}</div>
                <div className={`upload-card-status${u.state === 'error' || (u.state === 'password' && u.error) ? ' failed' : ''}`}>
                  {u.state === 'uploading' && (u.busy ? t.up_busy_other : t.up_left)(fmtSize(u.received), fmtSize(u.size))}
                  {u.state === 'processing' && t.up_wait}
                  {u.state === 'password' && (u.error ? t.up_pw_wrong : t.up_pw_need)}
                  {u.state === 'error' && `✗ ${u.error}`}
                </div>
              </div>
              {u.state === 'uploading' && !u.busy && (
                <button type="button" className="upload-card-btn" onClick={() => openUpload(u.target ? { id: u.target, title: u.target, mode: u.mode || undefined } : null)}>{t.up_pick}</button>
              )}
              {u.state !== 'processing' && !u.busy && (
                <button
                  type="button" className="upload-card-x" onClick={() => forgetPending(u)}
                  title={u.state === 'error' ? t.up_hide : t.up_forget} aria-label={u.state === 'error' ? t.up_hide : t.up_forget}
                >×</button>
              )}
            </div>
            {u.state === 'password' && <PasswordForm t={t} onSubmit={(password) => submitPendingPassword(u, password)} />}
            </React.Fragment>
          ))}
          {shownPending.some((u) => u.state === 'uploading' && !u.busy) && <div className="upload-pending-hint">{t.up_pick_hint}</div>}
        </div>,
        document.body
      )}
    </div>
  );
};

export default Toolbar;

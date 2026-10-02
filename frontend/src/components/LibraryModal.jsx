import React, { useEffect, useState } from 'react';
import StatsPanel from './StatsPanel';
import AuditPanel from './AuditPanel';

// Статистика и ревизия — одно окно с двумя вкладками. Обе — о библиотеке целиком, и двумя
// пунктами меню стояли рядом с тем, что нужно каждый день
const LibraryModal = ({ tab: initialTab = 'stats', games, t, lang, onClose, onOpenGame }) => {
  const [tab, setTab] = useState(initialTab);

  // Escape закрывает окно — как и остальные окна библиотеки
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Из ревизии — сразу к игре: окно закрываем, чтобы не заслоняло её
  const openGame = (id) => { onClose(); onOpenGame(id); };

  return (
    <div className="modal-overlay active" onClick={onClose}>
      <div className="stats-content" onClick={e => e.stopPropagation()}>
        <div className="modal-actions-top"><div className="modal-close" onClick={onClose}>×</div></div>
        <div className="library-tabs" role="tablist">
          {[['stats', t.stats], ['audit', t.audit]].map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={`library-tab${tab === key ? ' active' : ''}`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === 'stats'
          ? <StatsPanel games={games} t={t} lang={lang} />
          : <AuditPanel t={t} lang={lang} games={games} onOpenGame={openGame} />}
      </div>
    </div>
  );
};

export default LibraryModal;

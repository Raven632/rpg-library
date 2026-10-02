import { useEffect, useMemo, useState } from 'react';
import { getCoverUrl } from '../coverUrl';
import { effectiveStatus } from '../gameStatus';
import { launchGame } from '../launchGame';

// Случайная игра из списка; «Другая» не выдаёт ту же самую второй раз подряд
function pickFrom(list, except) {
  const rest = list.length > 1 ? list.filter((g) => g.id !== except) : list;
  return rest[Math.floor(Math.random() * rest.length)] || null;
}

// «Во что поиграть?» — из не начатых и отложенных «В планы»: игр ждёт много, а выбирать тяжело.
// Сузить можно по жанру: чипы — самые частые теги среди ждущих игр
const PlayPicker = ({ games, t, onClose, onOpenGame }) => {
  const waiting = useMemo(() => games.filter((g) => ['new', 'wish'].includes(effectiveStatus(g))), [games]);
  const genres = useMemo(() => {
    const count = new Map();
    for (const g of waiting) for (const tag of g.tags || []) count.set(tag, (count.get(tag) || 0) + 1);
    return [...count].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([tag]) => tag);
  }, [waiting]);
  const poolFor = (tag) => (tag ? waiting.filter((g) => (g.tags || []).includes(tag)) : waiting);
  const [genre, setGenre] = useState('');
  const pool = useMemo(() => poolFor(genre), [waiting, genre]); // eslint-disable-line react-hooks/exhaustive-deps
  // Сразу при открытии — уже игра, а не пустое окно
  const [pickedId, setPickedId] = useState(() => pickFrom(waiting, null)?.id || null);
  const game = pool.find((g) => g.id === pickedId) || null;
  const choose = (tag) => {
    setGenre(tag);
    setPickedId(pickFrom(poolFor(tag), null)?.id || null);
  };

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const another = () => setPickedId(pickFrom(pool, pickedId)?.id || null);
  const cover = game ? getCoverUrl(game) : null;

  return (
    <div className="modal-overlay active" onClick={onClose}>
      <div className="stats-content picker-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-actions-top"><div className="modal-close" onClick={onClose}>×</div></div>
        <h2>{t.pick_title}</h2>
        <p className="tg-note">{t.pick_hint}</p>
        {genres.length > 0 && (
          <div className="picker-lengths" role="group">
            {['', ...genres].map((tag) => (
              <button key={tag || 'any'} type="button" className={`chip${genre === tag ? ' active' : ''}`} onClick={() => choose(tag)}>
                {tag || t.pick_any}
              </button>
            ))}
          </div>
        )}
        <p className="tg-note">{t.pick_pool(pool.length)}</p>
        {!game && <p className="tg-note">{t.pick_none}</p>}
        {game && (
          <div className="picker-game">
            {cover && <img className="picker-cover" src={cover} alt="" />}
            <div className="picker-info">
              <h3>{game.displayTitle || game.title}</h3>
              <p className="tg-note">
                {[
                  game.developer || '',
                  String(game.releaseDate || '').slice(0, 4),
                  (game.tags || []).slice(0, 3).join(', '),
                ].filter(Boolean).join(' · ')}
              </p>
              <div className="tg-actions">
                <button type="button" className="save-btn" onClick={() => { onClose(); launchGame(game).catch(() => {}); }}>{t.play} →</button>
                <button type="button" className="meta-status-btn" onClick={another} disabled={pool.length < 2}>{t.pick_another}</button>
                <button type="button" className="meta-status-btn subtle" onClick={() => { onClose(); onOpenGame(game.id); }}>{t.pick_open}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PlayPicker;

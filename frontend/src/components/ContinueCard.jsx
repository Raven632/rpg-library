import React from 'react';
import { getCoverUrl } from '../coverUrl';
import { formatPlaytime } from '../formatPlaytime';
import { launchGame } from '../launchGame';

// Последняя запущенная игра — тонкой полосой в строке с чипами. Раньше это был
// отдельный блок высотой 130px с обложкой и большой кнопкой: он отодвигал
// библиотеку, хотя всё его дело — одна кнопка «Играть»
const ContinueCard = ({ game, t, onUpdateGame }) => {
  if (!game) return null;
  const cover = getCoverUrl(game);
  const name = game.displayTitle || game.title;
  const played = formatPlaytime(game.playtime, t);

  return (
    <section className="continue-strip" aria-label={t.continue_label}>
      <div className="continue-cover">
        {cover && <img src={cover} alt="" />}
      </div>
      <div className="continue-info">
        <span className="continue-label">
          {t.continue_label}
          {played && <span className="continue-meta"> · ⏱ {played}</span>}
          {game.progress?.level != null && <span className="continue-meta"> · {t.progress_level} {game.progress.level}</span>}
        </span>
        <span className="continue-title" title={name}>{name}</span>
      </div>
      <button type="button" className="continue-btn" onClick={() => launchGame(game, onUpdateGame)}>
        {t.play} <span className="launch-arrow">→</span>
      </button>
    </section>
  );
};

export default ContinueCard;

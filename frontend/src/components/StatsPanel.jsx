import React, { useMemo } from 'react';
import { effectiveStatus } from '../gameStatus';
import { formatPlaytime } from '../formatPlaytime';

// Горизонтальная полоса: подпись, шкала, число. Ширина — доля от максимума.
const Bar = ({ label, value, max, text }) => (
  <div className="stat-bar">
    <span className="stat-bar-label" title={label}>{label}</span>
    <span className="stat-bar-track">
      <span className="stat-bar-fill" style={{ width: `${max ? (value / max) * 100 : 0}%` }} />
    </span>
    <span className="stat-bar-value">{text || value}</span>
  </div>
);

// Вкладка «Статистика» окна «Статистика и ревизия» (LibraryModal): окно, крестик и Escape — там
const StatsPanel = ({ games, t, lang }) => {
  // Считаем один раз на изменение списка: перебор 80 игр дёшев, но в рендере он был бы на каждый чих
  const s = useMemo(() => {
    const tags = {};
    const byStatus = {};
    const byMonth = {};

    games.forEach(g => {
      (g.tags || []).forEach(tag => { tags[tag] = (tags[tag] || 0) + 1; });
      const key = effectiveStatus(g) || 'none';
      byStatus[key] = (byStatus[key] || 0) + 1;
      if (g.addedAt) {
        const d = new Date(g.addedAt);
        const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        byMonth[m] = (byMonth[m] || 0) + 1;
      }
    });

    return {
      total: games.length,
      gb: games.reduce((a, g) => a + (g.size || 0), 0) / 1073741824,
      seconds: games.reduce((a, g) => a + (g.playtime || 0), 0),
      launched: games.filter(g => g.lastPlayed).length,
      rated: games.filter(g => g.rating > 0),
      byStatus,
      topTags: Object.entries(tags).sort((a, b) => b[1] - a[1]).slice(0, 10),
      topPlayed: games.filter(g => g.playtime >= 60).sort((a, b) => b.playtime - a.playtime).slice(0, 5),
      months: Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b)).slice(-12),
    };
  }, [games]);

  const statusOrder = ['playing', 'new', 'done', 'dropped', 'wish', 'none'];
  const maxStatus = Math.max(...Object.values(s.byStatus), 1);
  const maxTag = s.topTags[0]?.[1] || 1;
  const maxPlayed = s.topPlayed[0]?.playtime || 1;
  const maxMonth = Math.max(...s.months.map(([, n]) => n), 1);
  const avg = s.rated.length ? (s.rated.reduce((a, g) => a + g.rating, 0) / s.rated.length).toFixed(1) : '—';
  const locale = lang === 'en' ? 'en-US' : lang === 'de' ? 'de-DE' : 'ru-RU';
  // «05» ничего не говорит. Показываем название месяца, а год — только когда он меняется,
  // иначе двенадцать одинаковых «26» просто съедают место.
  const monthLabel = (key, prevKey) => {
    const [y, m] = key.split('-');
    const name = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString(locale, { month: 'short' });
    return prevKey && prevKey.slice(0, 4) === y ? name : `${name} ${y.slice(2)}`;
  };
  
  return (
    <>
        <div className="stats-numbers">
          <div><b>{s.total}</b><span>{t.stats_total}</span></div>
          <div><b>{s.gb.toFixed(1)} GB</b><span>{t.stats_size}</span></div>
          <div><b>{formatPlaytime(s.seconds, t) || '—'}</b><span>{t.stats_time}</span></div>
          <div><b>{s.launched}</b><span>{t.stats_launched}</span></div>
          <div><b>{s.total - s.launched}</b><span>{t.stats_never}</span></div>
          <div><b>{s.rated.length} · {avg}</b><span>{t.stats_rated}</span></div>
        </div>

        <h3 className="stats-section">{t.stats_by_status}</h3>
        {statusOrder.filter(k => s.byStatus[k]).map(k => (
          <Bar key={k} label={k === 'none' ? t.stats_none : t[`status_${k}`]} value={s.byStatus[k]} max={maxStatus} />
        ))}

        {s.topPlayed.length > 0 && (
          <>
            <h3 className="stats-section">{t.stats_top_played}</h3>
            {s.topPlayed.map(g => (
              <Bar key={g.id} label={g.displayTitle || g.title} value={g.playtime} max={maxPlayed} text={formatPlaytime(g.playtime, t)} />
            ))}
          </>
        )}

        <h3 className="stats-section">{t.stats_top_tags}</h3>
        {s.topTags.map(([tag, n]) => <Bar key={tag} label={tag} value={n} max={maxTag} />)}

        <h3 className="stats-section">{t.stats_by_month}</h3>
        <div className="stats-months">
          {s.months.map(([month, n], i) => (
            <div key={month} className="stats-month" title={`${month}: ${n}`}>
              <span className="stats-month-bar" style={{ height: `${(n / maxMonth) * 100}%` }} />
              <span className="stats-month-num">{n}</span>
              <span className="stats-month-label">{monthLabel(month, s.months[i - 1]?.[0])}</span>
            </div>
          ))}
        </div>
    </>
  );
};

export default StatsPanel;

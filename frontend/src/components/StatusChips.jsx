// Быстрый фильтр по статусу. Живёт в одной строке с «Продолжить», а не отдельным
// рядом под поиском: справа от чипов было пустое место шириной в полэкрана.
// «Играю» и «Не начата» считаются и сами, по наигранному (gameStatus.js). «Избранного» нет:
// им никто не пользовался
const StatusChips = ({ value, onChange, t }) => (
  <div className="filter-chips">
    {[
      ['all', t.filter_all],
      ['playing', t.status_playing],
      ['new', t.status_new],
      ['done', t.status_done],
      ['dropped', t.status_dropped],
      ['wish', t.status_wish],
    ].map(([key, label]) => (
      <button
        key={key}
        type="button"
        className={`chip ${value === key ? 'active' : ''}`}
        aria-pressed={value === key}
        onClick={() => onChange(key)}
      >
        {label}
      </button>
    ))}
  </div>
);

export default StatusChips;

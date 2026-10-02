// Запуск игры: отмечаем время и открываем игру.
// Общий код для модалки и блока «Продолжить»: иначе отметка времени
// разойдётся между ними при первой же правке.
//
// Игра живёт на своём адресе (сервер игр, api/src/routes/play.js): её код чужой и не должен
// работать с входом библиотеки. Адрес с ключом этой игры даёт сервер; открывает его рамка на весь
// экран (GameFrame) — событием rpg-play, его слушает App. Так страница-приложение на айфоне
// остаётся собой: переход на другой адрес открыл бы игру во встроенном браузере с его панелью.
// По-старому (GAME_ISOLATION=off) сервер отвечает mode: 'page' — переходим на страницу игры
export async function launchGame(game, onUpdate) {
  const lastPlayed = Date.now();
  try {
    await fetch(`/api/games/${encodeURIComponent(game.id)}/meta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lastPlayed })
    });
    onUpdate?.({ ...game, lastPlayed });
  } catch {
    // Не смогли отметить — это не повод не запускать игру
  }

  // Язык меню в игре: у сервера игр своё хранилище, выбранного языка там не видно
  const lang = localStorage.getItem('rpg_lang') || 'ru';
  const res = await fetch(`/api/play/${encodeURIComponent(game.id)}`, { method: 'POST' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

  if (data.mode === 'frame') {
    const origin = data.origin || `${window.location.protocol}//${window.location.hostname}:${data.port}`;
    const url = `${origin}${data.path}?lang=${lang}&lib=${encodeURIComponent(`${window.location.origin}/`)}`;
    window.dispatchEvent(new CustomEvent('rpg-play', { detail: { game, url, origin } }));
    return;
  }

  // В dev страницу отдаёт Vite (:5173), а игры — бэкенд на своём порту
  window.location.href = import.meta.env.DEV
    ? `${window.location.protocol}//${window.location.hostname}:${import.meta.env.VITE_BACKEND_PORT}${data.path}?lang=${lang}`
    : data.path;
}

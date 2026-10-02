import { useEffect, useRef } from 'react';

// Сколько ждать, пока игра отправит сейвы перед закрытием рамки (rpg-fixes ждёт до 5 секунд)
const LEAVE_WAIT_MS = 6000;

// Игра на весь экран в рамке. Сама игра — на сервере игр (другой адрес), поэтому до страницы
// библиотеки ей не дотянуться; говорим с ней только сообщениями и только с её адреса.
// Уход из игры: «В библиотеку» или «Выход» в игре — rpg-fixes присылает rpg:leave, когда сейвы
// долетели. Кнопка «Назад» браузера — сначала просим игру уйти (rpg:leave-request) и ждём ответа.
// Адрес страницы на время игры — «?play=<игра>»: обновили страницу — игра откроется снова
const GameFrame = ({ game, url, origin, onClose }) => {
  const frameRef = useRef(null);
  // onClose у App новая на каждую отрисовку — держим последнюю, чтобы не перезапускать эффект
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => {
    let done = false;
    let timer = null;
    // Закрыть рамку. Ушли кнопкой в игре — убираем и «?play=» из истории
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (window.history.state?.rpgPlay === game.id) window.history.back();
      onCloseRef.current();
    };
    const onMessage = (e) => {
      if (e.origin !== origin || e.source !== frameRef.current?.contentWindow) return;
      if (e.data?.type === 'rpg:leave') finish();
    };
    // «Назад» в браузере: игра отправит сейвы и ответит rpg:leave; не ответила — закрываем сами
    const onPop = () => {
      if (done || window.history.state?.rpgPlay === game.id) return;
      frameRef.current?.contentWindow?.postMessage({ type: 'rpg:leave-request' }, origin);
      timer = setTimeout(finish, LEAVE_WAIT_MS);
    };

    if (window.history.state?.rpgPlay !== game.id) {
      const params = new URLSearchParams(window.location.search);
      params.set('play', game.id);
      window.history.pushState({ rpgPlay: game.id }, '', `${window.location.pathname}?${params}`);
    }
    window.addEventListener('message', onMessage);
    window.addEventListener('popstate', onPop);
    // Страница под игрой не прокручивается
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      window.removeEventListener('popstate', onPop);
      document.body.style.overflow = overflow;
    };
  }, [game.id, origin]);

  return (
    <div className="game-frame">
      <iframe
        ref={frameRef}
        src={url}
        title={game.displayTitle || game.title || game.id}
        // Без allow-top-navigation: игра не уведёт страницу библиотеки. allow-same-origin — у игры
        // свой адрес (не библиотеки), ей нужно своё хранилище
        sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-modals allow-downloads allow-popups allow-popups-to-escape-sandbox allow-orientation-lock"
        allow="fullscreen; autoplay; gamepad; screen-wake-lock"
        allowFullScreen
        onLoad={() => frameRef.current?.focus()}
      />
    </div>
  );
};

export default GameFrame;

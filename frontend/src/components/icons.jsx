import React from 'react';

// Значки меню одним стилем: тонкая линия, цвет берётся от текста (currentColor),
// поэтому при наведении они золотеют вместе с подписью. Эмодзи так не умеют —
// у каждого свои цвета, и в тёмно-золотой теме они выглядели чужими.
const Icon = ({ children }) => (
  <svg
    viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
  >
    {children}
  </svg>
);

export const IconStats = () => (
  <Icon>
    <path d="M4 20h16" />
    <path d="M7 16v-5" />
    <path d="M12 16V6" />
    <path d="M17 16v-8" />
  </Icon>
);

export const IconAudit = () => (
  <Icon>
    <rect x="5" y="4.5" width="14" height="16" rx="2" />
    <path d="M9 3h6v3H9z" />
    <path d="M9 13l2.2 2.2L15.5 11" />
  </Icon>
);

export const IconLogout = () => (
  <Icon>
    <path d="M14 4H6.5A1.5 1.5 0 0 0 5 5.5v13A1.5 1.5 0 0 0 6.5 20H14" />
    <path d="M11 12h9" />
    <path d="M17 9l3 3-3 3" />
  </Icon>
);

export const IconEdit = () => (
  <Icon>
    <path d="M4 20h4L19 9l-4-4L4 16v4z" />
    <path d="M13.5 6.5l4 4" />
  </Icon>
);

// Бэкап сейвов — скачать к себе, импорт — загрузить обратно
export const IconDownload = () => (
  <Icon>
    <path d="M12 4v11" />
    <path d="M8 11l4 4 4-4" />
    <path d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" />
  </Icon>
);

export const IconUpload = () => (
  <Icon>
    <path d="M12 15V4" />
    <path d="M8 8l4-4 4 4" />
    <path d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" />
  </Icon>
);

export const IconTrash = () => (
  <Icon>
    <path d="M4 7h16" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
    <path d="M6 7l1 12.5A1.5 1.5 0 0 0 8.5 21h7a1.5 1.5 0 0 0 1.5-1.5L18 7" />
    <path d="M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7" />
  </Icon>
);

export const IconSearch = () => (
  <Icon>
    <circle cx="10.5" cy="10.5" r="6" />
    <path d="M15 15l5 5" />
  </Icon>
);

// Новинки игр: свиток со звёздочкой
export const IconNews = () => (
  <Icon>
    <path d="M5 4.5h10.5a1.5 1.5 0 0 1 1.5 1.5v13.5l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5-2 1.5V6A1.5 1.5 0 0 1 5 4.5z" transform="translate(1 0)" />
    <path d="M9 9h6M9 12.5h4" />
    <path d="M19.5 3.5v3M18 5h3" />
  </Icon>
);

// Проверить обновления: круговая стрелка
export const IconRefresh = () => (
  <Icon>
    <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
    <path d="M19.5 4v4h-4" />
  </Icon>
);

// Галерея: картинка с горами
export const IconImage = () => (
  <Icon>
    <rect x="3.5" y="5" width="17" height="14" rx="2" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="M4 17l5-5 4 4 3-3 4 4" />
  </Icon>
);

// Во что поиграть: игральная кость
export const IconDice = () => (
  <Icon>
    <rect x="4" y="4" width="16" height="16" rx="3" />
    <circle cx="9" cy="9" r="1" />
    <circle cx="15" cy="15" r="1" />
    <circle cx="15" cy="9" r="1" />
    <circle cx="9" cy="15" r="1" />
  </Icon>
);

// Telegram: бумажный самолётик
export const IconSend = () => (
  <Icon>
    <path d="M20.5 3.5L3.5 10.5l6.5 2.5 2.5 6.5z" />
    <path d="M20.5 3.5L10 13" />
  </Icon>
);

// История сейвов: часы со стрелкой назад
export const IconHistory = () => (
  <Icon>
    <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
    <path d="M4.5 4v4h4" />
    <path d="M12 8v4.5l3 1.8" />
  </Icon>
);

// Хочу поиграть: звезда. Закрашивается стилем (.on), когда игра в списке
export const IconStar = () => (
  <Icon>
    <path d="M12 3.8l2.5 5.1 5.6.8-4 3.9.9 5.6L12 16.6l-5 2.6.9-5.6-4-3.9 5.6-.8z" />
  </Icon>
);

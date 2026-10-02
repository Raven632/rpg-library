import React from 'react';
import HeaderMenu from './HeaderMenu';

const LANGUAGES = [['ru', 'Русский'], ['en', 'English'], ['de', 'Deutsch']];

// Шапка как переплёт гримуара: девиз мелкой строкой, название между ромбами
// с расходящимися линиями, внизу — золотая нить с застёжкой посередине.
// Девиз стоит над названием не случайно: шапка прилипает с отрицательным отступом,
// и при прокрутке он сам уходит за край — остаётся узкая полоса с названием.
// Никакого слежения за прокруткой и никаких рывков страницы.
// Язык, место на диске и «Выйти» — мелкой строкой внизу меню «⋯»: нужны редко
const Header = ({ currentLang, onLangChange, t, menuItems, onLogout, children }) => {
  return (
    <header>
      <p className="header-motto">{t.subtitle}</p>
      <div className="header-inner">
        <div className="header-side" aria-hidden="true"></div>

        <div className="brand">
          <span className="brand-rule" aria-hidden="true"></span>
          <span className="brand-gem" aria-hidden="true"></span>
          <h1 className="brand-title">RPG Library</h1>
          <span className="brand-gem" aria-hidden="true"></span>
          <span className="brand-rule" aria-hidden="true"></span>
        </div>

        <div className="header-side">
          <HeaderMenu items={menuItems} label={t.menu_more}>
            {children}
            <div className="menu-footer-row">
              <div className="menu-langs" role="group" aria-label={t.menu_language}>
                {LANGUAGES.map(([code, name]) => (
                  <button
                    key={code}
                    type="button"
                    className={`menu-lang ${currentLang === code ? 'active' : ''}`}
                    aria-pressed={currentLang === code}
                    aria-label={name}
                    title={name}
                    onClick={() => onLangChange(code)}
                  >
                    {code.toUpperCase()}
                  </button>
                ))}
              </div>
              {onLogout && <button type="button" className="menu-logout" onClick={onLogout}>{t.logout}</button>}
            </div>
          </HeaderMenu>
        </div>
      </div>
    </header>
  );
};

export default Header;

import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './ui/App';
import { Popup } from './ui/Popup';
import { setUiLanguage, t, uiLanguage } from './shared/i18n';
import { loadUiLanguage } from './shared/storage';
import './ui/styles.css';

const popup = location.pathname.endsWith('popup.html');

void loadUiLanguage()
  .then(setUiLanguage)
  .catch(() => undefined)
  .finally(() => {
    document.documentElement.lang = uiLanguage();
    if (popup)
      document.title = t(
        'Subline 双语字幕',
        'Subline bilingual subtitles',
        'Subline 雙語字幕',
        'Subline 二言語字幕',
      );
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode>{popup ? <Popup /> : <App />}</React.StrictMode>,
    );
  });

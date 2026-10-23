import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './ui/App';
import { Popup } from './ui/Popup';
import { t, uiLanguage } from './shared/i18n';
import './ui/styles.css';

const popup = location.pathname.endsWith('popup.html');
document.documentElement.lang = uiLanguage;
document.title = popup
  ? t('Subline 双语字幕', 'Subline bilingual subtitles')
  : t('Subline · 双语字幕设置', 'Subline · Subtitle settings');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{popup ? <Popup /> : <App />}</React.StrictMode>,
);

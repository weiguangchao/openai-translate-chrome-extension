import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './ui/App';
import { Popup } from './ui/Popup';
import './ui/styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {location.pathname.endsWith('popup.html') ? <Popup /> : <App />}
  </React.StrictMode>,
);

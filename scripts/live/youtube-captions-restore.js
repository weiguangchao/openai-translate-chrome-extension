// Puts back the viewer's saved CC choice that youtube-captions-on.js recorded.
(() => {
  if (!('ccBefore' in window)) return { restored: false };
  if (window.ccBefore === null) localStorage.removeItem('yt-player-sticky-caption');
  else localStorage.setItem('yt-player-sticky-caption', window.ccBefore);
  return { restored: true };
})();

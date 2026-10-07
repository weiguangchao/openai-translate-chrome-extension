// Passes once YouTube's own captions show. Subline reuses the player's caption request, so
// without them it has nothing to translate. Clicking CC once is not enough: the button can
// read pressed while the player fetches nothing, so every 6 s without a caption it turns CC
// off and on again. Keeps the viewer's saved CC choice for youtube-captions-restore.js.
(() => {
  const player = document.querySelector('#movie_player');
  const button = document.querySelector('.ytp-subtitles-button');
  const video = document.querySelector('video');
  if (!player || !button || !video || video.paused) return null;
  if (player.classList.contains('ad-showing') || button.offsetParent === null) return null;
  if (!('ccBefore' in window)) window.ccBefore = localStorage.getItem('yt-player-sticky-caption');
  const cc = (window.__cc = window.__cc || { at: 0, toggles: 0 });
  if (document.querySelector('.ytp-caption-segment'))
    return { captions: true, toggles: cc.toggles, time: Math.round(video.currentTime) };
  if (Date.now() - cc.at > 6000) {
    cc.at = Date.now();
    cc.toggles++;
    if (button.getAttribute('aria-pressed') === 'true') button.click();
    button.click();
  }
  return null;
})();

export const PLAYER = '.html5-video-player';
export const CAPTION_LAYER = '.ytp-caption-window-container';

export function youtubeVideoId(): string {
  return new URL(location.href).searchParams.get('v') ?? location.pathname.split('/')[2] ?? '';
}

export function subtitlesHidden(element: Element): boolean {
  return Boolean(
    element.closest('.ad-showing') ||
    element
      .closest(PLAYER)
      ?.querySelector('.ytp-subtitles-button')
      ?.getAttribute('aria-pressed') === 'false',
  );
}

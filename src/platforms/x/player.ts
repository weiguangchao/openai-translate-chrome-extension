import { visible } from '../../core/dom';
import { languageTrack } from '../../core/languages';
import { captionText } from '../../core/native';
import type { LiveCaption } from '../../core/platform';

export const PLAYER = '[data-testid="videoPlayer"]';

function viewportArea(video: HTMLVideoElement): number {
  const rect = video.getBoundingClientRect();
  const width = Math.min(rect.right, innerWidth) - Math.max(rect.left, 0);
  const height = Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0);
  return width > 1 && height > 1 ? width * height : 0;
}

export function activeXVideo(): HTMLVideoElement | undefined {
  const fullscreen = document.fullscreenElement;
  let active: HTMLVideoElement | undefined;
  let best = 0;
  for (const video of document.querySelectorAll('video')) {
    if (video.ended || (fullscreen && !fullscreen.contains(video))) continue;
    const area = viewportArea(video);
    const score = area && area + (video.paused ? 0 : innerWidth * innerHeight);
    if (score > best && visible(video)) {
      best = score;
      active = video;
    }
  }
  return active;
}

export function xVideoId(): string {
  return JSON.stringify([location.pathname, activeXVideo()?.currentSrc ?? null]);
}

export function findXPlayer(video: HTMLVideoElement): HTMLElement | null {
  return video.closest<HTMLElement>(PLAYER) ?? video.parentElement;
}

export function readXCaption(video: HTMLVideoElement, sourceLanguage: string): LiveCaption {
  const tracks = [...video.textTracks].filter(
    (track) => track.mode !== 'disabled' && ['subtitles', 'captions'].includes(track.kind),
  );
  const track = languageTrack(tracks, (track) => track.language, sourceLanguage);
  const text = track?.activeCues ? [...track.activeCues].map(captionText).join('\n').trim() : '';
  return { text, layers: [], nativeTrack: Boolean(text) };
}

import { captionBoxes, domCaptionText } from '../../core/dom';
import { activeTrackCaption } from '../../core/native';
import type { LiveCaption } from '../../core/platform';

export const CAPTION_LAYERS =
  '[data-testid="caption_renderer_overlay"], #caption_renderer_overlay, [data-testid="CueBoxContainer"], [data-testid="subtitles"], [data-testid="subtitle-text"], [data-testid="cue"], [class*="SubtitleRenderer"], [class*="CaptionsRenderer"], .shaka-text-container, .vjs-text-track-display';
const PLAYER_ROOT =
  '[data-testid="player-container"], [data-testid="playerContainer"], [data-testid="player-root-element"], [data-testid="video-player"], [data-testid="video-player-container"], #layer-root-player-screen, .shaka-video-container, .video-js';

export function hboVideoId(): string {
  return `${location.origin}${location.pathname}`;
}

export function findHboPlayer(video: HTMLVideoElement): HTMLElement | null {
  const root = video.closest<HTMLElement>(PLAYER_ROOT);
  if (root?.matches('.shaka-video-container, .video-js')) return root;
  let parent = root ?? video.parentElement;
  for (
    let depth = 0;
    parent && parent !== document.body && depth < 12;
    depth++, parent = parent.parentElement
  ) {
    if (parent.querySelector(CAPTION_LAYERS) && parent.querySelectorAll('video').length === 1)
      return parent;
  }
  return root ?? video.parentElement;
}

export function readHboCaption(
  player: HTMLElement,
  video: HTMLVideoElement,
  sourceLanguage: string,
): LiveCaption {
  for (const element of player.querySelectorAll<HTMLElement>(CAPTION_LAYERS)) {
    const text = domCaptionText(element);
    if (text)
      return { text, layers: [element, ...captionBoxes(player, element)], nativeTrack: false };
  }
  return activeTrackCaption(video, sourceLanguage);
}

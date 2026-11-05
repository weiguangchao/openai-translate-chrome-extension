import { visible } from '../../src/core/dom';
import { NativeTimeline } from '../../src/core/native';
import { readXCaption } from '../../src/platforms/x/player';
import type { LiveCaption, PlatformFactory } from '../../src/core/platform';

function readCaption(player: HTMLElement, video: HTMLVideoElement): LiveCaption {
  const layer = player.querySelector<HTMLElement>('[data-caption-layer]');
  const text = layer && visible(layer) && layer.textContent?.trim();
  return layer && text ? { text, layers: [layer], nativeTrack: false } : readXCaption(video, null);
}

export const createTestPlatform: PlatformFactory = (changed) => {
  const native = new NativeTimeline(changed);
  return {
    id: 'youtube',
    style: '',
    videoId: () => 'fixture-video',
    findPlayer: (video) => video.closest<HTMLElement>('[data-player]') ?? video.parentElement,
    toolbar: () => null,
    source(video, player) {
      const state = native.read(video);
      return state.source
        ? {
            kind: 'timeline',
            mode: state.mode,
            language: state.language,
            cues: state.source,
            layers: () => [...player.querySelectorAll<HTMLElement>('[data-caption-layer]')],
          }
        : {
            kind: 'live',
            mode: state.mode,
            language: state.language,
            read: () => readCaption(player, video),
          };
    },
    reset: () => native.reset(),
    destroy: () => native.reset(),
  };
};

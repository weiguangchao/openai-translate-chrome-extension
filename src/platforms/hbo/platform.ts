import { BridgeTimeline } from '../../core/bridge/client';
import { NativeTimeline } from '../../core/native';
import type { Platform, PlatformFactory } from '../../core/platform';
import { CAPTION_LAYERS, findHboPlayer, hboVideoId, readHboCaption } from './player';

export const createHboPlatform: PlatformFactory = (changed): Platform => {
  const bridge = new BridgeTimeline('hbo', changed);
  const native = new NativeTimeline();
  return {
    id: 'hbo',
    style: '',
    videoId: hboVideoId,
    findPlayer: findHboPlayer,
    source(video, player, sourceLanguage) {
      const bridged = bridge.read(hboVideoId(), sourceLanguage);
      const state =
        bridged && (bridged.source !== null || bridged.mode !== 'model')
          ? bridged
          : native.read(video, sourceLanguage);
      if (state.source)
        return {
          kind: 'timeline',
          mode: state.mode,
          id: state.sourceId,
          cues: state.source,
          layers: () => [...player.querySelectorAll<HTMLElement>(CAPTION_LAYERS)],
        };
      return {
        kind: 'live',
        mode: state.mode,
        id: state.sourceId,
        read: () => readHboCaption(player, video, sourceLanguage),
      };
    },
    reset() {
      bridge.reset();
      native.reset();
    },
    destroy() {
      bridge.destroy();
      native.reset();
    },
  };
};

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
    source(video, player) {
      const bridged = bridge.read(hboVideoId());
      const local = native.read(video);
      const state =
        bridged && (bridged.source !== null || bridged.mode !== 'model')
          ? bridged
          : { ...local, language: bridged?.language ?? local.language };
      if (state.source)
        return {
          kind: 'timeline',
          mode: state.mode,
          id: state.sourceId,
          language: state.language,
          cues: state.source,
          layers: () => [...player.querySelectorAll<HTMLElement>(CAPTION_LAYERS)],
        };
      return {
        kind: 'live',
        mode: state.mode,
        id: state.sourceId,
        language: state.language,
        read: () => readHboCaption(player, video),
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

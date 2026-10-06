import { BridgeTimeline } from '../../core/bridge/client';
import type { Platform, PlatformFactory } from '../../core/platform';
import { activeXVideo, findXPlayer, readXCaption, xVideoId } from './player';

export const createXPlatform: PlatformFactory = (changed): Platform => {
  const bridge = new BridgeTimeline('x', changed);
  return {
    id: 'x',
    style: '',
    videoId: xVideoId,
    findVideo: activeXVideo,
    findPlayer: findXPlayer,
    source(video, _player, sourceLanguage) {
      const state = bridge.read(xVideoId(), sourceLanguage);
      if (state?.source)
        return {
          kind: 'timeline',
          mode: state.mode,
          id: state.sourceId,
          cues: state.source,
          layers: () => [],
        };
      if (state?.mode === 'model')
        return {
          kind: 'live',
          mode: state.mode,
          id: state.sourceId,
          read: () => readXCaption(video, sourceLanguage),
        };
      return { kind: 'waiting', mode: state?.mode ?? 'checking', id: state?.sourceId };
    },
    reset: () => bridge.reset(),
    destroy: () => bridge.destroy(),
  };
};

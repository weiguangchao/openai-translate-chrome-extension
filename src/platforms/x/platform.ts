import { selectedTrack } from '../../core/native';
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
    toolbar(player) {
      const button = player.querySelector<HTMLElement>('button[aria-haspopup="menu"]');
      const container = button?.parentElement;
      return container && button ? { container, button } : null;
    },
    source(video) {
      const state = bridge.read(xVideoId());
      const language = state?.language ?? selectedTrack(video)?.language ?? null;
      if (state?.source)
        return {
          kind: 'timeline',
          mode: state.mode,
          id: state.sourceId,
          language,
          cues: state.source,
          layers: () => [],
        };
      if (state?.mode === 'model')
        return {
          kind: 'live',
          mode: state.mode,
          id: state.sourceId,
          language,
          read: () => readXCaption(video, state.language),
        };
      return {
        kind: 'waiting',
        mode: state?.mode ?? 'checking',
        id: state?.sourceId,
        language: state?.language ?? null,
      };
    },
    reset: () => bridge.reset(),
    destroy: () => bridge.destroy(),
  };
};

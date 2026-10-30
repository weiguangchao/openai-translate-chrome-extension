import { NativeTimeline, selectedTrack } from '../../core/native';
import { BridgeTimeline } from '../../core/bridge/client';
import { languageTrack } from '../../core/languages';
import type { Platform, PlatformFactory } from '../../core/platform';
import { activeXVideo, findXPlayer, readXCaption, xVideoId } from './player';

export const createXPlatform: PlatformFactory = (changed): Platform => {
  const bridge = new BridgeTimeline('x', changed);
  const native = new NativeTimeline();
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
      const bridged = bridge.read(xVideoId());
      const local = native.read(video);
      const useNativeTrack =
        !bridged ||
        bridged.language === null ||
        Boolean(languageTrack([local], (state) => state.language ?? '', bridged.language));
      const state =
        bridged && (bridged.source !== null || bridged.mode !== 'model' || !useNativeTrack)
          ? bridged
          : local;
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
          read: () => readXCaption(video, state === bridged ? state.language : null),
        };
      return {
        kind: 'waiting',
        mode: state?.mode ?? 'checking',
        id: state?.sourceId,
        language: state?.language ?? null,
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

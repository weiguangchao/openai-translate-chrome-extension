import { BridgeTimeline } from '../../core/bridge/client';
import type { Platform, PlatformFactory } from '../../core/platform';
import { CAPTION_LAYER, PLAYER, subtitlesHidden, youtubeVideoId } from './player';

export const createYoutubePlatform: PlatformFactory = (changed): Platform => {
  const bridge = new BridgeTimeline('youtube', changed);
  return {
    id: 'youtube',
    style: `.subline-player ${CAPTION_LAYER} { opacity: 0 !important; pointer-events: none !important; }`,
    videoId: youtubeVideoId,
    findPlayer: (video) => video.closest<HTMLElement>(PLAYER) ?? video.parentElement,
    source(video) {
      const state = bridge.read(youtubeVideoId());
      if (subtitlesHidden(video))
        return { kind: 'timeline', mode: 'checking', language: null, cues: [], layers: () => [] };
      if (!state?.source)
        return {
          kind: 'waiting',
          mode: state?.mode ?? 'checking',
          id: state?.sourceId,
          language: state?.language ?? null,
        };
      return {
        kind: 'timeline',
        mode: state.mode,
        id: state.sourceId,
        language: state.language,
        cues: state.source,
        layers: () => [],
      };
    },
    reset: () => bridge.reset(),
    destroy: () => bridge.destroy(),
  };
};

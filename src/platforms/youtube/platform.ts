import { BridgeTimeline } from '../../core/bridge/client';
import { pageTitle, type Platform, type PlatformFactory } from '../../core/platform';
import { CAPTION_LAYER, PLAYER, subtitlesHidden, youtubeVideoId } from './player';

export const createYoutubePlatform: PlatformFactory = (changed): Platform => {
  const bridge = new BridgeTimeline('youtube', changed);
  let hidden = false;
  return {
    id: 'youtube',
    style: `.subline-player.subline-captions ${CAPTION_LAYER} { opacity: 0 !important; pointer-events: none !important; }`,
    videoId: youtubeVideoId,
    title: () => pageTitle(/\s+-\s+YouTube$/),
    findPlayer: (video) => video.closest<HTMLElement>(PLAYER) ?? video.parentElement,
    toolbar(player) {
      const container = player.querySelector<HTMLElement>('.ytp-right-controls');
      const button = container?.querySelector<HTMLElement>('.ytp-settings-button');
      return container && button ? { container, button } : null;
    },
    source(video) {
      const nextHidden = subtitlesHidden(video);
      const state = bridge.read(youtubeVideoId(), hidden && !nextHidden);
      hidden = nextHidden;
      if (nextHidden)
        return { kind: 'timeline', mode: 'checking', language: null, cues: [], layers: () => [] };
      if (!state?.source)
        return {
          kind: 'waiting',
          mode: state?.mode ?? 'checking',
          id: state?.sourceId,
          language: state?.language ?? null,
          failure: state?.failure,
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

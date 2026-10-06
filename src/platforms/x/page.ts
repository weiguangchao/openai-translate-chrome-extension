import { servePageTimeline } from '../../core/bridge/page';
import { mediaIdentity } from '../../core/bridge/source-cache';
import { languageTrack } from '../../core/languages';
import { authoredSubtitleSentences } from '../../core/sentences';
import { fetchSubtitleText, loadWebVtt } from '../../core/webvtt';
import { parseXSubtitlePlaylist, xMediaUrl } from './captions';
import { activeXVideo, xVideoId } from './player';

interface SubtitleTrack {
  lang?: string;
  url?: string;
}
interface HlsPlayer {
  url?: string;
  media?: unknown;
  subtitleTracks?: SubtitleTrack[];
  subtitleTrack?: number;
}
interface Fiber {
  return?: Fiber;
  memoizedProps?: { value?: { playerApi?: { video?: { hlsJs?: HlsPlayer } } } };
}

function hlsPlayer(video: HTMLVideoElement): HlsPlayer | undefined {
  let element = video.parentElement;
  let key: string | undefined;
  for (let depth = 0; element && depth < 12; depth++, element = element.parentElement) {
    key = Object.keys(element).find((name) => name.startsWith('__reactFiber$'));
    if (key) break;
  }
  let fiber = key ? (element as unknown as Record<string, Fiber>)[key] : undefined;
  for (let depth = 0; fiber && depth < 40; depth++, fiber = fiber.return) {
    const hls = fiber.memoizedProps?.value?.playerApi?.video?.hlsJs;
    if (hls?.media === video) return hls;
  }
}

function playerState(sourceLanguage: string) {
  const video = activeXVideo();
  const hls = video && hlsPlayer(video);
  const url = typeof hls?.url === 'string' ? xMediaUrl(hls.url) : undefined;
  if (!hls || !url) return null;
  const tracks = Array.isArray(hls.subtitleTracks) ? hls.subtitleTracks : [];
  const index = hls.subtitleTrack;
  const selected = Number.isInteger(index) ? tracks[index!] : undefined;
  const source = selected
    ? (languageTrack([selected], (track) => track.lang ?? '', sourceLanguage) ??
      languageTrack(tracks, (track) => track.lang ?? '', sourceLanguage))
    : undefined;
  const playlist = typeof source?.url === 'string' ? xMediaUrl(source.url) : undefined;
  return { url, playlist };
}

servePageTimeline('x', {
  videoId: xVideoId,
  update(request, cache) {
    let player: ReturnType<typeof playerState> = null;
    try {
      player = playerState(request.sourceLanguage);
    } catch {}
    const videoId = JSON.stringify([request.videoId, player ? mediaIdentity(player.url) : null]);
    const playlist = player?.playlist;
    cache.select(videoId, playlist ? mediaIdentity(playlist) : '', request.sourceLanguage);
    if (!player && cache.state.mode !== 'model') cache.update({ mode: 'model' });
    else if (player && !playlist && cache.state.source === null) cache.update({ source: [] });
    if (playlist)
      cache.load(playlist, async (signal) => {
        const files = parseXSubtitlePlaylist(await fetchSubtitleText(playlist, signal), playlist);
        if (!files.length) throw new Error('Empty subtitle playlist');
        return authoredSubtitleSentences(
          await loadWebVtt(
            files.map((url) => ({ url, offset: 0 })),
            signal,
          ),
        );
      });
  },
});

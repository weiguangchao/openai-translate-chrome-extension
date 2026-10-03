import { servePageTimeline } from '../../core/bridge/page';
import { languageTrack } from '../../core/languages';
import { parseYoutubeCaptions, type YoutubeCaptionKind } from './captions';
import { PLAYER, subtitlesHidden, youtubeVideoId } from './player';

interface Track {
  baseUrl?: string;
  languageCode?: string;
  vssId?: string;
  kind?: string;
}
interface YoutubePlayer extends HTMLElement {
  getPlayerResponse?: () => {
    videoDetails?: { videoId?: string };
    captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: Track[] } };
  };
  getOption?: (module: string, option: string) => Track | undefined;
}
interface CaptionResource {
  id: string;
  url: string;
  kind: YoutubeCaptionKind;
}

const contextParameters = ['pot', 'potc', 'c', 'cver'] as const;
const requestContexts = new Map<string, { startedAt: number; parameters: URLSearchParams }>();

function timedtextUrl(value: string): URL | undefined {
  try {
    const url = new URL(value, location.origin);
    if (
      url.protocol === 'https:' &&
      /(^|\.)youtube\.com$/.test(url.hostname) &&
      url.pathname === '/api/timedtext'
    )
      return url;
  } catch {}
}

function contextKey(url: URL): string {
  return JSON.stringify([url.searchParams.get('v'), url.searchParams.get('ei')]);
}

function observeRequests(entries: PerformanceEntry[]): void {
  for (const entry of entries) {
    const url = timedtextUrl(entry.name);
    if (!url?.searchParams.get('v') || !url.searchParams.get('pot')) continue;
    const key = contextKey(url);
    if ((requestContexts.get(key)?.startedAt ?? -1) >= entry.startTime) continue;
    const parameters = new URLSearchParams();
    for (const name of contextParameters) {
      const value = url.searchParams.get(name);
      if (value) parameters.set(name, value);
    }
    requestContexts.set(key, { startedAt: entry.startTime, parameters });
    if (requestContexts.size > 8) requestContexts.delete(requestContexts.keys().next().value!);
  }
}

if (typeof PerformanceObserver !== 'undefined') {
  const observer = new PerformanceObserver((list) => observeRequests(list.getEntries()));
  observer.observe({ type: 'resource', buffered: true });
}

function trackResource(track: Track | undefined): CaptionResource | undefined {
  if (!track?.baseUrl) return;
  const url = timedtextUrl(track.baseUrl);
  if (!url) return;
  const context = requestContexts.get(contextKey(url));
  if (context) for (const [name, value] of context.parameters) url.searchParams.set(name, value);
  url.searchParams.set('fmt', 'json3');
  url.searchParams.delete('tlang');
  return {
    id: JSON.stringify([
      track.vssId ?? null,
      track.languageCode ?? url.searchParams.get('lang'),
      captionKind(track),
      url.searchParams.get('name'),
    ]),
    url: url.href,
    kind: captionKind(track)!,
  };
}

function captionKind(track: Track | undefined): YoutubeCaptionKind | null {
  return track
    ? track.kind === 'asr' || track.vssId?.startsWith('a.')
      ? 'asr'
      : 'authored'
    : null;
}

function select(videoId: string, sourceLanguage: string): CaptionResource | undefined {
  const player = document.querySelector<YoutubePlayer>(PLAYER);
  const response = player?.getPlayerResponse?.();
  const tracks = response?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (
    !player ||
    subtitlesHidden(player) ||
    response?.videoDetails?.videoId !== videoId ||
    !Array.isArray(tracks)
  )
    return;
  const selected = player.getOption?.('captions', 'track');
  const active =
    tracks.find((track) => selected?.vssId && track.vssId === selected.vssId) ??
    tracks.find(
      (track) => selected?.languageCode === track.languageCode && selected?.kind === track.kind,
    );
  const source =
    languageTrack(active ? [active] : [], (track) => track.languageCode ?? '', sourceLanguage) ??
    languageTrack(
      tracks.filter((track) => captionKind(track) === 'authored'),
      (track) => track.languageCode ?? '',
      sourceLanguage,
    ) ??
    languageTrack(tracks, (track) => track.languageCode ?? '', sourceLanguage);
  return trackResource(source);
}

servePageTimeline('youtube', {
  videoId: youtubeVideoId,
  update({ videoId, sourceLanguage }, cache) {
    let selected: CaptionResource | undefined;
    try {
      selected = select(videoId, sourceLanguage);
    } catch {}
    const source = selected;
    cache.select(videoId, source?.id ?? '', sourceLanguage);
    if (source)
      cache.load(source.url, async (signal) => {
        const response = await fetch(source.url, {
          credentials: 'same-origin',
          signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
        });
        if (!response.ok) throw new Error('Caption track unavailable');
        const cues = parseYoutubeCaptions(await response.json(), source.kind);
        if (!cues.length) throw new Error('Empty caption track');
        return cues;
      });
  },
});

window.addEventListener('pagehide', () => requestContexts.clear());

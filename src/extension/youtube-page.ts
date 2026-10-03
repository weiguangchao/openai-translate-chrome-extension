import { pageVideoId, SourceCache } from './source-cache';
import { parseYoutubeCaptions, type YoutubeCaptionKind } from './youtube-captions';
import { languageTrack } from './languages';

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

interface Selection {
  sourceKind?: YoutubeCaptionKind | null;
  source?: { id: string; url: string; kind: YoutubeCaptionKind };
}
const cache = new SourceCache(publish);
let latest: { requestId: number; revision: number } | undefined;

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

function trackResource(track: Track | undefined): Selection['source'] {
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

function select(videoId: string, sourceLanguage: string): Selection {
  const player = document.querySelector<YoutubePlayer>('.html5-video-player');
  const response = player?.getPlayerResponse?.();
  const tracks = response?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (
    !player ||
    player.classList.contains('ad-showing') ||
    player.querySelector('.ytp-subtitles-button')?.getAttribute('aria-pressed') === 'false' ||
    response?.videoDetails?.videoId !== videoId ||
    !Array.isArray(tracks)
  )
    return {};
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
  return {
    sourceKind: captionKind(source),
    source: trackResource(source),
  };
}

function publish(): void {
  if (!latest) return;
  window.postMessage(
    {
      type: 'subline:timeline-response',
      requestId: latest.requestId,
      revision: cache.revision,
      ...(latest.revision === cache.revision ? { unchanged: true } : { state: cache.state }),
    },
    location.origin,
  );
}

window.addEventListener('message', (event: MessageEvent) => {
  const data = event.data;
  if (event.source !== window || event.origin !== location.origin) return;
  if (data?.type === 'subline:timeline-stop' && data.requestId === latest?.requestId) {
    latest = undefined;
    cache.stop();
    return;
  }
  if (
    data?.type !== 'subline:timeline-request' ||
    !Number.isSafeInteger(data.requestId) ||
    typeof data.videoId !== 'string' ||
    data.videoId.length > 200 ||
    data.videoId !== pageVideoId() ||
    typeof data.sourceLanguage !== 'string' ||
    data.sourceLanguage.length > 40
  )
    return;
  let selection: Selection;
  try {
    selection = select(data.videoId, data.sourceLanguage);
  } catch {
    selection = {};
  }
  cache.select(data.videoId, selection.source?.id ?? '', data.sourceLanguage, selection.sourceKind);
  latest = { requestId: data.requestId, revision: data.revision };
  publish();
  const source = selection.source;
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
});

window.addEventListener('pagehide', () => {
  latest = undefined;
  cache.clear();
  requestContexts.clear();
});

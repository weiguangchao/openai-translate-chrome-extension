import { hboMediaUrl, parseHboManifest, parseHboVtt, type HboSubtitleTrack } from './hbo-captions';
import { languageTrack } from './languages';
import type { SubtitleTimeline, TimedCue } from './timeline';

interface TextSelection {
  language?: string;
  role?: string;
}
interface SelectionEvent {
  selectedTextTrack?: TextSelection | null;
}
interface Observable {
  subscribe(callback: (value: SelectionEvent) => void): { unsubscribe(): void };
}
interface Fiber {
  return?: Fiber;
  alternate?: Fiber;
  stateNode?: { current?: Fiber };
  memoizedProps?: {
    eventConsumer?: { selectedTextTrack$?: Observable };
    value?: { activeStreamInfo?: { url?: string; streamMode?: string } };
  };
}

function playerState() {
  const element = document.querySelector('[data-testid="caption_renderer_overlay"]');
  const key = element && Object.keys(element).find((key) => key.startsWith('__reactFiber$'));
  const attached = key ? (element as unknown as Record<string, Fiber>)[key] : undefined;
  for (const first of [attached, attached?.alternate]) {
    let fiber = first;
    let root = first;
    let stream: { url?: string; streamMode?: string } | undefined;
    let selection: Observable | undefined;
    for (let depth = 0; fiber && depth < 40; depth++, fiber = fiber.return) {
      root = fiber;
      stream ??= fiber.memoizedProps?.value?.activeStreamInfo;
      selection ??= fiber.memoizedProps?.eventConsumer?.selectedTextTrack$;
    }
    if (fiber || (root?.stateNode?.current && root.stateNode.current !== root)) continue;
    const url = stream?.url && hboMediaUrl(stream.url);
    if (!url || stream?.streamMode !== 'VOD' || typeof selection?.subscribe !== 'function')
      continue;
    let event: SelectionEvent | undefined;
    const subscription = selection.subscribe((value) => {
      event = value;
    });
    subscription.unsubscribe();
    return { url, selected: event?.selectedTextTrack, known: Boolean(event) };
  }
  return null;
}

let context = '';
let generation = 0;
let revision = 0;
let state: SubtitleTimeline = { mode: 'checking', source: null, translation: null };
let latest: { requestId: number; revision: number } | undefined;
let controller = new AbortController();
let pending = false;
let loaded = false;
let retryAt = 0;

function clear(): void {
  controller.abort();
  controller = new AbortController();
  context = '';
  generation++;
  revision++;
  latest = undefined;
  pending = false;
  loaded = false;
  retryAt = 0;
  state = { mode: 'checking', source: null, translation: null };
}

function publish(): void {
  if (!latest) return;
  window.postMessage(
    {
      type: 'subline:hbo-timeline-response',
      requestId: latest.requestId,
      generation,
      revision,
      ...(latest.revision === revision ? { unchanged: true } : { state }),
    },
    location.origin,
  );
}

async function resource(url: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(url, {
    credentials: 'omit',
    signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
  });
  if (!response.ok || Number(response.headers.get('content-length')) > 4_000_000)
    throw new Error('Subtitle resource unavailable');
  const text = await response.text();
  if (text.length > 4_000_000) throw new Error('Subtitle resource too large');
  return text;
}

async function loadTrack(track: HboSubtitleTrack, signal: AbortSignal): Promise<TimedCue[]> {
  const results: TimedCue[][] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, track.files.length) }, async () => {
      while (next < track.files.length) {
        const index = next++;
        const file = track.files[index];
        results[index] = parseHboVtt(await resource(file.url, signal), file.offset);
      }
    }),
  );
  const cues = results.flat().sort((a, b) => a.startTime - b.startTime || a.endTime - b.endTime);
  if (cues.length > 30000) throw new Error('Caption track too large');
  return cues.filter(
    (cue, index) =>
      !index ||
      cue.startTime !== cues[index - 1].startTime ||
      cue.endTime !== cues[index - 1].endTime ||
      cue.text !== cues[index - 1].text,
  );
}

function load(
  url: string,
  sourceLanguage: string,
  targetLanguage: string,
  selected: TextSelection,
): void {
  if (pending || loaded || Date.now() < retryAt) return;
  pending = true;
  const active = controller;
  void (async () => {
    try {
      const tracks = parseHboManifest(await resource(url, active.signal), url);
      if (active.signal.aborted) return;
      const role = selected.role === 'closedcaptions' ? 'caption' : 'subtitle';
      const preferred = [...tracks].sort(
        (a, b) => Number(b.role === role) - Number(a.role === role),
      );
      const source = languageTrack(preferred, (track) => track.language, sourceLanguage);
      const target = languageTrack(tracks, (track) => track.language, targetLanguage);
      state = {
        mode: target ? 'existing' : source ? 'checking' : 'model',
        source: null,
        translation: null,
      };
      revision++;
      publish();
      await Promise.all([
        source
          ? loadTrack(source, active.signal).then((cues) => {
              if (active.signal.aborted) return;
              state.source = cues;
              if (!target) state.mode = 'model';
              revision++;
              publish();
            })
          : undefined,
        target
          ? loadTrack(target, active.signal).then((cues) => {
              if (active.signal.aborted) return;
              state.translation = cues;
              revision++;
              publish();
            })
          : undefined,
      ]);
      if (!active.signal.aborted) loaded = true;
    } catch {
      if (active.signal.aborted) return;
      retryAt = Date.now() + 15000;
      if (state.mode !== 'existing') state.mode = 'model';
      revision++;
      publish();
    } finally {
      if (!active.signal.aborted) pending = false;
    }
  })();
}

window.addEventListener('message', (event: MessageEvent) => {
  const data = event.data;
  if (event.source !== window || event.origin !== location.origin) return;
  if (data?.type === 'subline:hbo-timeline-stop' && data.requestId === latest?.requestId) {
    clear();
    return;
  }
  if (
    data?.type !== 'subline:hbo-timeline-request' ||
    !Number.isSafeInteger(data.requestId) ||
    data.pageUrl !== location.href ||
    typeof data.sourceLanguage !== 'string' ||
    data.sourceLanguage.length > 40 ||
    typeof data.targetLanguage !== 'string' ||
    data.targetLanguage.length > 40
  )
    return;
  let player: ReturnType<typeof playerState> = null;
  try {
    player = playerState();
  } catch {}
  const key = JSON.stringify([
    data.pageUrl,
    data.sourceLanguage,
    data.targetLanguage,
    player,
    document.querySelector('video')?.currentSrc,
  ]);
  if (key !== context) {
    clear();
    context = key;
    if (!player) state.mode = 'model';
    else if (player.known && !player.selected?.language) state.source = [];
  }
  latest = { requestId: data.requestId, revision: data.revision };
  publish();
  if (player?.known && player.selected?.language)
    load(player.url, data.sourceLanguage, data.targetLanguage, player.selected);
});

window.addEventListener('pagehide', clear);

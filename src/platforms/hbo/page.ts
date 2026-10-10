import { servePageTimeline } from '../../core/bridge/page';
import { mediaIdentity } from '../../core/bridge/source-cache';
import { languageTrack } from '../../core/languages';
import { authoredSubtitleSentences } from '../../core/sentences';
import { fetchSubtitleText, loadWebVtt } from '../../core/webvtt';
import { hboMediaUrl, parseHboManifest } from './captions';
import { hboVideoId } from './player';

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

servePageTimeline('hbo', {
  videoId: hboVideoId,
  update(request, cache) {
    let player: ReturnType<typeof playerState> = null;
    try {
      player = playerState();
    } catch {}
    const videoId = JSON.stringify([request.videoId, player ? mediaIdentity(player.url) : null]);
    const role = player?.selected?.role === 'closedcaptions' ? 'caption' : 'subtitle';
    const selected = player?.selected;
    const selectedSource =
      selected &&
      languageTrack([selected], (track) => track.language ?? '', request.sourceLanguage);
    const language = selectedSource ? selectedSource.language! : request.sourceLanguage;
    const track = player?.known && selected?.language ? JSON.stringify([language, role]) : '';
    cache.select(videoId, track, request.sourceLanguage);
    if (!player && cache.state.mode !== 'model') cache.update({ mode: 'model' });
    else if (player?.known && !player.selected?.language && cache.state.source === null)
      cache.update({ source: [] });
    if (player?.known && player.selected?.language) {
      const url = player.url;
      cache.load(
        url,
        async (signal) => {
          const tracks = parseHboManifest(await fetchSubtitleText(url, signal), url);
          const preferred = [...tracks].sort(
            (a, b) => Number(b.role === role) - Number(a.role === role),
          );
          const source = languageTrack(preferred, (track) => track.language, language);
          return source
            ? authoredSubtitleSentences(
                await loadWebVtt(source.files, signal),
                request.sourceLanguage,
              )
            : [];
        },
        selectedSource ? null : [],
      );
    }
  },
});

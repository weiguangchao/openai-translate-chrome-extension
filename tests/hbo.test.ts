import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CaptionController } from '../src/extension/captions';
import { hboMediaUrl, parseHboManifest, parseHboVtt } from '../src/extension/hbo-captions';
import { HboTimeline } from '../src/extension/hbo-timeline';
import { TranslationQueue } from '../src/extension/queue';
import { DEFAULT_SETTINGS, publicSettings } from '../src/shared/settings';
import { providerReply, requestedTexts } from './fixtures/provider';

const mediaUrl = 'https://cdn.prd.media.h264.io/episode/manifest.mpd';
const edgeMediaUrl = 'https://v4-e-cebcc-lax-csla2-01-wm.e.hbo/episode/manifest.mpd';
const settings = { ...DEFAULT_SETTINGS, apiKey: 'test', model: 'model' };
let controller: CaptionController | undefined;
let video: HTMLVideoElement;
let selected: { language: string; role: string } | null;
let stream: { url: string; streamMode: string };
let queue: TranslationQueue;
const requested: { at: number; texts: string[]; signal: AbortSignal }[] = [];
let targetLanguage = '';
let failTarget = false;

function manifest(languages = ['en-US', ...(targetLanguage ? [targetLanguage] : [])]): string {
  return `<MPD type="static" mediaPresentationDuration="PT90S">
    ${[0, 1, 2]
      .map(
        (period) => `<Period start="PT${period * 30}S" duration="PT30S">
      ${languages
        .map(
          (language) => `<AdaptationSet contentType="text" lang="${language}">
        <Role value="caption"/><Representation id="${language}" mimeType="text/vtt">
          <SegmentTemplate media="$RepresentationID$/$Number$.vtt" startNumber="${period + 1}" timescale="1000" presentationTimeOffset="${period * 30000}">
            <SegmentTimeline><S t="${period * 30000}" d="30000"/></SegmentTimeline>
          </SegmentTemplate>
        </Representation>
      </AdaptationSet>`,
        )
        .join('')}
    </Period>`,
      )
      .join('')}
  </MPD>`;
}

function alternateTrackManifest(
  periodTracks = [
    ['t3', 't6'],
    ['t6', 't3'],
    ['t3', 't6'],
  ],
): string {
  return `<MPD type="static" mediaPresentationDuration="PT90S">${periodTracks
    .map(
      (tracks, period) => `
    <Period start="PT${period * 30}S" duration="PT30S">${tracks
      .map(
        (id) => `
      <AdaptationSet id="${id}" contentType="text" lang="en-US"><Role value="caption"/>
        <Representation id="${id}" mimeType="text/vtt">
          <SegmentTemplate media="${id}/$Number$.vtt" startNumber="${period + 1}" timescale="1000" presentationTimeOffset="${period * 30000}">
            <SegmentTimeline><S t="${period * 30000}" d="30000"/></SegmentTimeline>
          </SegmentTemplate>
        </Representation>
      </AdaptationSet>`,
      )
      .join('')}
    </Period>`,
    )
    .join('')}
  </MPD>`;
}

function stamp(seconds: number): string {
  return `00:${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}.000`;
}

function vtt(part: number, language: string): string {
  return `WEBVTT\nX-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:0\n\n${Array.from(
    { length: 10 },
    (_, index) => {
      const time = (part - 1) * 30 + index * 3 + 3;
      return `${stamp(time)} --> ${stamp(time + 2)} position:50%\n<i>${language === 'en-US' ? 'Cue' : '已有字幕'} ${(part - 1) * 10 + index + 1}</i>\n\n`;
    },
  ).join('')}`;
}

beforeEach(async () => {
  vi.useFakeTimers();
  requested.length = 0;
  targetLanguage = '';
  failTarget = false;
  history.replaceState(null, '', '/video/watch/episode-1');
  document.body.innerHTML =
    '<div data-testid="playerContainer"><video></video><div data-testid="caption_renderer_overlay"></div></div>';
  video = document.querySelector('video')!;
  Object.defineProperties(video, {
    readyState: { value: 1 },
    paused: { value: false, configurable: true },
    textTracks: { value: [] },
    currentSrc: { value: 'blob:episode-1', configurable: true },
  });
  selected = { language: 'en-US', role: 'closedcaptions' };
  stream = { url: mediaUrl, streamMode: 'VOD' };
  Object.assign(document.querySelector('[data-testid="caption_renderer_overlay"]')!, {
    __reactFiber$test: {
      return: {
        memoizedProps: {
          eventConsumer: {
            selectedTextTrack$: {
              subscribe: (callback: (event: unknown) => void) => {
                callback({ selectedTextTrack: selected });
                return { unsubscribe() {} };
              },
            },
          },
        },
        return: { memoizedProps: { value: { activeStreamInfo: stream } } },
      },
    },
  });
  vi.spyOn(window, 'postMessage').mockImplementation((data) => {
    const copy = structuredClone(data);
    queueMicrotask(() =>
      window.dispatchEvent(
        new MessageEvent('message', {
          source: window,
          origin: location.origin,
          data: copy,
        }),
      ),
    );
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      if (new URL(url).pathname.endsWith('.mpd')) return new Response(manifest());
      if (url.endsWith('.vtt')) {
        if (failTarget && !url.includes('/en-US/')) throw new Error('Unavailable');
        return new Response(
          vtt(
            Number(url.match(/\/(\d)\.vtt/)![1]),
            url.includes('/en-US/') ? 'en-US' : targetLanguage,
          ),
        );
      }
      const texts = requestedTexts(init);
      requested.push({ at: video.currentTime, texts, signal: init.signal! });
      return new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(
          () => resolve(providerReply(texts, (text) => `译文 ${text}`)),
          2000,
        );
        init.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    }),
  );
  queue = new TranslationQueue();
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'extension-id',
      sendMessage: async (message: {
        type: string;
        text: string;
        texts: string[];
        segments?: number[];
        pause?: boolean;
        cacheOnly?: boolean;
      }) => {
        if (message.type === 'prefetch') {
          if (message.pause !== undefined) {
            if (message.pause) queue.pause('hbo');
            else queue.resume('hbo');
            return { ok: true };
          }
          return {
            ok: true,
            data: await queue.prefetch('hbo', settings, message.texts, message.segments),
          };
        }
        if (message.type === 'translate')
          return {
            ok: true,
            data: await (message.cacheOnly
              ? queue.lookup(settings, message.text)
              : queue.request('hbo', settings, message.text)),
          };
        return { ok: true };
      },
    },
  });
  await import('../src/extension/hbo-page');
});

afterEach(async () => {
  controller?.destroy();
  controller = undefined;
  queue.reset();
  window.dispatchEvent(new Event('pagehide'));
  await vi.advanceTimersByTimeAsync(0);
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

const lines = () =>
  document
    .querySelector('[data-subline-overlay]')
    ?.shadowRoot?.querySelectorAll<HTMLElement>('.line');

async function playTo(time: number): Promise<void> {
  while (video.currentTime < time) {
    video.currentTime = Math.min(time, video.currentTime + 1);
    video.dispatchEvent(new Event('timeupdate'));
    await vi.advanceTimersByTimeAsync(1000);
  }
}

it.each([mediaUrl, edgeMediaUrl])(
  'prefetches two segments from %s without TextTrack or visible cues, hiding the two-second provider latency',
  async (url) => {
    stream.url = url;
    controller = new CaptionController(publicSettings(settings));
    await vi.advanceTimersByTimeAsync(0);
    expect(requested.map((request) => request.texts)).toEqual([
      Array.from({ length: 10 }, (_, i) => `Cue ${i + 1}`),
      Array.from({ length: 10 }, (_, i) => `Cue ${i + 11}`),
    ]);
    expect(requested.every((request) => request.at === 0)).toBe(true);
    await playTo(3);
    expect(lines()?.[0].textContent).toBe('Cue 1');
    expect(lines()?.[1].textContent).toBe('译文 Cue 1');
    expect(lines()?.[1].hidden).toBe(false);
    await playTo(33);
    expect(lines()?.[1].textContent).toBe('译文 Cue 11');
    expect(requested[2].texts).toEqual(Array.from({ length: 10 }, (_, i) => `Cue ${i + 21}`));
    expect(requested[2].at).toBeLessThan(63);
    await playTo(63);
    expect(lines()?.[1].textContent).toBe('译文 Cue 21');
    expect(requested).toHaveLength(3);
  },
);

it('displays streamed HBO translations before either prefetched segment finishes', async () => {
  stream.url = edgeMediaUrl;
  const originalFetch = fetch;
  const batches: { texts: string[]; control: ReadableStreamDefaultController<Uint8Array> }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      if (!new URL(url).pathname.endsWith('/chat/completions')) return originalFetch(url, init);
      expect(JSON.parse(init.body as string).stream).toBe(true);
      const body = new ReadableStream<Uint8Array>({
        start(control) {
          batches.push({ texts: requestedTexts(init), control });
          init.signal?.addEventListener('abort', () =>
            control.error(new DOMException('Aborted', 'AbortError')),
          );
        },
      });
      return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
    }),
  );
  const delta = (content: string) =>
    `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
  const push = (index: number, content: string) =>
    batches[index].control.enqueue(new TextEncoder().encode(delta(content)));
  controller = new CaptionController(publicSettings(settings));
  await vi.advanceTimersByTimeAsync(0);
  expect(batches.map(({ texts }) => texts)).toEqual([
    Array.from({ length: 10 }, (_, i) => `Cue ${i + 1}`),
    Array.from({ length: 10 }, (_, i) => `Cue ${i + 11}`),
  ]);
  await playTo(3);
  await vi.advanceTimersByTimeAsync(300);
  expect(lines()?.[1].textContent).toBe('翻译中');
  push(0, '{"translations":["译文 Cue 1",');
  await vi.advanceTimersByTimeAsync(0);
  expect(lines()?.[1].textContent).toBe('译文 Cue 1');
  expect(lines()?.[0].textContent).toBe('Cue 1');
  push(
    0,
    `${batches[0].texts
      .slice(1)
      .map((text) => JSON.stringify(`译文 ${text}`))
      .join(',')}]}`,
  );
  push(1, JSON.stringify({ translations: batches[1].texts.map((text) => `译文 ${text}`) }));
  for (const { control } of batches) {
    control.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
    control.close();
  }
  await vi.advanceTimersByTimeAsync(0);
});

it('displays and translates one HBO track when alternate tracks have overlapping dialogue', async () => {
  const originalFetch = fetch;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      if (new URL(url).pathname.endsWith('.mpd')) return new Response(alternateTrackManifest());
      if (url.endsWith('.vtt')) {
        const text = vtt(Number(url.match(/\/(\d)\.vtt/)![1]), 'en-US');
        return new Response(url.includes('/t6/') ? text.replaceAll('.000', '.200') : text);
      }
      return originalFetch(url, init);
    }),
  );
  controller = new CaptionController(publicSettings(settings));
  for (const [time, cue] of [
    [4, 1],
    [34, 11],
    [64, 21],
  ]) {
    await playTo(time);
    expect(document.querySelectorAll('[data-subline-overlay]')).toHaveLength(1);
    expect(lines()?.[0].textContent).toBe(`Cue ${cue}`);
    expect(lines()?.[1].textContent).toBe(`译文 Cue ${cue}`);
  }
  expect(requested.map(({ texts }) => texts)).toEqual(
    [0, 1, 2].map((segment) => Array.from({ length: 10 }, (_, i) => `Cue ${segment * 10 + i + 1}`)),
  );
  const subtitles = vi
    .mocked(fetch)
    .mock.calls.map(([url]) => String(url))
    .filter((url) => url.endsWith('.vtt'));
  expect(subtitles).toEqual([1, 2, 3].map((part) => new URL(`t3/${part}.vtt`, mediaUrl).href));
});

it('accepts HBO edge subtitle URLs while rejecting lookalike hosts and unsafe URLs', () => {
  expect(hboMediaUrl(edgeMediaUrl)).toBe(edgeMediaUrl);
  expect(hboMediaUrl('subtitles/en.vtt', edgeMediaUrl)).toBe(
    'https://v4-e-cebcc-lax-csla2-01-wm.e.hbo/episode/subtitles/en.vtt',
  );
  for (const url of [
    'https://fake.hbo/manifest.mpd',
    'https://fake-e.hbo/manifest.mpd',
    'https://e.hbo.untrusted.example/manifest.mpd',
    'https://user:password@cdn.e.hbo/manifest.mpd',
    edgeMediaUrl.replace('https:', 'http:'),
  ])
    expect(hboMediaUrl(url)).toBeUndefined();
});

it('cancels old model requests after seeking and ignores their late results', async () => {
  controller = new CaptionController(publicSettings(settings));
  await vi.advanceTimersByTimeAsync(0);
  video.currentTime = 65;
  video.dispatchEvent(new Event('seeking'));
  video.dispatchEvent(new Event('seeked'));
  await vi.advanceTimersByTimeAsync(400);
  expect(requested.slice(0, 2).every((request) => request.signal.aborted)).toBe(true);
  expect(requested.at(-1)?.texts[0]).toBe('Cue 22');
  await vi.advanceTimersByTimeAsync(2400);
  video.currentTime = 66;
  video.dispatchEvent(new Event('timeupdate'));
  await vi.advanceTimersByTimeAsync(0);
  expect(lines()?.[1].textContent).toBe('译文 Cue 22');
});

it.each([true, false])(
  'ignores HBO target subtitles and requires a provider, configured=%s',
  async (configured) => {
    targetLanguage = 'zh-Hans';
    controller = new CaptionController({ ...publicSettings(settings), configured });
    await playTo(3);
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/zh-Hans/'))).toBe(
      false,
    );
    if (configured) {
      expect(lines()?.[1].textContent).toBe('译文 Cue 1');
      expect(requested).toHaveLength(2);
    } else {
      expect(lines()).toBeUndefined();
      expect(requested).toEqual([]);
    }
  },
);

it('does not download a target track even when it would fail', async () => {
  targetLanguage = 'zh-CN';
  failTarget = true;
  controller = new CaptionController(publicSettings(settings));
  await playTo(4);
  expect(lines()?.[1].textContent).toBe('译文 Cue 1');
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/zh-CN/'))).toBe(false);
  expect(requested).toHaveLength(2);
});

it('stops prefetch and clears the displayed subtitles when the HBO selection is off', async () => {
  controller = new CaptionController(publicSettings(settings));
  await playTo(3);
  expect(lines()?.[1].textContent).toBe('译文 Cue 1');
  selected = null;
  await vi.advanceTimersByTimeAsync(1200);
  expect(lines()?.[0].hidden).toBe(true);
  expect(lines()?.[1].hidden).toBe(true);
  const count = requested.length;
  await playTo(33);
  expect(requested).toHaveLength(count);
});

it('aborts subtitle downloads when switching episode or disabling the extension', async () => {
  const signals: AbortSignal[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init: RequestInit) => {
      signals.push(init.signal!);
      return new Promise<Response>((_resolve, reject) =>
        init.signal?.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')),
        ),
      );
    }),
  );
  controller = new CaptionController(publicSettings(settings));
  await vi.advanceTimersByTimeAsync(0);
  expect(signals).toHaveLength(1);
  history.replaceState(null, '', '/video/watch/episode-2');
  stream.url = mediaUrl.replace('episode', 'next');
  await vi.advanceTimersByTimeAsync(1200);
  expect(signals[0].aborted).toBe(true);
  expect(signals).toHaveLength(2);
  controller.update({ ...publicSettings(settings), enabled: false });
  await vi.advanceTimersByTimeAsync(0);
  expect(signals[1].aborted).toBe(true);
});

it('keeps DOM translation available when the HBO player adapter is unavailable', async () => {
  document.querySelector('[data-testid="caption_renderer_overlay"]')!.textContent = 'DOM cue';
  stream.streamMode = 'LIVE';
  controller = new CaptionController(publicSettings(settings));
  await vi.advanceTimersByTimeAsync(3000);
  expect(requested.map((request) => request.texts)).toEqual([['DOM cue']]);
  expect(lines()?.[0].textContent).toBe('DOM cue');
  expect(
    getComputedStyle(document.querySelector('[data-testid="caption_renderer_overlay"]')!).opacity,
  ).toBe('0');
  expect(lines()?.[1].textContent).toBe('译文 DOM cue');
});

it('renders HBO multiline captions as timed sentences in the plugin overlay', async () => {
  const originalFetch = fetch;
  const text = "Oh, thank you.\nI've got to talk to that\nmailman.";
  const native = document.querySelector<HTMLElement>('[data-testid="caption_renderer_overlay"]')!;
  native.textContent = text;
  native.style.cssText = 'font:italic bold 48px serif;line-height:3;white-space:pre-wrap';
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('.vtt'))
        return new Response(
          url.endsWith('/1.vtt') ? `WEBVTT\n\n00:03.000 --> 00:09.000\n${text}\n\n` : 'WEBVTT\n\n',
        );
      return originalFetch(url, init);
    }),
  );
  controller = new CaptionController(publicSettings(settings));
  await playTo(3);
  expect(requested.map(({ texts }) => texts)).toEqual([
    ['Oh, thank you.', "I've got to talk to that mailman."],
  ]);
  expect(lines()?.[0].textContent).toBe('Oh, thank you.');
  expect(lines()?.[1].textContent).toBe('译文 Oh, thank you.');
  expect(getComputedStyle(native).opacity).toBe('0');
  expect(native.textContent).toBe(text);
  await playTo(6);
  expect(lines()?.[0].textContent).toBe("I've got to talk to that mailman.");
  expect(lines()?.[1].textContent).toBe("译文 I've got to talk to that mailman.");
  expect(lines()?.[0].style.fontSize).toBe(`${settings.original.size}px`);
  controller.update({ ...publicSettings(settings), enabled: false });
  expect(getComputedStyle(native).opacity).not.toBe('0');
  expect(native.textContent).toBe(text);
});

it('reads the committed React branch instead of an old episode retained on the DOM node', async () => {
  const element = document.querySelector('[data-testid="caption_renderer_overlay"]')!;
  const props = {
    value: { activeStreamInfo: { url: mediaUrl.replace('episode', 'current'), streamMode: 'VOD' } },
    eventConsumer: {
      selectedTextTrack$: {
        subscribe: (callback: (event: unknown) => void) => {
          callback({ selectedTextTrack: selected });
          return { unsubscribe() {} };
        },
      },
    },
  };
  const currentRoot = { stateNode: {} as { current?: unknown } };
  currentRoot.stateNode.current = currentRoot;
  const oldRoot = { stateNode: currentRoot.stateNode };
  Object.assign(element, {
    __reactFiber$test: {
      memoizedProps: { ...props, value: { activeStreamInfo: stream } },
      return: oldRoot,
      alternate: { memoizedProps: props, return: currentRoot },
    },
  });
  controller = new CaptionController(publicSettings(settings));
  await vi.advanceTimersByTimeAsync(0);
  const urls = vi.mocked(fetch).mock.calls.map(([url]) => url);
  expect(urls).toContain(mediaUrl.replace('episode', 'current'));
  expect(urls).not.toContain(mediaUrl);
  expect(requested).toHaveLength(2);
});

it('rejects unsolicited or malformed bridge responses', () => {
  const changed = vi.fn();
  const timeline = new HboTimeline(changed);
  timeline.read('en');
  for (const data of [
    { requestId: 999, state: { mode: 'model', source: [], translation: null } },
    {
      requestId: 1,
      state: {
        mode: 'model',
        source: [{ startTime: 2, endTime: 1, text: 'Invalid' }],
        translation: null,
      },
    },
  ])
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        origin: location.origin,
        data: { type: 'subline:hbo-timeline-response', generation: 1, revision: 1, ...data },
      }),
    );
  expect(changed).not.toHaveBeenCalled();
  timeline.destroy();
});

it('parses multiperiod HBO WebVTT templates without adding the period offset twice', () => {
  const tracks = parseHboManifest(manifest(['en-US', 'es-419']), mediaUrl);
  expect(tracks).toHaveLength(2);
  expect(tracks[0].files).toEqual(
    [1, 2, 3].map((number) => ({
      url: `https://cdn.prd.media.h264.io/episode/en-US/${number}.vtt`,
      offset: 0,
    })),
  );
  expect(parseHboVtt(vtt(2, 'en-US'), tracks[0].files[1].offset)[0]).toEqual({
    startTime: 33,
    endTime: 35,
    text: 'Cue 11',
  });
});

it('chooses one same-language/role track and keeps its identity when later Periods reorder alternatives', () => {
  expect(parseHboManifest(alternateTrackManifest(), mediaUrl)).toEqual([
    {
      language: 'en-US',
      role: 'caption',
      files: [1, 2, 3].map((part) => ({
        url: new URL(`t3/${part}.vtt`, mediaUrl).href,
        offset: 0,
      })),
    },
  ]);
});

it('continues the timeline with one available alternative when track IDs change between Periods', () => {
  const tracks = parseHboManifest(
    alternateTrackManifest([
      ['t3', 't6'],
      ['t9', 't12'],
      ['t12', 't9'],
    ]),
    mediaUrl,
  );
  expect(tracks).toEqual([
    {
      language: 'en-US',
      role: 'caption',
      files: ['t3/1.vtt', 't9/2.vtt', 't9/3.vtt'].map((path) => ({
        url: new URL(path, mediaUrl).href,
        offset: 0,
      })),
    },
  ]);
});

it('resolves BaseURL, repeated templates, presentation offsets, and ignores video and forced tracks', () => {
  const xml = `<MPD type="static" mediaPresentationDuration="PT40S"><BaseURL>subtitles/</BaseURL><Period start="PT10S" duration="PT30S">
    <AdaptationSet lang="en" mimeType="text/vtt"><Role value="subtitle"/><SegmentTemplate media="$RepresentationID$/$Time$-$Number%03d$.vtt" timescale="1000" presentationTimeOffset="5000"><SegmentTimeline><S t="5000" d="10000" r="2"/></SegmentTimeline></SegmentTemplate><Representation id="en"/></AdaptationSet>
    <AdaptationSet lang="en"><Role value="forced-subtitle"/><Representation mimeType="text/vtt"><BaseURL>forced.vtt</BaseURL></Representation></AdaptationSet>
    <AdaptationSet lang="en"><Representation mimeType="video/mp4"><BaseURL>video.mp4</BaseURL></Representation></AdaptationSet>
  </Period></MPD>`;
  expect(parseHboManifest(xml, mediaUrl)).toEqual([
    {
      language: 'en',
      role: 'subtitle',
      files: [0, 1, 2].map((i) => ({
        url: `https://cdn.prd.media.h264.io/episode/subtitles/en/${5000 + 10000 * i}-${String(i + 1).padStart(3, '0')}.vtt`,
        offset: 5,
      })),
    },
  ]);
  expect(parseHboManifest(xml.replace('r="2"', 'r="999999999"'), mediaUrl)).toEqual([]);
  expect(
    parseHboManifest(xml.replace('subtitles/', 'https://untrusted.example/'), mediaUrl),
  ).toEqual([]);
  expect(parseHboManifest(xml.replace('type="static"', 'type="dynamic"'), mediaUrl)).toEqual([]);
});

it('parses VTT identifiers, markup, entities and CRLF while skipping metadata and invalid times', () => {
  const text =
    'WEBVTT\n\nNOTE ignore\n00:00.000 --> 00:01.000\nComment\n\nSTYLE\n::cue { color: red }\n\ncue-id\n00:01.000 --> 00:03.000 align:start\n<v Narrator><i>Hello &amp; goodbye.</i></v>\nSecond line &lt;3\n\n00:04.000 --> 00:02.000\nInvalid\n\n00:60.000 --> 01:02.000\nInvalid\n';
  expect(parseHboVtt(`\uFEFF${text.replaceAll('\n', '\r\n')}`, 10)).toEqual([
    { startTime: 11, endTime: 13, text: 'Hello & goodbye.\nSecond line <3' },
  ]);
  expect(() => parseHboVtt('<html>Not subtitles</html>')).toThrow('Invalid WebVTT');
});

it('keeps the HBO source across target/provider/style changes, seeks, blob renewal and signed URL renewal', async () => {
  controller = new CaptionController(publicSettings(settings));
  await playTo(3);
  const downloads = () =>
    vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('h264.io'));
  expect(downloads()).toHaveLength(4);
  for (const next of [
    { ...settings, targetLanguage: 'ja' },
    { ...settings, model: 'other', baseUrl: 'https://other.example/v1', apiKey: 'other' },
    { ...settings, original: { ...settings.original, size: 36 } },
  ]) {
    controller.update(publicSettings(next));
    await vi.advanceTimersByTimeAsync(1200);
    expect(downloads()).toHaveLength(4);
    expect(lines()?.[0].textContent).toBe('Cue 1');
  }
  stream.url = `${mediaUrl}?token=fresh&Signature=new&Expires=9999999999`;
  Object.defineProperty(video, 'currentSrc', { value: 'blob:renewed-same-episode' });
  history.replaceState(null, '', '/video/watch/episode-1?tracking=changed');
  video.dispatchEvent(new Event('pause'));
  video.currentTime = 33;
  video.dispatchEvent(new Event('seeked'));
  await vi.advanceTimersByTimeAsync(1600);
  expect(downloads()).toHaveLength(4);
  expect(lines()?.[0].textContent).toBe('Cue 11');
  controller.update({ ...publicSettings(settings), enabled: false });
  await vi.advanceTimersByTimeAsync(0);
  controller.update(publicSettings(settings));
  await vi.advanceTimersByTimeAsync(1200);
  expect(downloads()).toHaveLength(4);
});

it('replaces the HBO source for source-language, track-role and episode changes', async () => {
  targetLanguage = 'es';
  controller = new CaptionController(publicSettings(settings));
  await playTo(3);
  const manifests = () =>
    vi.mocked(fetch).mock.calls.filter(([url]) => new URL(String(url)).pathname.endsWith('.mpd'));
  expect(manifests()).toHaveLength(1);
  controller.update(publicSettings({ ...settings, sourceLanguage: 'es' }));
  await vi.advanceTimersByTimeAsync(1200);
  expect(manifests()).toHaveLength(2);
  expect(lines()?.[0].textContent).toBe('已有字幕 1');
  selected = { language: 'es', role: 'subtitle' };
  await vi.advanceTimersByTimeAsync(1200);
  expect(manifests()).toHaveLength(3);
  history.replaceState(null, '', '/video/watch/episode-2');
  stream.url = mediaUrl.replace('episode', 'next');
  await vi.advanceTimersByTimeAsync(1200);
  expect(manifests()).toHaveLength(4);
});

it('does not translate a known target-language DOM when the HBO source track is absent', async () => {
  const originalFetch = fetch;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit) =>
      new URL(url).pathname.endsWith('.mpd')
        ? Promise.resolve(new Response(manifest(['zh-Hans'])))
        : originalFetch(url, init),
    ),
  );
  selected = { language: 'zh-Hans', role: 'subtitle' };
  document.querySelector('[data-testid="caption_renderer_overlay"]')!.textContent = '已有中文字幕';
  controller = new CaptionController(publicSettings(settings));
  await playTo(3);
  expect(lines()?.[1].hidden).toBe(true);
  expect(requested).toEqual([]);
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('.vtt'))).toBe(false);
});

it('does not send target-language DOM to the provider after a source download fails', async () => {
  selected = { language: 'zh-Hans', role: 'subtitle' };
  document.querySelector('[data-testid="caption_renderer_overlay"]')!.textContent = '已有中文字幕';
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('', { status: 503 })),
  );
  controller = new CaptionController(publicSettings(settings));
  await playTo(3);
  expect(lines()?.[1].hidden).toBe(true);
  expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  expect(requested).toEqual([]);
});

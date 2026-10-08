import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CaptionController } from '../src/core/controller';
import { createHboPlatform } from '../src/platforms/hbo/platform';
import { NativeTimeline } from '../src/core/native';
import { DEFAULT_SETTINGS, publicSettings, STORAGE_KEY } from '../src/shared/settings';
import { providerReply, requestedTexts } from './fixtures/provider';
import {
  longCaption,
  longCaptionParts,
  longTranslations,
  longResult,
  structuredReply,
} from './fixtures/long-caption';

let controller: CaptionController | undefined;
let video: HTMLVideoElement;
const saved = { ...DEFAULT_SETTINGS, apiKey: 'test-key', model: 'test-model' };
const pending: {
  texts: string[];
  signal: AbortSignal;
  resolve: (value: Response) => void;
  reject: (error: unknown) => void;
}[] = [];
const requested: string[][] = [];
const messages: string[] = [];
const cues = [
  { startTime: 2, endTime: 4, text: 'First cue' },
  { startTime: 4, endTime: 6, text: 'Second cue' },
  { startTime: 6, endTime: 8, text: 'Third cue' },
  { startTime: 80, endTime: 82, text: 'After seeking' },
];

beforeEach(async () => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div class="video-js"><video></video></div>';
  video = document.querySelector('video')!;
  Object.defineProperty(video, 'readyState', { value: 1 });
  Object.defineProperty(video, 'paused', { configurable: true, value: false });
  Object.defineProperty(video, 'textTracks', {
    configurable: true,
    value: [{ mode: 'showing', kind: 'subtitles', language: 'en', cues, activeCues: [] }],
  });
  type Reply = { ok: boolean; data?: unknown; error?: string };
  let listener!: (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    reply: (value: Reply) => void,
  ) => unknown;
  const sender = {
    id: 'extension-id',
    url: 'https://www.max.com/video/example',
    frameId: 0,
    tab: { id: 1 },
  } as chrome.runtime.MessageSender;
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'extension-id',
      getURL: (path: string) => `chrome-extension://extension-id/${path}`,
      onMessage: {
        addListener: (callback: typeof listener) => {
          listener = callback;
        },
      },
      sendMessage: (message: { type: string }) => {
        messages.push(message.type);
        return new Promise<Reply>((resolve) => listener(message, sender, resolve));
      },
    },
    storage: {
      local: {
        setAccessLevel: vi.fn().mockResolvedValue(undefined),
        get: vi.fn().mockResolvedValue({ [STORAGE_KEY]: saved }),
      },
      session: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
      },
      onChanged: { addListener: vi.fn() },
    },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init: RequestInit) => {
      const texts = requestedTexts(init);
      requested.push(texts);
      return new Promise<Response>((resolve, reject) => {
        pending.push({ texts, signal: init.signal!, resolve, reject });
        init.signal?.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')),
        );
      });
    }),
  );
  await import('../src/extension/background');
});

it.each([true, false])(
  'ignores native target tracks and requires a provider, configured=%s',
  async (configured) => {
    const sourceTrack = video.textTracks[0];
    const targetTrack = {
      mode: 'disabled',
      kind: 'subtitles',
      language: 'zh-Hans',
      get cues() {
        throw new Error('Target subtitles must not be read');
      },
    };
    Object.defineProperty(video, 'textTracks', { value: [sourceTrack, targetTrack] });
    controller = new CaptionController(createHboPlatform, { ...publicSettings(saved), configured });
    await advance(2);
    expect(targetTrack.mode).toBe('disabled');
    expect(sourceTrack.mode).toBe('showing');
    if (configured) {
      expect(requested).toEqual([['First cue', 'Second cue', 'Third cue', 'After seeking']]);
      await finish({ 'First cue': 'Provider 译文' });
      expect(translated()?.textContent).toBe('Provider 译文');
    } else {
      expect(requested).toEqual([]);
      expect(translated()).toBeUndefined();
    }
  },
);

afterEach(() => {
  controller?.destroy();
  controller = undefined;
  pending.length = 0;
  requested.length = 0;
  messages.length = 0;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
  document.body.innerHTML = '';
});

function translated() {
  return document
    .querySelector('[data-subline-overlay]')
    ?.shadowRoot?.querySelectorAll<HTMLElement>('.line')[1];
}

function original() {
  return document
    .querySelector('[data-subline-overlay]')
    ?.shadowRoot?.querySelector<HTMLElement>('.original');
}
async function finish(translations: Record<string, string>) {
  const [text] = Object.keys(translations);
  const request = [...pending].reverse().find((item) => item.texts.includes(text))!;
  request.resolve(
    providerReply(request.texts, (source) => translations[source] ?? `${source} 译文`),
  );
  await vi.advanceTimersByTimeAsync(0);
}
async function advance(time: number) {
  const origin = video.currentTime;
  const direction = time >= origin ? 1 : -1;
  let at = origin;
  while (direction > 0 ? at + direction < time : at + direction > time) {
    at += direction;
    video.currentTime = at;
    video.dispatchEvent(new Event('timeupdate'));
    await vi.advanceTimersByTimeAsync(0);
  }
  await vi.advanceTimersByTimeAsync(Math.abs(time - origin) * 1000);
  video.currentTime = time;
  video.dispatchEvent(new Event('timeupdate'));
  await vi.advanceTimersByTimeAsync(150);
}

it('renders a late split at the current time, follows estimated boundaries, and reuses it after seeking', async () => {
  Object.defineProperty(video, 'textTracks', {
    value: [
      {
        mode: 'showing',
        kind: 'subtitles',
        language: 'en',
        activeCues: [],
        cues: [
          { text: longCaption, startTime: 2, endTime: 14 },
          { text: 'After.', startTime: 14, endTime: 16 },
        ],
      },
    ],
  });
  controller = new CaptionController(createHboPlatform, publicSettings(saved));
  await advance(8);
  expect(requested).toEqual([[longCaption, 'After.']]);
  expect(translated()?.textContent).toBe('翻译中');
  expect(original()?.hidden).toBe(true);
  expect(original()?.textContent).toBe('');
  pending[0].resolve(
    structuredReply([longResult(), { id: 1, parts: [{ translation: '之后。' }] }]),
  );
  await vi.advanceTimersByTimeAsync(0);
  const sourceText = () =>
    document.querySelector('[data-subline-overlay]')?.shadowRoot?.querySelector('.original')
      ?.textContent;
  expect(sourceText()).toBe(longCaptionParts[1]);
  expect(translated()?.textContent).toBe(longTranslations[1]);
  const boundary = 2 + 12 * (longCaption.indexOf(longCaptionParts[2]) / longCaption.length);
  await advance(boundary - 0.01);
  expect(sourceText()).toBe(longCaptionParts[1]);
  video.currentTime = boundary;
  video.dispatchEvent(new Event('timeupdate'));
  expect(sourceText()).toBe(longCaptionParts[2]);
  expect(translated()?.textContent).toBe(longTranslations[2]);
  await advance(14);
  expect(translated()?.textContent).toBe('之后。');
  video.currentTime = 3;
  video.dispatchEvent(new Event('seeked'));
  await vi.advanceTimersByTimeAsync(500);
  expect(sourceText()).toBe(longCaptionParts[0]);
  expect(translated()?.textContent).toBe(longTranslations[0]);
  expect(requested).toEqual([[longCaption, 'After.']]);
});

it('shows the whole long sentence for its full duration when the Provider split does not match the source', async () => {
  Object.defineProperty(video, 'textTracks', {
    value: [
      {
        mode: 'showing',
        kind: 'subtitles',
        language: 'en',
        activeCues: [],
        cues: [
          { text: longCaption, startTime: 2, endTime: 14 },
          { text: 'After.', startTime: 14, endTime: 16 },
        ],
      },
    ],
  });
  controller = new CaptionController(createHboPlatform, publicSettings(saved));
  await advance(3);
  pending[0].resolve(
    structuredReply([
      {
        id: 0,
        parts: longCaptionParts.map((source, index) => ({
          source: source.replace(' old', ''),
          translation: longTranslations[index],
        })),
      },
      { id: 1, parts: [{ translation: '之后。' }] },
    ]),
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(original()?.textContent).toBe(longCaption);
  expect(translated()?.textContent).toBe(longTranslations.join(''));
  await advance(13);
  expect(original()?.textContent).toBe(longCaption);
  expect(translated()?.textContent).toBe(longTranslations.join(''));
  await advance(15);
  expect(translated()?.textContent).toBe('之后。');
  expect(requested).toEqual([[longCaption, 'After.']]);
});

it('shows the whole long sentence with the error when its translation fails', async () => {
  Object.defineProperty(video, 'textTracks', {
    value: [
      {
        mode: 'showing',
        kind: 'subtitles',
        language: 'en',
        activeCues: [],
        cues: [{ text: longCaption, startTime: 2, endTime: 14 }],
      },
    ],
  });
  controller = new CaptionController(createHboPlatform, publicSettings(saved));
  await advance(3);
  expect(original()?.hidden).toBe(true);
  expect(translated()?.textContent).toBe('翻译中');
  pending[0].resolve(new Response('', { status: 500 }));
  await vi.advanceTimersByTimeAsync(0);
  expect(original()?.hidden).toBe(false);
  expect(original()?.textContent).toBe(longCaption);
  expect(translated()?.textContent).toBe('Subline：接口返回 HTTP 500，请稍后重试。');
});

it.each(['playing', 'paused', 'seeking'])(
  'does not paint a long input while a cached split travels from the background (%s)',
  async (state) => {
    Object.defineProperty(video, 'textTracks', {
      value: [
        {
          mode: 'showing',
          kind: 'subtitles',
          language: 'en',
          activeCues: [],
          cues: [{ text: longCaption, startTime: 2, endTime: 14 }],
        },
      ],
    });
    controller = new CaptionController(createHboPlatform, publicSettings(saved));
    await vi.advanceTimersByTimeAsync(0);
    pending[0].resolve(structuredReply([longResult()]));
    await vi.advanceTimersByTimeAsync(0);
    const send = chrome.runtime.sendMessage;
    let deliver!: () => void;
    vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation((message) => {
      const request = message as unknown as { type: string };
      const reply = send(request);
      return request.type === 'translate'
        ? Promise.resolve(reply).then(
            (value) =>
              new Promise((resolve) => {
                deliver = () => resolve(value);
              }),
          )
        : reply;
    });
    if (state === 'paused') Object.defineProperty(video, 'paused', { value: true });
    video.currentTime = 2;
    video.dispatchEvent(new Event(state === 'seeking' ? 'seeked' : 'timeupdate'));
    await vi.advanceTimersByTimeAsync(100);
    expect(original()?.hidden).toBe(true);
    expect(original()?.textContent).toBe('');
    deliver();
    await vi.advanceTimersByTimeAsync(0);
    expect(original()?.textContent).toBe(longCaptionParts[0]);
    expect(original()?.hidden).toBe(false);
    expect(translated()?.textContent).toBe(longTranslations[0]);
    const writes = vi.spyOn(original()!, 'textContent', 'set');
    await vi.advanceTimersByTimeAsync(450);
    expect(writes).not.toHaveBeenCalled();
    video.currentTime = 8;
    video.dispatchEvent(new Event('timeupdate'));
    expect(original()?.textContent).toBe(longCaptionParts[1]);
    expect(translated()?.textContent).toBe(longTranslations[1]);
    expect(writes.mock.calls.map(([text]) => text)).toEqual([longCaptionParts[1]]);
    expect(requested).toEqual([[longCaption]]);
    writes.mockRestore();
  },
);

it('preloads in the background and queries it at caption boundaries without another provider request', async () => {
  controller = new CaptionController(createHboPlatform, publicSettings(saved));
  await vi.advanceTimersByTimeAsync(0);
  const opening = [['First cue', 'Second cue', 'Third cue', 'After seeking']];
  expect(requested).toEqual(opening);
  await finish({ 'First cue': '第一句', 'Second cue': '第二句', 'Third cue': '第三句' });
  expect(translated()?.hidden).toBe(true);
  for (const [time, text] of [
    [2, '第一句'],
    [4, '第二句'],
    [6, '第三句'],
  ] as const) {
    await advance(time - 0.1);
    expect(translated()?.textContent).not.toBe(text);
    video.currentTime = time;
    video.dispatchEvent(new Event('timeupdate'));
    await vi.advanceTimersByTimeAsync(0);
    expect(translated()?.textContent).toBe(text);
    expect(translated()?.hidden).toBe(false);
  }
  await advance(9);
  expect(translated()?.hidden).toBe(true);
  expect(requested).toEqual(opening);
  expect(messages).toContain('translate');
});

it('queues the current and next segment on open, waits out a scrub, and requests only the cues at the new position', async () => {
  const dense = Array.from({ length: 30 }, (_, index) => ({
    startTime: 2 + index * 2,
    endTime: 4 + index * 2,
    text: `Cue ${index + 1}`,
  }));
  Object.defineProperty(video, 'textTracks', {
    value: [
      {
        mode: 'showing',
        kind: 'subtitles',
        language: 'en',
        cues: [...dense, { startTime: 80, endTime: 82, text: 'After seeking' }],
        activeCues: [],
      },
    ],
  });
  controller = new CaptionController(createHboPlatform, publicSettings(saved));
  await vi.advanceTimersByTimeAsync(0);
  const block = (from: number) => dense.slice(from, from + 5).map((cue) => cue.text);
  const opening = [block(0), block(5), block(10)];
  expect(requested).toEqual(opening);
  Object.defineProperty(video, 'seeking', { configurable: true, value: true });
  video.currentTime = 40;
  video.dispatchEvent(new Event('seeking'));
  await vi.advanceTimersByTimeAsync(200);
  expect(translated()?.hidden).toBe(true);
  expect(pending.map((request) => request.signal.aborted)).toEqual([true, true, true]);
  expect(requested).toEqual(opening);
  video.currentTime = 80;
  Object.defineProperty(video, 'seeking', { value: false });
  video.dispatchEvent(new Event('seeked'));
  await vi.advanceTimersByTimeAsync(200);
  expect(requested).toEqual(opening);
  await vi.advanceTimersByTimeAsync(600);
  expect(requested).toEqual([...opening, ['After seeking']]);
  await finish({ 'After seeking': '跳转后的字幕' });
  expect(translated()?.textContent).toBe('跳转后的字幕');
  await finish({ 'Cue 1': '迟到的旧字幕' });
  expect(translated()?.textContent).toBe('跳转后的字幕');
});

it('shows a timeout like the loading line, skips that batch, and translates the later segment', async () => {
  const dense = Array.from({ length: 30 }, (_, index) => ({
    startTime: 2 + index * 2,
    endTime: 4 + index * 2,
    text: `Cue ${index + 1}`,
  }));
  Object.defineProperty(video, 'textTracks', {
    value: [
      {
        mode: 'showing',
        kind: 'subtitles',
        language: 'en',
        cues: dense,
        activeCues: [],
      },
    ],
  });
  controller = new CaptionController(createHboPlatform, publicSettings(saved));
  await vi.advanceTimersByTimeAsync(0);
  const block = (from: number) => dense.slice(from, from + 5).map((cue) => cue.text);
  expect(requested).toEqual([block(0), block(5), block(10)]);
  await advance(3);
  expect(translated()?.textContent).toBe('翻译中');
  const timeout = new Error('The operation was aborted due to timeout');
  timeout.name = 'TimeoutError';
  pending.find((request) => request.texts.includes('Cue 1'))!.reject(timeout);
  await vi.advanceTimersByTimeAsync(0);
  const translation = translated();
  expect(translation?.textContent).toBe('接口调用超时');
  expect(translation?.classList.contains('error')).toBe(false);
  expect(translation?.style.color).toBe('rgb(184, 229, 207)');
  expect(translation?.style.fontSize).toBe('20px');
  expect(original()?.hidden).toBe(true);
  await finish({ 'Cue 6': '第六句' });
  const sent = requested.length;
  await vi.advanceTimersByTimeAsync(20000);
  expect(requested).toHaveLength(sent);
  expect(translated()?.textContent).toBe('接口调用超时');
  await advance(12);
  expect(translated()?.textContent).toBe('第六句');
  expect(requested).toEqual([block(0), block(5), block(10), block(15)]);
});

it('after a jump settles, sends the next fifteen sentences as full batches', async () => {
  const dense = Array.from({ length: 30 }, (_, index) => ({
    startTime: 2 + index * 2,
    endTime: 4 + index * 2,
    text: `Cue ${index + 1}`,
  }));
  Object.defineProperty(video, 'textTracks', {
    value: [{ mode: 'showing', kind: 'subtitles', language: 'en', cues: dense, activeCues: [] }],
  });
  controller = new CaptionController(createHboPlatform, publicSettings(saved));
  await vi.advanceTimersByTimeAsync(0);
  const started = requested.length;
  video.currentTime = 42;
  video.dispatchEvent(new Event('timeupdate'));
  await vi.advanceTimersByTimeAsync(200);
  expect(requested).toHaveLength(started);
  expect(pending.slice(0, started).every((request) => request.signal.aborted)).toBe(true);
  await vi.advanceTimersByTimeAsync(200);
  const block = (from: number) => dense.slice(from, from + 5).map((cue) => cue.text);
  expect(requested.slice(started)).toEqual([block(20), block(25)]);
  await vi.advanceTimersByTimeAsync(1000);
  expect(requested.slice(started)).toEqual([block(20), block(25)]);
  expect(pending[started].signal.aborted).toBe(false);
});

it('starts translation one second ahead on first load and after seeking', async () => {
  const cues = [
    { startTime: 0, endTime: 0.6, text: 'Opening' },
    { startTime: 0.6, endTime: 4, text: 'Stay' },
    { startTime: 4, endTime: 6, text: 'Next' },
    { startTime: 20, endTime: 20.3, text: 'Seek tail' },
    { startTime: 20.3, endTime: 24, text: 'After' },
  ];
  Object.defineProperty(video, 'textTracks', {
    value: [{ mode: 'showing', kind: 'subtitles', language: 'en', cues, activeCues: [] }],
  });
  const original = () =>
    document
      .querySelector('[data-subline-overlay]')
      ?.shadowRoot?.querySelectorAll<HTMLElement>('.line')[0];
  controller = new CaptionController(createHboPlatform, publicSettings(saved));
  await vi.advanceTimersByTimeAsync(0);
  expect(requested).toEqual([['Stay', 'Next', 'Seek tail', 'After']]);
  expect(original()?.hidden).toBe(true);
  expect(translated()?.hidden).toBe(true);
  await advance(3.2);
  expect(requested).toEqual([['Stay', 'Next', 'Seek tail', 'After']]);
  expect(pending[0].signal.aborted).toBe(false);
  expect(original()?.hidden).toBe(true);
  expect(translated()?.textContent).toBe('翻译中');
  Object.defineProperty(video, 'seeking', { configurable: true, value: true });
  video.currentTime = 20;
  video.dispatchEvent(new Event('seeking'));
  await vi.advanceTimersByTimeAsync(0);
  Object.defineProperty(video, 'seeking', { value: false });
  video.dispatchEvent(new Event('seeked'));
  await vi.advanceTimersByTimeAsync(0);
  expect(requested).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(400);
  expect(requested.slice(1)).toEqual([['After']]);
  expect(original()?.hidden).toBe(true);
  expect(translated()?.hidden).toBe(true);
  expect(pending[0].signal.aborted).toBe(true);
});

it('finishes in-flight prefetch while paused and does not send more until playback resumes', async () => {
  const dense = Array.from({ length: 25 }, (_, index) => ({
    startTime: 2 + index * 2,
    endTime: 4 + index * 2,
    text: `Cue ${index + 1}`,
  }));
  Object.defineProperty(video, 'textTracks', {
    value: [{ mode: 'showing', kind: 'subtitles', language: 'en', cues: dense, activeCues: [] }],
  });
  const setPaused = async (paused: boolean) => {
    Object.defineProperty(video, 'paused', { value: paused });
    video.dispatchEvent(new Event(paused ? 'pause' : 'play'));
    await vi.advanceTimersByTimeAsync(0);
  };
  controller = new CaptionController(createHboPlatform, publicSettings(saved));
  await advance(2);
  const block = (from: number) => dense.slice(from, from + 5).map((cue) => cue.text);
  const opening = [block(0), block(5), block(10)];
  expect(requested).toEqual(opening);
  await setPaused(true);
  expect(pending.map((request) => request.signal.aborted)).toEqual([false, false, false]);
  await vi.advanceTimersByTimeAsync(60000);
  expect(requested).toHaveLength(opening.length);
  await finish({ 'Cue 1': '第一句' });
  expect(translated()?.textContent).toBe('第一句');
  expect(translated()?.hidden).toBe(false);
  expect(requested).toHaveLength(opening.length);
  video.currentTime = 12;
  video.dispatchEvent(new Event('timeupdate'));
  await vi.advanceTimersByTimeAsync(60000);
  expect(requested).toHaveLength(opening.length);
  await setPaused(false);
  expect(requested.at(-1)).toEqual(block(15));
  await setPaused(true);
  const sent = requested.length;
  await vi.advanceTimersByTimeAsync(60000);
  expect(requested).toHaveLength(sent);
  expect(pending.at(-1)?.signal.aborted).toBe(false);
});

it('queues the next segment with the opening window and preloads the following segment when playback enters it', async () => {
  const dense = Array.from({ length: 24 }, (_, index) => ({
    startTime: 2 + index * 2,
    endTime: 4 + index * 2,
    text: `Cue ${index + 1}`,
  }));
  Object.defineProperty(video, 'textTracks', {
    value: [{ mode: 'showing', kind: 'subtitles', language: 'en', cues: dense, activeCues: [] }],
  });
  controller = new CaptionController(createHboPlatform, publicSettings(saved));
  await vi.advanceTimersByTimeAsync(0);
  const block = (from: number) => dense.slice(from, from + 5).map((cue) => cue.text);
  const opening = [block(0), block(5), block(10)];
  expect(requested).toEqual(opening);
  expect(pending.map((request) => request.signal.aborted)).toEqual([false, false, false]);
  for (let time = 1; time < 12; time++) {
    video.currentTime = time;
    video.dispatchEvent(new Event('timeupdate'));
    await vi.advanceTimersByTimeAsync(0);
  }
  expect(requested).toEqual(opening);
  video.currentTime = 12;
  video.dispatchEvent(new Event('timeupdate'));
  await vi.advanceTimersByTimeAsync(1000);
  expect(requested.at(-1)).toEqual(block(15));
  expect(pending[2].signal.aborted).toBe(false);
});

it('invalidates the old translation when the same video element loads a different source', async () => {
  controller = new CaptionController(createHboPlatform, publicSettings(saved));
  await advance(2);
  Object.defineProperty(video, 'currentSrc', { value: 'https://media.example/next.mp4' });
  const track = video.textTracks[0];
  Object.defineProperty(track, 'cues', {
    value: [{ startTime: 0, endTime: 10, text: 'New video' }],
  });
  video.currentTime = 0;
  video.dispatchEvent(new Event('loadedmetadata'));
  await vi.advanceTimersByTimeAsync(0);
  await finish({ 'First cue': '旧视频字幕' });
  expect(translated()?.textContent).not.toContain('旧视频字幕');
  await vi.advanceTimersByTimeAsync(400);
  await finish({ 'New video': '新视频字幕' });
  expect(translated()?.textContent).toBe('新视频字幕');
});

it('continues using the provider when a native target track appears', async () => {
  const tracks = [video.textTracks[0]];
  Object.defineProperty(video, 'textTracks', { value: tracks });
  controller = new CaptionController(createHboPlatform, publicSettings(saved));
  await advance(2);
  await finish({ 'First cue': '模型生成的字幕', 'Second cue': 'Second cue 译文' });
  const target = {
    mode: 'disabled',
    kind: 'subtitles',
    language: 'zh-CN',
    get cues() {
      throw new Error('Target subtitles must not be read');
    },
  };
  tracks.push(target as unknown as TextTrack);
  await advance(3);
  expect(translated()?.textContent).toBe('模型生成的字幕');
  expect(target.mode).toBe('disabled');
  await advance(4);
  expect(translated()?.textContent).toBe('Second cue 译文');
  expect(requested).toHaveLength(1);
});

it('queries the background again on a repeated caption while keeping the displayed caption between ticks', async () => {
  controller = new CaptionController(createHboPlatform, publicSettings(saved));
  await vi.advanceTimersByTimeAsync(0);
  await finish({ 'First cue': '第一句', 'Second cue': '第二句' });
  await advance(2);
  const firstMessages = messages.filter((type) => type === 'translate').length;
  await vi.advanceTimersByTimeAsync(5000);
  expect(messages.filter((type) => type === 'translate')).toHaveLength(firstMessages);
  expect(translated()?.textContent).toBe('第一句');
  await advance(4);
  await advance(2);
  expect(translated()?.textContent).toBe('第一句');
  expect(messages.filter((type) => type === 'translate').length).toBeGreaterThan(firstMessages + 1);
  expect(requested).toHaveLength(1);
});

it('translates overlapping sentences separately, and has the Provider split a long cue of its own', async () => {
  const first = 'When I first moved to the city, I didn’t know anyone at all,';
  const second = 'and every night I walked along the river, wondering why.';
  const joined = `${first}\n${second}`;
  const long =
    'Years later, standing on the same bridge, I finally understood that the city had become my home.';
  Object.defineProperty(video, 'textTracks', {
    value: [
      {
        mode: 'showing',
        kind: 'subtitles',
        language: 'en',
        activeCues: [],
        cues: [
          { startTime: 2, endTime: 6, text: first },
          { startTime: 4, endTime: 8, text: second },
          { startTime: 8, endTime: 12, text: long },
        ],
      },
    ],
  });
  const pieces = [
    'Years later, standing on the same bridge,',
    'I finally understood that the city had become my home.',
  ];
  controller = new CaptionController(createHboPlatform, publicSettings(saved));
  await vi.advanceTimersByTimeAsync(0);
  expect(requested).toEqual([[first, joined, second, long]]);
  const delivered = new Set<(typeof pending)[number]>();
  const deliver = async () => {
    for (const request of [...pending]) {
      if (delivered.has(request)) continue;
      delivered.add(request);
      request.resolve(
        structuredReply(
          request.texts.map((text, id) =>
            text === long
              ? { id, parts: pieces.map((source) => ({ source, translation: `${source} 译文` })) }
              : { id, parts: [{ translation: `${text} 译文` }] },
          ),
        ),
      );
    }
    await vi.advanceTimersByTimeAsync(0);
  };
  await deliver();
  for (const [time, text] of [
    [4, `${joined} 译文`],
    [6, `${second} 译文`],
    [8, `${pieces[0]} 译文`],
    [11, `${pieces[1]} 译文`],
  ] as const) {
    await advance(time - 0.1);
    await deliver();
    video.currentTime = time;
    video.dispatchEvent(new Event('timeupdate'));
    await vi.advanceTimersByTimeAsync(0);
    expect(translated()?.textContent).toBe(text);
  }
  expect(requested.map((request) => request.some((text) => text === joined))).toContain(true);
  expect(messages).toContain('translate');
});

it('counts a long sentence as one caption when filling a segment', async () => {
  const long = ['a', 'b', 'c'].map((letter) => letter.repeat(60)).join(', ');
  const short = Array.from({ length: 3 }, (_, index) => ({
    startTime: 2 + index * 2,
    endTime: 4 + index * 2,
    text: `Cue ${index + 1}`,
  }));
  Object.defineProperty(video, 'textTracks', {
    value: [
      {
        mode: 'showing',
        kind: 'subtitles',
        language: 'en',
        activeCues: [],
        cues: [
          ...short,
          { startTime: 8, endTime: 14, text: long },
          { startTime: 14, endTime: 16, text: 'After' },
          { startTime: 16, endTime: 18, text: 'Later' },
        ],
      },
    ],
  });
  controller = new CaptionController(createHboPlatform, publicSettings(saved));
  await vi.advanceTimersByTimeAsync(0);
  expect(requested).toEqual([['Cue 1', 'Cue 2', 'Cue 3', long, 'After'], ['Later']]);
});

it('shows the segment translation only after the JSON response is complete', async () => {
  const cues = [
    { startTime: 0, endTime: 3, text: 'Opening line' },
    { startTime: 3, endTime: 6, text: 'Following line' },
  ];
  Object.defineProperty(video, 'textTracks', {
    value: [{ mode: 'showing', kind: 'subtitles', language: 'en', cues, activeCues: [] }],
  });
  const resolvers: { texts: string[]; resolve: (value: Response) => void }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init: RequestInit) => {
      const texts = requestedTexts(init);
      requested.push(texts);
      expect(JSON.parse(init.body as string).stream).toBe(false);
      return new Promise<Response>((resolve) => {
        resolvers.push({ texts, resolve });
      });
    }),
  );
  controller = new CaptionController(createHboPlatform, publicSettings(saved));
  await vi.advanceTimersByTimeAsync(0);
  expect(requested).toEqual([['Opening line', 'Following line']]);
  expect(translated()?.hidden).toBe(true);
  await vi.advanceTimersByTimeAsync(300);
  expect(translated()?.textContent).toBe('翻译中');
  resolvers
    .find((resolver) => resolver.texts.includes('Opening line'))!
    .resolve(
      providerReply(
        ['Opening line', 'Following line'],
        (text) => ({ 'Opening line': '开场字幕', 'Following line': '下一句' })[text] ?? text,
      ),
    );
  for (let attempt = 0; attempt < 8; attempt++) await vi.advanceTimersByTimeAsync(0);
  expect(translated()?.textContent).toBe('开场字幕');
  expect(translated()?.hidden).toBe(false);
  expect(requested).toEqual([['Opening line', 'Following line']]);
});

it('reuses the cues read from a track until the track changes', () => {
  const timeline = new NativeTimeline();
  const read = () => timeline.read(video, 'en').source;
  const first = read();
  expect(read()).toBe(first);
  Object.defineProperty(video.textTracks[0], 'cues', {
    value: [{ startTime: 2, endTime: 4, text: 'Changed' }],
  });
  expect(read()).not.toBe(first);
  expect(read()?.map((cue) => cue.text)).toEqual(['Changed']);
});

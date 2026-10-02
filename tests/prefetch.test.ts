import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CaptionController } from '../src/extension/captions';
import { DEFAULT_SETTINGS, publicSettings, STORAGE_KEY } from '../src/shared/settings';
import { splitSubtitleAtCommas } from '../src/shared/subtitle-segmentation';
import { providerReply, requestedTexts } from './fixtures/provider';

let controller: CaptionController | undefined;
let video: HTMLVideoElement;
const saved = { ...DEFAULT_SETTINGS, apiKey: 'test-key', model: 'test-model' };
const pending: { texts: string[]; signal: AbortSignal; resolve: (value: Response) => void }[] = [];
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
      onChanged: { addListener: vi.fn() },
    },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init: RequestInit) => {
      const texts = requestedTexts(init);
      requested.push(texts);
      return new Promise<Response>((resolve, reject) => {
        pending.push({ texts, signal: init.signal!, resolve });
        init.signal?.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')),
        );
      });
    }),
  );
  await import('../src/extension/background');
});

it.each([true, false])(
  'uses an existing target track without model requests, configured=%s',
  async (configured) => {
    const sourceTrack = video.textTracks[0];
    const targetTrack = {
      mode: 'disabled',
      kind: 'subtitles',
      language: 'zh-Hans',
      cues: null as typeof cues | null,
    };
    Object.defineProperty(video, 'textTracks', { value: [sourceTrack, targetTrack] });
    controller = new CaptionController({ ...publicSettings(saved), configured });
    await advance(2);
    expect(targetTrack.mode).toBe('hidden');
    expect(requested).toEqual([]);
    targetTrack.cues = [
      { startTime: 2.5, endTime: 5, text: '已有译文第一段' },
      { startTime: 7, endTime: 10, text: '已有译文第二段' },
    ];
    await advance(3);
    expect(translated()?.textContent).toBe('已有译文第一段');
    expect(translated()?.hidden).toBe(false);
    await advance(4.5);
    expect(translated()?.textContent).toBe('已有译文第一段');
    await advance(6);
    expect(translated()?.hidden).toBe(true);
    await advance(9);
    expect(translated()?.textContent).toBe('已有译文第二段');
    expect(requested).toEqual([]);
    controller.update({ ...publicSettings(saved), enabled: false });
    expect(targetTrack.mode).toBe('disabled');
    expect(sourceTrack.mode).toBe('showing');
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

it('preloads upcoming cues in one request before the first caption and shows each reply at its timestamp without asking again', async () => {
  controller = new CaptionController(publicSettings(saved));
  await vi.advanceTimersByTimeAsync(0);
  const opening = ['First cue', 'Second cue', 'Third cue', 'After seeking'];
  expect(requested).toEqual([opening]);
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
    expect(translated()?.textContent).toBe(text);
    expect(translated()?.hidden).toBe(false);
  }
  await advance(9);
  expect(translated()?.hidden).toBe(true);
  expect(requested).toEqual([opening]);
  expect(messages).not.toContain('translate');
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
  controller = new CaptionController(publicSettings(saved));
  await vi.advanceTimersByTimeAsync(0);
  const block = (index: number) => dense.slice(index * 10, index * 10 + 10).map((cue) => cue.text);
  const opening = [block(0), block(1)];
  expect(requested).toEqual(opening);
  Object.defineProperty(video, 'seeking', { configurable: true, value: true });
  video.currentTime = 40;
  video.dispatchEvent(new Event('seeking'));
  await vi.advanceTimersByTimeAsync(200);
  expect(translated()?.hidden).toBe(true);
  expect(pending.map((request) => request.signal.aborted)).toEqual([true, true]);
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

it('previews a few cues after a jump settles, then resumes the lookahead once playback continues', async () => {
  const dense = Array.from({ length: 30 }, (_, index) => ({
    startTime: 2 + index * 2,
    endTime: 4 + index * 2,
    text: `Cue ${index + 1}`,
  }));
  Object.defineProperty(video, 'textTracks', {
    value: [{ mode: 'showing', kind: 'subtitles', language: 'en', cues: dense, activeCues: [] }],
  });
  controller = new CaptionController(publicSettings(saved));
  await vi.advanceTimersByTimeAsync(0);
  const started = requested.length;
  video.currentTime = 42;
  video.dispatchEvent(new Event('timeupdate'));
  await vi.advanceTimersByTimeAsync(200);
  expect(requested).toHaveLength(started);
  expect(pending.slice(0, started).every((request) => request.signal.aborted)).toBe(true);
  await vi.advanceTimersByTimeAsync(200);
  expect(requested[started]).toEqual(['Cue 21', 'Cue 22', 'Cue 23', 'Cue 24']);
  await vi.advanceTimersByTimeAsync(1000);
  expect(requested.at(-1)).toEqual(['Cue 25', 'Cue 26', 'Cue 27', 'Cue 28', 'Cue 29', 'Cue 30']);
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
  controller = new CaptionController(publicSettings(saved));
  await vi.advanceTimersByTimeAsync(0);
  expect(requested).toEqual([['Stay', 'Next', 'Seek tail', 'After']]);
  expect(original()?.textContent).toBe('Opening');
  expect(translated()?.hidden).toBe(true);
  await advance(3.2);
  expect(requested).toEqual([['Stay', 'Next', 'Seek tail', 'After']]);
  expect(pending[0].signal.aborted).toBe(false);
  expect(original()?.textContent).toBe('Stay');
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
  expect(original()?.textContent).toBe('Seek tail');
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
  controller = new CaptionController(publicSettings(saved));
  await advance(2);
  const block = (index: number) => dense.slice(index * 10, index * 10 + 10).map((cue) => cue.text);
  expect(requested).toEqual([block(0), block(1)]);
  await setPaused(true);
  expect(pending.map((request) => request.signal.aborted)).toEqual([false, false]);
  await vi.advanceTimersByTimeAsync(60000);
  expect(requested).toHaveLength(2);
  await finish({ 'Cue 1': '第一句' });
  expect(translated()?.textContent).toBe('第一句');
  expect(translated()?.hidden).toBe(false);
  expect(requested).toHaveLength(2);
  video.currentTime = 22;
  video.dispatchEvent(new Event('timeupdate'));
  await vi.advanceTimersByTimeAsync(60000);
  expect(requested).toHaveLength(2);
  await setPaused(false);
  expect(requested.at(-1)).toEqual(dense.slice(20).map((cue) => cue.text));
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
  controller = new CaptionController(publicSettings(saved));
  await vi.advanceTimersByTimeAsync(0);
  const block = (index: number) => dense.slice(index * 10, index * 10 + 10).map((cue) => cue.text);
  expect(requested).toEqual([block(0), block(1)]);
  expect(pending.map((request) => request.signal.aborted)).toEqual([false, false]);
  for (let time = 1; time < 22; time++) {
    video.currentTime = time;
    video.dispatchEvent(new Event('timeupdate'));
    await vi.advanceTimersByTimeAsync(0);
  }
  expect(requested).toEqual([block(0), block(1)]);
  video.currentTime = 22;
  video.dispatchEvent(new Event('timeupdate'));
  await vi.advanceTimersByTimeAsync(0);
  expect(requested.at(-1)).toEqual(dense.slice(20).map((cue) => cue.text));
  expect(pending[1].signal.aborted).toBe(false);
});

it('invalidates the old translation when the same video element loads a different source', async () => {
  controller = new CaptionController(publicSettings(saved));
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

it('distinguishes Chinese scripts and stops model work when the requested subtitle track becomes available', async () => {
  const tracks = [
    video.textTracks[0],
    {
      mode: 'disabled',
      kind: 'subtitles',
      language: 'zh-Hant',
      cues: [{ startTime: 2, endTime: 10, text: '現有繁體字幕' }],
    },
  ];
  Object.defineProperty(video, 'textTracks', { value: tracks });
  controller = new CaptionController(publicSettings(saved));
  await advance(2);
  await finish({ 'First cue': '模型生成的简体字幕' });
  expect(translated()?.textContent).toBe('模型生成的简体字幕');
  tracks.push({
    mode: 'disabled',
    kind: 'subtitles',
    language: 'zh-CN',
    cues: [{ startTime: 2, endTime: 10, text: '现有简体字幕' }],
  });
  const alreadyRequested = [...requested];
  await advance(3);
  expect(translated()?.textContent).toBe('现有简体字幕');
  await advance(7);
  expect(requested).toEqual(alreadyRequested);
  controller.update({ ...publicSettings(saved), targetLanguage: 'zh-TW' });
  expect(translated()?.textContent).toBe('現有繁體字幕');
  expect(requested).toEqual(alreadyRequested);
});

it('translates overlapping cues joined into one line whole, splits a long cue of its own, and asks for neither again', async () => {
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
  const pieces = splitSubtitleAtCommas(long).map((part) => long.slice(part.from, part.to));
  controller = new CaptionController(publicSettings(saved));
  await vi.advanceTimersByTimeAsync(0);
  expect(requested).toEqual([[first, joined, second], pieces]);
  for (const request of [...pending])
    request.resolve(providerReply(request.texts, (text) => `${text} 译文`));
  await vi.advanceTimersByTimeAsync(0);
  for (const [time, text] of [
    [4, `${joined} 译文`],
    [6, `${second} 译文`],
    [8, `${pieces[0]} 译文`],
  ] as const) {
    await advance(time - 0.1);
    video.currentTime = time;
    video.dispatchEvent(new Event('timeupdate'));
    expect(translated()?.textContent).toBe(text);
  }
  expect(requested).toHaveLength(2);
  expect(messages).not.toContain('translate');
});

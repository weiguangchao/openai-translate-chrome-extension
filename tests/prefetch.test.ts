import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CaptionController } from '../src/extension/captions';
import { DEFAULT_SETTINGS, publicSettings, STORAGE_KEY } from '../src/shared/settings';
import { providerReply, requestedTexts } from './fixtures/provider';

let controller: CaptionController | undefined;
let video: HTMLVideoElement;
const saved = { ...DEFAULT_SETTINGS, apiKey: 'test-key', model: 'test-model' };
const pending: { texts: string[]; signal: AbortSignal; resolve: (value: Response) => void }[] = [];
const requested: string[][] = [];
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
      sendMessage: (message: unknown) =>
        new Promise<Reply>((resolve) => listener(message, sender, resolve)),
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
  video.currentTime = time;
  video.dispatchEvent(new Event('timeupdate'));
  await vi.advanceTimersByTimeAsync(150);
}

it('preloads upcoming cues in one request before the first caption and displays them only at their timestamps', async () => {
  controller = new CaptionController(publicSettings(saved));
  await vi.advanceTimersByTimeAsync(0);
  expect(requested).toEqual([['First cue', 'Second cue', 'Third cue', 'After seeking']]);
  await finish({ 'First cue': '第一句', 'Second cue': '第二句', 'Third cue': '第三句' });
  expect(translated()?.hidden).toBe(true);
  await advance(2);
  expect(requested.at(-1)).toEqual(['First cue']);
  await finish({ 'First cue': '第一句' });
  expect(translated()?.textContent).toBe('第一句');
  expect(translated()?.hidden).toBe(false);
  await advance(4);
  expect(requested.at(-1)).toEqual(['Second cue', 'Third cue', 'After seeking']);
  await finish({ 'Second cue': '第二句' });
  expect(translated()?.textContent).toBe('第二句');
  await advance(6);
  expect(requested.at(-1)).toEqual(['Third cue', 'After seeking']);
  await finish({ 'Third cue': '第三句' });
  expect(translated()?.textContent).toBe('第三句');
  await advance(9);
  expect(translated()?.hidden).toBe(true);
  expect(requested).toEqual([
    ['First cue', 'Second cue', 'Third cue', 'After seeking'],
    ['First cue'],
    ['Second cue', 'Third cue', 'After seeking'],
    ['Third cue', 'After seeking'],
    ['After seeking'],
  ]);
});

it('prefetches the next blocks in ten-cue requests, cancels them on seek, and immediately prioritizes the new position', async () => {
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
  const blocks = [0, 10, 20].map((start) => dense.slice(start, start + 10).map((cue) => cue.text));
  expect(requested).toEqual(blocks);
  Object.defineProperty(video, 'seeking', { configurable: true, value: true });
  video.currentTime = 80;
  video.dispatchEvent(new Event('seeking'));
  await vi.advanceTimersByTimeAsync(0);
  expect(translated()?.hidden).toBe(true);
  expect(pending.map((request) => request.signal.aborted)).toEqual([true, true, true]);
  Object.defineProperty(video, 'seeking', { value: false });
  video.dispatchEvent(new Event('seeked'));
  await vi.advanceTimersByTimeAsync(0);
  expect(requested).toEqual([...blocks, ['After seeking']]);
  await finish({ 'After seeking': '跳转后的字幕' });
  expect(translated()?.textContent).toBe('跳转后的字幕');
  await finish({ 'Cue 1': '迟到的旧字幕' });
  expect(translated()?.textContent).toBe('跳转后的字幕');
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
  expect(requested.slice(1)).toEqual([['After']]);
  expect(original()?.textContent).toBe('Seek tail');
  expect(translated()?.hidden).toBe(true);
  expect(pending[0].signal.aborted).toBe(true);
});

it('cancels prefetching while paused, keeps the shown translation, and resumes on play', async () => {
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
  const blocks = [0, 10, 20].map((start) => dense.slice(start, start + 10).map((cue) => cue.text));
  expect(requested).toEqual(blocks);
  await setPaused(true);
  expect(pending.map((request) => request.signal.aborted)).toEqual([true, true, true]);
  await vi.advanceTimersByTimeAsync(60000);
  expect(requested).toHaveLength(3);
  expect(translated()?.hidden).toBe(true);
  pending.length = 0;
  await setPaused(false);
  expect(requested.slice(3)).toEqual(blocks);
  await finish({ 'Cue 1': '第一句' });
  expect(translated()?.textContent).toBe('第一句');
  expect(requested).toHaveLength(6);
  await setPaused(true);
  expect(pending.slice(1).map((request) => request.signal.aborted)).toEqual([true, true]);
  await vi.advanceTimersByTimeAsync(60000);
  expect(requested).toHaveLength(6);
  expect(translated()?.textContent).toBe('第一句');
  expect(translated()?.hidden).toBe(false);
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

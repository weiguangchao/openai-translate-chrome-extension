import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CaptionController } from '../src/extension/captions';
import { DEFAULT_SETTINGS, publicSettings, STORAGE_KEY } from '../src/shared/settings';

let controller: CaptionController | undefined;
let video: HTMLVideoElement;
const saved = { ...DEFAULT_SETTINGS, apiKey: 'test-key', model: 'test-model' };
const responses = new Map<string, (value: Response) => void>();
const requested: string[] = [];
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
      const prompt: string = JSON.parse(init.body as string).messages[1].content;
      const text = prompt.split('字幕：\n')[1];
      requested.push(text);
      return new Promise<Response>((resolve, reject) => {
        responses.set(text, resolve);
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
  responses.clear();
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
async function finish(text: string, translation: string) {
  responses.get(text)!(Response.json({ choices: [{ message: { content: translation } }] }));
  await vi.advanceTimersByTimeAsync(0);
}
async function advance(time: number) {
  video.currentTime = time;
  video.dispatchEvent(new Event('timeupdate'));
  await vi.advanceTimersByTimeAsync(150);
}

it('preloads upcoming cues before the first caption and displays cached translations only at their timestamps', async () => {
  controller = new CaptionController(publicSettings(saved));
  await vi.advanceTimersByTimeAsync(0);
  expect(requested).toEqual(['First cue', 'Second cue']);
  await finish('Second cue', '第二句');
  expect(translated()?.hidden).toBe(true);
  expect(requested).toContain('Third cue');
  await advance(2);
  expect(translated()?.hidden).toBe(true);
  await advance(4);
  expect(translated()?.textContent).toBe('第二句');
  expect(translated()?.hidden).toBe(false);
  await finish('First cue', '第一句');
  expect(translated()?.textContent).toBe('第二句');
  await finish('Third cue', '第三句');
  await advance(6);
  expect(translated()?.textContent).toBe('第三句');
  await advance(9);
  expect(translated()?.hidden).toBe(true);
  expect(requested.filter((text) => text === 'Second cue')).toHaveLength(1);
});

it('cancels obsolete work on seek and immediately prioritizes the new position', async () => {
  controller = new CaptionController(publicSettings(saved));
  await vi.advanceTimersByTimeAsync(0);
  expect(requested).toEqual(['First cue', 'Second cue']);
  Object.defineProperty(video, 'seeking', { configurable: true, value: true });
  video.currentTime = 80;
  video.dispatchEvent(new Event('seeking'));
  await vi.advanceTimersByTimeAsync(0);
  expect(translated()?.hidden).toBe(true);
  Object.defineProperty(video, 'seeking', { value: false });
  video.dispatchEvent(new Event('seeked'));
  await vi.advanceTimersByTimeAsync(0);
  expect(requested).toEqual(['First cue', 'Second cue', 'After seeking']);
  await finish('After seeking', '跳转后的字幕');
  expect(translated()?.textContent).toBe('跳转后的字幕');
  await finish('First cue', '迟到的旧字幕');
  expect(translated()?.textContent).toBe('跳转后的字幕');
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
  await finish('First cue', '旧视频字幕');
  expect(translated()?.textContent).not.toContain('旧视频字幕');
  await finish('New video', '新视频字幕');
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
  await finish('First cue', '模型生成的简体字幕');
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
  await finish('Second cue', '迟到的模型译文');
  expect(translated()?.textContent).toBe('现有简体字幕');
  await advance(7);
  expect(requested).toEqual(alreadyRequested);
  controller.update({ ...publicSettings(saved), targetLanguage: 'zh-TW' });
  expect(translated()?.textContent).toBe('現有繁體字幕');
  expect(requested).toEqual(alreadyRequested);
});

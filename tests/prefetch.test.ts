import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CaptionController } from '../src/core/controller';
import type { TimedCue } from '../src/core/cues';
import { maxInFlightRequests, seekSettleMs, translationSendsPerSecond } from '../src/shared/tuning';
import { createHboPlatform } from '../src/platforms/hbo/platform';
import { NativeTimeline } from '../src/core/native';
import { publicSettings } from '../src/shared/settings';
import { extensionStorage } from './fixtures/extension-storage';
import { consentedSettings } from './fixtures/settings';
import { providerReply, requestedTexts } from './fixtures/provider';
import { longCaption, longCaptionParts, longTranslations } from './fixtures/long-caption';

let controller: CaptionController | undefined;
let video: HTMLVideoElement;
const saved = { ...consentedSettings, apiKey: 'test-key', model: 'test-model' };
const pending: {
  texts: string[];
  signal: AbortSignal;
  resolve: (value: Response) => void;
  reject: (error: unknown) => void;
}[] = [];
const requested: string[][] = [];
const messages: string[] = [];

const cues = [
  { startTime: 2, endTime: 4, text: 'First cue.' },
  { startTime: 4, endTime: 6, text: 'Second cue.' },
  { startTime: 6, endTime: 8, text: 'Third cue.' },
  { startTime: 80, endTime: 82, text: 'After seeking.' },
];

function setCues(cues: readonly TimedCue[]): void {
  Object.defineProperty(video, 'textTracks', {
    configurable: true,
    value: [{ mode: 'showing', kind: 'subtitles', language: 'en', cues, activeCues: [] }],
  });
}

beforeEach(async () => {
  document.body.innerHTML = '<div class="video-js"><video></video></div>';
  video = document.querySelector('video')!;
  Object.defineProperty(video, 'readyState', { value: 1 });
  Object.defineProperty(video, 'paused', { configurable: true, value: false });
  setCues(cues);
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
  const { local, onChanged } = extensionStorage();
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
      local,
      session: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
      },
      onChanged,
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
  await (await import('../src/shared/storage')).saveSettings(saved);
  await import('../src/extension/background');
  await new Promise((resolve) => listener({ type: 'settings' }, sender, resolve));
  vi.useFakeTimers();
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
      expect(requested).toEqual([['First cue.'], ['Second cue.', 'Third cue.']]);
      await finish({ 'First cue.': 'Provider 译文' });
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
  const keys = new Set(Object.keys(translations));
  for (const request of pending) {
    if (request.signal.aborted || !request.texts.some((text) => keys.has(text))) continue;
    request.resolve(
      providerReply(request.texts, (source) => translations[source] ?? `${source} 译文`),
    );
  }
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

it('cuts a long cue into captions, translates each on its own, and shows each on time after a seek', async () => {
  setCues([
    { text: longCaption, startTime: 2, endTime: 14 },
    { text: 'After.', startTime: 16, endTime: 18 },
  ]);
  controller = new CaptionController(createHboPlatform, publicSettings(saved));
  await advance(8);
  expect(requested.flat()).not.toContain(longCaption);
  expect(translated()?.textContent).toBe('翻译中');
  expect(original()?.hidden).toBe(true);
  const translations = {
    ...Object.fromEntries(longCaptionParts.map((part, index) => [part, longTranslations[index]])),
    'After.': '之后。',
  };
  await finish(translations);
  const sourceText = () =>
    document.querySelector('[data-subline-overlay]')?.shadowRoot?.querySelector('.original')
      ?.textContent;
  expect(sourceText()).toBe(longCaptionParts[1]);
  expect(translated()?.textContent).toBe(longTranslations[1]);
  const boundary = 2 + 12 * (longCaption.indexOf(longCaptionParts[2]) / longCaption.length);
  await advance(boundary - 0.01);
  expect(sourceText()).toBe(longCaptionParts[1]);
  await finish(translations);
  video.currentTime = boundary;
  video.dispatchEvent(new Event('timeupdate'));
  await vi.advanceTimersByTimeAsync(0);
  expect(sourceText()).toBe(longCaptionParts[2]);
  expect(translated()?.textContent).toBe(longTranslations[2]);
  await advance(16);
  await finish(translations);
  expect(translated()?.textContent).toBe('之后。');
  video.currentTime = 3;
  video.dispatchEvent(new Event('seeked'));
  await vi.advanceTimersByTimeAsync(500);
  await finish(translations);
  expect(sourceText()).toBe(longCaptionParts[0]);
  expect(translated()?.textContent).toBe(longTranslations[0]);
  expect(new Set(requested.flat())).toEqual(new Set([...longCaptionParts, 'After.']));
});

it('preloads in the background and queries it at caption boundaries without another provider request', async () => {
  controller = new CaptionController(createHboPlatform, publicSettings(saved));
  await vi.advanceTimersByTimeAsync(0);
  const opening = [['First cue.'], ['Second cue.', 'Third cue.']];
  expect(requested).toEqual(opening);
  await finish({ 'First cue.': '第一句', 'Second cue.': '第二句', 'Third cue.': '第三句' });
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

it('lets the opening window finish during a scrub and requests only the cues at the new position', async () => {
  const dense = Array.from({ length: 30 }, (_, index) => ({
    startTime: 2 + index * 2,
    endTime: 4 + index * 2,
    text: `Cue ${index + 1}.`,
  }));
  setCues([...dense, { startTime: 80, endTime: 82, text: 'After seeking.' }]);
  controller = new CaptionController(createHboPlatform, publicSettings(saved));
  await vi.advanceTimersByTimeAsync(0);
  const opening = [['Cue 1.'], ['Cue 2.', 'Cue 3.', 'Cue 4.', 'Cue 5.']];
  expect(requested).toEqual(opening);
  Object.defineProperty(video, 'seeking', { configurable: true, value: true });
  video.currentTime = 40;
  video.dispatchEvent(new Event('seeking'));
  await vi.advanceTimersByTimeAsync(200);
  expect(translated()?.hidden).toBe(true);
  expect(pending.some((request) => request.signal.aborted)).toBe(false);
  expect(requested).toEqual(opening);
  video.currentTime = 80;
  Object.defineProperty(video, 'seeking', { value: false });
  video.dispatchEvent(new Event('seeked'));
  await vi.advanceTimersByTimeAsync(200);
  expect(requested).toEqual(opening);
  await vi.advanceTimersByTimeAsync(600);
  expect(requested.slice(opening.length)).toEqual([['After seeking.']]);
  await finish({ 'After seeking.': '跳转后的字幕' });
  expect(translated()?.textContent).toBe('跳转后的字幕');
  await finish({ 'Cue 1.': '迟到的旧字幕' });
  expect(translated()?.textContent).toBe('跳转后的字幕');
});

it('shows a timeout like the loading line, skips that batch, and translates the later segment', async () => {
  const dense = Array.from({ length: 30 }, (_, index) => ({
    startTime: 2 + index * 2,
    endTime: 4 + index * 2,
    text: `Cue ${index + 1}.`,
  }));
  setCues(dense);
  controller = new CaptionController(createHboPlatform, publicSettings(saved));
  await vi.advanceTimersByTimeAsync(0);
  const opening = [['Cue 1.'], ['Cue 2.', 'Cue 3.', 'Cue 4.', 'Cue 5.']];
  expect(requested).toEqual(opening);
  await advance(3);
  expect(requested).toEqual(opening);
  expect(translated()?.textContent).toBe('翻译中');
  const timeout = new Error('The operation was aborted due to timeout');
  timeout.name = 'TimeoutError';
  pending.find((request) => request.texts.includes('Cue 1.'))!.reject(timeout);
  await vi.advanceTimersByTimeAsync(0);
  const translation = translated();
  expect(translation?.textContent).toBe('接口调用超时');
  expect(translation?.classList.contains('error')).toBe(false);
  expect(translation?.classList.contains('timeout')).toBe(true);
  expect(translation?.style.fontSize).toBe('20px');
  expect(original()?.hidden).toBe(true);
  const sent = requested.length;
  await vi.advanceTimersByTimeAsync(20000);
  expect(requested.filter((request) => request.includes('Cue 1.'))).toHaveLength(1);
  expect(requested).toHaveLength(sent);
  expect(translated()?.textContent).toBe('接口调用超时');
  await advance(12);
  await finish({ 'Cue 6.': '第六句' });
  expect(translated()?.textContent).toBe('第六句');
  expect(requested.some((request) => request.includes('Cue 6.'))).toBe(true);
});

it('keeps requests sent before a seek running, sends the landing at once and caches their replies', async () => {
  const dense = Array.from({ length: 30 }, (_, index) => ({
    startTime: 2 + index * 2,
    endTime: 4 + index * 2,
    text: `Cue ${index + 1}.`,
  }));
  setCues(dense);
  controller = new CaptionController(createHboPlatform, publicSettings(saved));
  await vi.advanceTimersByTimeAsync(0);
  const started = requested.length;
  expect(started).toBe(maxInFlightRequests);
  video.currentTime = 42;
  video.dispatchEvent(new Event('timeupdate'));
  await vi.advanceTimersByTimeAsync(seekSettleMs - 1);
  expect(requested).toHaveLength(started);
  await vi.advanceTimersByTimeAsync(1);
  expect(requested.slice(started)).toEqual([
    ['Cue 21.'],
    ['Cue 22.', 'Cue 23.', 'Cue 24.', 'Cue 25.'],
  ]);
  expect(started + 2).toBeGreaterThan(translationSendsPerSecond);
  expect(pending.slice(0, started).some((request) => request.signal.aborted)).toBe(false);
  await finish({ 'Cue 1.': '第一句' });
  const sent = requested.length;
  video.currentTime = 2.5;
  video.dispatchEvent(new Event('timeupdate'));
  await vi.advanceTimersByTimeAsync(seekSettleMs);
  expect(translated()?.textContent).toBe('第一句');
  expect(requested.slice(sent).flat()).not.toContain('Cue 1.');
});

it('keeps an untranslated short source hidden and waits out a seek before requesting the landing cues', async () => {
  const cues = [
    { startTime: 0, endTime: 0.6, text: 'Opening.' },
    { startTime: 0.6, endTime: 4, text: 'Stay.' },
    { startTime: 4, endTime: 6, text: 'Next.' },
    { startTime: 20, endTime: 20.3, text: 'Seek tail.' },
    { startTime: 20.3, endTime: 24, text: 'After.' },
  ];
  setCues(cues);
  const original = () =>
    document
      .querySelector('[data-subline-overlay]')
      ?.shadowRoot?.querySelectorAll<HTMLElement>('.line')[0];
  controller = new CaptionController(createHboPlatform, publicSettings(saved));
  await vi.advanceTimersByTimeAsync(0);
  const opening = [['Stay.'], ['Next.']];
  expect(requested).toEqual(opening);
  expect(requested.flat()).not.toContain('Opening.');
  expect(requested.flat()).not.toContain('Seek tail.');
  expect(original()?.hidden).toBe(true);
  expect(translated()?.hidden).toBe(true);
  await advance(3.2);
  const sent = requested.length;
  expect(pending.find((request) => request.texts.includes('Stay.'))?.signal.aborted).toBe(false);
  expect(original()?.hidden).toBe(true);
  expect(translated()?.textContent).toBe('翻译中');
  Object.defineProperty(video, 'seeking', { configurable: true, value: true });
  video.currentTime = 20;
  video.dispatchEvent(new Event('seeking'));
  await vi.advanceTimersByTimeAsync(0);
  Object.defineProperty(video, 'seeking', { value: false });
  video.dispatchEvent(new Event('seeked'));
  await vi.advanceTimersByTimeAsync(0);
  expect(requested).toHaveLength(sent);
  await vi.advanceTimersByTimeAsync(400);
  expect(requested.slice(sent)).toEqual([['After.'], ['Seek tail.']]);
  expect(original()?.hidden).toBe(true);
  expect(translated()?.hidden).toBe(false);
  expect(translated()?.textContent).toBe('翻译中');
});

it('finishes in-flight prefetch while paused and does not send more until playback resumes', async () => {
  const dense = Array.from({ length: 25 }, (_, index) => ({
    startTime: 2 + index * 2,
    endTime: 4 + index * 2,
    text: `Cue ${index + 1}.`,
  }));
  setCues(dense);
  const setPaused = async (paused: boolean) => {
    Object.defineProperty(video, 'paused', { value: paused });
    video.dispatchEvent(new Event(paused ? 'pause' : 'play'));
    await vi.advanceTimersByTimeAsync(0);
  };
  controller = new CaptionController(createHboPlatform, publicSettings(saved));
  await advance(2);
  const openingCount = requested.length;
  expect(openingCount).toBeGreaterThan(0);
  expect(openingCount).toBeLessThanOrEqual(maxInFlightRequests);
  await setPaused(true);
  expect(pending.every((request) => !request.signal.aborted)).toBe(true);
  await vi.advanceTimersByTimeAsync(60000);
  expect(requested).toHaveLength(openingCount);
  await finish({ 'Cue 1.': '第一句' });
  expect(translated()?.textContent).toBe('第一句');
  expect(translated()?.hidden).toBe(false);
  expect(requested).toHaveLength(openingCount);
  video.currentTime = 12;
  video.dispatchEvent(new Event('timeupdate'));
  await vi.advanceTimersByTimeAsync(60000);
  expect(requested).toHaveLength(openingCount);
  await setPaused(false);
  await vi.advanceTimersByTimeAsync(1000);
  expect(requested.length).toBeGreaterThan(openingCount);
  await setPaused(true);
  const sent = requested.length;
  await vi.advanceTimersByTimeAsync(60000);
  expect(requested).toHaveLength(sent);
  expect(pending.at(-1)?.signal.aborted).toBe(false);
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
  await finish({ 'First cue.': '旧视频字幕' });
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
  await finish({ 'First cue.': '模型生成的字幕', 'Second cue.': 'Second cue 译文' });
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
  expect(requested).toEqual([['First cue.'], ['Second cue.', 'Third cue.']]);
});

it('queries the background again on a repeated caption while keeping the displayed caption between ticks', async () => {
  controller = new CaptionController(createHboPlatform, publicSettings(saved));
  await vi.advanceTimersByTimeAsync(0);
  await finish({ 'First cue.': '第一句', 'Second cue.': '第二句' });
  await advance(2);
  const firstMessages = messages.filter((type) => type === 'translate').length;
  await vi.advanceTimersByTimeAsync(5000);
  expect(messages.filter((type) => type === 'translate')).toHaveLength(firstMessages);
  expect(translated()?.textContent).toBe('第一句');
  await advance(4);
  await advance(2);
  expect(translated()?.textContent).toBe('第一句');
  expect(messages.filter((type) => type === 'translate').length).toBeGreaterThan(firstMessages + 1);
  expect(requested).toEqual([['First cue.'], ['Second cue.', 'Third cue.']]);
});

it('translates the displayed overlap together and splits a following long cue into captions', async () => {
  const first = 'When I first moved to the city, I didn’t know anyone at all,';
  const second = 'and every night I walked along the river, wondering why.';
  const joined = `${first}\n${second}`;
  const long =
    'Years later, standing on the same bridge, I finally understood that the city had become my home.';
  const overlap = [
    { startTime: 2, endTime: 6, text: first },
    { startTime: 4, endTime: 8, text: second },
    { startTime: 8, endTime: 12, text: long },
  ];
  setCues(overlap);
  const pieces = [
    'Years later, standing on the same bridge,',
    'I finally understood that the city had become my home.',
  ];
  controller = new CaptionController(createHboPlatform, publicSettings(saved));
  await vi.advanceTimersByTimeAsync(0);
  expect(requested).toEqual([[first], [joined, second, ...pieces]]);
  const delivered = new Set<(typeof pending)[number]>();
  const deliver = async () => {
    for (const request of [...pending]) {
      if (delivered.has(request)) continue;
      delivered.add(request);
      request.resolve(providerReply(request.texts, (text) => `${text} 译文`));
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
  expect(requested.flat()).toEqual(expect.arrayContaining([joined, ...pieces]));
  expect(requested.flat()).not.toContain(long);
  expect(messages).toContain('translate');
});

it('reuses the cues read from a track until the track changes', () => {
  const timeline = new NativeTimeline();
  const read = () => timeline.read(video).source;
  const first = read();
  expect(read()).toBe(first);
  Object.defineProperty(video.textTracks[0], 'cues', {
    value: [{ startTime: 2, endTime: 4, text: 'Changed' }],
  });
  expect(read()).not.toBe(first);
  expect(read()?.map((cue) => cue.text)).toEqual(['Changed']);
});

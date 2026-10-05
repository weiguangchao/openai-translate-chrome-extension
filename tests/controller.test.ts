import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CaptionController } from '../src/core/controller';
import type { CaptionSource, Platform } from '../src/core/platform';
import { DEFAULT_SETTINGS, publicSettings } from '../src/shared/settings';

let controller: CaptionController | undefined;
let source: CaptionSource;
let platform: Platform;
const sendMessage = vi.fn((message: { type: string; text?: string }) =>
  Promise.resolve({ ok: true, data: message.type === 'translate' ? `译文 ${message.text}` : null }),
);

beforeEach(() => {
  vi.useFakeTimers();
  sendMessage.mockReset().mockImplementation((message) =>
    Promise.resolve({
      ok: true,
      data: message.type === 'translate' ? `译文 ${message.text}` : null,
    }),
  );
  vi.stubGlobal('chrome', { runtime: { id: 'extension-id', sendMessage } });
  document.body.innerHTML = '<div id="player"><video></video><div id="layer">Native</div></div>';
  const video = document.querySelector('video')!;
  Object.defineProperties(video, {
    textTracks: { value: [] },
    readyState: { value: 1 },
    paused: { value: false, configurable: true },
  });
  source = { kind: 'waiting', mode: 'checking' };
  platform = {
    id: 'hbo',
    style: '.subline-player #layer { opacity: 0 !important; }',
    videoId: () => 'video',
    findPlayer: (element) => element.parentElement,
    source: () => source,
    reset: vi.fn(),
    destroy: vi.fn(),
  };
});

afterEach(() => {
  controller?.destroy();
  controller = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

const lines = () =>
  [
    ...document
      .querySelector('[data-subline-overlay]')!
      .shadowRoot!.querySelectorAll<HTMLElement>('.line'),
  ].map((line) => (line.hidden ? null : line.textContent));

it('drives any platform through the waiting, live and timeline caption sources', async () => {
  const layer = document.getElementById('layer')!;
  controller = new CaptionController(
    () => platform,
    publicSettings({ ...DEFAULT_SETTINGS, apiKey: 'key', model: 'model' }),
  );
  await vi.advanceTimersByTimeAsync(450);
  expect(lines()).toEqual([null, null]);
  expect(getComputedStyle(layer).opacity).toBe('0');
  expect(sendMessage).not.toHaveBeenCalled();

  source = {
    kind: 'live',
    mode: 'model',
    read: () => ({ text: 'Live cue', layers: [layer], nativeTrack: false }),
  };
  await vi.advanceTimersByTimeAsync(450);
  expect(lines()).toEqual(['Live cue', '译文 Live cue']);
  expect(layer.hasAttribute('data-subline-caption')).toBe(true);

  source = {
    kind: 'timeline',
    mode: 'model',
    id: 'track',
    cues: [{ startTime: 0, endTime: 10, text: 'Timed cue.' }],
    layers: () => [],
  };
  await vi.advanceTimersByTimeAsync(150);
  expect(lines()).toEqual(['Timed cue.', '译文 Timed cue.']);
  expect(layer.hasAttribute('data-subline-caption')).toBe(false);
  expect(sendMessage).toHaveBeenCalledWith({
    type: 'prefetch',
    items: [{ text: 'Timed cue.', segment: 0, needsSplit: false }],
  });

  controller.destroy();
  expect(platform.destroy).toHaveBeenCalledOnce();
  expect(document.querySelector('[data-subline-overlay]')).toBeNull();
  expect(getComputedStyle(layer).opacity).not.toBe('0');
});

it('updates styles in place while a translation is pending and shows its original result', async () => {
  const settings = { ...DEFAULT_SETTINGS, apiKey: 'key', model: 'model' };
  let finish!: (value: { ok: boolean; data: string }) => void;
  sendMessage.mockImplementationOnce(() => Promise.resolve({ ok: true, data: null }));
  sendMessage.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  source = {
    kind: 'timeline',
    mode: 'model',
    cues: [{ startTime: 0, endTime: 10, text: 'Still waiting.' }],
    layers: () => [],
  };
  controller = new CaptionController(() => platform, publicSettings(settings));
  await vi.advanceTimersByTimeAsync(0);
  const host = document.querySelector('[data-subline-overlay]');
  const calls = sendMessage.mock.calls.length;
  controller.update(
    publicSettings({
      ...settings,
      original: { color: '#FF0000', size: 36 },
      backgroundOpacity: 60,
      subtitleGap: 16,
    }),
  );
  expect(document.querySelector('[data-subline-overlay]')).toBe(host);
  expect(sendMessage).toHaveBeenCalledTimes(calls);
  expect(host?.shadowRoot?.querySelector<HTMLElement>('.original')?.style.fontSize).toBe('36px');
  finish({ ok: true, data: '等待后的译文' });
  await vi.advanceTimersByTimeAsync(0);
  expect(lines()).toEqual(['Still waiting.', '等待后的译文']);
});

it.each(['translation', 'source'])(
  'discards a late cached response after the %s identity changes',
  async (change) => {
    const settings = { ...DEFAULT_SETTINGS, apiKey: 'key', model: 'model' };
    const replies: ((value: { ok: boolean; data: string }) => void)[] = [];
    sendMessage.mockImplementation((message) =>
      message.type === 'translate'
        ? new Promise((resolve) => {
            replies.push(resolve);
          })
        : Promise.resolve({ ok: true, data: null }),
    );
    const video = document.querySelector('video')!;
    Object.defineProperty(video, 'paused', { value: true });
    source = {
      kind: 'timeline',
      mode: 'model',
      id: 'old-track',
      cues: [{ startTime: 0, endTime: 10, text: 'Old source.' }],
      layers: () => [],
    };
    controller = new CaptionController(() => platform, publicSettings(settings, 'old-version'));
    await vi.advanceTimersByTimeAsync(0);
    source = {
      ...source,
      id: change === 'source' ? 'new-track' : 'old-track',
      cues: [{ startTime: 0, endTime: 10, text: 'New source.' }],
    };
    controller.update(
      publicSettings(settings, change === 'translation' ? 'new-version' : 'old-version'),
    );
    await vi.advanceTimersByTimeAsync(0);
    replies[1]({ ok: true, data: '新的译文' });
    await vi.advanceTimersByTimeAsync(0);
    expect(lines()).toEqual(['New source.', '新的译文']);
    replies[0]({ ok: true, data: '旧的译文' });
    await vi.advanceTimersByTimeAsync(0);
    expect(lines()).toEqual(['New source.', '新的译文']);
    expect(sendMessage.mock.calls.filter(([message]) => message.type === 'translate')).toHaveLength(
      2,
    );
  },
);

it('retries a paused cache lookup invalidated by a later seek event', async () => {
  const replies: ((value: { ok: boolean; data: string }) => void)[] = [];
  sendMessage.mockImplementation((message) =>
    message.type === 'translate'
      ? new Promise((resolve) => {
          replies.push(resolve);
        })
      : Promise.resolve({ ok: true, data: null }),
  );
  const video = document.querySelector('video')!;
  Object.defineProperty(video, 'paused', { value: true });
  source = {
    kind: 'timeline',
    mode: 'model',
    cues: [{ startTime: 0, endTime: 90, text: 'Cached source.' }],
    layers: () => [],
  };
  controller = new CaptionController(
    () => platform,
    publicSettings({ ...DEFAULT_SETTINGS, apiKey: 'key', model: 'model' }),
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(replies).toHaveLength(1);
  video.dispatchEvent(new Event('seeked'));
  await vi.advanceTimersByTimeAsync(0);
  expect(replies).toHaveLength(2);
  replies[0]({ ok: true, data: '旧查询' });
  await vi.advanceTimersByTimeAsync(0);
  expect(lines()).toEqual([null, null]);
  replies[1]({ ok: true, data: '缓存译文' });
  await vi.advanceTimersByTimeAsync(450);
  expect(lines()).toEqual(['Cached source.', '缓存译文']);
  expect(sendMessage.mock.calls.filter(([m]) => m.type === 'translate').map(([m]) => m)).toEqual([
    { type: 'translate', text: 'Cached source.', cacheOnly: true },
    { type: 'translate', text: 'Cached source.', cacheOnly: true },
  ]);
});

it('keeps a displayed translation when playback resumes through a rebuffer seek', async () => {
  let translated = false;
  sendMessage.mockImplementation((message: { type: string; text?: string }) => {
    if (message.type !== 'translate') return Promise.resolve({ ok: true, data: null });
    if (!translated) {
      translated = true;
      return Promise.resolve({ ok: true, data: `译文 ${message.text}` });
    }
    return new Promise(() => {});
  });
  const video = document.querySelector('video')!;
  video.currentTime = 2;
  source = {
    kind: 'timeline',
    mode: 'model',
    id: 'track',
    cues: [{ startTime: 0, endTime: 10, text: 'Already translated.' }],
    layers: () => [],
  };
  controller = new CaptionController(
    () => platform,
    publicSettings({ ...DEFAULT_SETTINGS, apiKey: 'key', model: 'model' }),
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(lines()).toEqual(['Already translated.', '译文 Already translated.']);
  const translates = () =>
    sendMessage.mock.calls.filter(([message]) => message.type === 'translate');
  expect(translates()).toHaveLength(1);
  Object.defineProperty(video, 'paused', { value: true });
  video.dispatchEvent(new Event('pause'));
  Object.defineProperty(video, 'paused', { value: false });
  Object.defineProperty(video, 'seeking', { configurable: true, value: true });
  video.dispatchEvent(new Event('seeking'));
  Object.defineProperty(video, 'seeking', { value: false });
  video.dispatchEvent(new Event('seeked'));
  await vi.advanceTimersByTimeAsync(450);
  expect(lines()).toEqual(['Already translated.', '译文 Already translated.']);
  expect(translates()).toHaveLength(1);
});

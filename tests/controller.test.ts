import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CaptionController } from '../src/core/controller';
import type { CaptionSource, Platform } from '../src/core/platform';
import type { Reply } from '../src/shared/messages';
import { repeatedSourceMessage } from '../src/shared/provider-error';
import { publicSettings } from '../src/shared/settings';
import { consentedSettings } from './fixtures/settings';

let controller: CaptionController | undefined;
let source: CaptionSource;
let platform: Platform;
const sendMessage = vi.fn(
  (message: { type: string; text?: string }): Promise<Reply<string | null>> =>
    Promise.resolve({
      ok: true,
      data: message.type === 'translate' ? `译文 ${message.text}` : null,
    }),
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
  document.documentElement.removeAttribute('data-subline-trace');
  document.documentElement.removeAttribute('data-subline-trace-worker');
  Reflect.deleteProperty(document, 'fullscreenElement');
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

it('releases a DOM-only consumer when the controller is destroyed', async () => {
  source = {
    kind: 'live',
    mode: 'model',
    read: () => ({ text: 'DOM caption', layers: [], nativeTrack: false }),
  };
  controller = new CaptionController(
    () => platform,
    publicSettings({ ...consentedSettings, apiKey: 'key', model: 'model' }),
  );
  await vi.advanceTimersByTimeAsync(450);
  expect(lines()).toEqual(['DOM caption', '译文 DOM caption']);
  sendMessage.mockClear();
  controller.destroy();
  await vi.advanceTimersByTimeAsync(0);
  expect(sendMessage).toHaveBeenCalledWith({ type: 'prefetch', time: 0, rate: 1, cues: [] });
});

it('drives any platform through the waiting, live and timeline caption sources', async () => {
  const layer = document.getElementById('layer')!;
  controller = new CaptionController(
    () => platform,
    publicSettings({ ...consentedSettings, apiKey: 'key', model: 'model' }),
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
    time: 0,
    rate: 1,
    cues: [{ text: 'Timed cue.', start: 0, end: 10 }],
  });

  controller.destroy();
  expect(platform.destroy).toHaveBeenCalledOnce();
  expect(document.querySelector('[data-subline-overlay]')).toBeNull();
  expect(getComputedStyle(layer).opacity).not.toBe('0');
});

it('shows no source while the caption source is still being checked', async () => {
  const layer = document.getElementById('layer')!;
  const checking: CaptionSource[] = [
    {
      kind: 'live',
      mode: 'checking',
      read: () => ({ text: 'Live cue', layers: [layer], nativeTrack: false }),
    },
    {
      kind: 'timeline',
      mode: 'checking',
      cues: [{ startTime: 0, endTime: 10, text: 'Timed cue.' }],
      layers: () => [layer],
    },
  ];
  controller = new CaptionController(
    () => platform,
    publicSettings({ ...consentedSettings, apiKey: 'key', model: 'model' }),
  );
  for (const next of checking) {
    source = next;
    await vi.advanceTimersByTimeAsync(450);
    expect(lines()).toEqual([null, null]);
    expect(layer.hasAttribute('data-subline-caption')).toBe(true);
  }
  expect(sendMessage).not.toHaveBeenCalled();
  source = { ...checking[0], mode: 'model' };
  await vi.advanceTimersByTimeAsync(450);
  expect(lines()).toEqual(['Live cue', '译文 Live cue']);
});

it('updates styles in place while a translation is pending and shows its original result', async () => {
  const settings = { ...consentedSettings, apiKey: 'key', model: 'model' };
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

it('shows only the translation when translation-only is on and switches in place', async () => {
  const settings = { ...consentedSettings, apiKey: 'key', model: 'model', translationOnly: true };
  source = {
    kind: 'live',
    mode: 'model',
    read: () => ({ text: 'DOM caption', layers: [], nativeTrack: false }),
  };
  controller = new CaptionController(() => platform, publicSettings(settings));
  await vi.advanceTimersByTimeAsync(450);
  expect(lines()).toEqual([null, '译文 DOM caption']);
  const host = document.querySelector('[data-subline-overlay]');
  const calls = sendMessage.mock.calls.length;
  controller.update(publicSettings({ ...settings, translationOnly: false }));
  expect(document.querySelector('[data-subline-overlay]')).toBe(host);
  expect(sendMessage).toHaveBeenCalledTimes(calls);
  expect(lines()).toEqual(['DOM caption', '译文 DOM caption']);
});

it.each(['translation', 'source'])(
  'discards a late cached response after the %s identity changes',
  async (change) => {
    const settings = { ...consentedSettings, apiKey: 'key', model: 'model' };
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
    publicSettings({ ...consentedSettings, apiKey: 'key', model: 'model' }),
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
    publicSettings({ ...consentedSettings, apiKey: 'key', model: 'model' }),
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

it('reports what the viewer sees only while the page asks for a trace', async () => {
  source = {
    kind: 'timeline',
    mode: 'model',
    id: 'track',
    cues: [{ startTime: 0, endTime: 10, text: 'Timed cue.' }],
    layers: () => [],
  };
  controller = new CaptionController(
    () => platform,
    publicSettings({ ...consentedSettings, apiKey: 'key', model: 'model' }),
  );
  await vi.advanceTimersByTimeAsync(450);
  expect(lines()).toEqual(['Timed cue.', '译文 Timed cue.']);
  const traces = () =>
    sendMessage.mock.calls.map(([message]) => message).filter(({ type }) => type === 'trace');
  expect(traces()).toEqual([]);

  document.documentElement.setAttribute('data-subline-trace', 'run-1');
  await vi.advanceTimersByTimeAsync(300);
  expect(traces()).toEqual([
    {
      type: 'trace',
      run: 'run-1',
      time: 0,
      paused: false,
      seeking: false,
      state: 'ready',
      text: 'Timed cue.',
      cue: 0,
      start: 0,
      end: 10,
      segment: 0,
    },
  ]);
  expect(document.documentElement.getAttribute('data-subline-trace-worker')).toBe('extension-id');
});

it('treats a translation that reads like the loading placeholder as a translation', async () => {
  sendMessage.mockImplementation((message) =>
    Promise.resolve({ ok: true, data: message.type === 'translate' ? '翻译中' : null }),
  );
  document.documentElement.setAttribute('data-subline-trace', 'run');
  source = {
    kind: 'timeline',
    mode: 'model',
    id: 'track',
    cues: [{ startTime: 0, endTime: 10, text: 'Translating.' }],
    layers: () => [],
  };
  controller = new CaptionController(
    () => platform,
    publicSettings({ ...consentedSettings, apiKey: 'key', model: 'model' }),
  );
  await vi.advanceTimersByTimeAsync(450);
  const traced = () =>
    sendMessage.mock.calls
      .map(([message]) => message as { type: string; state?: string })
      .filter((message) => message.type === 'trace')
      .at(-1)?.state;
  expect(lines()).toEqual(['Translating.', '翻译中']);
  expect(traced()).toBe('ready');

  const video = document.querySelector('video')!;
  Object.defineProperty(video, 'seeking', { configurable: true, value: true });
  video.dispatchEvent(new Event('seeking'));
  await vi.advanceTimersByTimeAsync(0);
  expect(lines()).toEqual(['Translating.', '翻译中']);
  expect(traced()).toBe('ready');
});

it('shows only the source when the translation copies it and does not ask again', async () => {
  sendMessage.mockImplementation((message) =>
    Promise.resolve(
      message.type === 'translate'
        ? { ok: false, error: repeatedSourceMessage }
        : { ok: true, data: null },
    ),
  );
  source = {
    kind: 'live',
    mode: 'model',
    read: () => ({ text: 'Live cue', layers: [], nativeTrack: false }),
  };
  controller = new CaptionController(
    () => platform,
    publicSettings({ ...consentedSettings, apiKey: 'key', model: 'model' }),
  );
  await vi.advanceTimersByTimeAsync(450);
  expect(lines()).toEqual(['Live cue', null]);
  await vi.advanceTimersByTimeAsync(20000);
  expect(sendMessage.mock.calls.filter(([message]) => message.type === 'translate')).toHaveLength(
    1,
  );
});

it('keeps ready captions when the playback rate changes and plans at the new rate', async () => {
  source = {
    kind: 'timeline',
    mode: 'model',
    id: 'track',
    cues: [
      { startTime: 0, endTime: 10, text: 'Current caption.' },
      { startTime: 10, endTime: 20, text: 'Upcoming caption.' },
    ],
    layers: () => [],
  };
  controller = new CaptionController(
    () => platform,
    publicSettings({ ...consentedSettings, apiKey: 'key', model: 'model' }),
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(lines()).toEqual(['Current caption.', '译文 Current caption.']);
  sendMessage.mockClear();
  const video = document.querySelector('video')!;
  video.playbackRate = 1.5;
  video.dispatchEvent(new Event('ratechange'));
  await vi.advanceTimersByTimeAsync(0);
  expect(lines()).toEqual(['Current caption.', '译文 Current caption.']);
  expect(sendMessage.mock.calls.map(([message]) => message)).toEqual([
    {
      type: 'prefetch',
      time: 0,
      rate: 1.5,
      cues: [
        { start: 0, end: 10, text: 'Current caption.' },
        { start: 10, end: 20, text: 'Upcoming caption.' },
      ],
    },
  ]);
});

it('keeps captions inside a fullscreen ancestor and restores native layers for video-only fullscreen', async () => {
  const player = document.getElementById('player')!;
  const layer = document.getElementById('layer')!;
  const video = document.querySelector('video')!;
  const fullscreen = document.createElement('div');
  player.replaceWith(fullscreen);
  fullscreen.append(player);
  source = {
    kind: 'timeline',
    mode: 'model',
    cues: [{ startTime: 0, endTime: 10, text: 'Visible caption.' }],
    layers: () => [layer],
  };
  controller = new CaptionController(
    () => platform,
    publicSettings({ ...consentedSettings, apiKey: 'key', model: 'model' }),
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(lines()).toEqual(['Visible caption.', '译文 Visible caption.']);
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: fullscreen });
  video.dispatchEvent(new Event('timeupdate'));
  await vi.advanceTimersByTimeAsync(0);
  expect(
    fullscreen
      .querySelector(':scope > [data-subline-overlay]')
      ?.shadowRoot?.querySelector('.original')?.textContent,
  ).toBe('Visible caption.');
  expect(getComputedStyle(layer).opacity).toBe('0');
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: video });
  video.dispatchEvent(new Event('timeupdate'));
  expect(document.querySelector('[data-subline-overlay]')).toBeNull();
  expect(getComputedStyle(layer).opacity).not.toBe('0');
});

it('keeps the overlay in the player when the whole document is fullscreen', async () => {
  controller = new CaptionController(
    () => platform,
    publicSettings({ ...consentedSettings, apiKey: 'key', model: 'model' }),
  );
  const host = document.querySelector('#player > [data-subline-overlay]');
  expect(host).not.toBeNull();
  for (const root of [document.documentElement, document.body]) {
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: root });
    await vi.advanceTimersByTimeAsync(150);
    expect([...document.querySelectorAll('[data-subline-overlay]')]).toEqual([host]);
    expect(root.classList.contains('subline-player')).toBe(false);
  }
});

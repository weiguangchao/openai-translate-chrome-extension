import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CaptionController, readCaption } from '../src/extension/captions';
import { DEFAULT_SETTINGS, publicSettings } from '../src/shared/settings';

let controller: CaptionController | undefined;
const settings = () =>
  publicSettings({ ...structuredClone(DEFAULT_SETTINGS), apiKey: 'secret', model: 'test' });
beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML =
    '<div class="html5-video-player"><video></video><div class="ytp-caption-window-container"><div class="caption-window"><span class="caption-visual-line"><span class="ytp-caption-segment">First cue</span></span></div></div></div>';
  Object.defineProperty(document.querySelector('video'), 'textTracks', {
    configurable: true,
    value: [],
  });
  Object.defineProperty(document.querySelector('video'), 'readyState', { value: 1 });
  Object.defineProperty(document.querySelector('video'), 'paused', {
    configurable: true,
    value: false,
  });
});
afterEach(() => {
  controller?.destroy();
  controller = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});
function translationNode() {
  return document
    .querySelector('[data-subline-overlay]')
    ?.shadowRoot?.querySelectorAll<HTMLElement>('.line')[1];
}

it('shows the current translation, ignores a late reply, clears a missing cue and restores captions when disabled', async () => {
  const replies: ((value: unknown) => void)[] = [];
  const sendMessage = vi.fn(() => new Promise((resolve) => replies.push(resolve)));
  vi.stubGlobal('chrome', { runtime: { id: 'extension-id', sendMessage } });
  controller = new CaptionController(settings());
  await vi.advanceTimersByTimeAsync(450);
  expect(sendMessage).toHaveBeenCalledWith({ type: 'translate', text: 'First cue' });
  expect(translationNode()?.textContent).toBe('翻译中');
  expect(translationNode()?.hidden).toBe(false);
  expect(
    document.querySelector('[data-subline-overlay]')?.shadowRoot?.querySelector('.original')
      ?.textContent,
  ).toBe('First cue');
  document.querySelector('.ytp-caption-segment')!.textContent = 'Second cue';
  await vi.advanceTimersByTimeAsync(450);
  replies[0]({ ok: true, data: '过时译文' });
  await vi.advanceTimersByTimeAsync(1);
  expect(translationNode()?.textContent).not.toContain('过时译文');
  replies[1]({ ok: true, data: '第二句译文' });
  await vi.advanceTimersByTimeAsync(1);
  expect(translationNode()?.textContent).toBe('第二句译文');
  expect(translationNode()?.hidden).toBe(false);
  expect(
    document.querySelector('[data-subline-overlay]')?.shadowRoot?.querySelector('.original')
      ?.textContent,
  ).toBe('Second cue');
  expect(getComputedStyle(document.querySelector('.ytp-caption-window-container')!).opacity).toBe(
    '0',
  );
  document.querySelector('.ytp-caption-segment')!.textContent = '';
  await vi.advanceTimersByTimeAsync(150);
  expect(translationNode()?.hidden).toBe(true);
  controller.update({ ...settings(), enabled: false });
  expect(document.querySelector('[data-subline-overlay]')).toBeNull();
  expect(document.querySelector('[data-subline-caption]')).toBeNull();
  expect(document.querySelector('.subline-player')).toBeNull();
  expect(
    getComputedStyle(document.querySelector('.ytp-caption-window-container')!).opacity,
  ).not.toBe('0');
});

it.each(['.ytp-caption-window-container', '.caption-window'])(
  'ignores captions hidden by %s and reads an active browser subtitle track',
  (hidden) => {
    const video = document.querySelector('video')!;
    document.querySelector<HTMLElement>(hidden)!.style.display = 'none';
    Object.defineProperty(video, 'textTracks', {
      value: [
        {
          mode: 'showing',
          kind: 'subtitles',
          language: 'en',
          activeCues: [{ text: 'Track subtitle' }],
        },
      ],
    });
    expect(readCaption(document.querySelector('.html5-video-player')!, video, 'en')).toEqual({
      text: 'Track subtitle',
      element: null,
      nativeTrack: true,
    });
  },
);

it('finds an HBO subtitle layer that is a sibling of the video wrapper', async () => {
  document.body.innerHTML =
    '<div class="stream-player"><div class="media-wrapper"><video></video></div><div data-testid="subtitles">HBO cue</div></div>';
  Object.defineProperty(document.querySelector('video'), 'textTracks', { value: [] });
  Object.defineProperty(document.querySelector('video'), 'readyState', { value: 1 });
  Object.defineProperty(document.querySelector('video'), 'paused', { value: false });
  const sendMessage = vi.fn().mockResolvedValue({ ok: true, data: 'HBO 译文' });
  vi.stubGlobal('chrome', { runtime: { id: 'extension-id', sendMessage } });
  controller = new CaptionController(settings());
  await vi.advanceTimersByTimeAsync(450);
  expect(sendMessage).toHaveBeenCalledWith({ type: 'translate', text: 'HBO cue' });
  expect(translationNode()?.textContent).toBe('HBO 译文');
});

it('does not contact the service or modify the player before API setup is complete', async () => {
  const sendMessage = vi.fn();
  vi.stubGlobal('chrome', { runtime: { id: 'extension-id', sendMessage } });
  controller = new CaptionController(publicSettings(structuredClone(DEFAULT_SETTINGS)));
  await vi.advanceTimersByTimeAsync(3000);
  expect(sendMessage).not.toHaveBeenCalled();
  expect(document.querySelector('[data-subline-overlay]')).toBeNull();
  expect(document.querySelector('.subline-player')).toBeNull();
});

it.each(['throw', 'reject'])(
  'restores website captions and stops the old controller when messaging fails with an invalid context (%s)',
  async (failure) => {
    let invalidated = false;
    let obsoleteRequests = 0;
    const sendMessage = vi.fn(() => {
      if (!invalidated) return Promise.resolve({ ok: true, data: '第一句译文' });
      obsoleteRequests++;
      const error = new Error('Extension context invalidated.');
      if (failure === 'throw') throw error;
      return Promise.reject(error);
    });
    vi.stubGlobal('chrome', { runtime: { id: 'extension-id', sendMessage } });
    controller = new CaptionController(settings());
    await vi.advanceTimersByTimeAsync(450);
    expect(translationNode()?.textContent).toBe('第一句译文');
    const original = document.querySelector<HTMLElement>('.ytp-caption-window-container')!;
    expect(getComputedStyle(original).opacity).toBe('0');
    invalidated = true;
    document.querySelector('.ytp-caption-segment')!.textContent = 'Second cue';
    await vi.advanceTimersByTimeAsync(450);
    expect(document.querySelector('[data-subline-overlay]')).toBeNull();
    expect(original.textContent).toBe('Second cue');
    expect(getComputedStyle(original).opacity).not.toBe('0');
    await vi.advanceTimersByTimeAsync(30000);
    document.querySelector('video')!.dispatchEvent(new Event('timeupdate'));
    controller.update(settings());
    expect(document.querySelector('[data-subline-overlay]')).toBeNull();
    expect(obsoleteRequests).toBe(1);
  },
);

it('stops a cached caption when Chrome removes the runtime ID, even without another translation request', async () => {
  const runtime = {
    id: 'extension-id' as string | undefined,
    sendMessage: vi.fn().mockResolvedValue({ ok: true, data: '第一句译文' }),
  };
  vi.stubGlobal('chrome', { runtime });
  controller = new CaptionController(settings());
  await vi.advanceTimersByTimeAsync(450);
  expect(translationNode()?.textContent).toBe('第一句译文');
  runtime.id = undefined;
  await vi.advanceTimersByTimeAsync(150);
  expect(document.querySelector('[data-subline-overlay]')).toBeNull();
  expect(document.querySelector('.ytp-caption-window-container')?.textContent).toBe('First cue');
  expect(document.querySelector('.subline-youtube')).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
  expect(runtime.sendMessage.mock.calls.map(([message]) => message)).toEqual([
    { type: 'translate', text: 'First cue' },
  ]);
});

it('cleans up when prefetch throws during teardown and ignores an in-flight translation reply', async () => {
  let invalidated = false;
  let finish!: (value: unknown) => void;
  const sendMessage = vi.fn((message: { type: string }) => {
    if (invalidated) throw new Error('Extension context invalidated.');
    if (message.type === 'translate')
      return new Promise((resolve) => {
        finish = resolve;
      });
    return Promise.resolve({ ok: true });
  });
  vi.stubGlobal('chrome', { runtime: { id: 'extension-id', sendMessage } });
  controller = new CaptionController(settings());
  await vi.advanceTimersByTimeAsync(450);
  expect(
    document.querySelector('[data-subline-overlay]')?.shadowRoot?.querySelector('.original')
      ?.textContent,
  ).toBe('First cue');
  invalidated = true;
  controller.destroy();
  finish({ ok: true, data: '迟到的译文' });
  await vi.advanceTimersByTimeAsync(0);
  expect(document.querySelector('[data-subline-overlay]')).toBeNull();
  expect(document.querySelector('[data-subline-caption]')).toBeNull();
  expect(document.querySelector('.ytp-caption-window-container')?.textContent).toBe('First cue');
  expect(vi.getTimerCount()).toBe(0);
});

it('keeps the controller alive for recoverable messaging errors and retries the current caption', async () => {
  const sendMessage = vi
    .fn()
    .mockRejectedValueOnce(new Error('Receiving end does not exist.'))
    .mockResolvedValue({ ok: true, data: '恢复后的译文' });
  vi.stubGlobal('chrome', { runtime: { id: 'extension-id', sendMessage } });
  controller = new CaptionController(settings());
  await vi.advanceTimersByTimeAsync(450);
  expect(translationNode()?.textContent).toBe('Subline：Receiving end does not exist.');
  await vi.advanceTimersByTimeAsync(16000);
  expect(translationNode()?.textContent).toBe('恢复后的译文');
  expect(translationNode()?.hidden).toBe(false);
});

it('finishes an in-flight translation while paused and does not start another until playback resumes', async () => {
  const video = document.querySelector('video')!;
  const replies: ((value: unknown) => void)[] = [];
  const sendMessage = vi.fn((message: { type: string }) =>
    message.type === 'translate'
      ? new Promise((resolve) => replies.push(resolve))
      : Promise.resolve({ ok: true }),
  );
  const setPaused = async (paused: boolean) => {
    Object.defineProperty(video, 'paused', { value: paused });
    video.dispatchEvent(new Event(paused ? 'pause' : 'play'));
    await vi.advanceTimersByTimeAsync(0);
  };
  vi.stubGlobal('chrome', { runtime: { id: 'extension-id', sendMessage } });
  Object.defineProperty(video, 'paused', { value: true });
  controller = new CaptionController(settings());
  await vi.advanceTimersByTimeAsync(30000);
  expect(sendMessage).not.toHaveBeenCalled();
  await setPaused(false);
  expect(sendMessage).toHaveBeenLastCalledWith({ type: 'translate', text: 'First cue' });
  await setPaused(true);
  expect(sendMessage).toHaveBeenLastCalledWith({ type: 'prefetch', texts: [], pause: true });
  expect(translationNode()?.textContent).toBe('翻译中');
  replies[0]({ ok: true, data: '第一句译文' });
  await vi.advanceTimersByTimeAsync(1);
  expect(translationNode()?.textContent).toBe('第一句译文');
  expect(translationNode()?.hidden).toBe(false);
  await vi.advanceTimersByTimeAsync(30000);
  expect(translationNode()?.textContent).toBe('第一句译文');
  await setPaused(false);
  await vi.advanceTimersByTimeAsync(30000);
  expect(translationNode()?.textContent).toBe('第一句译文');
  await setPaused(true);
  await vi.advanceTimersByTimeAsync(30000);
  expect(translationNode()?.textContent).toBe('第一句译文');
  expect(translationNode()?.hidden).toBe(false);
  expect(sendMessage.mock.calls.map(([message]) => message)).toEqual([
    { type: 'translate', text: 'First cue' },
    { type: 'prefetch', texts: [], pause: true },
    { type: 'prefetch', texts: [], pause: false },
    { type: 'prefetch', texts: [], pause: true },
  ]);
});

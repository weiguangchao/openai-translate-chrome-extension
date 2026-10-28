import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CaptionController } from '../src/core/controller';
import { createHboPlatform } from '../src/platforms/hbo/platform';
import { readHboCaption } from '../src/platforms/hbo/player';
import { DEFAULT_SETTINGS, publicSettings } from '../src/shared/settings';
import { consentedSettings } from './fixtures/settings';

let controller: CaptionController | undefined;
const settings = () =>
  publicSettings({ ...structuredClone(consentedSettings), apiKey: 'secret', model: 'test' });
const captionLayer = () =>
  document.querySelector<HTMLElement>('[data-testid="caption_renderer_overlay"]')!;
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(window, 'postMessage').mockImplementation(() => {});
  document.body.innerHTML =
    '<div data-testid="playerContainer"><video></video><div data-testid="caption_renderer_overlay"><div id="cue">First cue</div></div></div>';
  Object.defineProperty(document.querySelector('video'), 'textTracks', {
    configurable: true,
    value: [{ mode: 'showing', kind: 'subtitles', language: 'en', cues: null, activeCues: [] }],
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});
function originalNode() {
  return document
    .querySelector('[data-subline-overlay]')
    ?.shadowRoot?.querySelector<HTMLElement>('.original');
}
function translationNode() {
  return document
    .querySelector('[data-subline-overlay]')
    ?.shadowRoot?.querySelectorAll<HTMLElement>('.line')[1];
}

it('shows the current translation, ignores a late reply, clears a missing cue and restores captions when disabled', async () => {
  const replies: ((value: unknown) => void)[] = [];
  const sendMessage = vi.fn(() => new Promise((resolve) => replies.push(resolve)));
  vi.stubGlobal('chrome', { runtime: { id: 'extension-id', sendMessage } });
  controller = new CaptionController(createHboPlatform, settings());
  await vi.advanceTimersByTimeAsync(450);
  expect(sendMessage).toHaveBeenCalledWith({
    type: 'translate',
    captionLanguage: 'en',
    text: 'First cue',
  });
  expect(translationNode()?.textContent).toBe('Translating');
  expect(translationNode()?.hidden).toBe(false);
  expect(
    document
      .querySelector('[data-subline-overlay]')
      ?.shadowRoot?.querySelector<HTMLElement>('.original')?.hidden,
  ).toBe(true);
  document.getElementById('cue')!.textContent = 'Second cue';
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
  expect(getComputedStyle(captionLayer()).opacity).toBe('0');
  expect(
    document
      .querySelector('[data-subline-overlay]')
      ?.shadowRoot?.querySelector<HTMLElement>('.stack')?.style.bottom,
  ).toBe('9%');
  document.getElementById('cue')!.textContent = '';
  await vi.advanceTimersByTimeAsync(150);
  expect(translationNode()?.hidden).toBe(true);
  controller.update({ ...settings(), enabled: false });
  expect(document.querySelector('[data-subline-overlay]')).toBeNull();
  expect(document.querySelector('[data-subline-caption]')).toBeNull();
  expect(document.querySelector('.subline-player')).toBeNull();
  expect(getComputedStyle(captionLayer()).opacity).not.toBe('0');
});

it.each(['[data-testid="caption_renderer_overlay"]', '#cue'])(
  'ignores Max captions hidden by %s and reads an active browser subtitle track',
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
    expect(
      readHboCaption(document.querySelector('[data-testid="playerContainer"]')!, video, true),
    ).toEqual({
      text: 'Track subtitle',
      layers: [],
      nativeTrack: true,
    });
  },
);

it.each([
  [
    'a sibling of the video wrapper',
    '<div class="stream-player"><div class="media-wrapper"><video></video></div><div data-testid="subtitles">HBO cue</div></div>',
  ],
  [
    'outside the nested video root',
    '<div data-testid="playerContainer"><div data-testid="player-root-element"><div><div><video></video></div></div></div><div data-testid="caption_renderer_overlay">HBO cue</div></div>',
  ],
])('finds an HBO subtitle layer when it is %s', async (_placement, html) => {
  document.body.innerHTML = html;
  Object.defineProperty(document.querySelector('video'), 'textTracks', {
    value: [{ mode: 'showing', kind: 'subtitles', language: 'en', cues: null, activeCues: [] }],
  });
  Object.defineProperty(document.querySelector('video'), 'readyState', { value: 1 });
  Object.defineProperty(document.querySelector('video'), 'paused', { value: false });
  const sendMessage = vi.fn().mockResolvedValue({ ok: true, data: 'HBO 译文' });
  vi.stubGlobal('chrome', { runtime: { id: 'extension-id', sendMessage } });
  controller = new CaptionController(createHboPlatform, settings());
  await vi.advanceTimersByTimeAsync(450);
  expect(sendMessage).toHaveBeenCalledWith({
    type: 'translate',
    captionLanguage: 'en',
    text: 'HBO cue',
  });
  expect(originalNode()?.textContent).toBe('HBO cue');
  expect(translationNode()?.textContent).toBe('HBO 译文');
});

function box(top: number, height: number, width = 640): DOMRect {
  return new DOMRect(80, top, width, height);
}
function stubBox(element: HTMLElement, value: DOMRect): void {
  element.getBoundingClientRect = () => value;
}
function stackNode() {
  return document
    .querySelector('[data-subline-overlay]')
    ?.shadowRoot?.querySelector<HTMLElement>('.stack');
}
async function playMax(html: string) {
  document.body.innerHTML = html;
  const video = document.querySelector('video')!;
  Object.defineProperty(video, 'textTracks', {
    configurable: true,
    value: [{ mode: 'showing', kind: 'subtitles', language: 'en', cues: null, activeCues: [] }],
  });
  Object.defineProperty(video, 'readyState', { configurable: true, value: 1 });
  Object.defineProperty(video, 'paused', { configurable: true, value: false });
  const sendMessage = vi.fn().mockResolvedValue({ ok: true, data: '是吗?' });
  vi.stubGlobal('chrome', { runtime: { id: 'extension-id', sendMessage } });
  controller = new CaptionController(createHboPlatform, settings());
  await vi.advanceTimersByTimeAsync(450);
  return sendMessage;
}

it('hides both Max source and mirrored cue when they are outside each other', async () => {
  await playMax(
    '<div id="player" data-testid="playerContainer"><video></video><div id="overlay" data-testid="caption_renderer_overlay">[chuckles] It is?</div><div id="cue">[chuckles] It is?</div></div>',
  );
  const player = document.getElementById('player')!;
  const overlay = document.getElementById('overlay')!;
  const cue = document.getElementById('cue')!;
  stubBox(player, box(0, 450, 800));
  stubBox(overlay, box(8, 24, 800));
  stubBox(cue, box(360, 28));
  await vi.advanceTimersByTimeAsync(150);
  expect(getComputedStyle(overlay).opacity).toBe('0');
  expect(getComputedStyle(cue).opacity).toBe('0');
  expect(stackNode()?.querySelector('.original')?.textContent).toBe('[chuckles] It is?');
  expect(stackNode()?.style.bottom).toBe('9%');
  controller!.destroy();
  expect(getComputedStyle(overlay).opacity).not.toBe('0');
  expect(getComputedStyle(cue).opacity).not.toBe('0');
});

it('reads Max text without hidden old cues or platform line breaks after taking over its layer', async () => {
  const sendMessage = await playMax(
    '<div data-testid="playerContainer"><video></video><div data-testid="caption_renderer_overlay"><div>Oh, thank you.</div><div>I\'ve got to talk to that<br>mailman.</div><span style="visibility:hidden">Old cue</span></div></div>',
  );
  const text = "Oh, thank you. I've got to talk to that mailman.";
  expect(sendMessage).toHaveBeenCalledWith({ type: 'translate', captionLanguage: 'en', text });
  expect(stackNode()?.querySelector('.original')?.textContent).toBe(text);
  await vi.advanceTimersByTimeAsync(1500);
  expect(stackNode()?.querySelector('.original')?.textContent).toBe(text);
  expect(sendMessage.mock.calls.filter(([message]) => message.type === 'translate')).toHaveLength(
    1,
  );
});

it('follows a replaced Max source while keeping plugin placement and restores site styles when disabled', async () => {
  await playMax(
    '<div id="player" data-testid="playerContainer"><video></video><div id="overlay" data-testid="caption_renderer_overlay" style="color:red;font-size:40px;background:blue">First cue</div></div>',
  );
  const player = document.getElementById('player')!;
  const overlay = document.getElementById('overlay')!;
  const originalStyle = overlay.style.cssText;
  const replacement = overlay.cloneNode() as HTMLElement;
  replacement.textContent = 'Second cue';
  overlay.replaceWith(replacement);
  stubBox(player, box(0, 900, 1600));
  stubBox(replacement, box(750, 40));
  await vi.advanceTimersByTimeAsync(450);
  expect(stackNode()?.style.bottom).toBe('9%');
  expect(stackNode()?.querySelector('.original')?.textContent).toBe('Second cue');
  expect(overlay.hasAttribute('data-subline-caption')).toBe(false);
  expect(getComputedStyle(replacement).opacity).toBe('0');
  expect(replacement.style.cssText).toBe(originalStyle);
  replacement.style.display = 'none';
  await vi.advanceTimersByTimeAsync(150);
  expect(stackNode()?.querySelector<HTMLElement>('.original')?.hidden).toBe(true);
  replacement.style.display = '';
  await vi.advanceTimersByTimeAsync(450);
  expect(stackNode()?.querySelector<HTMLElement>('.original')?.hidden).toBe(false);
  controller!.update({ ...settings(), enabled: false });
  expect(replacement.hasAttribute('data-subline-caption')).toBe(false);
  expect(getComputedStyle(replacement).opacity).not.toBe('0');
  expect(replacement.style.cssText).toBe(originalStyle);
  expect(document.querySelector('[data-subline-overlay]')).toBeNull();
});

it('does not contact the service or modify the player before API setup is complete', async () => {
  const sendMessage = vi.fn();
  vi.stubGlobal('chrome', { runtime: { id: 'extension-id', sendMessage } });
  controller = new CaptionController(
    createHboPlatform,
    publicSettings(structuredClone(DEFAULT_SETTINGS)),
  );
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
    controller = new CaptionController(createHboPlatform, settings());
    await vi.advanceTimersByTimeAsync(450);
    expect(translationNode()?.textContent).toBe('第一句译文');
    const original = captionLayer();
    expect(getComputedStyle(original).opacity).toBe('0');
    invalidated = true;
    document.getElementById('cue')!.textContent = 'Second cue';
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
  controller = new CaptionController(createHboPlatform, settings());
  await vi.advanceTimersByTimeAsync(450);
  expect(translationNode()?.textContent).toBe('第一句译文');
  runtime.id = undefined;
  await vi.advanceTimersByTimeAsync(150);
  expect(document.querySelector('[data-subline-overlay]')).toBeNull();
  expect(captionLayer().textContent).toBe('First cue');
  expect(captionLayer().hasAttribute('data-subline-caption')).toBe(false);
  expect(document.querySelector('.subline-player')).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
  expect(runtime.sendMessage.mock.calls.map(([message]) => message)).toEqual([
    { type: 'translate', captionLanguage: 'en', text: 'First cue' },
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
  controller = new CaptionController(createHboPlatform, settings());
  await vi.advanceTimersByTimeAsync(450);
  expect(translationNode()?.textContent).toBe('Translating');
  invalidated = true;
  controller.destroy();
  finish({ ok: true, data: '迟到的译文' });
  await vi.advanceTimersByTimeAsync(0);
  expect(document.querySelector('[data-subline-overlay]')).toBeNull();
  expect(document.querySelector('[data-subline-caption]')).toBeNull();
  expect(captionLayer().textContent).toBe('First cue');
  expect(vi.getTimerCount()).toBe(0);
});

it('keeps the error on its caption without retrying it and translates the next caption', async () => {
  const sendMessage = vi
    .fn()
    .mockRejectedValueOnce(new Error('Receiving end does not exist.'))
    .mockResolvedValue({ ok: true, data: '第二句译文' });
  vi.stubGlobal('chrome', { runtime: { id: 'extension-id', sendMessage } });
  controller = new CaptionController(createHboPlatform, settings());
  await vi.advanceTimersByTimeAsync(450);
  expect(translationNode()?.textContent).toBe('Receiving end does not exist.');
  expect(originalNode()?.hidden).toBe(true);
  await vi.advanceTimersByTimeAsync(16000);
  expect(translationNode()?.textContent).toBe('Receiving end does not exist.');
  expect(sendMessage).toHaveBeenCalledExactlyOnceWith({
    type: 'translate',
    captionLanguage: 'en',
    text: 'First cue',
  });
  document.getElementById('cue')!.textContent = 'Second cue';
  await vi.advanceTimersByTimeAsync(450);
  expect(translationNode()?.textContent).toBe('第二句译文');
  expect(originalNode()?.textContent).toBe('Second cue');
});

it('finishes an in-flight translation while paused and does not start another until playback resumes', async () => {
  const video = document.querySelector('video')!;
  const replies: ((value: unknown) => void)[] = [];
  const sendMessage = vi.fn((message: { type: string; cacheOnly?: boolean }) =>
    message.cacheOnly
      ? Promise.resolve({ ok: true, data: null })
      : message.type === 'translate'
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
  controller = new CaptionController(createHboPlatform, settings());
  await vi.advanceTimersByTimeAsync(16000);
  expect(sendMessage).toHaveBeenCalledExactlyOnceWith({
    type: 'translate',
    captionLanguage: 'en',
    text: 'First cue',
    cacheOnly: true,
  });
  await setPaused(false);
  expect(sendMessage).toHaveBeenLastCalledWith({
    type: 'translate',
    captionLanguage: 'en',
    text: 'First cue',
  });
  await setPaused(true);
  expect(sendMessage).toHaveBeenLastCalledWith({ type: 'prefetch-pause' });
  expect(translationNode()?.textContent).toBe('Translating');
  replies[0]({ ok: true, data: '第一句译文' });
  await vi.advanceTimersByTimeAsync(1);
  expect(translationNode()?.textContent).toBe('第一句译文');
  expect(translationNode()?.hidden).toBe(false);
  await vi.advanceTimersByTimeAsync(16000);
  expect(translationNode()?.textContent).toBe('第一句译文');
  await setPaused(false);
  await vi.advanceTimersByTimeAsync(16000);
  expect(translationNode()?.textContent).toBe('第一句译文');
  await setPaused(true);
  await vi.advanceTimersByTimeAsync(16000);
  expect(translationNode()?.textContent).toBe('第一句译文');
  expect(translationNode()?.hidden).toBe(false);
  expect(sendMessage.mock.calls.map(([message]) => message)).toEqual([
    { type: 'translate', captionLanguage: 'en', text: 'First cue', cacheOnly: true },
    { type: 'translate', captionLanguage: 'en', text: 'First cue' },
    { type: 'prefetch-pause' },
    { type: 'prefetch-resume' },
    { type: 'prefetch-pause' },
  ]);
}, 15_000);

it('serializes playback controls and synchronizes the latest intent after a delayed acknowledgement', async () => {
  const video = document.querySelector('video')!;
  const controls: string[] = [];
  const replies: ((value: unknown) => void)[] = [];
  const sendMessage = vi.fn((message: { type: string }) => {
    if (message.type === 'translate') return Promise.resolve({ ok: true, data: '第一句译文' });
    if (message.type !== 'prefetch-pause' && message.type !== 'prefetch-resume')
      return Promise.resolve({ ok: true });
    controls.push(message.type);
    return new Promise((resolve) => replies.push(resolve));
  });
  vi.stubGlobal('chrome', { runtime: { id: 'extension-id', sendMessage } });
  controller = new CaptionController(createHboPlatform, settings());
  await vi.advanceTimersByTimeAsync(450);
  const setPaused = async (paused: boolean) => {
    Object.defineProperty(video, 'paused', { value: paused });
    video.dispatchEvent(new Event(paused ? 'pause' : 'play'));
    await vi.advanceTimersByTimeAsync(150);
  };
  await setPaused(true);
  await setPaused(false);
  await setPaused(true);
  await setPaused(false);
  expect(controls).toEqual(['prefetch-pause']);
  replies[0]({ ok: true });
  await vi.advanceTimersByTimeAsync(0);
  expect(controls).toEqual(['prefetch-pause', 'prefetch-resume']);
  await setPaused(true);
  expect(controls).toHaveLength(2);
  replies[1]({ ok: true });
  await vi.advanceTimersByTimeAsync(0);
  expect(controls).toEqual(['prefetch-pause', 'prefetch-resume', 'prefetch-pause']);
  await setPaused(false);
  controller.destroy();
  replies[2]({ ok: true });
  await vi.advanceTimersByTimeAsync(150);
  expect(controls).toHaveLength(3);
  expect(vi.getTimerCount()).toBe(0);
});

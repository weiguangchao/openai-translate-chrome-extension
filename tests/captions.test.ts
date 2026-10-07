import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CaptionController } from '../src/core/controller';
import { createHboPlatform } from '../src/platforms/hbo/platform';
import { readHboCaption } from '../src/platforms/hbo/player';
import { createYoutubePlatform } from '../src/platforms/youtube/platform';
import { providerTimeoutMessage } from '../src/shared/provider-error';
import { DEFAULT_SETTINGS, publicSettings } from '../src/shared/settings';

let controller: CaptionController | undefined;
const settings = () =>
  publicSettings({ ...structuredClone(DEFAULT_SETTINGS), apiKey: 'secret', model: 'test' });
const captionLayer = () =>
  document.querySelector<HTMLElement>('[data-testid="caption_renderer_overlay"]')!;
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(window, 'postMessage').mockImplementation(() => {});
  document.body.innerHTML =
    '<div data-testid="playerContainer"><video></video><div data-testid="caption_renderer_overlay"><div id="cue">First cue</div></div></div>';
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
  expect(sendMessage).toHaveBeenCalledWith({ type: 'translate', text: 'First cue' });
  expect(translationNode()?.textContent).toBe('翻译中');
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
      readHboCaption(document.querySelector('[data-testid="playerContainer"]')!, video, 'en'),
    ).toEqual({
      text: 'Track subtitle',
      layers: [],
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
  controller = new CaptionController(createHboPlatform, settings());
  await vi.advanceTimersByTimeAsync(450);
  expect(sendMessage).toHaveBeenCalledWith({ type: 'translate', text: 'HBO cue' });
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
  Object.defineProperty(video, 'textTracks', { configurable: true, value: [] });
  Object.defineProperty(video, 'readyState', { configurable: true, value: 1 });
  Object.defineProperty(video, 'paused', { configurable: true, value: false });
  const sendMessage = vi.fn().mockResolvedValue({ ok: true, data: '是吗?' });
  vi.stubGlobal('chrome', { runtime: { id: 'extension-id', sendMessage } });
  controller = new CaptionController(createHboPlatform, settings());
  await vi.advanceTimersByTimeAsync(450);
  return sendMessage;
}

it.each([
  ['collapsed', 0],
  ['full screen', 450],
])(
  'replaces the Max original and uses the shared layout when its overlay is %s',
  async (_label, overlayHeight) => {
    const sendMessage = await playMax(
      '<div id="player" data-testid="playerContainer"><video></video><div id="overlay" data-testid="caption_renderer_overlay"><div id="cue">[chuckles] It is?</div></div></div>',
    );
    const player = document.getElementById('player')!;
    const overlay = document.getElementById('overlay')!;
    const cue = document.getElementById('cue')!;
    stubBox(player, box(0, 450, 800));
    stubBox(overlay, box(0, overlayHeight, 800));
    stubBox(cue, box(360, 28));
    await vi.advanceTimersByTimeAsync(150);
    expect(sendMessage).toHaveBeenCalledWith({ type: 'translate', text: '[chuckles] It is?' });
    expect(stackNode()?.querySelector('.original')?.textContent).toBe('[chuckles] It is?');
    expect(translationNode()?.textContent).toBe('是吗?');
    expect(stackNode()?.style.bottom).toBe('9%');
    expect(stackNode()?.style.top).toBe('');
    expect(getComputedStyle(overlay).opacity).toBe('0');
    expect(player.style.getPropertyValue('--subline-reserve')).toBe('');
  },
);

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
  expect(sendMessage).toHaveBeenCalledWith({ type: 'translate', text });
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

it('renders a YouTube timeline and a Max DOM caption with the same overlay and settings', async () => {
  vi.mocked(window.postMessage).mockImplementation(
    (data: { type?: string; requestId?: number }) => {
      if (data?.type !== 'subline:youtube-timeline-request') return;
      queueMicrotask(() =>
        window.dispatchEvent(
          new MessageEvent('message', {
            source: window,
            origin: location.origin,
            data: {
              type: 'subline:youtube-timeline-response',
              requestId: data.requestId,
              revision: 1,
              state: {
                mode: 'model',
                source: [{ startTime: 0, endTime: 10, text: 'Shared text' }],
                sourceId: 'track',
              },
            },
          }),
        ),
      );
    },
  );
  const styled = {
    ...settings(),
    original: { color: '#AABBCC', size: 32 },
    translation: { color: '#CCDDEE', size: 28 },
    backgroundOpacity: 60,
    subtitleGap: 12,
  };
  const sources = [
    {
      platform: createYoutubePlatform,
      html: '<div class="html5-video-player"><video></video><div class="ytp-caption-window-container"><span class="ytp-caption-segment">Shared text</span></div></div>',
      layer: '.ytp-caption-window-container',
    },
    {
      platform: createHboPlatform,
      html: '<div data-testid="playerContainer" style="font:bold italic 60px serif;letter-spacing:8px;text-transform:uppercase"><video></video><div data-testid="caption_renderer_overlay">Shared text</div></div>',
      layer: '[data-testid="caption_renderer_overlay"]',
    },
  ];
  const snapshots = [];
  for (const { platform, html, layer } of sources) {
    document.body.innerHTML = html;
    const video = document.querySelector('video')!;
    Object.defineProperty(video, 'textTracks', { value: [] });
    Object.defineProperty(video, 'readyState', { value: 1 });
    Object.defineProperty(video, 'paused', { value: false });
    vi.stubGlobal('chrome', {
      runtime: {
        id: 'extension-id',
        sendMessage: vi.fn().mockResolvedValue({ ok: true, data: '是吗?' }),
      },
    });
    controller = new CaptionController(platform, styled);
    await vi.advanceTimersByTimeAsync(450);
    const shadow = document.querySelector('[data-subline-overlay]')!.shadowRoot!;
    snapshots.push(shadow.innerHTML);
    expect(shadow.querySelector('.original')?.textContent).toBe('Shared text');
    expect(shadow.querySelector('.translation')?.textContent).toBe('是吗?');
    expect(shadow.querySelector<HTMLElement>('.original')?.style.fontSize).toBe('32px');
    expect(shadow.querySelector<HTMLElement>('.translation')?.style.marginTop).toBe('12px');
    expect(getComputedStyle(document.querySelector(layer)!).opacity).toBe('0');
    controller.destroy();
    expect(getComputedStyle(document.querySelector(layer)!).opacity).not.toBe('0');
  }
  expect(snapshots[0]).toBe(snapshots[1]);
});

it('reads the current Max caption overlay even when it sits outside the video root', async () => {
  document.body.innerHTML =
    '<div data-testid="playerContainer"><div data-testid="player-root-element"><div><div><video></video></div></div></div><div data-testid="caption_renderer_overlay">Max cue</div></div>';
  Object.defineProperty(document.querySelector('video'), 'textTracks', { value: [] });
  Object.defineProperty(document.querySelector('video'), 'readyState', { value: 1 });
  Object.defineProperty(document.querySelector('video'), 'paused', { value: false });
  const sendMessage = vi.fn().mockResolvedValue({ ok: true, data: 'Max 译文' });
  vi.stubGlobal('chrome', { runtime: { id: 'extension-id', sendMessage } });
  controller = new CaptionController(createHboPlatform, settings());
  await vi.advanceTimersByTimeAsync(450);
  expect(sendMessage).toHaveBeenCalledWith({ type: 'translate', text: 'Max cue' });
  expect(translationNode()?.textContent).toBe('Max 译文');
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
  controller = new CaptionController(createHboPlatform, settings());
  await vi.advanceTimersByTimeAsync(450);
  expect(translationNode()?.textContent).toBe('翻译中');
  invalidated = true;
  controller.destroy();
  finish({ ok: true, data: '迟到的译文' });
  await vi.advanceTimersByTimeAsync(0);
  expect(document.querySelector('[data-subline-overlay]')).toBeNull();
  expect(document.querySelector('[data-subline-caption]')).toBeNull();
  expect(captionLayer().textContent).toBe('First cue');
  expect(vi.getTimerCount()).toBe(0);
});

it('shows a provider timeout like the loading line and does not retry that caption', async () => {
  const sendMessage = vi.fn().mockResolvedValue({ ok: false, error: providerTimeoutMessage });
  vi.stubGlobal('chrome', { runtime: { id: 'extension-id', sendMessage } });
  controller = new CaptionController(createHboPlatform, settings());
  await vi.advanceTimersByTimeAsync(450);
  const translation = translationNode();
  expect(translation?.textContent).toBe('接口调用超时');
  expect(translation?.classList.contains('error')).toBe(false);
  expect(translation?.style.color).toBe('rgb(184, 229, 207)');
  expect(translation?.style.fontSize).toBe('20px');
  expect(originalNode()?.hidden).toBe(true);
  const translates = () =>
    sendMessage.mock.calls.filter(([message]) => message.type === 'translate');
  expect(translates()).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(20000);
  expect(translationNode()?.textContent).toBe('接口调用超时');
  expect(translates()).toHaveLength(1);
  document.getElementById('cue')!.textContent = 'Second cue';
  await vi.advanceTimersByTimeAsync(450);
  expect(translates()).toEqual([
    [{ type: 'translate', text: 'First cue' }],
    [{ type: 'translate', text: 'Second cue' }],
  ]);
});

it('shows the original with the error, keeps the controller alive and retries the current caption', async () => {
  const sendMessage = vi
    .fn()
    .mockRejectedValueOnce(new Error('Receiving end does not exist.'))
    .mockResolvedValue({ ok: true, data: '恢复后的译文' });
  vi.stubGlobal('chrome', { runtime: { id: 'extension-id', sendMessage } });
  controller = new CaptionController(createHboPlatform, settings());
  await vi.advanceTimersByTimeAsync(450);
  expect(translationNode()?.textContent).toBe('Subline：Receiving end does not exist.');
  expect(originalNode()?.hidden).toBe(false);
  expect(originalNode()?.textContent).toBe('First cue');
  await vi.advanceTimersByTimeAsync(16000);
  expect(translationNode()?.textContent).toBe('恢复后的译文');
  expect(translationNode()?.hidden).toBe(false);
  expect(originalNode()?.textContent).toBe('First cue');
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
  await vi.advanceTimersByTimeAsync(30000);
  expect(sendMessage).toHaveBeenCalledExactlyOnceWith({
    type: 'translate',
    text: 'First cue',
    cacheOnly: true,
  });
  await setPaused(false);
  expect(sendMessage).toHaveBeenLastCalledWith({ type: 'translate', text: 'First cue' });
  await setPaused(true);
  expect(sendMessage).toHaveBeenLastCalledWith({ type: 'prefetch-pause' });
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
    { type: 'translate', text: 'First cue', cacheOnly: true },
    { type: 'translate', text: 'First cue' },
    { type: 'prefetch-pause' },
    { type: 'prefetch-resume' },
    { type: 'prefetch-pause' },
  ]);
}, 15_000);

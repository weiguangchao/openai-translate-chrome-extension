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
  sendMessage.mockClear();
  vi.stubGlobal('chrome', { runtime: { id: 'extension-id', sendMessage } });
  document.body.innerHTML = '<div id="player"><video></video><div id="layer">Native</div></div>';
  const video = document.querySelector('video')!;
  Object.defineProperties(video, {
    textTracks: { value: [] },
    readyState: { value: 1 },
    paused: { value: false },
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
    texts: ['Timed cue.'],
    segments: [0],
  });

  controller.destroy();
  expect(platform.destroy).toHaveBeenCalledOnce();
  expect(document.querySelector('[data-subline-overlay]')).toBeNull();
  expect(getComputedStyle(layer).opacity).not.toBe('0');
});

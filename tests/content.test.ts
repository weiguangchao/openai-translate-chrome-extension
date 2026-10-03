import { afterEach, beforeEach, expect, it, vi, type Mock } from 'vitest';
import { DEFAULT_SETTINGS, publicSettings } from '../src/shared/settings';

const settings = publicSettings({ ...DEFAULT_SETTINGS, apiKey: 'key', model: 'model' });
let runtime: {
  id: string | undefined;
  sendMessage: Mock<(message: { type: string }) => Promise<unknown>>;
  onMessage: { addListener: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  document.body.innerHTML =
    '<div data-testid="playerContainer"><video></video><div data-testid="caption_renderer_overlay">First cue</div></div>';
  Object.defineProperty(document.querySelector('video'), 'textTracks', { value: [] });
  Object.defineProperty(document.querySelector('video'), 'readyState', { value: 1 });
  Object.defineProperty(document.querySelector('video'), 'paused', { value: false });
  runtime = {
    id: 'extension-id',
    sendMessage: vi.fn((message: { type: string }) =>
      Promise.resolve({
        ok: true,
        data: message.type === 'settings' ? settings : '第一句译文',
      }),
    ),
    onMessage: { addListener: vi.fn() },
  };
  vi.stubGlobal('chrome', { runtime });
});

afterEach(async () => {
  runtime.id = undefined;
  window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  await vi.advanceTimersByTimeAsync(150);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

function translated(): string | null | undefined {
  return document.querySelector('[data-subline-overlay]')?.shadowRoot?.querySelector('.translation')
    ?.textContent;
}

it.each(['initial', 'restore'])(
  'handles synchronous invalidation during %s settings loading and starts again only in a fresh content script',
  async (stage) => {
    let invalidated = stage === 'initial';
    const send = runtime.sendMessage.getMockImplementation()!;
    runtime.sendMessage.mockImplementation((message) => {
      if (invalidated) throw new Error('Extension context invalidated.');
      return send(message);
    });
    await import('../src/platforms/hbo/content');
    await vi.advanceTimersByTimeAsync(450);
    if (stage === 'restore') {
      expect(translated()).toBe('第一句译文');
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      await vi.advanceTimersByTimeAsync(0);
      invalidated = true;
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(document.querySelector('[data-subline-overlay]')).toBeNull();
    expect(document.querySelector('.subline-player')).toBeNull();
    invalidated = false;
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    runtime.onMessage.addListener.mock.calls[0][0]({ type: 'settings-updated', settings });
    await vi.advanceTimersByTimeAsync(450);
    expect(document.querySelector('[data-subline-overlay]')).toBeNull();
    vi.resetModules();
    await import('../src/platforms/hbo/content');
    await vi.advanceTimersByTimeAsync(450);
    expect(translated()).toBe('第一句译文');
    expect(document.querySelectorAll('[data-subline-overlay]').length).toBe(1);
  },
);

it('discards settings replies from before pagehide and loads current settings on browser history restoration', async () => {
  const replies: ((value: unknown) => void)[] = [];
  const send = runtime.sendMessage.getMockImplementation()!;
  runtime.sendMessage.mockImplementation((message) =>
    message.type === 'settings' ? new Promise((resolve) => replies.push(resolve)) : send(message),
  );
  await import('../src/platforms/hbo/content');
  await vi.advanceTimersByTimeAsync(0);
  window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
  window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  await vi.advanceTimersByTimeAsync(0);
  replies[0]({ ok: true, data: { ...settings, original: { color: '#FFFFFF', size: 48 } } });
  await vi.advanceTimersByTimeAsync(450);
  expect(document.querySelector('[data-subline-overlay]')).toBeNull();
  replies[1]({ ok: true, data: settings });
  await vi.advanceTimersByTimeAsync(450);
  expect(translated()).toBe('第一句译文');
  const original = document
    .querySelector('[data-subline-overlay]')!
    .shadowRoot!.querySelector<HTMLElement>('.original')!;
  expect(original.style.fontSize).toBe('24px');
});

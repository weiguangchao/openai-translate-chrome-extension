import { afterEach, beforeEach, expect, it, vi, type Mock } from 'vitest';
import { createTestPlatform } from './fixtures/platform';
import { publicSettings } from '../src/shared/settings';
import { consentedSettings } from './fixtures/settings';
import { createChromeEvent } from './fixtures/chrome-event';

const settings = publicSettings({ ...consentedSettings, apiKey: 'key', model: 'model' });
let runtime: {
  id: string | undefined;
  sendMessage: Mock<(message: { type: string }) => Promise<unknown>>;
  onMessage: { addListener: ReturnType<typeof vi.fn> };
  onConnect: { addListener: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  document.body.innerHTML =
    '<div data-player><video></video><div data-caption-layer>First cue</div></div>';
  Object.defineProperty(document.querySelector('video'), 'textTracks', {
    value: [{ mode: 'showing', kind: 'subtitles', language: 'en', cues: null, activeCues: [] }],
  });
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
    onConnect: { addListener: vi.fn() },
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
    const { startContentScript } = await import('../src/core/content');
    startContentScript(createTestPlatform);
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
    startContentScript(createTestPlatform);
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
  const { startContentScript } = await import('../src/core/content');
  startContentScript(createTestPlatform);
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
  expect(original.style.fontSize).toBe('clamp(14px, 3.75cqw, 24px)');
});

it('streams the displayed caption state while the popup stays connected', async () => {
  const { startContentScript } = await import('../src/core/content');
  startContentScript(createTestPlatform);
  const port = {
    name: 'page-status',
    postMessage: vi.fn(),
    onDisconnect: createChromeEvent<[]>(),
  };
  runtime.onConnect.addListener.mock.calls[0][0](port);
  expect(port.postMessage).toHaveBeenLastCalledWith('waiting');
  await vi.advanceTimersByTimeAsync(450);
  expect(translated()).toBe('第一句译文');
  expect(port.postMessage).toHaveBeenLastCalledWith('bilingual');
  const listener = runtime.onMessage.addListener.mock.calls[0][0];
  listener({ type: 'settings-updated', settings: { ...settings, translationOnly: true } });
  expect(port.postMessage).toHaveBeenLastCalledWith('translation-only');
  expect(translated()).toBe('第一句译文');
  listener({ type: 'settings-updated', settings: { ...settings, enabled: false } });
  expect(port.postMessage).toHaveBeenLastCalledWith('disabled');
  expect(document.querySelector('[data-subline-overlay]')).toBeNull();
  listener({ type: 'settings-updated', settings });
  expect(port.postMessage).toHaveBeenLastCalledWith('waiting');
  await vi.advanceTimersByTimeAsync(450);
  expect(translated()).toBe('第一句译文');
  expect(port.postMessage).toHaveBeenLastCalledWith('bilingual');
  port.onDisconnect.emit();
  port.postMessage.mockClear();
  listener({ type: 'settings-updated', settings: { ...settings, enabled: false } });
  await vi.advanceTimersByTimeAsync(150);
  expect(port.postMessage).not.toHaveBeenCalled();
});

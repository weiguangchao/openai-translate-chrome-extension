import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CaptionTranslator, type CaptionFrame } from '../src/core/translator';
import { ExtensionConnection } from '../src/core/connection';
import { SubtitleOverlay } from '../src/core/overlay';
import type { Reply } from '../src/shared/messages';
import { portPair } from './fixtures/ports';

const frame: CaptionFrame = {
  text: 'Current caption',
  captionLanguage: 'en',
  pageTitle: 'Video',
  cacheOnly: false,
  debounce: 0,
};
let translator: CaptionTranslator;
let reply: (value: Reply<string | null>) => void;
let pair: ReturnType<typeof portPair>;
let connect: ReturnType<typeof vi.fn>;
let render: ReturnType<typeof vi.spyOn>;
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  connect = vi.fn(({ name }: { name: string }) => {
    pair = portPair(name);
    return pair.client;
  });
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'extension',
      connect,
      sendMessage: vi.fn((message: { type: string }) =>
        message.type === 'translate'
          ? new Promise<Reply<string | null>>((resolve) => {
              reply = resolve;
            })
          : Promise.resolve({ ok: true }),
      ),
    },
  });
  const overlay = new SubtitleOverlay();
  render = vi.spyOn(overlay, 'render');
  const changed = () => translator.show({ ...frame, cacheOnly: false });
  translator = new CaptionTranslator(
    new ExtensionConnection(() => {}),
    overlay,
    changed,
    () => false,
    () => 'zh-CN',
    () => ({ provider: 'openai', translationRevision: 'version' }),
  );
  translator.notePlayback(false);
  translator.show(frame);
});
afterEach(() => {
  translator.reset();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function resume() {
  translator.notePlayback(true);
  translator.show({ ...frame, cacheOnly: true });
  await vi.advanceTimersByTimeAsync(5000);
  translator.notePlayback(false);
  translator.show(frame);
  await flush();
}

it('does not spend the recovery attempt on initial playback before a real pause', async () => {
  translator.reset();
  translator.notePlayback(true);
  translator.show({ ...frame, cacheOnly: true });
  await flush();
  translator.notePlayback(false);
  translator.show(frame);
  await flush();
  expect(connect).not.toHaveBeenCalled();
  await resume();
  expect(connect).toHaveBeenCalledOnce();
});

it('counts playing time on either side of a pause without freezing DOM debounce', async () => {
  await vi.advanceTimersByTimeAsync(100);
  translator.notePlayback(true);
  translator.show({ ...frame, cacheOnly: true });
  await vi.advanceTimersByTimeAsync(5000);
  translator.notePlayback(false);
  translator.show(frame);
  expect(translator.state).toBe('empty');
  await vi.advanceTimersByTimeAsync(199);
  translator.notePlayback(false);
  translator.show(frame);
  expect(translator.state).toBe('empty');
  await vi.advanceTimersByTimeAsync(1);
  translator.notePlayback(false);
  translator.show(frame);
  expect(translator.state).toBe('loading');
});

it.each(['clear', 'release'] as const)(
  'does not carry a resume into the next caption after %s',
  async (method) => {
    translator.notePlayback(true);
    translator.notePlayback(false);
    translator[method]();
    translator.show({ ...frame, text: 'Next caption' });
    await flush();
    expect(connect).not.toHaveBeenCalled();
  },
);

it('does not recover a caption that first appears after resuming in a blank interval', async () => {
  translator.notePlayback(true);
  translator.clear();
  translator.notePlayback(false);
  translator.show({ ...frame, text: 'Next caption' });
  await flush();
  expect(connect).not.toHaveBeenCalled();
});

it('keeps recovery bound to the caption that was present at resume', async () => {
  translator.notePlayback(true);
  translator.notePlayback(false);
  translator.show({ ...frame, text: 'Next caption' });
  await flush();
  expect(connect).not.toHaveBeenCalled();
});

it.each(['failure', 'timeout', 'success'] as const)(
  'retains the supplemental translation when the original later returns %s',
  async (result) => {
    await flush();
    await resume();
    pair.server.postMessage({ type: 'translation', translation: '微软先完成' });
    await flush();
    reply(
      result === 'success'
        ? { ok: true, data: '后来原译文' }
        : {
            ok: false,
            failure:
              result === 'timeout'
                ? { kind: 'timeout' }
                : { kind: 'error', message: 'Provider failed' },
          },
    );
    await flush();
    expect(translator.state).toBe('ready');
    expect(render).toHaveBeenLastCalledWith({
      original: frame.text,
      line: { kind: 'ready', translation: '微软先完成' },
    });
  },
);

it('keeps the original failure pending only while a sent supplement can succeed', async () => {
  await flush();
  await resume();
  pair.server.postMessage({ type: 'sent' });
  await flush();
  reply({ ok: false, failure: { kind: 'error', message: 'Original failed' } });
  await flush();
  expect(translator.state).toBe('empty');
  pair.server.postMessage({ type: 'translation', translation: '补充成功' });
  await flush();
  expect(translator.state).toBe('ready');
});

it('settles a saved failure when a sent supplement disconnects', async () => {
  await flush();
  await resume();
  pair.server.postMessage({ type: 'sent' });
  await flush();
  reply({ ok: false, failure: { kind: 'timeout' } });
  await flush();
  pair.server.disconnect();
  await flush();
  expect(translator.state).toBe('timeout');
});

it('shows an original error immediately when the supplement has not sent', async () => {
  await flush();
  await resume();
  reply({ ok: false, failure: { kind: 'error', message: 'Original failed' } });
  await flush();
  expect(translator.state).toBe('error');
  expect(pair.client.disconnect).toHaveBeenCalledOnce();
});

it('lets the original finish after an unexpected port disconnection', async () => {
  await flush();
  await resume();
  pair.server.disconnect();
  await flush();
  reply({ ok: true, data: '原请求成功' });
  await flush();
  expect(translator.state).toBe('ready');
});

it('synchronizes the current pause and reuses the same port through another resume', async () => {
  await flush();
  await resume();
  translator.notePlayback(true);
  pair.server.postMessage({ type: 'sync' });
  await flush();
  expect(pair.client.postMessage).toHaveBeenLastCalledWith({ type: 'sync-state', paused: true });
  translator.notePlayback(false);
  translator.show(frame);
  await flush();
  expect(connect).toHaveBeenCalledOnce();
  expect(pair.client.postMessage).toHaveBeenLastCalledWith({ type: 'state', paused: false });
});

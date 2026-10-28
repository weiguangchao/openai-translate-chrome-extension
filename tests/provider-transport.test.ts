import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/shared/settings';
import { prefetchItems, providerReply, requestedTexts } from './fixtures/provider';
import {
  providerSendWindowMs,
  providerTimeoutMs,
  translationSendsPerSecond,
} from '../src/shared/tuning';

let api: typeof import('../src/shared/api');
let TranslationQueue: typeof import('../src/extension/queue').TranslationQueue;
const settings = {
  ...DEFAULT_SETTINGS,
  captionLanguage: 'en' as const,
  apiKey: 'key',
  model: 'budget-test',
};

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  api = await import('../src/shared/api');
  ({ TranslationQueue } = await import('../src/extension/queue'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('keeps invalid replies in the send budget before admitting fresh captions', async () => {
  const sends: number[] = [];
  const invalid = ['A', 'B', 'C'];
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    sends.push(Date.now());
    const texts = requestedTexts(init);
    return providerReply(texts, () => (invalid.includes(texts[0]) ? '' : `译文 ${texts[0]}`));
  });
  vi.stubGlobal('fetch', fetch);
  const queue = new TranslationQueue();
  await expect(
    Promise.all(invalid.map((text) => queue.request(text, settings, text).catch(() => null))),
  ).resolves.toEqual([null, null, null]);
  const work = ['D', 'E', 'F'].map((text) => queue.request(text, settings, text));
  await vi.advanceTimersByTimeAsync(999);
  expect(sends).toHaveLength(3);
  await vi.advanceTimersByTimeAsync(1);
  await expect(Promise.all(work)).resolves.toEqual(['译文 D', '译文 E', '译文 F']);
  expect(sends).toHaveLength(6);
  for (const at of sends)
    expect(sends.filter((time) => at <= time && time < at + 1000).length).toBeLessThanOrEqual(3);
});

it('shares the POST budget with connection checks while GET models remain available', async () => {
  const fetch = vi.fn(async (_url: string, init: RequestInit) =>
    init.method === 'GET'
      ? Response.json({ data: [{ id: 'model' }] })
      : providerReply(requestedTexts(init), () => '完成'),
  );
  vi.stubGlobal('fetch', fetch);
  const queue = new TranslationQueue();
  const work = ['A', 'B', 'C'].map((text) => queue.request(text, settings, text));
  const check = api.translate(settings, 'connection check');
  await expect(api.fetchModels(settings)).resolves.toEqual(['model']);
  expect(fetch.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(3);
  await vi.advanceTimersByTimeAsync(1000);
  await expect(Promise.all(work)).resolves.toEqual(['完成', '完成', '完成']);
  await expect(check).resolves.toContain('完成');
  expect(fetch).toHaveBeenCalledTimes(5);
});

it('cancels a waiting send without fetching or consuming another consumer’s work', async () => {
  const fetch = vi.fn(async (_url: string, init: RequestInit) =>
    providerReply(requestedTexts(init), () => '完成'),
  );
  vi.stubGlobal('fetch', fetch);
  const queue = new TranslationQueue();
  await Promise.all(['A', 'B', 'C'].map((text) => queue.request(text, settings, text)));
  const dropped = queue.request('drop', settings, 'D').catch((error: Error) => error.message);
  const shared = queue.request('one', settings, 'Shared').catch((error: Error) => error.message);
  const retained = queue.request('two', settings, 'Shared');
  queue.prefetch('drop', settings, []);
  queue.prefetch('one', settings, []);
  await vi.advanceTimersByTimeAsync(1000);
  await expect(dropped).resolves.toBe('Subtitles have changed.');
  await expect(shared).resolves.toBe('完成');
  await expect(retained).resolves.toBe('完成');
  expect(fetch.mock.calls.map(([, init]) => requestedTexts(init))).toEqual([
    ['A'],
    ['B'],
    ['C'],
    ['Shared'],
  ]);
});

it('starts each provider deadline only when its HTTP request is sent', async () => {
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
    const controller = new AbortController();
    setTimeout(
      () => controller.abort(new DOMException('Provider deadline', 'TimeoutError')),
      milliseconds,
    );
    return controller.signal;
  });
  const sends: { text: string; at: number; signal: AbortSignal }[] = [];
  const fetch = vi.fn(
    (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init.signal!;
        sends.push({ text: requestedTexts(init)[0], at: Date.now(), signal });
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
  );
  vi.stubGlobal('fetch', fetch);
  const started = Date.now();
  const work = ['A', 'B', 'C', 'D'].map((text) =>
    api.translateCaptionBatch(settings, [text]).catch((error: Error) => error.message),
  );
  expect(sends.map(({ text }) => text)).toEqual(['A', 'B', 'C']);
  await vi.advanceTimersByTimeAsync(providerSendWindowMs - 1);
  expect(sends).toHaveLength(translationSendsPerSecond);
  await vi.advanceTimersByTimeAsync(1);
  expect(sends.map(({ text, at }) => [text, at - started])).toEqual([
    ['A', 0],
    ['B', 0],
    ['C', 0],
    ['D', providerSendWindowMs],
  ]);
  await vi.advanceTimersByTimeAsync(providerTimeoutMs - providerSendWindowMs);
  expect(sends.map(({ signal }) => signal.aborted)).toEqual([true, true, true, false]);
  await expect(Promise.all(work.slice(0, 3))).resolves.toEqual(
    Array(3).fill('The request timed out. Check your network or choose a faster model.'),
  );
  await vi.advanceTimersByTimeAsync(providerSendWindowMs - 1);
  expect(sends[3].signal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(sends[3].signal.aborted).toBe(true);
  await expect(work[3]).resolves.toBe(
    'The request timed out. Check your network or choose a faster model.',
  );
});

it('prioritizes the visible caption when the next send window opens', async () => {
  const sent: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      const texts = requestedTexts(init);
      sent.push(...texts);
      return providerReply(texts, () => '完成');
    }),
  );
  const queue = new TranslationQueue();
  await Promise.all(['A', 'B', 'C'].map((text) => queue.request(text, settings, text)));
  const prefetch = queue.prefetch(
    'window',
    settings,
    prefetchItems(Array.from({ length: 2 }, (_, index) => `Future ${index}`)),
  );
  const current = queue.request('current', settings, 'Visible');
  await vi.advanceTimersByTimeAsync(1000);
  expect(sent.slice(3)).toEqual(['Visible', 'Future 0']);
  await expect(current).resolves.toBe('完成');
  await expect(prefetch).resolves.toEqual(['完成', null]);
});

it('replaces unsent work when a consumer moves to a disjoint window', async () => {
  const sent: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      const texts = requestedTexts(init);
      sent.push(...texts);
      return providerReply(texts, () => '完成');
    }),
  );
  const queue = new TranslationQueue();
  await Promise.all(['A', 'B', 'C'].map((text) => queue.request(text, settings, text)));
  const old = queue.prefetch('window', settings, prefetchItems(['Obsolete']));
  const next = queue.prefetch('window', settings, prefetchItems(['Needed']));
  await vi.advanceTimersByTimeAsync(1000);
  await expect(old).resolves.toEqual([null]);
  await expect(next).resolves.toEqual(['完成']);
  expect(sent).toEqual(['A', 'B', 'C', 'Needed']);
});

it('keeps the shared send budget across queue resets and configuration changes', async () => {
  const fetch = vi.fn(async (_url: string, init: RequestInit) =>
    providerReply(requestedTexts(init), () => '完成'),
  );
  vi.stubGlobal('fetch', fetch);
  const queue = new TranslationQueue();
  await Promise.all(['A', 'B', 'C'].map((text) => queue.request(text, settings, text)));
  queue.reset();
  const changed = queue.request('next', { ...settings, model: 'new-model' }, 'D');
  await vi.advanceTimersByTimeAsync(999);
  expect(fetch).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(1);
  await expect(changed).resolves.toBe('完成');
  expect(fetch).toHaveBeenCalledTimes(4);
});

it('releases all disabled consumers before waking any pending provider sends', async () => {
  const fetch = vi.fn(async (_url: string, init: RequestInit) =>
    providerReply(requestedTexts(init), () => '完成'),
  );
  vi.stubGlobal('fetch', fetch);
  const queue = new TranslationQueue();
  await Promise.all(['A', 'B', 'C'].map((text) => queue.request(text, settings, text)));
  const waiting = ['one', 'two'].map((consumer) =>
    queue.request(consumer, settings, consumer).catch((error: Error) => error.message),
  );
  vi.setSystemTime(Date.now() + 1000);
  queue.release(['one', 'two']);
  await expect(Promise.all(waiting)).resolves.toEqual([
    'Subtitles have changed.',
    'Subtitles have changed.',
  ]);
  expect(fetch).toHaveBeenCalledTimes(3);
});

it('keeps a rate slot for every POST that was sent, even when it is aborted later', async () => {
  const sends: number[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          sends.push(Date.now());
          init.signal!.addEventListener('abort', () => reject(init.signal!.reason), {
            once: true,
          });
        }),
    ),
  );
  const { providerFetch } = await import('../src/shared/provider/transport');
  const controllers = Array.from(
    { length: translationSendsPerSecond * 2 },
    () => new AbortController(),
  );
  const work = controllers.map((controller) =>
    providerFetch(
      'https://provider.example/v1/chat/completions',
      { method: 'POST' },
      controller.signal,
    ).catch(() => undefined),
  );
  await vi.advanceTimersByTimeAsync(10);
  for (const controller of controllers.slice(0, translationSendsPerSecond)) controller.abort();
  await vi.advanceTimersByTimeAsync(providerSendWindowMs - 11);
  expect(sends).toHaveLength(translationSendsPerSecond);
  await vi.advanceTimersByTimeAsync(1);
  expect(sends).toHaveLength(controllers.length);
  for (const controller of controllers) controller.abort();
  await Promise.all(work);
});

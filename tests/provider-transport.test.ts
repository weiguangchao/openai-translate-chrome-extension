import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  providerSendWindowMs,
  providerTimeoutMs,
  translationSendsPerSecond,
} from '../src/shared/provider/transport';
import { DEFAULT_SETTINGS } from '../src/shared/settings';
import { providerReply, requestedTexts } from './fixtures/provider';

let api: typeof import('../src/shared/api');
let TranslationQueue: typeof import('../src/extension/queue').TranslationQueue;
const settings = { ...DEFAULT_SETTINGS, apiKey: 'key', model: 'budget-test' };

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

it.each([400, 422])(
  'budgets every compatibility probe and corrective retry after HTTP %s',
  async (status) => {
    const sends: number[] = [];
    const attempts = new Map<string, number>();
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      sends.push(Date.now());
      const texts = requestedTexts(init);
      const key = texts.join('|');
      const attempt = (attempts.get(key) ?? 0) + 1;
      attempts.set(key, attempt);
      if (attempt <= 3) return new Response('', { status });
      return providerReply(texts, () => (attempt === 4 ? '' : `译文 ${texts[0]}`));
    });
    vi.stubGlobal('fetch', fetch);
    const queue = new TranslationQueue();
    const work = ['A', 'B', 'C'].map((text) => queue.request(text, settings, text));
    await vi.advanceTimersByTimeAsync(999);
    expect(sends).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(4001);
    await expect(Promise.all(work)).resolves.toEqual(['译文 A', '译文 B', '译文 C']);
    expect(sends).toHaveLength(15);
    for (const at of sends)
      expect(sends.filter((time) => at <= time && time < at + 1000).length).toBeLessThanOrEqual(3);
  },
);

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
  await expect(dropped).resolves.toBe('字幕已更新。');
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
  const timeout = vi.spyOn(AbortSignal, 'timeout');
  const fetch = vi.fn(async (_url: string, init: RequestInit) =>
    providerReply(requestedTexts(init), () => '完成'),
  );
  vi.stubGlobal('fetch', fetch);
  const work = ['A', 'B', 'C', 'D'].map((text) =>
    api.translateCaptionBatch(settings, [{ text, needsSplit: false }]),
  );
  const immediate = Array.from({ length: translationSendsPerSecond }, () => [providerTimeoutMs]);
  expect(timeout.mock.calls).toEqual(immediate);
  await vi.advanceTimersByTimeAsync(providerSendWindowMs - 1);
  expect(timeout).toHaveBeenCalledTimes(translationSendsPerSecond);
  await vi.advanceTimersByTimeAsync(1);
  await expect(Promise.all(work)).resolves.toEqual([['完成'], ['完成'], ['完成'], ['完成']]);
  expect(timeout.mock.calls).toEqual([...immediate, [providerTimeoutMs]]);
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
    Array.from({ length: 4 }, (_, segment) => ({
      text: `Future ${segment}`,
      segment,
      needsSplit: false,
    })),
  );
  const current = queue.request('current', settings, 'Visible');
  await vi.advanceTimersByTimeAsync(1000);
  expect(sent.slice(3)).toEqual(['Visible', 'Future 0', 'Future 1']);
  await expect(current).resolves.toBe('完成');
  await vi.advanceTimersByTimeAsync(1000);
  await expect(prefetch).resolves.toEqual(['完成', '完成', '完成', '完成']);
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
  const old = queue.prefetch('window', settings, [
    { text: 'Obsolete', segment: 0, needsSplit: false },
  ]);
  const next = queue.prefetch('window', settings, [
    { text: 'Needed', segment: 1, needsSplit: false },
  ]);
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
  await expect(Promise.all(waiting)).resolves.toEqual(['字幕已更新。', '字幕已更新。']);
  expect(fetch).toHaveBeenCalledTimes(3);
});

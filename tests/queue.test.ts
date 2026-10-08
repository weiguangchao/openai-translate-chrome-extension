import { prefetchItems } from './fixtures/provider';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { translationBatchLimit } from '../src/shared/limits';
import { translationSendsPerSecond } from '../src/shared/provider/transport';
let TranslationQueue: typeof import('../src/extension/queue').TranslationQueue;
import { DEFAULT_SETTINGS } from '../src/shared/settings';
import { providerReply, requestedTexts } from './fixtures/provider';
import { readCaptionTranslation, translationInput } from '../src/shared/caption-translation';
import { longCaption, longResult, structuredReply } from './fixtures/long-caption';
import type { TraceEvent } from '../src/shared/trace';

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  ({ TranslationQueue } = await import('../src/extension/queue'));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const flush = () => vi.advanceTimersByTimeAsync(0);

function pendingProvider() {
  const requests: { texts: string[]; signal: AbortSignal; resolve: (value: Response) => void }[] =
    [];
  const fetch = vi.fn(
    (_url: string, init: RequestInit) =>
      new Promise<Response>((resolve) =>
        requests.push({ texts: requestedTexts(init), signal: init.signal!, resolve }),
      ),
  );
  vi.stubGlobal('fetch', fetch);
  const batches = () => requests.map((request) => request.texts);
  const reply = (index: number) =>
    requests[index].resolve(providerReply(requests[index].texts, (text) => `${text} 译文`));
  return { fetch, requests, batches, reply };
}
const settings = { ...DEFAULT_SETTINGS, apiKey: 'test-key', model: 'test-model' };

it('caches all split parts under their parent and separates split and unsplit versions of the same text', async () => {
  const { fetch, requests } = pendingProvider();
  const queue = new TranslationQueue();
  const pending = queue.prefetch('tab', settings, [
    { text: longCaption, segment: 0, needsSplit: false },
    { text: longCaption, segment: 0, needsSplit: true },
  ]);
  requests[0].resolve(
    structuredReply([{ id: 0, parts: [{ translation: '整句译文' }] }, longResult(1)]),
  );
  const split = readCaptionTranslation(translationInput(longCaption, true), longResult());
  await expect(pending).resolves.toEqual(['整句译文', split]);
  await expect(queue.request('tab', settings, longCaption, true)).resolves.toEqual(split);
  await expect(queue.request('tab', settings, longCaption)).resolves.toBe('整句译文');
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('retries only an invalid split with the split flag intact, keeping ordinary neighbors cached', async () => {
  const { fetch, requests } = pendingProvider();
  const queue = new TranslationQueue();
  const pending = queue.prefetch('tab', settings, [
    { text: 'Before.', segment: 0, needsSplit: false },
    { text: longCaption, segment: 0, needsSplit: true },
    { text: 'After.', segment: 0, needsSplit: false },
  ]);
  requests[0].resolve(
    structuredReply([
      { id: 0, parts: [{ translation: '之前。' }] },
      { id: 1, parts: longResult().parts.slice(0, 2) },
      { id: 2, parts: [{ translation: '之后。' }] },
    ]),
  );
  await flush();
  expect(requests.map((request) => request.texts)).toEqual([
    ['Before.', longCaption, 'After.'],
    [longCaption],
  ]);
  expect(
    JSON.parse(JSON.parse(fetch.mock.calls[1][1].body as string).messages[1].content)[0],
  ).toMatchObject({ id: 0, split: true });
  await expect(queue.lookup(settings, 'Before.')).resolves.toBe('之前。');
  requests[1].resolve(structuredReply([longResult()]));
  await expect(pending).resolves.toEqual([
    '之前。',
    readCaptionTranslation(translationInput(longCaption, true), longResult()),
    '之后。',
  ]);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('stops after one corrective retry for a persistently invalid split and never caches it', async () => {
  const fetch = vi.fn().mockImplementation(async () => structuredReply([{ id: 0, parts: [] }]));
  vi.stubGlobal('fetch', fetch);
  const queue = new TranslationQueue();
  await expect(queue.request('tab', settings, longCaption, true)).rejects.toThrow(
    '模型返回的译文无效',
  );
  await vi.advanceTimersByTimeAsync(3000);
  expect(fetch).toHaveBeenCalledTimes(2);
  await expect(queue.lookup(settings, longCaption, true)).resolves.toBeNull();
});

it('sends every cue right away, shares in-flight work, and serves a completed cue from the cache', async () => {
  const { fetch, requests, batches } = pendingProvider();
  const queue = new TranslationQueue();
  const first = queue.request('tab-1', settings, 'First');
  const second = queue.request('tab-2', settings, 'Second');
  const current = queue.request('tab-1', settings, 'Current');
  const shared = queue.request('tab-3', settings, 'Current');
  expect(batches()).toEqual([['First'], ['Second'], ['Current']]);
  expect(requests.map((request) => request.signal.aborted)).toEqual([false, false, false]);
  for (const request of requests)
    request.resolve(providerReply(request.texts, (text) => `${text} 译文`));
  await expect(Promise.all([first, second, current, shared])).resolves.toEqual([
    'First 译文',
    'Second 译文',
    'Current 译文',
    'Current 译文',
  ]);
  await expect(queue.request('tab-4', settings, 'Current')).resolves.toBe('Current 译文');
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetch).toHaveBeenCalledTimes(3);
});

it('translates the next caption after a timeout without pausing or retrying that batch', async () => {
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    const texts = requestedTexts(init);
    if (texts.includes('Stale')) {
      const timeout = new Error('The operation was aborted due to timeout');
      timeout.name = 'TimeoutError';
      throw timeout;
    }
    return providerReply(texts, (text) => `${text} 译文`);
  });
  vi.stubGlobal('fetch', fetch);
  const queue = new TranslationQueue();
  const failed = queue.prefetch('tab', settings, prefetchItems(['Stale', 'Passed']));
  await expect(failed).resolves.toEqual([null, null]);
  expect(fetch).toHaveBeenCalledTimes(1);
  queue.prefetch('tab', settings, prefetchItems(['Stale', 'Passed']));
  await flush();
  expect(fetch).toHaveBeenCalledTimes(1);
  await expect(queue.request('tab', settings, 'Stale')).rejects.toThrow('接口请求超时');
  expect(fetch).toHaveBeenCalledTimes(1);
  const next = queue.prefetch('tab', settings, prefetchItems(['Later'], 1));
  await expect(next).resolves.toEqual(['Later 译文']);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('backs off after a rate limit so subsequent cues do not repeatedly bill or hit the provider', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('', { status: 429 }));
  vi.stubGlobal('fetch', fetch);
  const queue = new TranslationQueue();
  await expect(queue.request('tab', settings, 'First')).rejects.toThrow('请求过于频繁');
  await expect(queue.request('tab', settings, 'Second')).rejects.toThrow('请求过于频繁');
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('keeps reporting why the provider failed while it backs off after a prefetch', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('', { status: 401 }));
  vi.stubGlobal('fetch', fetch);
  const queue = new TranslationQueue();
  await expect(queue.prefetch('tab', settings, prefetchItems(['Ahead']))).resolves.toEqual([null]);
  await expect(queue.request('tab', settings, 'Visible')).rejects.toThrow(
    new Error('API Key 无效或已过期。'),
  );
  expect(fetch).toHaveBeenCalledTimes(1);
  queue.reset();
  fetch.mockResolvedValue(providerReply(['Visible'], () => '可见'));
  await expect(queue.request('tab', settings, 'Visible')).resolves.toBe('可见');
});

it('does not cache a failed request, but still serves cached cues while the provider backs off', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(providerReply(['Cached'], () => '已缓存'))
    .mockResolvedValue(new Response('', { status: 429 }));
  vi.stubGlobal('fetch', fetch);
  const queue = new TranslationQueue();
  await expect(queue.request('tab', settings, 'Cached')).resolves.toBe('已缓存');
  await expect(queue.request('tab', settings, 'First')).rejects.toThrow('请求过于频繁');
  await expect(queue.request('tab', settings, 'Cached')).resolves.toBe('已缓存');
  await expect(
    queue.prefetch('tab', settings, [
      { text: 'Cached', segment: 0, needsSplit: false },
      { text: 'First', segment: 0, needsSplit: false },
    ]),
  ).resolves.toEqual(['已缓存', null]);
  expect(fetch).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(15000);
  await expect(queue.request('tab', settings, 'First')).rejects.toThrow('请求过于频繁');
  expect(fetch).toHaveBeenCalledTimes(3);
});

it('keeps finished translations through a settings reset and requests again only for other provider settings', async () => {
  const { fetch, reply } = pendingProvider();
  const queue = new TranslationQueue();
  const first = queue.request('tab', settings, 'Cue');
  reply(0);
  await expect(first).resolves.toBe('Cue 译文');
  queue.reset();
  await expect(queue.request('tab', settings, 'Cue')).resolves.toBe('Cue 译文');
  expect(fetch).toHaveBeenCalledTimes(1);
  queue.reset();
  const changed = queue.request('tab', { ...settings, model: 'other-model' }, 'Cue');
  expect(fetch).toHaveBeenCalledTimes(2);
  reply(1);
  await expect(changed).resolves.toBe('Cue 译文');
});

it('forgets the oldest translations beyond the cache limit', async () => {
  const { fetch, reply } = pendingProvider();
  const queue = new TranslationQueue(2);
  for (const [index, text] of ['A', 'B', 'C'].entries()) {
    const done = queue.request('tab', settings, text);
    reply(index);
    await done;
  }
  await expect(queue.request('tab', settings, 'C')).resolves.toBe('C 译文');
  await expect(queue.request('tab', settings, 'B')).resolves.toBe('B 译文');
  expect(fetch).toHaveBeenCalledTimes(3);
  void queue.request('tab', settings, 'A');
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetch).toHaveBeenCalledTimes(4);
});

it('answers a prefetch with cached and in-flight translations in order, and null for cues it drops or holds', async () => {
  const { batches, reply } = pendingProvider();
  const queue = new TranslationQueue();
  const opening = queue.prefetch('tab', settings, [
    { text: 'A', segment: 0, needsSplit: false },
    { text: 'B', segment: 0, needsSplit: false },
  ]);
  const sliding = queue.prefetch('tab', settings, [
    { text: 'B', segment: 0, needsSplit: false },
    { text: 'C', segment: 0, needsSplit: false },
  ]);
  const held = queue.prefetch('tab', settings, [
    { text: 'X', segment: 0, needsSplit: false },
    { text: 'Y', segment: 0, needsSplit: false },
  ]);
  expect(batches()).toEqual([['A', 'B'], ['C']]);
  await expect(held).resolves.toEqual([null, null]);
  reply(0);
  reply(1);
  await expect(opening).resolves.toEqual([null, 'B 译文']);
  await expect(sliding).resolves.toEqual(['B 译文', 'C 译文']);
  expect(batches()).toEqual([['A', 'B'], ['C'], ['X', 'Y']]);
  await expect(
    queue.prefetch('tab', settings, [
      { text: 'A', segment: 0, needsSplit: false },
      { text: 'C', segment: 0, needsSplit: false },
    ]),
  ).resolves.toEqual(['A 译文', 'C 译文']);
  expect(batches()).toHaveLength(3);
});

it('sends each new block of five cues as one request and reuses a finished block', async () => {
  const { batches, reply, requests } = pendingProvider();
  const queue = new TranslationQueue();
  const cues = Array.from({ length: 20 }, (_, index) => `Cue ${index + 1}`);
  const block = (index: number) => cues.slice(index * 5, index * 5 + 5);
  queue.prefetch('tab', settings, prefetchItems(cues.slice(0, 15)));
  expect(batches()).toEqual([block(0), block(1), block(2)]);
  for (let start = 1; start < 5; start++) {
    queue.prefetch('tab', settings, prefetchItems(cues.slice(start, 15)));
    expect(batches()).toHaveLength(3);
  }
  queue.prefetch('tab', settings, prefetchItems(cues.slice(5, 20)));
  expect(requests[0].signal.aborted).toBe(true);
  expect(batches()).toEqual([block(0), block(1), block(2), block(3)]);
  await vi.advanceTimersByTimeAsync(1000);
  expect(batches()).toEqual([block(0), block(1), block(2), block(3)]);
  [1, 2, 3].forEach(reply);
  await flush();
  await expect(queue.prefetch('tab', settings, prefetchItems(block(3)))).resolves.toEqual(
    block(3).map((cue) => `${cue} 译文`),
  );
  expect(batches()).toHaveLength(4);
});

it('does not prefetch the next segment until the current provider request receives a reply', async () => {
  const { batches, reply, requests } = pendingProvider();
  const queue = new TranslationQueue();
  const cues = Array.from({ length: 15 }, (_, index) => `Cue ${index + 1}`);
  const block = (index: number) => cues.slice(index * 5, index * 5 + 5);
  queue.prefetch('tab', settings, prefetchItems(block(0)));
  queue.prefetch('tab', settings, prefetchItems(block(1)));
  queue.prefetch('tab', settings, prefetchItems(block(2)));
  expect(batches()).toEqual([block(0)]);
  expect(requests[0].signal.aborted).toBe(false);
  const visible = queue.request('tab', settings, cues[10]);
  expect(batches()).toEqual([block(0)]);
  reply(0);
  await flush();
  expect(batches()).toEqual([block(0), block(2)]);
  expect(requests[0].signal.aborted).toBe(false);
  requests[1].resolve(providerReply(requests[1].texts, (text) => `${text} 译文`));
  await expect(visible).resolves.toBe('Cue 11 译文');
});

it('still sends the rest of the current segment while its provider request is in flight', async () => {
  const { batches, requests } = pendingProvider();
  const queue = new TranslationQueue();
  queue.prefetch('tab', settings, [
    { text: 'Cue 1', segment: 0, needsSplit: false },
    { text: 'Cue 2', segment: 0, needsSplit: false },
    { text: 'Cue 3', segment: 0, needsSplit: false },
    { text: 'Cue 4', segment: 0, needsSplit: false },
  ]);
  queue.prefetch('tab', settings, [
    { text: 'Cue 2', segment: 0, needsSplit: false },
    { text: 'Cue 3', segment: 0, needsSplit: false },
    { text: 'Cue 4', segment: 0, needsSplit: false },
    { text: 'Cue 5', segment: 0, needsSplit: false },
  ]);
  expect(batches()).toEqual([['Cue 1', 'Cue 2', 'Cue 3', 'Cue 4'], ['Cue 5']]);
  expect(requests[0].signal.aborted).toBe(false);
});

it('drops a parked next segment when the current request is cancelled', async () => {
  const { batches, requests } = pendingProvider();
  const queue = new TranslationQueue();
  const first = ['Cue 1', 'Cue 2'];
  const next = ['Cue 9', 'Cue 10'];
  const jumped = ['Cue 17', 'Cue 18'];
  queue.prefetch('tab', settings, prefetchItems(first));
  queue.prefetch('tab', settings, prefetchItems(next));
  queue.prefetch('tab', settings, []);
  expect(requests[0].signal.aborted).toBe(true);
  queue.prefetch('tab', settings, prefetchItems(jumped));
  expect(batches()).toEqual([first, jumped]);
});

it('starts from the current cue mid-block, sends a short final batch at the end of a video, and skips finished cues', async () => {
  const { batches, reply } = pendingProvider();
  const queue = new TranslationQueue();
  const cues = Array.from({ length: 18 }, (_, index) => `Cue ${index + 1}`);
  queue.prefetch('tab', settings, prefetchItems(cues.slice(2, 15)));
  expect(batches()).toEqual([cues.slice(2, 7), cues.slice(7, 12), cues.slice(12, 15)]);
  [0, 1, 2].forEach(reply);
  await flush();
  queue.prefetch('tab', settings, prefetchItems(cues.slice(5, 18)));
  expect(batches()).toHaveLength(3);
  await vi.advanceTimersByTimeAsync(1000);
  expect(batches().slice(3)).toEqual([cues.slice(15, 18)]);
});

it('retries each cue on its own when the batch reply cannot be matched to the cues', async () => {
  const { fetch, requests, batches } = pendingProvider();
  const queue = new TranslationQueue();
  queue.prefetch('tab', settings, [
    { text: 'First', segment: 0, needsSplit: false },
    { text: 'Second', segment: 0, needsSplit: false },
  ]);
  const first = queue.request('tab', settings, 'First');
  requests[0].resolve(Response.json({ choices: [{ message: { content: '第一句\n第二句' } }] }));
  await flush();
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(batches().slice(1)).toEqual([['First'], ['Second']]);
  requests[1].resolve(providerReply(['First'], () => '第一句'));
  await expect(first).resolves.toBe('第一句');
  await expect(queue.request('tab', settings, 'First')).resolves.toBe('第一句');
  expect(fetch).toHaveBeenCalledTimes(3);
});

it('keeps a batch running while any of its cues is still needed, caches all of its replies, and cancels it once none are', async () => {
  const { fetch, requests, batches } = pendingProvider();
  const queue = new TranslationQueue();
  queue.prefetch('tab', settings, [
    { text: 'Shared cue', segment: 0, needsSplit: false },
    { text: 'Next cue', segment: 0, needsSplit: false },
  ]);
  queue.prefetch('other-tab', settings, [{ text: 'Shared cue', segment: 0, needsSplit: false }]);
  const visible = queue.request('other-tab', settings, 'Shared cue');
  const dropped = queue.request('tab', settings, 'Next cue').catch((error) => error.message);
  queue.prefetch('tab', settings, []);
  await expect(dropped).resolves.toBe('字幕已更新。');
  expect(requests[0].signal.aborted).toBe(false);
  requests[0].resolve(
    providerReply(requests[0].texts, (text) => (text === 'Shared cue' ? '共享字幕' : '下一句')),
  );
  await expect(visible).resolves.toBe('共享字幕');
  await expect(queue.request('tab-3', settings, 'Next cue')).resolves.toBe('下一句');
  expect(fetch).toHaveBeenCalledTimes(1);
  queue.prefetch('tab', settings, [
    { text: 'A', segment: 0, needsSplit: false },
    { text: 'B', segment: 0, needsSplit: false },
  ]);
  queue.prefetch('tab', settings, [
    { text: 'B', segment: 0, needsSplit: false },
    { text: 'C', segment: 0, needsSplit: false },
  ]);
  expect(batches().slice(1)).toEqual([['A', 'B'], ['C']]);
  expect(requests[1].signal.aborted).toBe(false);
  queue.prefetch('tab', settings, []);
  expect(requests[1].signal.aborted).toBe(true);
  expect(requests[2].signal.aborted).toBe(true);
});

it('finishes sent requests while paused and does not send the rest until playback resumes', async () => {
  const { fetch, requests, batches, reply } = pendingProvider();
  const queue = new TranslationQueue();
  const cues = Array.from({ length: 40 }, (_, index) => `Cue ${index + 1}`);
  const block = (index: number) =>
    cues.slice(index * translationBatchLimit, (index + 1) * translationBatchLimit);
  queue.prefetch('tab', settings, prefetchItems(cues));
  const visible = queue.request('tab', settings, cues[0]);
  expect(batches()).toEqual([block(0), block(1), block(2)]);
  queue.pause('tab');
  await vi.advanceTimersByTimeAsync(5000);
  expect(fetch).toHaveBeenCalledTimes(translationSendsPerSecond);
  expect(requests.every((request) => !request.signal.aborted)).toBe(true);
  reply(0);
  await expect(visible).resolves.toBe('Cue 1 译文');
  expect(fetch).toHaveBeenCalledTimes(translationSendsPerSecond);
  queue.resume('tab');
  expect(batches()[3]).toEqual(block(3));
});

it('sends an anchor window as three full batches even when timeline segments split them', () => {
  const { requests, batches } = pendingProvider();
  const queue = new TranslationQueue();
  const cues = Array.from({ length: 20 }, (_, index) => `Cue ${index + 1}`);
  const pack = (from: number, count: number) =>
    cues.slice(from, from + count).map((text, offset) => ({
      text,
      segment: Math.floor((from + offset + 3) / translationBatchLimit),
      needsSplit: false,
      batch: Math.floor((from + offset) / translationBatchLimit),
    }));
  queue.prefetch('tab', settings, pack(0, 15));
  expect(batches()).toEqual([cues.slice(0, 5), cues.slice(5, 10), cues.slice(10, 15)]);
  expect(fetch).toHaveBeenCalledTimes(translationSendsPerSecond);
  queue.prefetch('tab', settings, pack(5, 15));
  expect(requests[0].signal.aborted).toBe(true);
  expect(requests.slice(1, 3).every((request) => !request.signal.aborted)).toBe(true);
  expect(batches()[3]).toEqual(cues.slice(15, 20));
});

it('sends at most three requests each second', async () => {
  const { fetch, batches } = pendingProvider();
  const queue = new TranslationQueue();
  const cues = Array.from({ length: 40 }, (_, index) => `Cue ${index + 1}`);
  const block = (index: number) =>
    cues.slice(index * translationBatchLimit, (index + 1) * translationBatchLimit);
  queue.prefetch('tab', settings, prefetchItems(cues));
  expect(batches()).toEqual([block(0), block(1), block(2)]);
  await vi.advanceTimersByTimeAsync(999);
  expect(fetch).toHaveBeenCalledTimes(translationSendsPerSecond);
  await vi.advanceTimersByTimeAsync(1);
  expect(batches()).toEqual([block(0), block(1), block(2), block(3), block(4), block(5)]);
});

it('keeps a queued batch parked through a provider backoff', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('', { status: 429 }));
  vi.stubGlobal('fetch', fetch);
  const queue = new TranslationQueue();
  const cues = Array.from({ length: 40 }, (_, index) => `Cue ${index + 1}`);
  queue.prefetch('tab', settings, prefetchItems(cues));
  expect(fetch).toHaveBeenCalledTimes(translationSendsPerSecond);
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetch).toHaveBeenCalledTimes(translationSendsPerSecond);
  await vi.advanceTimersByTimeAsync(14000);
  expect(fetch).toHaveBeenCalledTimes(translationSendsPerSecond * 2);
});

it('does not send a batch that leaves the window before a send slot opens', async () => {
  const { fetch } = pendingProvider();
  const queue = new TranslationQueue();
  const cues = Array.from({ length: 40 }, (_, index) => `Cue ${index + 1}`);
  queue.prefetch('tab', settings, prefetchItems(cues));
  queue.prefetch(
    'tab',
    settings,
    prefetchItems(cues.slice(0, translationBatchLimit * translationSendsPerSecond)),
  );
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetch).toHaveBeenCalledTimes(translationSendsPerSecond);
});

it('cancels an in-flight batch when playback leaves and does not retry it', async () => {
  const { fetch, requests } = pendingProvider();
  const queue = new TranslationQueue();
  const pending = queue.prefetch('tab', settings, [
    { text: 'First', segment: 0, needsSplit: false },
    { text: longCaption, segment: 0, needsSplit: true },
  ]);
  await flush();
  expect(fetch).toHaveBeenCalledTimes(1);
  queue.prefetch('tab', settings, []);
  expect(requests[0].signal.aborted).toBe(true);
  await expect(pending).resolves.toEqual([null, null]);
  await expect(queue.lookup(settings, 'First')).resolves.toBeNull();
  await expect(queue.lookup(settings, longCaption, true)).resolves.toBeNull();
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('resolves a batch together when the response arrives and serves a cue from the cache', async () => {
  const { fetch, requests } = pendingProvider();
  const queue = new TranslationQueue();
  const pending = queue.prefetch('tab', settings, [
    { text: 'First', segment: 0, needsSplit: false },
    { text: 'Second', segment: 0, needsSplit: false },
  ]);
  const first = queue.request('tab', settings, 'First');
  await flush();
  let secondSettled = false;
  void queue.request('tab', settings, 'Second').then(() => {
    secondSettled = true;
  });
  await flush();
  expect(secondSettled).toBe(false);
  requests[0].resolve(
    providerReply(['First', 'Second'], (text) => (text === 'First' ? '第一句' : '第二句')),
  );
  await flush();
  await expect(first).resolves.toBe('第一句');
  await expect(pending).resolves.toEqual(['第一句', '第二句']);
  expect(secondSettled).toBe(true);
  await expect(queue.request('tab', settings, 'First')).resolves.toBe('第一句');
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetch.mock.calls[0][1].body as string).stream).toBe(false);
});

it('caches only the final reply after a truncated draft without retrying', async () => {
  const { fetch, requests } = pendingProvider();
  const queue = new TranslationQueue();
  const pending = queue.prefetch('tab', settings, prefetchItems(['Original.']));
  requests[0].resolve(
    Response.json({
      choices: [
        {
          message: {
            content:
              '{"results":[{"id":0,"parts":[{"translation":"草稿"}]}\nFinal\n' +
              '{"results":[{"id":0,"parts":[{"translation":"最终"}]}]}',
          },
        },
      ],
    }),
  );
  await expect(pending).resolves.toEqual(['最终']);
  await expect(queue.lookup(settings, 'Original.')).resolves.toBe('最终');
  await expect(queue.request('other-tab', settings, 'Original.')).resolves.toBe('最终');
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('does not cache either cue when the batch is aborted before the response', async () => {
  const { fetch, requests } = pendingProvider();
  const queue = new TranslationQueue();
  const pending = queue.prefetch('tab', settings, [
    { text: 'First', segment: 0, needsSplit: false },
    { text: 'Second', segment: 0, needsSplit: false },
  ]);
  const first = queue.request('tab', settings, 'First');
  const second = queue.request('tab', settings, 'Second');
  await flush();
  queue.prefetch('tab', settings, []);
  await expect(first).rejects.toThrow('字幕已更新');
  await expect(second).rejects.toThrow('字幕已更新');
  await expect(pending).resolves.toEqual([null, null]);
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(requests[0].signal.aborted).toBe(true);
  await expect(queue.lookup(settings, 'First')).resolves.toBeNull();
});

it('retries only the cue that was not committed when the batch reply is short', async () => {
  const { fetch, requests } = pendingProvider();
  const queue = new TranslationQueue();
  const pending = queue.prefetch('tab', settings, [
    { text: 'First', segment: 0, needsSplit: false },
    { text: 'Second', segment: 0, needsSplit: false },
  ]);
  const first = queue.request('tab', settings, 'First');
  await flush();
  requests[0].resolve(
    Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              results: [{ id: 0, parts: [{ translation: '第一句' }] }],
            }),
          },
        },
      ],
    }),
  );
  await flush();
  await expect(first).resolves.toBe('第一句');
  expect(requestedTexts(fetch.mock.calls[1][1])).toEqual(['Second']);
  requests[1].resolve(providerReply(['Second'], () => 'Second 译文'));
  await expect(pending).resolves.toEqual(['第一句', 'Second 译文']);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(JSON.parse(fetch.mock.calls[0][1].body as string).stream).toBe(false);
  expect(JSON.parse(fetch.mock.calls[1][1].body as string).stream).toBe(false);
});

it('keeps the well-formed results of a reply with malformed JSON and retries only the broken ones', async () => {
  const { fetch, requests } = pendingProvider();
  const queue = new TranslationQueue();
  const pending = queue.prefetch('tab', settings, [
    { text: longCaption, segment: 0, needsSplit: true },
    { text: 'Middle.', segment: 0, needsSplit: false },
    { text: 'After.', segment: 0, needsSplit: false },
  ]);
  const broken = (result: unknown) => JSON.stringify(result).replace(/\}\]\}$/, '} stray]}');
  const results = [
    broken(longResult(0)),
    JSON.stringify({ id: 1, parts: [{ translation: '中间。' }] }),
    broken({ id: 2, parts: [{ translation: '之后。' }] }),
  ];
  requests[0].resolve(
    Response.json({
      choices: [{ message: { content: '```json\n{"results":[' + results.join(',') + ']}\n```' } }],
    }),
  );
  await flush();
  expect(requests.map((request) => request.texts)).toEqual([
    [longCaption, 'Middle.', 'After.'],
    [longCaption],
    ['After.'],
  ]);
  expect(
    JSON.parse(JSON.parse(fetch.mock.calls[1][1].body as string).messages[1].content)[0],
  ).toMatchObject({ id: 0, split: true });
  await expect(queue.lookup(settings, 'Middle.')).resolves.toBe('中间。');
  requests[1].resolve(structuredReply([longResult()]));
  requests[2].resolve(providerReply(['After.'], () => '之后。'));
  await expect(pending).resolves.toEqual([
    readCaptionTranslation(translationInput(longCaption, true), longResult()),
    '中间。',
    '之后。',
  ]);
  expect(fetch).toHaveBeenCalledTimes(3);
});

it('sends each segment as its own request, even with fewer than five captions, and never mixes tabs', () => {
  const { batches } = pendingProvider();
  const queue = new TranslationQueue();
  const cues = Array.from({ length: 7 }, (_, index) => `Cue ${index + 1}`);
  queue.prefetch(
    'tab',
    settings,
    cues.map((text, index) => ({
      text,
      segment: [0, 0, 0, 0, 1, 1, 1][index] ?? 0,
      needsSplit: [][index] === true,
    })),
  );
  queue.prefetch('other-tab', settings, [
    { text: 'Other 1', segment: 0, needsSplit: false },
    { text: 'Other 2', segment: 0, needsSplit: false },
  ]);
  expect(batches()).toEqual([cues.slice(0, 4), cues.slice(4), ['Other 1', 'Other 2']]);
});

it('traces each batch by tab and segment without its keys, texts or error messages', async () => {
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    const texts = requestedTexts(init);
    if (texts.includes('Slow')) {
      const timeout = new Error('The operation was aborted due to timeout');
      timeout.name = 'TimeoutError';
      throw timeout;
    }
    return providerReply(texts, (text) => `${text} 译文`);
  });
  vi.stubGlobal('fetch', fetch);
  const events: TraceEvent[] = [];
  const queue = new TranslationQueue(undefined, (event) => events.push(event));
  await expect(
    queue.prefetch('7:0', settings, prefetchItems(['First', 'Second'])),
  ).resolves.toEqual(['First 译文', 'Second 译文']);
  await queue.prefetch('7:0', settings, prefetchItems(['Slow'], 1));
  await expect(queue.request('7:0', settings, 'Current')).resolves.toBe('Current 译文');
  expect(events.map(({ ms: _ms, ...event }) => event)).toEqual([
    { e: 'batch', id: 1, tab: '7:0', seg: 0, size: 2, solo: false },
    { e: 'sent', id: 1 },
    { e: 'first', id: 1 },
    { e: 'done', id: 1, result: 'ok' },
    { e: 'batch', id: 2, tab: '7:0', seg: 1, size: 1, solo: false },
    { e: 'sent', id: 2 },
    { e: 'done', id: 2, result: 'timeout' },
    { e: 'batch', id: 3, tab: '7:0', seg: null, size: 1, solo: false },
    { e: 'sent', id: 3 },
    { e: 'first', id: 3 },
    { e: 'done', id: 3, result: 'ok' },
  ]);
  for (const event of events)
    if (event.e === 'first' || event.e === 'done') expect(event.ms).toBeGreaterThanOrEqual(0);
  const printed = JSON.stringify(events);
  for (const hidden of [settings.apiKey, 'First', 'Slow', 'Current', 'aborted due to timeout'])
    expect(printed).not.toContain(hidden);
});

it('restores stored translations and mirrors new and evicted ones to the store', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) =>
      providerReply(requestedTexts(init), (text) => `${text} 译文`),
    ),
  );
  const stored = new Map<string, unknown>();
  const queue = new TranslationQueue(2);
  queue.restore([], {
    save: (key, translation) => stored.set(key, translation),
    remove: (key) => stored.delete(key),
  });
  await queue.prefetch('tab', settings, prefetchItems(['One', 'Two', 'Three']));
  expect([...stored.values()].sort()).toEqual(['Three 译文', 'Two 译文']);
  for (const key of stored.keys()) expect(key).not.toContain(settings.apiKey);

  vi.mocked(fetch).mockClear();
  const restarted = new TranslationQueue(2);
  restarted.restore(stored as Map<string, string>, { save: vi.fn(), remove: vi.fn() });
  await expect(restarted.request('tab', settings, 'Three')).resolves.toBe('Three 译文');
  await expect(restarted.lookup(settings, 'Two')).resolves.toBe('Two 译文');
  await expect(restarted.lookup(settings, 'One')).resolves.toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});

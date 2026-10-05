import { prefetchItems } from './fixtures/provider';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { translationSendsPerSecond } from '../src/shared/provider/transport';
let TranslationQueue: typeof import('../src/extension/queue').TranslationQueue;
import { DEFAULT_SETTINGS } from '../src/shared/settings';
import { providerReply, requestedTexts } from './fixtures/provider';
import { readCaptionTranslation, translationInput } from '../src/shared/caption-translation';
import { longCaption, longResult, structuredReply } from './fixtures/long-caption';

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
  ).toMatchObject({ id: 0, needsSplit: true });
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
    '字幕断句结果无效',
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

it('backs off after a rate limit so subsequent cues do not repeatedly bill or hit the provider', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('', { status: 429 }));
  vi.stubGlobal('fetch', fetch);
  const queue = new TranslationQueue();
  await expect(queue.request('tab', settings, 'First')).rejects.toThrow('请求过于频繁');
  await expect(queue.request('tab', settings, 'Second')).rejects.toThrow('稍后将自动重试');
  expect(fetch).toHaveBeenCalledTimes(1);
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

it('sends each new block of ten cues as one request and reuses a finished block', async () => {
  const { batches, reply, requests } = pendingProvider();
  const queue = new TranslationQueue();
  const cues = Array.from({ length: 40 }, (_, index) => `Cue ${index + 1}`);
  const block = (index: number) => cues.slice(index * 10, index * 10 + 10);
  queue.prefetch('tab', settings, prefetchItems(cues.slice(0, 30)));
  expect(batches()).toEqual([block(0), block(1), block(2)]);
  for (let start = 1; start < 10; start++) {
    queue.prefetch('tab', settings, prefetchItems(cues.slice(start, 30)));
    expect(batches()).toHaveLength(3);
  }
  queue.prefetch('tab', settings, prefetchItems(cues.slice(10, 40)));
  expect(requests[0].signal.aborted).toBe(true);
  expect(batches()).toEqual([block(0), block(1), block(2)]);
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
  const cues = Array.from({ length: 30 }, (_, index) => `Cue ${index + 1}`);
  const block = (index: number) => cues.slice(index * 10, index * 10 + 10);
  queue.prefetch('tab', settings, prefetchItems(block(0)));
  queue.prefetch('tab', settings, prefetchItems(block(1)));
  queue.prefetch('tab', settings, prefetchItems(block(2)));
  expect(batches()).toEqual([block(0)]);
  expect(requests[0].signal.aborted).toBe(false);
  const visible = queue.request('tab', settings, cues[20]);
  expect(batches()).toEqual([block(0)]);
  reply(0);
  await flush();
  expect(batches()).toEqual([block(0), block(2)]);
  expect(requests[0].signal.aborted).toBe(false);
  requests[1].resolve(providerReply(requests[1].texts, (text) => `${text} 译文`));
  await expect(visible).resolves.toBe('Cue 21 译文');
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
  const cues = Array.from({ length: 33 }, (_, index) => `Cue ${index + 1}`);
  queue.prefetch('tab', settings, prefetchItems(cues.slice(7, 30)));
  expect(batches()).toEqual([cues.slice(7, 17), cues.slice(17, 27), cues.slice(27, 30)]);
  [0, 1, 2].forEach(reply);
  await flush();
  queue.prefetch('tab', settings, prefetchItems(cues.slice(10, 33)));
  expect(batches()).toHaveLength(3);
  await vi.advanceTimersByTimeAsync(1000);
  expect(batches().slice(3)).toEqual([cues.slice(30, 33)]);
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
  const block = (index: number) => cues.slice(index * 10, index * 10 + 10);
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

it('sends at most three requests each second', async () => {
  const { fetch, batches } = pendingProvider();
  const queue = new TranslationQueue();
  const cues = Array.from({ length: 40 }, (_, index) => `Cue ${index + 1}`);
  const block = (index: number) => cues.slice(index * 10, index * 10 + 10);
  queue.prefetch('tab', settings, prefetchItems(cues));
  expect(batches()).toEqual([block(0), block(1), block(2)]);
  await vi.advanceTimersByTimeAsync(999);
  expect(fetch).toHaveBeenCalledTimes(translationSendsPerSecond);
  await vi.advanceTimersByTimeAsync(1);
  expect(batches()).toEqual([block(0), block(1), block(2), block(3)]);
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
  expect(fetch).toHaveBeenCalledTimes(translationSendsPerSecond + 1);
});

it('does not send a batch that leaves the window before a send slot opens', async () => {
  const { fetch } = pendingProvider();
  const queue = new TranslationQueue();
  const cues = Array.from({ length: 40 }, (_, index) => `Cue ${index + 1}`);
  queue.prefetch('tab', settings, prefetchItems(cues));
  queue.prefetch('tab', settings, prefetchItems(cues.slice(0, 30)));
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

it('sends each segment as its own request, even with fewer than ten captions, and never mixes tabs', () => {
  const { batches } = pendingProvider();
  const queue = new TranslationQueue();
  const cues = Array.from({ length: 12 }, (_, index) => `Cue ${index + 1}`);
  queue.prefetch(
    'tab',
    settings,
    cues.map((text, index) => ({
      text,
      segment: [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1][index] ?? 0,
      needsSplit: [][index] === true,
    })),
  );
  queue.prefetch('other-tab', settings, [
    { text: 'Other 1', segment: 0, needsSplit: false },
    { text: 'Other 2', segment: 0, needsSplit: false },
  ]);
  expect(batches()).toEqual([cues.slice(0, 8), cues.slice(8), ['Other 1', 'Other 2']]);
});

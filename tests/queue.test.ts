import { packedCues, prefetchItems } from './fixtures/provider';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { maxInFlightRequests, translationBatchLimit } from '../src/shared/limits';
import { planPlayback } from '../src/shared/playback-plan';
import { translationSendsPerSecond } from '../src/shared/provider/transport';
let TranslationQueue: typeof import('../src/extension/queue').TranslationQueue;
import { DEFAULT_SETTINGS } from '../src/shared/settings';
import { providerReply, requestedTexts } from './fixtures/provider';
import {
  longCaption,
  longCaptionParts,
  longResult,
  longSplit,
  structuredReply,
} from './fixtures/long-caption';
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
  const pending = queue.prefetch(
    'tab',
    settings,
    packedCues([
      { text: longCaption, needsSplit: false },
      { text: longCaption, needsSplit: true },
    ]),
  );
  requests[0].resolve(
    structuredReply([{ id: 0, parts: [{ translation: '整句译文' }] }, longResult(1)]),
  );
  const split = longSplit();
  await expect(pending).resolves.toEqual(['整句译文', split]);
  await expect(queue.request('tab', settings, longCaption, true)).resolves.toEqual(split);
  await expect(queue.request('tab', settings, longCaption)).resolves.toBe('整句译文');
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('retries only an invalid split with the split flag intact, keeping ordinary neighbors cached', async () => {
  const { fetch, requests } = pendingProvider();
  const queue = new TranslationQueue();
  const pending = queue.prefetch(
    'tab',
    settings,
    packedCues([
      { text: 'Before.', needsSplit: false },
      { text: longCaption, needsSplit: true },
      { text: 'After.', needsSplit: false },
    ]),
  );
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
  ).toMatchObject({ id: 0, parts: longCaptionParts });
  await expect(queue.lookup(settings, 'Before.')).resolves.toBe('之前。');
  requests[1].resolve(structuredReply([longResult()]));
  await expect(pending).resolves.toEqual(['之前。', longSplit(), '之后。']);
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

it('shares in-flight work within the request cap and serves a completed cue from the cache', async () => {
  const { fetch, requests, batches } = pendingProvider();
  const queue = new TranslationQueue();
  const first = queue.request('tab-1', settings, 'First');
  const second = queue.request('tab-2', settings, 'Second');
  const current = queue.request('tab-1', settings, 'Current');
  const shared = queue.request('tab-3', settings, 'Current');
  expect(batches()).toEqual([['First'], ['Second']]);
  expect(requests.map((request) => request.signal.aborted)).toEqual([false, false]);
  for (const request of requests)
    request.resolve(providerReply(request.texts, (text) => `${text} 译文`));
  await flush();
  expect(batches()).toEqual([['First'], ['Second'], ['Current']]);
  requests[2].resolve(providerReply(['Current'], () => 'Current 译文'));
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
  await expect(failed).resolves.toEqual([null, 'Passed 译文']);
  expect(fetch).toHaveBeenCalledTimes(2);
  queue.prefetch('tab', settings, prefetchItems(['Stale', 'Passed']));
  await flush();
  expect(fetch).toHaveBeenCalledTimes(2);
  await expect(queue.request('tab', settings, 'Stale')).rejects.toThrow('接口请求超时');
  expect(fetch).toHaveBeenCalledTimes(2);
  const next = queue.prefetch('tab', settings, prefetchItems(['Later'], 1));
  await expect(next).resolves.toEqual(['Later 译文']);
  expect(fetch).toHaveBeenCalledTimes(3);
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
    queue.prefetch('tab', settings, packedCues([{ text: 'Cached' }, { text: 'First' }])),
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

it('answers a prefetch in order, nulls a cue the next plan drops, and reuses the cache', async () => {
  const { batches, reply } = pendingProvider();
  const queue = new TranslationQueue();
  const opening = queue.prefetch('tab', settings, packedCues([{ text: 'A' }, { text: 'B' }]));
  const sliding = queue.prefetch('tab', settings, packedCues([{ text: 'B' }, { text: 'C' }]));
  expect(batches()).toEqual([['A', 'B'], ['C']]);
  reply(0);
  reply(1);
  await expect(opening).resolves.toEqual([null, 'B 译文']);
  await expect(sliding).resolves.toEqual(['B 译文', 'C 译文']);
  await expect(
    queue.prefetch('tab', settings, packedCues([{ text: 'A' }, { text: 'C' }])),
  ).resolves.toEqual(['A 译文', 'C 译文']);
  expect(batches()).toHaveLength(2);
});

it('keeps at most two requests in flight and gives the next slot to a visible caption', async () => {
  const { batches, reply, requests } = pendingProvider();
  const queue = new TranslationQueue();
  const cues = prefetchItems(Array.from({ length: 8 }, (_, index) => `Cue ${index + 1}`));
  const planned = planPlayback({ time: 0, rate: 1.5, cues }).map((request) =>
    request.cues.map((cue) => cue.text),
  );
  queue.prefetch('tab', settings, cues, 0, 1.5);
  expect(planned.length).toBeGreaterThan(2);
  expect(batches()).toEqual(planned.slice(0, 2));
  const visible = queue.request('tab', settings, 'Visible now');
  expect(batches()).toEqual(planned.slice(0, 2));
  expect(requests[0].signal.aborted).toBe(false);
  reply(0);
  await vi.advanceTimersByTimeAsync(1000);
  expect(batches()[2]).toEqual(['Visible now']);
  requests[2].resolve(providerReply(['Visible now'], () => '可见'));
  await expect(visible).resolves.toBe('可见');
  expect(batches()[3]).toEqual(planned[2]);
});

it('sends a newly near cue without waiting for the pack already in flight', async () => {
  const { batches, requests } = pendingProvider();
  const queue = new TranslationQueue();
  queue.prefetch(
    'tab',
    settings,
    packedCues([{ text: 'Cue 1' }, { text: 'Cue 2' }, { text: 'Cue 3' }, { text: 'Cue 4' }]),
  );
  queue.prefetch(
    'tab',
    settings,
    packedCues([{ text: 'Cue 2' }, { text: 'Cue 3' }, { text: 'Cue 4' }, { text: 'Cue 5' }]),
  );
  expect(batches()).toEqual([['Cue 1', 'Cue 2', 'Cue 3', 'Cue 4'], ['Cue 5']]);
  expect(requests[0].signal.aborted).toBe(false);
});

it('aborts an in-flight pack that misses the playhead and does not enqueue during the seek', () => {
  const { batches, requests } = pendingProvider();
  const queue = new TranslationQueue();
  queue.prefetch('tab', settings, prefetchItems(['Now', 'Soon', 'Later']));
  expect(batches()).toEqual([['Now'], ['Soon', 'Later']]);
  queue.hold('tab', 1);
  expect(requests[0].signal.aborted).toBe(false);
  expect(requests[1].signal.aborted).toBe(true);
  queue.hold('tab', 50);
  expect(requests[0].signal.aborted).toBe(true);
  expect(batches()).toHaveLength(2);
  queue.prefetch('tab', settings, []);
  queue.prefetch('tab', settings, prefetchItems(['Landed'], 50), 50);
  expect(batches().at(-1)).toEqual(['Landed']);
  expect(requests.at(-1)?.signal.aborted).toBe(false);
});

it('drops an unsent pack at the seek position until a settled snapshot arrives', async () => {
  const { batches, requests } = pendingProvider();
  const queue = new TranslationQueue();
  const cues = prefetchItems(['Now', 'Soon', 'Landing', 'After']);
  queue.prefetch('tab', settings, cues, 0, 1.5);
  expect(batches()).toEqual([['Now'], ['Soon', 'Landing']]);
  queue.hold('tab', 8.6);
  await vi.advanceTimersByTimeAsync(1000);
  expect(requests.map((request) => request.signal.aborted)).toEqual([true, false]);
  expect(batches()).toHaveLength(2);
  queue.prefetch('tab', settings, cues, 8.6, 1.5);
  expect(batches().slice(2)).toEqual([['After']]);
});

it('resumes a DOM-only caption after holding a seek without requiring a timeline snapshot', () => {
  const { batches, requests } = pendingProvider();
  const queue = new TranslationQueue();
  void queue.request('tab', settings, 'Old DOM caption').catch(() => {});
  queue.hold('tab', 20);
  expect(requests[0].signal.aborted).toBe(true);
  queue.request('tab', settings, 'Landed DOM caption');
  expect(batches()).toEqual([['Old DOM caption'], ['Landed DOM caption']]);
});

it('aborts a sent pack when the seek lands in a gap between its cues', () => {
  const { requests } = pendingProvider();
  const queue = new TranslationQueue();
  queue.prefetch('tab', settings, [
    { text: 'Before gap', start: 5, end: 5.5, needsSplit: false },
    { text: 'After gap', start: 7, end: 7.5, needsSplit: false },
  ]);
  expect(requests).toHaveLength(1);
  queue.hold('tab', 6);
  expect(requests[0].signal.aborted).toBe(true);
});

it('releases the previous visible caption when a new snapshot leaves it behind', () => {
  const { batches, requests } = pendingProvider();
  const queue = new TranslationQueue();
  queue.prefetch('tab', settings, prefetchItems(['Old', 'Soon', 'Later']));
  void queue.request('tab', settings, 'Old').catch(() => {});
  queue.prefetch('tab', settings, prefetchItems(['Landed'], 20), 20);
  expect(requests[0].signal.aborted).toBe(true);
  expect(requests[1].signal.aborted).toBe(true);
  expect(batches().at(-1)).toEqual(['Landed']);
});

it("does not let another playing tab send a paused tab's transport-pending pack", async () => {
  const { batches, reply } = pendingProvider();
  const queue = new TranslationQueue();
  for (const text of ['A', 'B', 'C']) queue.request(text, settings, text);
  reply(0);
  reply(1);
  await flush();
  queue.prefetch('paused-tab', settings, packedCues([{ text: 'Paused cue' }], 2));
  queue.pause('paused-tab');
  queue.request('playing-tab', settings, 'Playing cue');
  await vi.advanceTimersByTimeAsync(1000);
  expect(batches()).toEqual([['A'], ['B'], ['C']]);
  reply(2);
  await flush();
  expect(batches().at(-1)).toEqual(['Playing cue']);
  queue.resume('paused-tab');
  expect(batches().at(-1)).toEqual(['Paused cue']);
});

it('does not send a cue outside the buffer or a cue that is already translated', async () => {
  const { batches, reply } = pendingProvider();
  const queue = new TranslationQueue();
  const cues = prefetchItems(Array.from({ length: 12 }, (_, index) => `Cue ${index + 1}`));
  const planned = planPlayback({ time: 0, rate: 1, cues }).map((request) =>
    request.cues.map((cue) => cue.text),
  );
  queue.prefetch('tab', settings, cues);
  expect(batches()).toEqual(planned.slice(0, maxInFlightRequests));
  for (let index = 0; index < planned.length; index++) {
    reply(index);
    await vi.advanceTimersByTimeAsync(1000);
  }
  expect(batches()).toEqual(planned);
  expect(planned.flat()).not.toContain('Cue 10');
  queue.prefetch('tab', settings, cues, 4);
  expect(
    batches()
      .flat()
      .filter((text) => text === 'Cue 2'),
  ).toHaveLength(1);
});

it('retries each cue on its own when the batch reply cannot be matched to the cues', async () => {
  const { fetch, requests, batches } = pendingProvider();
  const queue = new TranslationQueue();
  queue.prefetch('tab', settings, packedCues([{ text: 'First' }, { text: 'Second' }]));
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
  queue.prefetch('tab', settings, packedCues([{ text: 'Shared cue' }, { text: 'Next cue' }]));
  queue.prefetch('other-tab', settings, packedCues([{ text: 'Shared cue' }]));
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
  queue.prefetch('tab', settings, packedCues([{ text: 'A' }, { text: 'B' }], 3));
  queue.prefetch('tab', settings, packedCues([{ text: 'B' }, { text: 'C' }], 3));
  expect(batches().slice(1)).toEqual([['A', 'B'], ['C']]);
  expect(requests[1].signal.aborted).toBe(false);
  queue.prefetch('tab', settings, []);
  expect(requests[1].signal.aborted).toBe(true);
  expect(requests[2].signal.aborted).toBe(true);
});

it('finishes sent requests while paused and does not send the rest until playback resumes', async () => {
  const { fetch, requests, batches, reply } = pendingProvider();
  const queue = new TranslationQueue();
  const cues = prefetchItems(Array.from({ length: 8 }, (_, index) => `Cue ${index + 1}`));
  const planned = planPlayback({ time: 0, rate: 1.5, cues }).map((request) =>
    request.cues.map((cue) => cue.text),
  );
  queue.prefetch('tab', settings, cues, 0, 1.5);
  const visible = queue.request('tab', settings, cues[0].text);
  expect(batches().slice(0, 2)).toEqual(planned.slice(0, 2));
  queue.pause('tab');
  await vi.advanceTimersByTimeAsync(5000);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(requests.slice(0, 2).every((request) => !request.signal.aborted)).toBe(true);
  reply(0);
  await expect(visible).resolves.toBe('Cue 1 译文');
  expect(fetch).toHaveBeenCalledTimes(2);
  queue.resume('tab');
  expect(batches()[2]).toEqual(planned[2]);
});

it('sends at most two requests at once and keeps the per-second send cap', async () => {
  const { fetch, batches, reply } = pendingProvider();
  const queue = new TranslationQueue();
  const cues = prefetchItems(Array.from({ length: 8 }, (_, index) => `Cue ${index + 1}`));
  const planned = planPlayback({ time: 0, rate: 1.5, cues }).map((request) =>
    request.cues.map((cue) => cue.text),
  );
  queue.prefetch('tab', settings, cues, 0, 1.5);
  expect(batches()).toEqual(planned.slice(0, 2));
  for (const [index, text] of ['A', 'B', 'C', 'D'].entries())
    queue.request(`visible-${index}`, settings, text);
  expect(fetch).toHaveBeenCalledTimes(2);
  reply(0);
  await flush();
  expect(fetch).toHaveBeenCalledTimes(translationSendsPerSecond);
  reply(1);
  reply(2);
  await flush();
  expect(fetch).toHaveBeenCalledTimes(translationSendsPerSecond);
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetch).toHaveBeenCalledTimes(5);
  reply(3);
  await flush();
  expect(fetch).toHaveBeenCalledTimes(6);
});

it('keeps queued packs parked through a provider backoff', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('', { status: 429 }));
  vi.stubGlobal('fetch', fetch);
  const queue = new TranslationQueue();
  const cues = prefetchItems(Array.from({ length: 8 }, (_, index) => `Cue ${index + 1}`));
  queue.prefetch('tab', settings, cues, 0, 1.5);
  await flush();
  expect(fetch).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(14000);
  expect(fetch).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetch).toHaveBeenCalledTimes(2 + maxInFlightRequests);
});

it('does not send a pack that leaves the plan before a slot opens', async () => {
  const { fetch, batches } = pendingProvider();
  const queue = new TranslationQueue();
  const cues = prefetchItems(Array.from({ length: 8 }, (_, index) => `Cue ${index + 1}`));
  const planned = planPlayback({ time: 0, rate: 1.5, cues }).map((request) =>
    request.cues.map((cue) => cue.text),
  );
  queue.prefetch('tab', settings, cues, 0, 1.5);
  queue.prefetch('tab', settings, prefetchItems(planned[0]));
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(batches()).toEqual(planned.slice(0, 2));
});

it('cancels an in-flight batch when playback leaves and does not retry it', async () => {
  const { fetch, requests } = pendingProvider();
  const queue = new TranslationQueue();
  const pending = queue.prefetch(
    'tab',
    settings,
    packedCues([{ text: 'First' }, { text: longCaption, needsSplit: true }]),
  );
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
  const pending = queue.prefetch(
    'tab',
    settings,
    packedCues([{ text: 'First' }, { text: 'Second' }]),
  );
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
  const pending = queue.prefetch(
    'tab',
    settings,
    packedCues([{ text: 'First' }, { text: 'Second' }]),
  );
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
  const pending = queue.prefetch(
    'tab',
    settings,
    packedCues([{ text: 'First' }, { text: 'Second' }]),
  );
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
  const pending = queue.prefetch(
    'tab',
    settings,
    packedCues([{ text: longCaption, needsSplit: true }, { text: 'Middle.' }, { text: 'After.' }]),
  );
  const broken = (result: unknown) => JSON.stringify(result).replace(/\]\}$/, ' stray]}');
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
  ).toMatchObject({ id: 0, parts: longCaptionParts });
  await expect(queue.lookup(settings, 'Middle.')).resolves.toBe('中间。');
  requests[1].resolve(structuredReply([longResult()]));
  requests[2].resolve(providerReply(['After.'], () => '之后。'));
  await expect(pending).resolves.toEqual([longSplit(), '中间。', '之后。']);
  expect(fetch).toHaveBeenCalledTimes(3);
});

it('packs a short list without padding it to four and never mixes tabs', () => {
  const { batches } = pendingProvider();
  const queue = new TranslationQueue();
  queue.prefetch('tab', settings, packedCues([{ text: 'Cue 1' }, { text: 'Cue 2' }]));
  queue.prefetch('other-tab', settings, packedCues([{ text: 'Other 1' }, { text: 'Other 2' }]));
  expect(batches()).toEqual([
    ['Cue 1', 'Cue 2'],
    ['Other 1', 'Other 2'],
  ]);
  expect(batches().every((batch) => batch.length < translationBatchLimit)).toBe(true);
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
  const current = queue.request('7:0', settings, 'Current');
  await vi.advanceTimersByTimeAsync(1000);
  await expect(current).resolves.toBe('Current 译文');
  expect(
    events.map(
      ({ ms: _ms, start: _start, end: _end, predictedMs: _prediction, ...event }) => event,
    ),
  ).toEqual([
    {
      e: 'batch',
      id: 1,
      tab: '7:0',
      size: 1,
      videoTime: 0,
      playbackRate: 1,
      slack: 0,
      inFlight: 1,
      blocked: false,
      atRisk: true,
    },
    { e: 'sent', id: 1 },
    {
      e: 'batch',
      id: 2,
      tab: '7:0',
      size: 1,
      videoTime: 0,
      playbackRate: 1,
      slack: 4,
      inFlight: 2,
      blocked: false,
      atRisk: false,
    },
    { e: 'sent', id: 2 },
    { e: 'first', id: 1 },
    { e: 'first', id: 2 },
    { e: 'done', id: 1, result: 'ok' },
    { e: 'done', id: 2, result: 'ok' },
    {
      e: 'batch',
      id: 3,
      tab: '7:0',
      size: 1,
      videoTime: 0,
      playbackRate: 1,
      slack: 1,
      inFlight: 1,
      blocked: false,
      atRisk: true,
    },
    { e: 'sent', id: 3 },
    { e: 'done', id: 3, result: 'timeout' },
    {
      e: 'batch',
      id: 4,
      tab: '7:0',
      size: 1,
      videoTime: 0,
      playbackRate: 1,
      slack: 0,
      inFlight: 1,
      blocked: false,
      atRisk: true,
    },
    { e: 'sent', id: 4 },
    { e: 'first', id: 4 },
    { e: 'done', id: 4, result: 'ok' },
  ]);
  for (const event of events)
    if (event.e === 'first' || event.e === 'done') expect(event.ms).toBeGreaterThanOrEqual(0);
  expect(events.filter((event) => event.e === 'batch').map((event) => event.predictedMs)).toEqual([
    4000, 4000, 2000, 2000,
  ]);
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

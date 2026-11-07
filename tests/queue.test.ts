import { sessionStorage } from './fixtures/extension-storage';
import { packedCues, prefetchItems } from './fixtures/provider';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  providerSendWindowMs,
  translationBatchLimit,
  translationSendsPerSecond,
} from '../src/shared/tuning';
import { planPlayback } from '../src/shared/playback-plan';
let TranslationQueue: typeof import('../src/extension/queue').TranslationQueue;
let failureOf: typeof import('../src/shared/provider-error').failureOf;
import { DEFAULT_SETTINGS, type CaptionTranslationSettings } from '../src/shared/settings';
import { providerReply, requestedTexts, translationReply } from './fixtures/provider';
import { TranslationStore } from '../src/extension/translation-store';
import type { TraceEvent } from '../src/shared/trace';

beforeEach(async () => {
  vi.stubGlobal('chrome', { storage: { session: sessionStorage() } });
  vi.useFakeTimers();
  vi.resetModules();
  ({ TranslationQueue } = await import('../src/extension/queue'));
  ({ failureOf } = await import('../src/shared/provider-error'));
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
const settings: CaptionTranslationSettings = {
  ...DEFAULT_SETTINGS,
  provider: 'openai',
  captionLanguage: 'en' as const,
  pageTitle: '',
  apiKey: 'test-key',
  model: 'test-model',
};

it('fails one caption without retrying and keeps its neighbors cached', async () => {
  const { fetch, requests } = pendingProvider();
  const queue = new TranslationQueue();
  const cues = [
    { text: 'Before.', start: 0, end: 3 },
    { text: 'Middle.', start: 3, end: 14 },
    { text: 'After.', start: 14, end: 25 },
  ];
  const pending = queue.prefetch('tab', settings, cues);
  await flush();
  requests[0].resolve(translationReply('之前。'));
  requests[1].resolve(translationReply(''));
  requests[2].resolve(translationReply('之后。'));
  await expect(pending).resolves.toEqual(['之前。', null, '之后。']);
  await expect(queue.lookup(settings, 'Before.')).resolves.toBe('之前。');
  await expect(queue.lookup(settings, 'After.')).resolves.toBe('之后。');
  await expect(queue.prefetch('tab', settings, cues)).resolves.toEqual(['之前。', null, '之后。']);
  await expect(queue.request('tab', settings, 'Middle.')).rejects.toThrow('invalid response');
  await vi.advanceTimersByTimeAsync(16000);
  expect(fetch).toHaveBeenCalledTimes(3);
});

it('caches content the Provider leaves unchanged', async () => {
  const { fetch, requests } = pendingProvider();
  const queue = new TranslationQueue();
  const pending = queue.request('tab', settings, 'OpenAI');
  await flush();
  requests[0].resolve(translationReply('OpenAI'));
  await expect(pending).resolves.toBe('OpenAI');
  await expect(queue.request('other-tab', settings, 'OpenAI')).resolves.toBe('OpenAI');
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each([
  {
    language: 'en-US',
    message: 'Provider returned an invalid response stream. Unable to translate.',
  },
  { language: 'zh-CN', message: 'Provider 回复非法信息流，无法翻译' },
])(
  'rejects an invalid result without retrying or caching it ($language)',
  async ({ language, message }) => {
    vi.resetModules();
    vi.stubGlobal('navigator', { language });
    ({ TranslationQueue } = await import('../src/extension/queue'));
    const fetch = vi.fn().mockImplementation(async () => translationReply(''));
    vi.stubGlobal('fetch', fetch);
    const queue = new TranslationQueue();
    await expect(queue.request('tab', settings, 'Broken.')).rejects.toThrow(message);
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(queue.lookup(settings, 'Broken.')).resolves.toBeNull();
  },
);

it('shares pending work within the send budget and serves a completed cue from the cache', async () => {
  const { fetch, requests, batches } = pendingProvider();
  const queue = new TranslationQueue();
  const first = queue.request('tab-1', settings, 'First');
  await flush();
  const second = queue.request('tab-2', settings, 'Second');
  await flush();
  const third = queue.request('tab-extra', settings, 'Third');
  await flush();
  const current = queue.request('tab-1', settings, 'Current');
  await flush();
  const shared = queue.request('tab-3', settings, 'Current');
  await flush();
  expect(batches()).toEqual([['First'], ['Second'], ['Third']]);
  expect(requests.map((request) => request.signal.aborted)).toEqual([false, false, false]);
  for (const request of requests)
    request.resolve(providerReply(request.texts, (text) => `${text} 译文`));
  await vi.advanceTimersByTimeAsync(1000);
  expect(batches()).toEqual([['First'], ['Second'], ['Third'], ['Current']]);
  requests[3].resolve(providerReply(['Current'], () => 'Current 译文'));
  await expect(Promise.all([first, second, third, current, shared])).resolves.toEqual([
    'First 译文',
    'Second 译文',
    'Third 译文',
    'Current 译文',
    'Current 译文',
  ]);
  await expect(queue.request('tab-4', settings, 'Current')).resolves.toBe('Current 译文');
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetch).toHaveBeenCalledTimes(4);
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
  await flush();
  await expect(failed).resolves.toEqual([null, 'Passed 译文']);
  expect(fetch).toHaveBeenCalledTimes(2);
  queue.prefetch('tab', settings, prefetchItems(['Stale', 'Passed']));
  await flush();
  await flush();
  expect(fetch).toHaveBeenCalledTimes(2);
  await expect(queue.request('tab', settings, 'Stale')).rejects.toThrow('The request timed out');
  expect(fetch).toHaveBeenCalledTimes(2);
  const next = queue.prefetch('tab', settings, prefetchItems(['Later'], 1));
  await flush();
  await vi.advanceTimersByTimeAsync(1000);
  await expect(next).resolves.toEqual(['Later 译文']);
  expect(fetch).toHaveBeenCalledTimes(3);
});

it.each([
  { status: 401, message: 'The API Key is invalid or expired.' },
  { status: 500, message: 'Provider request failed' },
])(
  'keeps the HTTP $status failure while it backs off after a prefetch',
  async ({ status, message }) => {
    const fetch = vi.fn().mockResolvedValue(new Response('', { status }));
    vi.stubGlobal('fetch', fetch);
    const queue = new TranslationQueue();
    const ahead = queue.prefetch('tab', settings, prefetchItems(['Ahead']));
    await flush();
    const failure = { kind: 'http', status, message };
    await expect(
      queue.request('tab', settings, 'Ahead').catch((error) => failureOf(error, 'Request failed')),
    ).resolves.toEqual(failure);
    await expect(ahead).resolves.toEqual([null]);
    await expect(
      queue
        .request('tab', settings, 'Visible')
        .catch((error) => failureOf(error, 'Request failed')),
    ).resolves.toEqual(failure);
    expect(fetch).toHaveBeenCalledTimes(1);
    queue.reset();
    fetch.mockResolvedValue(providerReply(['Visible'], () => '可见'));
    await expect(queue.request('tab', settings, 'Visible')).resolves.toBe('可见');
  },
);

it('does not cache a failed request, but still serves cached cues while the provider backs off', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(providerReply(['Cached'], () => '已缓存'))
    .mockResolvedValue(new Response('', { status: 429 }));
  vi.stubGlobal('fetch', fetch);
  const queue = new TranslationQueue();
  await expect(queue.request('tab', settings, 'Cached')).resolves.toBe('已缓存');
  await expect(queue.request('tab', settings, 'First')).rejects.toThrow('Rate limit');
  await expect(queue.request('tab', settings, 'Second')).rejects.toThrow('Rate limit');
  await expect(queue.request('tab', settings, 'Cached')).resolves.toBe('已缓存');
  await expect(queue.prefetch('tab', settings, packedCues(['Cached', 'First']))).resolves.toEqual([
    '已缓存',
    null,
  ]);
  expect(fetch).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(15000);
  await expect(queue.request('tab', settings, 'First')).rejects.toThrow('Rate limit');
  expect(fetch).toHaveBeenCalledTimes(3);
});

it('keeps finished translations through a settings reset and requests again only for other provider settings', async () => {
  const { fetch, reply } = pendingProvider();
  const queue = new TranslationQueue();
  const first = queue.request('tab', settings, 'Cue');
  await flush();
  reply(0);
  await expect(first).resolves.toBe('Cue 译文');
  queue.reset();
  await expect(queue.request('tab', settings, 'Cue')).resolves.toBe('Cue 译文');
  expect(fetch).toHaveBeenCalledTimes(1);
  queue.reset();
  const changed = queue.request('tab', { ...settings, model: 'other-model' }, 'Cue');
  await flush();
  expect(fetch).toHaveBeenCalledTimes(2);
  reply(1);
  await expect(changed).resolves.toBe('Cue 译文');
});

it('forgets the oldest translations beyond the cache limit', async () => {
  const { fetch, reply } = pendingProvider();
  let queue = new TranslationQueue(new TranslationStore(2));
  for (const [index, text] of ['A', 'B', 'C'].entries()) {
    await vi.advanceTimersByTimeAsync(1000);
    const done = queue.request('tab', settings, text);
    await flush();
    reply(index);
    await done;
    if (index === 1) queue = new TranslationQueue(new TranslationStore(2));
  }
  await expect(queue.request('tab', settings, 'C')).resolves.toBe('C 译文');
  await expect(queue.request('tab', settings, 'B')).resolves.toBe('B 译文');
  expect(fetch).toHaveBeenCalledTimes(3);
  void queue.request('tab', settings, 'A');
  await flush();
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetch).toHaveBeenCalledTimes(4);
});

it('answers a prefetch in order, nulls a cue the next plan drops, and reuses the cache', async () => {
  const { batches, reply } = pendingProvider();
  const queue = new TranslationQueue();
  const opening = queue.prefetch('tab', settings, packedCues(['A', 'B']));
  await flush();
  const sliding = queue.prefetch('tab', settings, packedCues(['B', 'C']));
  await flush();
  expect(batches()).toEqual([['A', 'B'], ['C']]);
  reply(0);
  reply(1);
  await expect(opening).resolves.toEqual([null, 'B 译文']);
  await expect(sliding).resolves.toEqual(['B 译文', 'C 译文']);
  const replay = queue.prefetch('tab', settings, packedCues(['A', 'C']));
  await flush();
  await vi.advanceTimersByTimeAsync(1000);
  await expect(replay).resolves.toEqual(['A 译文', 'C 译文']);
  expect(batches()).toHaveLength(2);
});

it('keeps sending with earlier requests pending and prioritizes a visible caption', async () => {
  const { batches, requests } = pendingProvider();
  const queue = new TranslationQueue();
  const cues = prefetchItems(Array.from({ length: 12 }, (_, index) => `Cue ${index + 1}`));
  const planned = planPlayback({ time: 0, rate: 1.5, cues }).map((request) =>
    request.cues.map((cue) => cue.text),
  );
  queue.prefetch('tab', settings, cues, 0, 1.5);
  await flush();
  expect(planned.length).toBeGreaterThan(translationSendsPerSecond);
  expect(batches()).toEqual(planned.slice(0, translationSendsPerSecond));
  const visible = queue.request('tab', settings, 'Visible now');
  await flush();
  expect(batches()).toEqual(planned.slice(0, translationSendsPerSecond));
  expect(requests[0].signal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(999);
  expect(batches()).toEqual(planned.slice(0, translationSendsPerSecond));
  await vi.advanceTimersByTimeAsync(1);
  expect(batches()[translationSendsPerSecond]).toEqual(['Visible now']);
  expect(batches()).toHaveLength(translationSendsPerSecond * 2);
  expect(requests.every((request) => !request.signal.aborted)).toBe(true);
  requests[translationSendsPerSecond].resolve(providerReply(['Visible now'], () => '可见'));
  await expect(visible).resolves.toBe('可见');
  expect(batches()[translationSendsPerSecond + 1]).toEqual(planned[translationSendsPerSecond]);
});

it('sends a newly near cue without waiting for the pack already in flight', async () => {
  const { batches, requests } = pendingProvider();
  const queue = new TranslationQueue();
  queue.prefetch('tab', settings, packedCues(['Cue 1', 'Cue 2']));
  await flush();
  queue.prefetch('tab', settings, packedCues(['Cue 2', 'Cue 3']));
  await flush();
  expect(batches()).toEqual([['Cue 1', 'Cue 2'], ['Cue 3']]);
  expect(requests[0].signal.aborted).toBe(false);
  expect(requests[1].signal.aborted).toBe(false);
});

it('lets packs sent before a seek finish into the cache without holding back the landing', async () => {
  const { batches, requests, reply } = pendingProvider();
  const queue = new TranslationQueue();
  queue.prefetch('tab', settings, prefetchItems(['Now', 'Soon', 'Later', 'After', 'Last']));
  await flush();
  expect(batches()).toEqual([['Now'], ['Soon', 'Later'], ['After', 'Last']]);
  expect(batches()).toHaveLength(translationSendsPerSecond);
  queue.hold('tab', 50);
  expect(batches()).toHaveLength(3);
  queue.prefetch('tab', settings, prefetchItems(['Landed'], 50), 50);
  await flush();
  expect(batches().at(-1)).toEqual(['Landed']);
  expect(requests.some((request) => request.signal.aborted)).toBe(false);
  reply(1);
  await vi.advanceTimersByTimeAsync(0);
  await expect(queue.lookup(settings, 'Later')).resolves.toBe('Later 译文');
});

it('drops an unsent pack at the seek position until a settled snapshot arrives', async () => {
  const { batches } = pendingProvider();
  const queue = new TranslationQueue();
  queue.request('other', settings, 'Other');
  await flush();
  queue.request('another', settings, 'Another');
  await flush();
  const cues = prefetchItems(['Now', 'Soon', 'Landing', 'After']);
  queue.prefetch('tab', settings, cues, 0, 1.5);
  await flush();
  expect(batches()).toEqual([['Other'], ['Another'], ['Now']]);
  queue.hold('tab', 8.6);
  await vi.advanceTimersByTimeAsync(1000);
  expect(batches()).toHaveLength(3);
  queue.prefetch('tab', settings, cues, 8.6, 1.5);
  await flush();
  expect(batches().slice(3)).toEqual([['Landing'], ['After']]);
});

it('resumes a DOM-only caption after holding a seek without requiring a timeline snapshot', async () => {
  const { batches } = pendingProvider();
  const queue = new TranslationQueue();
  void queue.request('tab', settings, 'Old DOM caption').catch(() => {});
  await flush();
  queue.hold('tab', 20);
  queue.request('tab', settings, 'Landed DOM caption');
  await flush();
  expect(batches()).toEqual([['Old DOM caption'], ['Landed DOM caption']]);
});

it('releases the previous visible caption when a new snapshot leaves it behind', async () => {
  const { batches, requests } = pendingProvider();
  const queue = new TranslationQueue();
  queue.prefetch('tab', settings, prefetchItems(['Old', 'Soon', 'Later']));
  await flush();
  void queue.request('tab', settings, 'Old').catch(() => {});
  await flush();
  queue.prefetch('tab', settings, prefetchItems(['Landed'], 20), 20);
  await flush();
  expect(requests[0].signal.aborted).toBe(true);
  expect(requests[1].signal.aborted).toBe(true);
  await vi.advanceTimersByTimeAsync(1000);
  expect(batches().at(-1)).toEqual(['Landed']);
});

it("does not let another playing tab send a paused tab's transport-pending pack", async () => {
  const { batches, reply } = pendingProvider();
  const queue = new TranslationQueue();
  for (const text of ['A', 'B', 'C']) {
    queue.request(text, settings, text);
    await flush();
  }
  reply(0);
  reply(1);
  await flush();
  queue.prefetch('paused-tab', settings, packedCues(['Paused cue'], 2));
  await flush();
  queue.pause('paused-tab');
  queue.request('playing-tab', settings, 'Playing cue');
  await flush();
  await vi.advanceTimersByTimeAsync(1000);
  expect(batches()).toEqual([['A'], ['B'], ['C'], ['Playing cue']]);
  queue.resume('paused-tab');
  await vi.advanceTimersByTimeAsync(1000);
  expect(batches().at(-1)).toEqual(['Paused cue']);
});

it('does not send a cue outside the buffer or a cue that is already translated', async () => {
  const { batches, reply } = pendingProvider();
  const queue = new TranslationQueue();
  const cues = prefetchItems(Array.from({ length: 16 }, (_, index) => `Cue ${index + 1}`));
  const shuffled = cues.map((cue, index) => ({ ...cue, segment: index }));
  const planned = planPlayback({ time: 0, rate: 1, cues }).map((request) =>
    request.cues.map((cue) => cue.text),
  );
  queue.prefetch('tab', settings, shuffled);
  await flush();
  expect(batches()).toEqual(planned.slice(0, translationSendsPerSecond));
  for (let index = 0; index < planned.length; index++) {
    reply(index);
    await vi.advanceTimersByTimeAsync(1000);
  }
  expect(batches()).toEqual(planned);
  expect(planned.flat()).not.toContain('Cue 10');
  queue.prefetch('tab', settings, cues, 4);
  await flush();
  expect(
    batches()
      .flat()
      .filter((text) => text === 'Cue 2'),
  ).toHaveLength(1);
  queue.prefetch('tab', settings, prefetchItems(['Cue 16'], 60), 60);
  await flush();
  expect(batches().at(-1)).toEqual(['Cue 16']);
});

it('keeps a shared caption running until every consumer leaves', async () => {
  const { requests, reply } = pendingProvider();
  const queue = new TranslationQueue();
  queue.prefetch('tab', settings, packedCues(['Shared cue', 'Next cue']));
  await flush();
  queue.prefetch('other-tab', settings, packedCues(['Shared cue']));
  await flush();
  const visible = queue.request('other-tab', settings, 'Shared cue');
  await flush();
  queue.prefetch('tab', settings, []);
  await flush();
  expect(requests[0].signal.aborted).toBe(false);
  expect(requests).toHaveLength(1);
  reply(0);
  await expect(visible).resolves.toBe('Shared cue 译文');
  await expect(queue.lookup(settings, 'Next cue')).resolves.toBe('Next cue 译文');
});

it('finishes sent requests while paused and does not send the rest until playback resumes', async () => {
  const { fetch, requests, batches, reply } = pendingProvider();
  const queue = new TranslationQueue();
  const cues = prefetchItems(Array.from({ length: 8 }, (_, index) => `Cue ${index + 1}`));
  const planned = planPlayback({ time: 0, rate: 1.5, cues }).map((request) =>
    request.cues.map((cue) => cue.text),
  );
  queue.prefetch('tab', settings, cues, 0, 1.5);
  await flush();
  const visible = queue.request('tab', settings, cues[0].text);
  await flush();
  expect(batches().slice(0, translationSendsPerSecond)).toEqual(
    planned.slice(0, translationSendsPerSecond),
  );
  queue.pause('tab');
  await vi.advanceTimersByTimeAsync(5000);
  expect(fetch).toHaveBeenCalledTimes(translationSendsPerSecond);
  expect(
    requests.slice(0, translationSendsPerSecond).every((request) => !request.signal.aborted),
  ).toBe(true);
  reply(0);
  await expect(visible).resolves.toBe('Cue 1 译文');
  expect(fetch).toHaveBeenCalledTimes(translationSendsPerSecond);
  queue.resume('tab');
  expect(batches()[translationSendsPerSecond]).toEqual(planned[translationSendsPerSecond]);
});

it('keeps queued packs parked through a provider backoff', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('', { status: 429 }));
  vi.stubGlobal('fetch', fetch);
  const queue = new TranslationQueue();
  const cues = prefetchItems(Array.from({ length: 12 }, (_, index) => `Cue ${index + 1}`));
  queue.prefetch('tab', settings, cues, 0, 1.5);
  await flush();
  await flush();
  expect(fetch).toHaveBeenCalledTimes(translationSendsPerSecond);
  await vi.advanceTimersByTimeAsync(14000);
  expect(fetch).toHaveBeenCalledTimes(translationSendsPerSecond);
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetch).toHaveBeenCalledTimes(translationSendsPerSecond * 2);
});

it('does not send a pack that leaves the plan before a slot opens', async () => {
  const { fetch, batches, reply } = pendingProvider();
  const queue = new TranslationQueue();
  const cues = prefetchItems(Array.from({ length: 8 }, (_, index) => `Cue ${index + 1}`));
  const planned = planPlayback({ time: 0, rate: 1.5, cues }).map((request) =>
    request.cues.map((cue) => cue.text),
  );
  queue.prefetch('tab', settings, cues, 0, 1.5);
  await flush();
  queue.prefetch('tab', settings, prefetchItems(planned[0]));
  await flush();
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetch).toHaveBeenCalledTimes(translationSendsPerSecond);
  expect(batches()).toEqual(planned.slice(0, translationSendsPerSecond));
  reply(0);
  await flush();
  expect(fetch).toHaveBeenCalledTimes(translationSendsPerSecond);
  expect(batches()).toEqual(planned.slice(0, translationSendsPerSecond));
});

it('cancels an in-flight batch when playback leaves and does not retry it', async () => {
  const { fetch, requests } = pendingProvider();
  const queue = new TranslationQueue();
  const pending = queue.prefetch('tab', settings, packedCues(['First', 'Second']));
  await flush();
  const first = queue.request('tab', settings, 'First');
  await flush();
  const second = queue.request('tab', settings, 'Second');
  await flush();
  await flush();
  expect(fetch).toHaveBeenCalledTimes(1);
  queue.prefetch('tab', settings, []);
  await flush();
  expect(requests[0].signal.aborted).toBe(true);
  await expect(first).rejects.toThrow('Subtitles have changed');
  await expect(second).rejects.toThrow('Subtitles have changed');
  await expect(pending).resolves.toEqual([null, null]);
  for (const request of requests) request.resolve(providerReply(request.texts, () => '过期译文'));
  await flush();
  await expect(queue.lookup(settings, 'First')).resolves.toBeNull();
  await expect(queue.lookup(settings, 'Second')).resolves.toBeNull();
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('resolves captions independently and replays each from cache', async () => {
  const { fetch, requests, batches } = pendingProvider();
  const queue = new TranslationQueue();
  const pending = queue.prefetch('tab', settings, packedCues(['First', 'Second']));
  await flush();
  expect(batches()).toEqual([['First', 'Second']]);
  const first = queue.request('tab', settings, 'First');
  await flush();
  requests[0].resolve(
    providerReply(['First', 'Second'], (text) => (text === 'First' ? '第一句' : '第二句')),
  );
  await expect(first).resolves.toBe('第一句');
  await expect(queue.lookup(settings, 'First')).resolves.toBe('第一句');
  await expect(pending).resolves.toEqual(['第一句', '第二句']);
  await expect(queue.request('tab', settings, 'First')).resolves.toBe('第一句');
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('packs a short list without padding it to the batch limit and never mixes tabs', async () => {
  const { batches } = pendingProvider();
  const queue = new TranslationQueue();
  queue.prefetch('tab', settings, packedCues(['Cue 1', 'Cue 2']));
  await flush();
  queue.prefetch('other-tab', settings, packedCues(['Other 1']));
  await flush();
  expect(batches()).toEqual([['Cue 1', 'Cue 2'], ['Other 1']]);
  expect(batches().every((batch) => batch.length <= translationBatchLimit)).toBe(true);
});

it('traces each batch by tab without its keys, texts or error messages, excluding send-budget wait from duration', async () => {
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
  const slow = queue.prefetch('7:0', settings, prefetchItems(['Slow'], 1));
  await flush();
  await vi.advanceTimersByTimeAsync(1000);
  await slow;
  const current = queue.request('7:0', settings, 'Current');
  await flush();
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

  queue.reset();
  events.length = 0;
  const delayed = pendingProvider();
  await vi.advanceTimersByTimeAsync(1000);
  for (const text of ['A', 'B', 'C']) {
    const done = queue.request(text, settings, text);
    await flush();
    delayed.reply(delayed.requests.length - 1);
    await done;
  }
  const created = Date.now();
  const measured = queue.request('measured', settings, 'Delayed');
  await flush();
  expect(delayed.batches()).toEqual([['A'], ['B'], ['C']]);
  await vi.advanceTimersByTimeAsync(providerSendWindowMs);
  expect(delayed.batches()).toEqual([['A'], ['B'], ['C'], ['Delayed']]);
  const measuredBatch = events.find((event) => event.e === 'batch' && event.tab === 'measured')!;
  expect(events).toContainEqual({ e: 'sent', id: measuredBatch.id });
  expect(Date.now() - created).toBe(providerSendWindowMs);
  await vi.advanceTimersByTimeAsync(250);
  delayed.reply(3);
  await expect(measured).resolves.toBe('Delayed 译文');
  await flush();
  expect(events.filter((event) => event.id === measuredBatch.id && event.e === 'done')).toEqual([
    { e: 'done', id: measuredBatch.id, ms: 250, result: 'ok' },
  ]);
});

it('reads session storage for every lookup and replay, including after a worker restart', async () => {
  const fetch = vi.fn(async (_url: string, init: RequestInit) =>
    providerReply(requestedTexts(init), (text) => `${text} 译文`),
  );
  vi.stubGlobal('fetch', fetch);
  const session = sessionStorage();
  vi.stubGlobal('chrome', { storage: { session } });
  const queue = new TranslationQueue();
  await expect(queue.request('tab', settings, 'One')).resolves.toBe('One 译文');
  const key = [...session.stored.keys()].find((key) => key.startsWith('subline.translation.v3:'))!;
  session.stored.set(key, '会话中的新译文');
  await expect(queue.lookup(settings, 'One')).resolves.toBe('会话中的新译文');
  await expect(queue.request('tab', settings, 'One')).resolves.toBe('会话中的新译文');
  const restarted = new TranslationQueue();
  await expect(restarted.request('tab', settings, 'One')).resolves.toBe('会话中的新译文');
  expect(fetch).toHaveBeenCalledTimes(1);
  session.stored.delete(key);
  await expect(queue.lookup(settings, 'One')).resolves.toBeNull();
  await expect(queue.request('tab', settings, 'One')).resolves.toBe('One 译文');
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(JSON.stringify([...session.stored])).not.toContain(settings.apiKey);
});

it('keeps sent packs through snapshot refreshes and cancels one only after its cues leave', async () => {
  const { batches, reply, requests } = pendingProvider();
  const queue = new TranslationQueue();
  const list = Array.from({ length: 8 }, (_, index) => `Cue ${index + 1}`);
  queue.prefetch('tab', settings, prefetchItems(list));
  await flush();
  expect(batches()).toEqual([['Cue 1'], ['Cue 2', 'Cue 3'], ['Cue 4', 'Cue 5']]);
  queue.prefetch('tab', settings, prefetchItems(list), 1);
  await flush();
  expect(requests.map((request) => request.signal.aborted)).toEqual([false, false, false]);
  expect(batches()).toHaveLength(3);
  queue.prefetch('tab', settings, prefetchItems(list.slice(1), 4), 5);
  await flush();
  expect(requests[0].signal.aborted).toBe(true);
  expect(requests[1].signal.aborted).toBe(false);
  reply(1);
  await vi.advanceTimersByTimeAsync(0);
  const again = queue.prefetch('tab', settings, prefetchItems(['Cue 2'], 4), 5);
  await flush();
  await expect(again).resolves.toEqual(['Cue 2 译文']);
  expect(
    batches()
      .flat()
      .filter((text) => text === 'Cue 2'),
  ).toHaveLength(1);
});

it.each([
  { kind: 'request', action: 'hold' },
  { kind: 'request', action: 'release' },
  { kind: 'request', action: 'reset' },
  { kind: 'prefetch', action: 'hold' },
  { kind: 'prefetch', action: 'release' },
  { kind: 'prefetch', action: 'reset' },
])('drops a $kind cancelled by $action during a session lookup', async ({ kind, action }) => {
  const { fetch } = pendingProvider();
  const session = sessionStorage();
  vi.stubGlobal('chrome', { storage: { session } });
  const read = session.get.getMockImplementation()!;
  let resume!: () => void;
  const blocked = new Promise<void>((resolve) => {
    resume = resolve;
  });
  session.get.mockImplementationOnce(async (keys) => {
    await blocked;
    return read(keys);
  });
  const queue = new TranslationQueue();
  const pending =
    kind === 'request'
      ? queue.request('tab', settings, 'Old').catch(() => null)
      : queue.prefetch('tab', settings, packedCues(['Old']));
  await flush();
  expect(session.get).toHaveBeenCalled();
  if (action === 'hold') queue.hold('tab', 20);
  else if (action === 'release') queue.release(['tab']);
  else queue.reset();
  resume();
  await expect(pending).resolves.toEqual(kind === 'request' ? null : [null]);
  expect(fetch).not.toHaveBeenCalled();
});

it('keeps a caption paused when the session lookup finishes, then sends it on resume', async () => {
  const { batches, reply } = pendingProvider();
  const queue = new TranslationQueue();
  const pending = queue.request('tab', settings, 'Paused');
  queue.pause('tab');
  await flush();
  expect(batches()).toEqual([]);
  queue.resume('tab');
  expect(batches()).toEqual([['Paused']]);
  reply(0);
  await expect(pending).resolves.toBe('Paused 译文');
});

it('ignores a stale session lookup after a newer prefetch window arrives', async () => {
  const { batches, reply } = pendingProvider();
  const session = sessionStorage();
  vi.stubGlobal('chrome', { storage: { session } });
  const read = session.get.getMockImplementation()!;
  let resume!: () => void;
  const blocked = new Promise<void>((resolve) => {
    resume = resolve;
  });
  session.get.mockImplementationOnce(async (keys) => {
    await blocked;
    return read(keys);
  });
  const queue = new TranslationQueue();
  const old = queue.prefetch('tab', settings, packedCues(['Old']));
  await flush();
  const current = queue.prefetch('tab', settings, packedCues(['Current']));
  await flush();
  expect(batches()).toEqual([['Current']]);
  resume();
  await expect(old).resolves.toEqual([null]);
  reply(0);
  await expect(current).resolves.toEqual(['Current 译文']);
  expect(batches()).toEqual([['Current']]);
});

it('applies the session cache limit separately to each provider', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) =>
      url.startsWith('https://edge.microsoft.com')
        ? Response.json([{ translations: [{ text: '微软译文', to: 'zh-Hans' }] }])
        : providerReply(requestedTexts(init), (text) => `${text} 译文`),
    ),
  );
  const microsoft: CaptionTranslationSettings = { ...settings, provider: 'microsoft' };
  const queue = new TranslationQueue(new TranslationStore(1));
  await expect(queue.request('tab', settings, 'First')).resolves.toBe('First 译文');
  await expect(queue.request('tab', microsoft, 'Microsoft')).resolves.toBe('微软译文');
  await expect(queue.request('tab', settings, 'Second')).resolves.toBe('Second 译文');
  await expect(queue.lookup(settings, 'First')).resolves.toBeNull();
  await expect(queue.lookup(microsoft, 'Microsoft')).resolves.toBe('微软译文');
  await expect(queue.lookup(settings, 'Second')).resolves.toBe('Second 译文');
});

it('removes temporary session translations when their window leaves and fetches them again', async () => {
  const fetch = vi
    .fn()
    .mockImplementation(async () =>
      Response.json([{ translations: [{ text: '临时译文', to: 'zh-Hans' }] }]),
    );
  vi.stubGlobal('fetch', fetch);
  const session = sessionStorage();
  vi.stubGlobal('chrome', { storage: { session } });
  const microsoft: CaptionTranslationSettings = { ...settings, provider: 'microsoft' };
  const queue = new TranslationQueue();
  await expect(
    queue.prefetch('tab', microsoft, packedCues(['First']), 0, 1, { fallback: settings }),
  ).resolves.toEqual(['临时译文']);
  expect([...session.stored.values()]).toContain('临时译文');
  queue.hold('tab', 20);
  await flush();
  expect([...session.stored.values()]).not.toContain('临时译文');
  await expect(queue.request('tab', microsoft, 'First', { fallback: settings })).resolves.toBe(
    '临时译文',
  );
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('uses a translation completed by another consumer while a session lookup was pending', async () => {
  const fetch = vi.fn(async (_url: string, init: RequestInit) =>
    providerReply(requestedTexts(init), () => '共享译文'),
  );
  vi.stubGlobal('fetch', fetch);
  const session = sessionStorage();
  vi.stubGlobal('chrome', { storage: { session } });
  let resume!: () => void;
  const blocked = new Promise<void>((resolve) => {
    resume = resolve;
  });
  session.get.mockImplementationOnce(async () => {
    await blocked;
    return {};
  });
  const queue = new TranslationQueue();
  const pending = queue.prefetch('first-tab', settings, packedCues(['Shared']));
  await flush();
  await expect(queue.request('second-tab', settings, 'Shared')).resolves.toBe('共享译文');
  resume();
  await expect(pending).resolves.toEqual(['共享译文']);
  expect(fetch).toHaveBeenCalledTimes(1);
});

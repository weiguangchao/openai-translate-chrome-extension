import { afterEach, expect, it, vi } from 'vitest';
import { TranslationQueue } from '../src/extension/queue';
import { DEFAULT_SETTINGS } from '../src/shared/settings';
import { providerReply, requestedTexts } from './fixtures/provider';

vi.mock('../src/shared/rate-limiter', () => ({
  RateLimiter: class {
    acquire() {
      return Promise.resolve();
    }
  },
}));

afterEach(() => vi.unstubAllGlobals());
const flush = () => new Promise((resolve) => setTimeout(resolve));

it('limits concurrency, replaces an obsolete queued cue, and caches completed translations', async () => {
  const responses: ((value: Response) => void)[] = [];
  const fetch = vi.fn(() => new Promise<Response>((resolve) => responses.push(resolve)));
  vi.stubGlobal('fetch', fetch);
  const queue = new TranslationQueue();
  const settings = {
    ...structuredClone(DEFAULT_SETTINGS),
    apiKey: 'test-key',
    model: 'test-model',
  };
  const first = queue.request('tab-1', settings, 'First');
  const second = queue.request('tab-2', settings, 'Second');
  const old = queue.request('tab-1', settings, 'Expired').catch((error) => error.message);
  const latest = queue.request('tab-1', settings, 'Current');
  await flush();
  expect(fetch).toHaveBeenCalledTimes(2);
  await expect(old).resolves.toBe('字幕已更新。');
  responses[0](Response.json({ choices: [{ message: { content: '第一句' } }] }));
  await first;
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
  expect(
    JSON.parse((fetch.mock.calls[2] as unknown as [string, RequestInit])[1].body as string)
      .messages[1].content,
  ).toContain('Current');
  responses[1](Response.json({ choices: [{ message: { content: '第二句' } }] }));
  responses[2](Response.json({ choices: [{ message: { content: '当前字幕' } }] }));
  await expect(second).resolves.toBe('第二句');
  await expect(latest).resolves.toBe('当前字幕');
  await expect(queue.request('tab-3', settings, 'Current')).resolves.toBe('当前字幕');
  expect(fetch).toHaveBeenCalledTimes(3);
});

it('backs off after a rate limit so subsequent cues do not repeatedly bill or hit the provider', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('', { status: 429 }));
  vi.stubGlobal('fetch', fetch);
  const queue = new TranslationQueue();
  const settings = {
    ...structuredClone(DEFAULT_SETTINGS),
    apiKey: 'test-key',
    model: 'test-model',
  };
  await expect(queue.request('tab', settings, 'First')).rejects.toThrow('请求过于频繁');
  await expect(queue.request('tab', settings, 'Second')).rejects.toThrow('稍后将自动重试');
  expect(fetch).toHaveBeenCalledTimes(1);
});

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
  return { fetch, requests };
}
const settings = { ...DEFAULT_SETTINGS, apiKey: 'test-key', model: 'test-model' };

it('keeps ten cues translated ahead with five-cue requests and sends later cues as full batches', async () => {
  const { requests } = pendingProvider();
  const queue = new TranslationQueue();
  const cues = Array.from({ length: 20 }, (_, index) => `Cue ${index + 1}`);
  const batches = () => requests.map((request) => request.texts);
  const reply = (index: number) =>
    requests[index].resolve(providerReply(requests[index].texts, (text) => `${text} 译文`));
  queue.prefetch('tab', settings, cues.slice(0, 15));
  await flush();
  expect(batches()).toEqual([cues.slice(0, 5), cues.slice(5, 10)]);
  reply(0);
  await flush();
  expect(batches()).toEqual([cues.slice(0, 5), cues.slice(5, 10), cues.slice(10, 15)]);
  reply(1);
  reply(2);
  for (let start = 1; start < 5; start++) {
    queue.prefetch('tab', settings, cues.slice(start, start + 15));
    await flush();
    expect(batches()).toHaveLength(3);
  }
  queue.prefetch('tab', settings, cues.slice(5, 20));
  await flush();
  expect(batches()[3]).toEqual(cues.slice(15, 20));
  await expect(queue.request('tab', settings, 'Cue 15')).resolves.toBe('Cue 15 译文');
});

it('sends a partial batch once its first cue comes within ten cues, as at the end of a video', async () => {
  const { requests } = pendingProvider();
  const queue = new TranslationQueue();
  const cues = Array.from({ length: 12 }, (_, index) => `Cue ${index + 1}`);
  queue.prefetch('tab', settings, cues);
  await flush();
  for (const request of requests)
    request.resolve(providerReply(request.texts, (text) => `${text} 译文`));
  await flush();
  expect(requests.map((request) => request.texts)).toEqual([cues.slice(0, 5), cues.slice(5, 10)]);
  queue.prefetch('tab', settings, cues.slice(1));
  await flush();
  expect(requests.map((request) => request.texts)[2]).toEqual(['Cue 11', 'Cue 12']);
});

it('retries each cue on its own when the batch reply cannot be matched to the cues', async () => {
  const { fetch, requests } = pendingProvider();
  const queue = new TranslationQueue();
  queue.prefetch('tab', settings, ['First', 'Second']);
  const first = queue.request('tab', settings, 'First');
  await flush();
  requests[0].resolve(Response.json({ choices: [{ message: { content: '第一句\n第二句' } }] }));
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
  expect(requests.slice(1).map((request) => request.texts)).toEqual([['First'], ['Second']]);
  requests[1].resolve(providerReply(['First'], () => '第一句'));
  await expect(first).resolves.toBe('第一句');
});

it('keeps a batch running while any of its cues is still needed and cancels it once none are', async () => {
  const { fetch, requests } = pendingProvider();
  const queue = new TranslationQueue();
  queue.prefetch('tab', settings, ['Shared cue', 'Next cue']);
  queue.prefetch('other-tab', settings, ['Shared cue']);
  const visible = queue.request('other-tab', settings, 'Shared cue');
  const dropped = queue.request('tab', settings, 'Next cue').catch((error) => error.message);
  queue.prefetch('tab', settings, []);
  await expect(dropped).resolves.toBe('字幕已更新。');
  await flush();
  expect(requests[0].signal.aborted).toBe(false);
  requests[0].resolve(
    providerReply(requests[0].texts, (text) => (text === 'Shared cue' ? '共享字幕' : '下一句')),
  );
  await expect(visible).resolves.toBe('共享字幕');
  await expect(queue.request('tab-3', settings, 'Next cue')).resolves.toBe('下一句');
  expect(fetch).toHaveBeenCalledTimes(1);
  queue.prefetch('tab', settings, ['A', 'B']);
  queue.prefetch('tab', settings, ['B', 'C']);
  await flush();
  expect(requests.map((request) => request.texts).slice(1)).toEqual([['A', 'B'], ['C']]);
  expect(requests[1].signal.aborted).toBe(false);
  queue.prefetch('tab', settings, []);
  expect(requests[1].signal.aborted).toBe(true);
  expect(requests[2].signal.aborted).toBe(true);
});

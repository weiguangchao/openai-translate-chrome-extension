import { afterEach, expect, it, vi } from 'vitest';
import { TranslationQueue } from '../src/extension/queue';
import { DEFAULT_SETTINGS } from '../src/shared/settings';
import { providerReply, requestedTexts } from './fixtures/provider';

afterEach(() => vi.unstubAllGlobals());
const flush = () => new Promise((resolve) => setTimeout(resolve));

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

it('sends every cue right away, shares in-flight work, and caches completed translations', async () => {
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

it('sends each new block of ten cues as one request so two blocks stay translated ahead', async () => {
  const { batches, reply } = pendingProvider();
  const queue = new TranslationQueue();
  const cues = Array.from({ length: 40 }, (_, index) => `Cue ${index + 1}`);
  const block = (index: number) => cues.slice(index * 10, index * 10 + 10);
  queue.prefetch('tab', settings, cues.slice(0, 30));
  expect(batches()).toEqual([block(0), block(1), block(2)]);
  [0, 1, 2].forEach(reply);
  await flush();
  for (let start = 1; start < 10; start++) {
    queue.prefetch('tab', settings, cues.slice(start, 30));
    expect(batches()).toHaveLength(3);
  }
  queue.prefetch('tab', settings, cues.slice(10, 40));
  expect(batches()).toEqual([block(0), block(1), block(2), block(3)]);
  await expect(queue.request('tab', settings, 'Cue 30')).resolves.toBe('Cue 30 译文');
});

it('starts from the current cue mid-block and sends a short final batch at the end of a video', async () => {
  const { batches, reply } = pendingProvider();
  const queue = new TranslationQueue();
  const cues = Array.from({ length: 33 }, (_, index) => `Cue ${index + 1}`);
  queue.prefetch('tab', settings, cues.slice(7, 30));
  expect(batches()).toEqual([cues.slice(7, 17), cues.slice(17, 27), cues.slice(27, 30)]);
  [0, 1, 2].forEach(reply);
  await flush();
  queue.prefetch('tab', settings, cues.slice(10, 33));
  expect(batches()[3]).toEqual(cues.slice(30, 33));
});

it('retries each cue on its own when the batch reply cannot be matched to the cues', async () => {
  const { fetch, requests, batches } = pendingProvider();
  const queue = new TranslationQueue();
  queue.prefetch('tab', settings, ['First', 'Second']);
  const first = queue.request('tab', settings, 'First');
  requests[0].resolve(Response.json({ choices: [{ message: { content: '第一句\n第二句' } }] }));
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
  expect(batches().slice(1)).toEqual([['First'], ['Second']]);
  requests[1].resolve(providerReply(['First'], () => '第一句'));
  await expect(first).resolves.toBe('第一句');
});

it('keeps a batch running while any of its cues is still needed and cancels it once none are', async () => {
  const { fetch, requests, batches } = pendingProvider();
  const queue = new TranslationQueue();
  queue.prefetch('tab', settings, ['Shared cue', 'Next cue']);
  queue.prefetch('other-tab', settings, ['Shared cue']);
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
  queue.prefetch('tab', settings, ['A', 'B']);
  queue.prefetch('tab', settings, ['B', 'C']);
  expect(batches().slice(1)).toEqual([['A', 'B'], ['C']]);
  expect(requests[1].signal.aborted).toBe(false);
  queue.prefetch('tab', settings, []);
  expect(requests[1].signal.aborted).toBe(true);
  expect(requests[2].signal.aborted).toBe(true);
});

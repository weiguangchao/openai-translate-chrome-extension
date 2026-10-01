import { afterEach, expect, it, vi } from 'vitest';
import { TranslationQueue } from '../src/extension/queue';
import { DEFAULT_SETTINGS } from '../src/shared/settings';

afterEach(() => vi.unstubAllGlobals());

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

it('shares prefetched work across players and keeps it alive when only one player seeks', async () => {
  const responses: ((value: Response) => void)[] = [];
  const signals: AbortSignal[] = [];
  const fetch = vi.fn(
    (_url: string, init: RequestInit) =>
      new Promise<Response>((resolve) => {
        signals.push(init.signal!);
        responses.push(resolve);
      }),
  );
  vi.stubGlobal('fetch', fetch);
  const queue = new TranslationQueue();
  const settings = { ...DEFAULT_SETTINGS, apiKey: 'test-key', model: 'test-model' };
  queue.prefetch('tab-1', settings, ['Shared cue', 'Next cue']);
  queue.prefetch('tab-2', settings, ['Shared cue']);
  const visible = queue.request('tab-2', settings, 'Shared cue');
  expect(fetch).toHaveBeenCalledTimes(2);
  queue.prefetch('tab-1', settings, []);
  expect(signals[0].aborted).toBe(false);
  expect(signals[1].aborted).toBe(true);
  responses[0](Response.json({ choices: [{ message: { content: '共享字幕' } }] }));
  await expect(visible).resolves.toBe('共享字幕');
  await expect(queue.request('tab-3', settings, 'Shared cue')).resolves.toBe('共享字幕');
  expect(fetch).toHaveBeenCalledTimes(2);
  responses[1](Response.json({ choices: [{ message: { content: '已取消的字幕' } }] }));
});

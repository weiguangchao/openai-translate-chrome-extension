import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RateLimiter } from '../src/shared/rate-limiter';
import { DEFAULT_SETTINGS } from '../src/shared/settings';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

it('starts at most three requests in any one-second window, first in first out', async () => {
  const limiter = new RateLimiter(3, 1000);
  const started: string[] = [];
  for (const name of ['a', 'b', 'c', 'd', 'e', 'f', 'g'])
    void limiter.acquire().then(() => started.push(name));
  await vi.advanceTimersByTimeAsync(0);
  expect(started).toEqual(['a', 'b', 'c']);
  await vi.advanceTimersByTimeAsync(999);
  expect(started).toEqual(['a', 'b', 'c']);
  await vi.advanceTimersByTimeAsync(1);
  expect(started).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  await vi.advanceTimersByTimeAsync(1000);
  expect(started).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
});

it('keeps the window sliding instead of resetting it on whole seconds', async () => {
  const limiter = new RateLimiter(3, 1000);
  const started: number[] = [];
  const start = () => void limiter.acquire().then(() => started.push(performance.now()));
  start();
  await vi.advanceTimersByTimeAsync(400);
  start();
  start();
  start();
  start();
  await vi.advanceTimersByTimeAsync(2000);
  const origin = started[0];
  expect(started.map((time) => time - origin)).toEqual([0, 400, 400, 1000, 1400]);
});

it('drops a request aborted while waiting without spending a slot on it', async () => {
  const limiter = new RateLimiter(3, 1000);
  const started: string[] = [];
  for (const name of ['a', 'b', 'c']) void limiter.acquire().then(() => started.push(name));
  const controller = new AbortController();
  const aborted = limiter.acquire(controller.signal).catch((error: Error) => error.name);
  for (const name of ['e', 'f', 'g']) void limiter.acquire().then(() => started.push(name));
  controller.abort();
  await expect(aborted).resolves.toBe('AbortError');
  await vi.advanceTimersByTimeAsync(1000);
  expect(started).toEqual(['a', 'b', 'c', 'e', 'f', 'g']);
  const late = new AbortController();
  late.abort();
  await expect(limiter.acquire(late.signal)).rejects.toThrow();
});

it('queues every provider request, including model lookups, in call order', async () => {
  const { fetchModels, translate } = await import('../src/shared/api');
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push(init.body ? JSON.parse(init.body as string).messages[1].content : url);
      return init.body
        ? Response.json({ choices: [{ message: { content: '译文' } }] })
        : Response.json({ data: [{ id: 'model' }] });
    }),
  );
  const settings = { ...DEFAULT_SETTINGS, apiKey: 'key', model: 'model' };
  const results = Promise.all([
    translate(settings, 'One'),
    translate(settings, 'Two'),
    fetchModels(settings),
    translate(settings, 'Three'),
    translate(settings, 'Four'),
  ]);
  await vi.advanceTimersByTimeAsync(0);
  expect(calls).toEqual(['One', 'Two', 'https://api.openai.com/v1/models']);
  await vi.advanceTimersByTimeAsync(999);
  expect(calls).toHaveLength(3);
  await vi.advanceTimersByTimeAsync(1);
  expect(calls).toEqual(['One', 'Two', 'https://api.openai.com/v1/models', 'Three', 'Four']);
  await expect(results).resolves.toHaveLength(5);
});

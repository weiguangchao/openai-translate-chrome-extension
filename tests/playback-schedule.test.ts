import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PlaybackGate, leadSeconds, seekSettleMs } from '../src/core/playback';
import { captionWindow, timedCaptions } from '../src/core/timeline';
import {
  prefetchBatchCount,
  prefetchSentenceCount,
  translationBatchLimit,
} from '../src/shared/limits';
import { providerSendWindowMs, translationSendsPerSecond } from '../src/shared/provider/transport';
import { DEFAULT_SETTINGS } from '../src/shared/settings';
import { prefetchItems, providerReply, requestedTexts } from './fixtures/provider';

const settings = { ...DEFAULT_SETTINGS, apiKey: 'test-key', model: 'test-model' };
let TranslationQueue: typeof import('../src/extension/queue').TranslationQueue;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  ({ TranslationQueue } = await import('../src/extension/queue'));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function cues(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    startTime: index * 10,
    endTime: index * 10 + 8,
    text: `Cue ${index + 1}`,
  }));
}

function textsFrom(
  list: readonly { startTime: number; endTime: number; text: string }[],
  time: number,
) {
  const first = list.findIndex((cue) => cue.endTime > time);
  if (first < 0) return [];
  return list.slice(first, Math.min(list.length, first + prefetchSentenceCount));
}

it('packs each anchor into full batches and keeps a short batch at the end', () => {
  const list = cues(30);
  const captions = timedCaptions(list);
  for (const time of [0, 41, 95, 105, 165, 205]) {
    const expected = textsFrom(list, time);
    const items = captionWindow(captions, time).items;
    expect(items.map((item) => item.text)).toEqual(expected.map((cue) => cue.text));
    expect(items.map((item) => item.batch)).toEqual(
      expected.map((_, offset) => Math.floor(offset / translationBatchLimit)),
    );
    expect(items.map((item) => item.segment)).toEqual(
      expected.map((cue) => Math.floor(list.indexOf(cue) / translationBatchLimit)),
    );
  }
  expect(captionWindow(captions, 0).items).toHaveLength(prefetchSentenceCount);
  expect(new Set(captionWindow(captions, 0).items.map((item) => item.batch)).size).toBe(
    prefetchBatchCount,
  );
  expect(captionWindow(captions, 9999)).toEqual({ current: '', items: [] });
  const tail = textsFrom(list, 250);
  expect(tail.length).toBeGreaterThan(0);
  expect(tail.length).toBeLessThan(prefetchSentenceCount);
  expect(tail.length % translationBatchLimit).not.toBe(0);
});

it('counts a long sentence as one caption when it numbers segments', () => {
  const long = ['a', 'b', 'c'].map((letter) => letter.repeat(60)).join(', ');
  const ordinary = translationBatchLimit * 2;
  const list = [
    ...Array.from({ length: ordinary }, (_, index) => ({
      startTime: index * 4,
      endTime: index * 4 + 3,
      text: `Cue ${index + 1}.`,
    })),
    { startTime: ordinary * 4, endTime: ordinary * 4 + 12, text: long },
    ...Array.from({ length: translationBatchLimit - 1 }, (_, index) => ({
      startTime: ordinary * 4 + 12 + index * 3,
      endTime: ordinary * 4 + 15 + index * 3,
      text: `After ${index + 1}.`,
    })),
  ];
  const captions = timedCaptions(list);
  expect(captions.map((caption) => caption.segment)).toEqual(
    captions.map((_, index) => Math.floor(index / translationBatchLimit)),
  );
  expect(captions[ordinary]).toMatchObject({ text: long, needsSplit: true });
  const items = captionWindow(captions, 0).items;
  expect(items.map((item) => item.segment)).toEqual(
    items.map((_, index) => Math.floor(index / translationBatchLimit)),
  );
  expect(items.map((item) => item.batch)).toEqual(
    items.map((_, index) => Math.floor(index / translationBatchLimit)),
  );
});

it('leads by a fixed media interval and releases a seek on its own clock', async () => {
  const hooks = { hold: vi.fn(), changed: vi.fn() };
  const gate = new PlaybackGate(hooks);
  expect(gate.lead(2, false)).toBe(2);
  expect(gate.lead(2, true)).toBe(2 + leadSeconds);
  expect(gate.lead(3, true)).toBe(2 + leadSeconds);
  gate.restartLead();
  expect(gate.lead(3, true)).toBe(3 + leadSeconds);
  gate.hold();
  expect(gate.settling).toBe(true);
  expect(hooks.hold).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(seekSettleMs - 1);
  expect(gate.settling).toBe(true);
  await vi.advanceTimersByTimeAsync(1);
  expect(gate.settling).toBe(false);
  expect(hooks.changed).toHaveBeenCalledOnce();
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
  const batches = () => requests.map((request) => request.texts);
  const reply = (index: number) =>
    requests[index].resolve(providerReply(requests[index].texts, (text) => `${text} 译文`));
  return { fetch, requests, batches, reply };
}

function block(cues: readonly string[], index: number) {
  return cues.slice(index * translationBatchLimit, (index + 1) * translationBatchLimit);
}

it('reuses a finished batch and drops the batch that leaves the window', async () => {
  const { batches, reply, requests } = pendingProvider();
  const queue = new TranslationQueue();
  const depth = translationSendsPerSecond;
  const list = Array.from(
    { length: translationBatchLimit * (depth + 2) },
    (_, index) => `Cue ${index + 1}`,
  );
  queue.prefetch('tab', settings, prefetchItems(list.slice(0, translationBatchLimit * depth)));
  expect(batches()).toEqual(Array.from({ length: depth }, (_, index) => block(list, index)));
  for (let start = 1; start < translationBatchLimit; start++) {
    queue.prefetch(
      'tab',
      settings,
      prefetchItems(list.slice(start, translationBatchLimit * depth)),
    );
    expect(batches()).toHaveLength(depth);
  }
  queue.prefetch(
    'tab',
    settings,
    prefetchItems(list.slice(translationBatchLimit, translationBatchLimit * (depth + 1))),
  );
  expect(requests[0].signal.aborted).toBe(true);
  expect(batches()).toEqual(Array.from({ length: depth + 1 }, (_, index) => block(list, index)));
  await vi.advanceTimersByTimeAsync(providerSendWindowMs);
  expect(batches()).toHaveLength(depth + 1);
  for (let index = 1; index <= depth; index++) reply(index);
  await vi.advanceTimersByTimeAsync(0);
  await expect(queue.prefetch('tab', settings, prefetchItems(block(list, depth)))).resolves.toEqual(
    block(list, depth).map((cue) => `${cue} 译文`),
  );
  expect(batches()).toHaveLength(depth + 1);
});

it('sends the opening window up to the send rate, then the rest, even when segments differ', async () => {
  const { fetch, requests, batches } = pendingProvider();
  const queue = new TranslationQueue();
  const list = Array.from(
    { length: translationBatchLimit * (prefetchBatchCount + 1) },
    (_, index) => `Cue ${index + 1}`,
  );
  const size = translationBatchLimit;
  const pack = (from: number, count: number) =>
    list.slice(from, from + count).map((text, offset) => ({
      text,
      segment: Math.floor((from + offset + size - 1) / size),
      needsSplit: false,
      batch: Math.floor((from + offset) / size),
    }));
  queue.prefetch('tab', settings, pack(0, size * prefetchBatchCount));
  expect(batches()).toEqual(
    Array.from({ length: translationSendsPerSecond }, (_, index) => block(list, index)),
  );
  expect(fetch).toHaveBeenCalledTimes(translationSendsPerSecond);
  await vi.advanceTimersByTimeAsync(providerSendWindowMs);
  expect(batches()).toEqual(
    Array.from({ length: prefetchBatchCount }, (_, index) => block(list, index)),
  );
  queue.prefetch('tab', settings, pack(size, size * prefetchBatchCount));
  expect(requests[0].signal.aborted).toBe(true);
  expect(requests.slice(1, prefetchBatchCount).every((request) => !request.signal.aborted)).toBe(
    true,
  );
  await vi.advanceTimersByTimeAsync(providerSendWindowMs);
  expect(batches().at(-1)).toEqual(list.slice(size * prefetchBatchCount));
});

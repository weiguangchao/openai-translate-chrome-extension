import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mediaIdentity, SourceCache } from '../src/extension/source-cache';
import type { TimedCue } from '../src/extension/timeline';

const cues = [{ startTime: 1, endTime: 3, text: 'Source sentence.' }];
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const flush = () => vi.advanceTimersByTimeAsync(0);

it('keeps one completed source across reader restarts and credential changes, until the page is destroyed', async () => {
  const cache = new SourceCache(vi.fn());
  const read = vi.fn().mockResolvedValue(cues);
  cache.select('video', 'track', 'en');
  cache.load('signed-url-1', read);
  await flush();
  cache.stop();
  cache.select('video', 'track', 'en');
  cache.load('signed-url-2', read);
  await flush();
  expect(cache.state.source).toBe(cues);
  expect(read).toHaveBeenCalledTimes(1);
  cache.clear();
  cache.select('video', 'track', 'en');
  cache.load('signed-url-2', read);
  await flush();
  expect(read).toHaveBeenCalledTimes(2);
});

it.each([
  ['other-video', 'track', 'en'],
  ['video', 'other-track', 'en'],
  ['video', 'track', 'es'],
])(
  'replaces the source and ignores late downloads when identity changes to %s/%s/%s',
  async (video, track, language) => {
    const cache = new SourceCache(vi.fn());
    let finish!: (value: TimedCue[]) => void;
    let oldSignal!: AbortSignal;
    cache.select('video', 'track', 'en');
    cache.load('old', (signal) => {
      oldSignal = signal;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    cache.select(video, track, language);
    expect(oldSignal.aborted).toBe(true);
    expect(cache.state.source).toBeNull();
    const next = [{ ...cues[0], text: 'New source.' }];
    cache.load('new', async () => next);
    await flush();
    finish(cues);
    await flush();
    expect(cache.state.source).toBe(next);
  },
);

it('retries failures with fresh credentials immediately, without waiting for the old backoff', async () => {
  const cache = new SourceCache(vi.fn());
  const read = vi.fn().mockRejectedValueOnce(new Error('Expired')).mockResolvedValue(cues);
  cache.select('video', 'track', 'en');
  cache.load('expired', read);
  await flush();
  cache.load('expired', read);
  expect(read).toHaveBeenCalledTimes(1);
  cache.load('fresh', read);
  await flush();
  expect(read).toHaveBeenCalledTimes(2);
  expect(cache.state.source).toBe(cues);
});

it('cancels a stopped download without caching a late result and allows the reader to resume', async () => {
  const cache = new SourceCache(vi.fn());
  let finish!: (value: TimedCue[]) => void;
  let signal!: AbortSignal;
  cache.select('video', 'track', 'en');
  cache.load('resource', (active) => {
    signal = active;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  cache.stop();
  expect(signal.aborted).toBe(true);
  finish(cues);
  await flush();
  expect(cache.state.source).toBeNull();
  cache.load('resource', async () => cues);
  await flush();
  expect(cache.state.source).toBe(cues);
});

it('ignores signed media credentials while preserving parameters that identify content', () => {
  expect(
    mediaIdentity('https://cdn.h264.io/manifest.mpd?asset=one&token=old&Signature=old&Expires=1'),
  ).toBe(
    mediaIdentity('https://cdn.h264.io/manifest.mpd?Expires=2&token=new&asset=one&Signature=new'),
  );
  expect(mediaIdentity('https://cdn.h264.io/manifest.mpd?asset=one')).not.toBe(
    mediaIdentity('https://cdn.h264.io/manifest.mpd?asset=two'),
  );
});

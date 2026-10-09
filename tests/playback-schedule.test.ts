import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PlaybackGate, seekJumpSeconds, seekSettleMs } from '../src/core/playback';
import { captionAt, captionWindow, playbackCues, timedCaptions } from '../src/core/timeline';
import {
  behindGraceSeconds,
  maxInFlightRequests,
  planBufferSeconds,
  planLookaheadCues,
  planLookaheadSeconds,
  translationBatchLimit,
} from '../src/shared/limits';
import { planPlayback } from '../src/shared/playback-plan';
import { providerSendWindowMs } from '../src/shared/provider/transport';
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

it('snapshots cues that can still reach the playhead within the next minute', () => {
  const list = cues(30);
  const captions = timedCaptions(list);
  for (const time of [0, 41, 95, 105, 165, 205]) {
    const expected = list
      .filter(
        (cue) =>
          cue.endTime > time - behindGraceSeconds && cue.startTime < time + planLookaheadSeconds,
      )
      .slice(0, planLookaheadCues);
    const items = captionWindow(captions, time).items;
    expect(items.map((item) => item.text)).toEqual(expected.map((cue) => cue.text));
    expect(
      items.every((item) => item.end > item.start && typeof item.needsSplit === 'boolean'),
    ).toBe(true);
  }
  expect(captionWindow(captions, 0).items.length).toBeLessThanOrEqual(planLookaheadCues);
  expect(captionWindow(captions, 9999)).toEqual({ current: '', items: [] });
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
  expect(captionWindow(captions, 0).items.find((item) => item.text === long)?.needsSplit).toBe(
    true,
  );
});

it('keeps overlapping snapshot intervals aligned with the text actually shown', () => {
  const captions = timedCaptions([
    { startTime: 0, endTime: 10, text: 'First' },
    { startTime: 5, endTime: 15, text: 'Second' },
  ]);
  const snapshot = playbackCues(captions, 0);
  for (const time of [2, 7, 12]) {
    expect(
      snapshot.filter((cue) => cue.start <= time && time < cue.end).map((cue) => cue.text),
    ).toEqual([captionAt(captions, time)]);
  }
});

it('keeps a silent gap between repeated text in a snapshot', () => {
  const captions = timedCaptions([
    { startTime: 0, endTime: 1, text: 'Again' },
    { startTime: 4, endTime: 5, text: 'Again' },
  ]);
  expect(playbackCues(captions, 0)).toEqual([
    { text: 'Again', start: 0, end: 1, needsSplit: false },
    { text: 'Again', start: 4, end: 5, needsSplit: false },
  ]);
});

it('holds a jump and releases it only after the playhead stays still', async () => {
  const hooks = { hold: vi.fn(), changed: vi.fn() };
  const gate = new PlaybackGate(hooks);
  gate.observe(2);
  gate.observe(2 + seekJumpSeconds);
  expect(hooks.hold).not.toHaveBeenCalled();
  gate.observe(2 + seekJumpSeconds * 2 + 0.01);
  expect(gate.settling).toBe(true);
  expect(hooks.hold).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(seekSettleMs - 1);
  expect(gate.settling).toBe(true);
  gate.hold();
  await vi.advanceTimersByTimeAsync(seekSettleMs - 1);
  expect(gate.settling).toBe(true);
  expect(hooks.changed).not.toHaveBeenCalled();
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

it('keeps sent packs through snapshot refreshes and cancels one only after its cues leave', async () => {
  const { batches, reply, requests } = pendingProvider();
  const queue = new TranslationQueue();
  const list = Array.from({ length: 8 }, (_, index) => `Cue ${index + 1}`);
  queue.prefetch('tab', settings, prefetchItems(list));
  expect(batches()).toEqual([['Cue 1'], ['Cue 2', 'Cue 3']]);
  queue.prefetch('tab', settings, prefetchItems(list), 1);
  expect(requests.map((request) => request.signal.aborted)).toEqual([false, false]);
  expect(batches()).toHaveLength(2);
  queue.prefetch('tab', settings, prefetchItems(list.slice(1), 4), 5);
  expect(requests[0].signal.aborted).toBe(true);
  expect(requests[1].signal.aborted).toBe(false);
  reply(1);
  await vi.advanceTimersByTimeAsync(0);
  const again = queue.prefetch('tab', settings, prefetchItems(['Cue 2'], 4), 5);
  await expect(again).resolves.toEqual(['Cue 2 译文']);
  expect(
    batches()
      .flat()
      .filter((text) => text === 'Cue 2'),
  ).toHaveLength(1);
});

it('sends only the packs inside the buffer, even when the old segment numbers differ', async () => {
  const { batches, reply } = pendingProvider();
  const queue = new TranslationQueue();
  const cues = prefetchItems(Array.from({ length: 16 }, (_, index) => `Cue ${index + 1}`));
  const shuffled = cues.map((cue, index) => ({ ...cue, segment: index }));
  const planned = planPlayback({ time: 0, rate: 1, cues }).map((request) =>
    request.cues.map((cue) => cue.text),
  );
  queue.prefetch('tab', settings, shuffled);
  expect(batches()).toEqual(planned.slice(0, maxInFlightRequests));
  for (let index = 0; index < planned.length; index++) {
    reply(index);
    await vi.advanceTimersByTimeAsync(providerSendWindowMs);
  }
  expect(batches()).toEqual(planned);
  expect(cues.find((cue) => cue.text === 'Cue 10')!.start).toBeGreaterThanOrEqual(
    planBufferSeconds,
  );
  expect(planned.flat()).not.toContain('Cue 10');
  queue.prefetch('tab', settings, prefetchItems(['Cue 16'], 60), 60);
  expect(batches().at(-1)).toEqual(['Cue 16']);
});

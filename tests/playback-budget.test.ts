import { expect, it } from 'vitest';
import { leadSeconds } from '../src/core/playback';
import { captionWindow, timedCaptions } from '../src/core/timeline';
import {
  prefetchBatchCount,
  prefetchSentenceCount,
  translationBatchLimit,
} from '../src/shared/limits';
import {
  providerSendWindowMs,
  providerTimeoutMs,
  translationSendsPerSecond,
} from '../src/shared/provider/transport';

const sentenceSeconds = 4;
const slowSeconds = 48.19;

function coverage() {
  const list = Array.from(
    { length: prefetchSentenceCount + translationBatchLimit },
    (_, index) => ({
      startTime: index * sentenceSeconds,
      endTime: (index + 1) * sentenceSeconds,
      text: `Sentence ${index + 1}`,
    }),
  );
  const items = captionWindow(timedCaptions(list), leadSeconds).items;
  const last = list.find((cue) => cue.text === items.at(-1)?.text);
  if (!last) throw new Error('Opening window is empty');
  const waves = Math.ceil(prefetchBatchCount / translationSendsPerSecond);
  const dispatchSeconds = (waves - 1) * (providerSendWindowMs / 1000);
  return {
    items,
    coveredUntil: last.endTime,
    mediaAt(rate: number, latencySeconds: number) {
      return (dispatchSeconds + latencySeconds) * rate;
    },
  };
}

it('keeps a 3 second batch inside the window at 1x and 1.5x, and lets a 48 second batch fall behind at 1.5x', () => {
  const opening = coverage();
  expect(opening.items).toHaveLength(prefetchSentenceCount);
  expect(opening.mediaAt(1, 3)).toBeLessThan(opening.coveredUntil);
  expect(opening.mediaAt(1.5, 3)).toBeLessThan(opening.coveredUntil);
  expect(opening.mediaAt(1, slowSeconds)).toBeLessThan(opening.coveredUntil);
  expect(opening.mediaAt(1.5, slowSeconds)).toBeGreaterThan(opening.coveredUntil);
  expect(slowSeconds * 1000).toBeLessThan(providerTimeoutMs);
});

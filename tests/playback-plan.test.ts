import { expect, it } from 'vitest';
import {
  planPlayback,
  slackSeconds,
  slowLatency,
  typicalLatency,
} from '../src/shared/playback-plan';
import {
  latencyDefaultMs,
  latencyMaxMs,
  latencyMinMs,
  latencySampleLimit,
  minShowSeconds,
  packSpanSeconds,
  planBufferSeconds,
  planSentenceCap,
  translationBatchLimit,
} from '../src/shared/limits';

function cues(count: number, gap = 4, from = 0) {
  return Array.from({ length: count }, (_, index) => ({
    text: `Cue ${index + 1}`,
    start: from + index * gap,
    end: from + index * gap + gap,
    needsSplit: false,
  }));
}

const texts = (requests: ReturnType<typeof planPlayback>) =>
  requests.map((request) => request.cues.map((cue) => cue.text));

it('sends the imminent cue alone and packs the rest by speech until the buffer is covered', () => {
  const requests = planPlayback({ time: 0, rate: 1, cues: cues(12) });
  expect(texts(requests)).toEqual([
    ['Cue 1'],
    ['Cue 2', 'Cue 3'],
    ['Cue 4', 'Cue 5'],
    ['Cue 6', 'Cue 7'],
    ['Cue 8', 'Cue 9'],
  ]);
  expect(requests.map((request) => request.atRisk)).toEqual([true, false, false, false, false]);
  expect(slackSeconds(28, 0, 1)).toBeLessThan(planBufferSeconds);
  expect(slackSeconds(36, 0, 1)).toBeGreaterThanOrEqual(planBufferSeconds);
});

it('reaches further into the video at 1.5x because the buffer is measured in wall time', () => {
  const requests = planPlayback({ time: 0, rate: 1.5, cues: cues(12) });
  expect(texts(requests)).toEqual([
    ['Cue 1'],
    ['Cue 2', 'Cue 3'],
    ['Cue 4', 'Cue 5'],
    ['Cue 6', 'Cue 7'],
    ['Cue 8', 'Cue 9'],
    ['Cue 10', 'Cue 11'],
  ]);
  expect(requests[1].atRisk).toBe(true);
});

it('leaves a cue that is about to leave the screen to the visible caption request', () => {
  const requests = planPlayback({
    time: 5,
    rate: 1,
    cues: [
      { text: 'Gone', start: 0, end: 4, needsSplit: false },
      { text: 'Ending', start: 4, end: 5 + minShowSeconds, needsSplit: false },
      { text: 'Next', start: 6.5, end: 10, needsSplit: false },
      { text: 'Later', start: 10, end: 14, needsSplit: false },
    ],
  });
  expect(texts(requests)).toEqual([['Next'], ['Later']]);
});

it('waits for a pack at the end of the snapshot to fill unless its first cue nears the latency tail', () => {
  const tail = cues(2, 2, 20);
  expect(planPlayback({ time: 0, rate: 1, cues: tail })).toEqual([]);
  expect(texts(planPlayback({ time: 5, rate: 1, cues: tail }))).toEqual([['Cue 1', 'Cue 2']]);
  expect(texts(planPlayback({ time: 0, rate: 1, cues: cues(4, 2, 20) }))).toEqual([
    ['Cue 1', 'Cue 2', 'Cue 3', 'Cue 4'],
  ]);
});

it('stretches the buffer to three times the slow tail of recent replies', () => {
  const samples = [...Array(4).fill(15000), ...Array(28).fill(2000)];
  expect(typicalLatency(samples)).toBe(2000);
  expect(slowLatency(samples)).toBe(15000);
  const requests = planPlayback({ time: 0, rate: 1, cues: cues(20), samples });
  expect(requests.at(-1)?.cues[0].start).toBe(44);
  expect(texts(planPlayback({ time: 0, rate: 1, cues: cues(20) })).at(-1)).toEqual([
    'Cue 8',
    'Cue 9',
  ]);
});

it('takes the median of the latest replies and the 90th percentile of all kept ones', () => {
  expect(typicalLatency([])).toBe(latencyDefaultMs);
  expect(slowLatency([])).toBe(2 * latencyDefaultMs);
  expect(typicalLatency([...Array(latencySampleLimit).fill(11000), 3000, 3000, 3000])).toBe(11000);
  expect(typicalLatency([...Array(latencySampleLimit).fill(3000), 48190])).toBe(3000);
  expect(typicalLatency([48190])).toBe(latencyMaxMs);
  expect(typicalLatency([500])).toBe(latencyMinMs);
  expect(slowLatency([...Array(9).fill(3000), 30000])).toBe(3000);
  expect(slowLatency([...Array(8).fill(3000), 30000, 30000])).toBe(30000);
  expect(slowLatency([500])).toBe(latencyMinMs);
});

it('caps each request by the batch limit and pack span, and the plan by the sentence cap', () => {
  const dense = planPlayback({ time: 0, rate: 1, cues: cues(planSentenceCap * 3, 0.1, 5) });
  expect(dense.flatMap((request) => request.cues)).toHaveLength(planSentenceCap);
  expect(dense.every((request) => request.cues.length === translationBatchLimit)).toBe(true);
  const spoken = planPlayback({
    time: 0,
    rate: 1,
    cues: [
      ...cues(3, 3, 5),
      { text: 'Long', start: 14, end: 14 + packSpanSeconds + 2, needsSplit: true },
      ...cues(4, 1, 26).map((cue) => ({ ...cue, text: `After ${cue.text}` })),
    ],
  });
  expect(texts(spoken)).toEqual([
    ['Cue 1', 'Cue 2', 'Cue 3'],
    ['Long'],
    ['After Cue 1', 'After Cue 2', 'After Cue 3', 'After Cue 4'],
  ]);
});

it('does not pack sentences across a long silence', () => {
  const requests = planPlayback({
    time: 0,
    rate: 1,
    cues: [
      { text: 'Before', start: 5, end: 6, needsSplit: false },
      { text: 'Still before', start: 6, end: 7, needsSplit: false },
      { text: 'After the pause', start: 20, end: 21, needsSplit: false },
    ],
  });
  expect(texts(requests)).toEqual([['Before', 'Still before']]);
});

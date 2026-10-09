import { expect, it } from 'vitest';
import { planPlayback, predictLatency, slackSeconds } from '../src/shared/playback-plan';
import {
  latencyMaxMs,
  latencySampleLimit,
  planSentenceCap,
  translationBatchLimit,
} from '../src/shared/limits';

function cues(count: number, gap = 4) {
  return Array.from({ length: count }, (_, index) => ({
    text: `Cue ${index + 1}`,
    start: index * gap,
    end: index * gap + gap,
    needsSplit: false,
  }));
}

it('sends the imminent cue alone and packs only sentences that share its slack', () => {
  const requests = planPlayback({ time: 0, rate: 1, cues: cues(12) });
  expect(requests.map((request) => request.cues.map((cue) => cue.text))).toEqual([
    ['Cue 1'],
    ['Cue 2', 'Cue 3'],
  ]);
  expect(requests[0].atRisk).toBe(true);
  expect(requests[1].atRisk).toBe(false);
  expect(slackSeconds(8, 0, 1)).toBe(8);
});

it('splits packs further at 1.5x because the same cue starts sooner', () => {
  const requests = planPlayback({ time: 0, rate: 1.5, cues: cues(12) });
  expect(requests.map((request) => request.cues.map((cue) => cue.text))).toEqual([
    ['Cue 1'],
    ['Cue 2'],
    ['Cue 3', 'Cue 4'],
  ]);
});

it('uses a measured fast latency to pack four sentences before the horizon', () => {
  const samples = Array.from({ length: 8 }, () => ({ sentences: 4, ms: 1000 }));
  expect(predictLatency(samples, 4)).toBe(2000);
  const near = Array.from({ length: 8 }, (_, index) => ({
    text: `Cue ${index + 1}`,
    start: 2 + index * 0.5,
    end: 2.5 + index * 0.5,
    needsSplit: false,
  }));
  const requests = planPlayback({ time: 0, rate: 1, cues: near, samples });
  expect(requests[0].cues.map((cue) => cue.text)).toEqual(['Cue 1', 'Cue 2', 'Cue 3', 'Cue 4']);
  expect(requests[0].atRisk).toBe(false);
});

it('does not pack a far cue into the sentence that is on screen', () => {
  const requests = planPlayback({
    time: 2,
    rate: 1,
    cues: [
      { text: 'First cue', start: 2, end: 4, needsSplit: false },
      { text: 'Second cue', start: 4, end: 6, needsSplit: false },
      { text: 'Third cue', start: 6, end: 8, needsSplit: false },
      { text: 'After seeking', start: 80, end: 82, needsSplit: false },
    ],
  });
  expect(requests.map((request) => request.cues.map((cue) => cue.text))).toEqual([
    ['First cue'],
    ['Second cue'],
    ['Third cue'],
  ]);
});

it('drops a cue that already ended and keeps the one still on screen', () => {
  const requests = planPlayback({
    time: 5,
    rate: 1,
    cues: [
      { text: 'Gone', start: 0, end: 4, needsSplit: false },
      { text: 'Visible', start: 4, end: 8, needsSplit: false },
      { text: 'Next', start: 8, end: 12, needsSplit: false },
    ],
  });
  expect(requests.flatMap((request) => request.cues.map((cue) => cue.text))).toEqual([
    'Visible',
    'Next',
  ]);
});

it('uses recent samples for the requested size without letting one slow tail dominate', () => {
  const samples = [
    ...Array.from({ length: latencySampleLimit }, () => ({ sentences: 1, ms: 3000 })),
    { sentences: 1, ms: 48190 },
    ...Array.from({ length: latencySampleLimit }, () => ({ sentences: 4, ms: 7000 })),
  ];
  expect(predictLatency(samples, 1)).toBe(3000);
  expect(predictLatency(samples, 4)).toBe(7000);
  expect(predictLatency([{ sentences: 1, ms: 48190 }], 1)).toBe(latencyMaxMs);
  expect(
    predictLatency(
      [
        ...Array.from({ length: latencySampleLimit }, () => ({ sentences: 1, ms: 11000 })),
        ...Array.from({ length: latencySampleLimit }, () => ({ sentences: 1, ms: 3000 })),
      ],
      1,
    ),
  ).toBe(3000);
});

it('enforces both request size and sentence caps through the actual planner', () => {
  const future = cues(planSentenceCap * 3, 0.1).map((cue) => ({
    ...cue,
    start: cue.start + 5,
    end: cue.end + 5,
  }));
  const requests = planPlayback({ time: 0, rate: 1, cues: future });
  expect(requests.flatMap((request) => request.cues)).toHaveLength(planSentenceCap);
  expect(requests.every((request) => request.cues.length <= translationBatchLimit)).toBe(true);
  expect(requests.some((request) => request.cues.length === translationBatchLimit)).toBe(true);
});

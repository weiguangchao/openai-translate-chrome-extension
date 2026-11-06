import { expect, it, vi } from 'vitest';
import { authoredSubtitleCaptions } from '../src/core/sentences';
import { captionAt, playbackCues, timedCaptions } from '../src/core/timeline';
import {
  behindGraceSeconds,
  planLookaheadCues,
  planLookaheadSeconds,
  segmentCaptions,
} from '../src/shared/tuning';

vi.mock('../src/shared/tuning', async (importOriginal) => {
  const limits = await importOriginal<typeof import('../src/shared/tuning')>();
  return { ...limits, segmentCaptions: limits.translationBatchLimit + 1 };
});

it('snapshots cues that can still reach the playhead within the lookahead', () => {
  const time = 100;
  const behind = time - behindGraceSeconds;
  const horizon = time + planLookaheadSeconds;
  const captions = timedCaptions([
    { startTime: behind - 1, endTime: behind, text: 'Ended' },
    { startTime: behind, endTime: time - behindGraceSeconds / 2, text: 'Within grace' },
    { startTime: horizon - 1, endTime: horizon, text: 'Last ahead' },
    { startTime: horizon, endTime: horizon + 1, text: 'Beyond' },
  ]);
  expect(playbackCues(captions, time)).toEqual([
    { text: 'Within grace', start: behind, end: time - behindGraceSeconds / 2 },
    { text: 'Last ahead', start: horizon - 1, end: horizon },
  ]);
  expect(captionAt(captions, horizon + 2)).toBe('');
  expect(playbackCues(captions, horizon + 2)).toEqual([]);
});

it('stops a snapshot at planLookaheadCues', () => {
  const spacing = planLookaheadSeconds / (planLookaheadCues + 1);
  const captions = timedCaptions(
    Array.from({ length: planLookaheadCues + 1 }, (_, index) => ({
      startTime: index * spacing,
      endTime: index * spacing + spacing / 2,
      text: `Cue ${index + 1}`,
    })),
  );
  expect(playbackCues(captions, 0).map((cue) => cue.text)).toEqual(
    Array.from({ length: planLookaheadCues }, (_, index) => `Cue ${index + 1}`),
  );
});

it('numbers segments over the captions a long sentence is cut into', async () => {
  const pieces = ['a', 'b', 'c'].map((letter) => letter.repeat(60));
  const long = `${pieces.join(', ')}.`;
  const ordinary = segmentCaptions * 2;
  const list = [
    ...Array.from({ length: ordinary }, (_, index) => ({
      startTime: index * 4,
      endTime: index * 4 + 3,
      text: `Cue ${index + 1}.`,
    })),
    { startTime: ordinary * 4, endTime: ordinary * 4 + 12, text: long },
    ...Array.from({ length: segmentCaptions - 1 }, (_, index) => ({
      startTime: ordinary * 4 + 12 + index * 3,
      endTime: ordinary * 4 + 15 + index * 3,
      text: `After ${index + 1}.`,
    })),
  ];
  const captions = timedCaptions(await authoredSubtitleCaptions(list, 'en'));
  expect(captions.slice(ordinary, ordinary + 3).map((caption) => caption.text)).toEqual([
    `${pieces[0]},`,
    `${pieces[1]},`,
    `${pieces[2]}.`,
  ]);
  expect(captions.map((caption) => caption.segment)).toEqual(
    captions.map((_, index) => Math.floor(index / segmentCaptions)),
  );
});

it('keeps overlapping snapshot intervals aligned with the text actually shown', () => {
  const captions = timedCaptions([
    { startTime: 2, endTime: 6, text: 'First.' },
    { startTime: 4, endTime: 8, text: 'Second.' },
    { startTime: 8, endTime: 12, text: 'After.' },
  ]);
  expect(playbackCues(captions, 0)).toEqual([
    { text: 'First.', start: 2, end: 4 },
    { text: 'First.\nSecond.', start: 4, end: 6 },
    { text: 'Second.', start: 6, end: 8 },
    { text: 'After.', start: 8, end: 12 },
  ]);
  expect([0, 2, 4, 6, 8, 12].map((time) => captionAt(captions, time))).toEqual([
    '',
    'First.',
    'First.\nSecond.',
    'Second.',
    'After.',
    '',
  ]);
});

it('keeps a silent gap between repeated text in a snapshot', () => {
  const captions = timedCaptions([
    { startTime: 0, endTime: 1, text: 'Again' },
    { startTime: 4, endTime: 5, text: 'Again' },
  ]);
  expect(playbackCues(captions, 0)).toEqual([
    { text: 'Again', start: 0, end: 1 },
    { text: 'Again', start: 4, end: 5 },
  ]);
});

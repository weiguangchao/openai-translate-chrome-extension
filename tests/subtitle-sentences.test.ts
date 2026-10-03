import { expect, it } from 'vitest';
import { authoredSubtitleSentences } from '../src/core/sentences';
import { parseYoutubeCaptions } from '../src/platforms/youtube/captions';
import { captionAt, timedCaptions } from '../src/core/timeline';

it('uses YouTube sentence boundaries and timing for multiline authored subtitles', () => {
  const text = "Oh, thank you.\nI've got to talk to that\nmailman.";
  const cues = authoredSubtitleSentences([{ startTime: 3, endTime: 9, text }]);
  expect(cues.map((cue) => cue.text)).toEqual([
    'Oh, thank you.',
    "I've got to talk to that mailman.",
  ]);
  expect(cues).toEqual(
    parseYoutubeCaptions(
      { events: [{ tStartMs: 3000, dDurationMs: 6000, segs: [{ utf8: text }] }] },
      'authored',
    ),
  );
  expect(captionAt(cues, 3)).toBe('Oh, thank you.');
  expect(captionAt(cues, 6)).toBe("I've got to talk to that mailman.");
  expect(captionAt(cues, 9)).toBe('');
});

it('rejoins fragmented authored sentences and retains source block timings for long captions', () => {
  const first = 'When I first moved to the city I did not know anyone at all,';
  const second = 'and every night I walked along the river wondering why I had come.';
  const cues = authoredSubtitleSentences([
    { startTime: 1, endTime: 5, text: first },
    { startTime: 5.2, endTime: 9, text: second },
  ]);
  expect(cues.map((cue) => cue.text)).toEqual([`${first} ${second}`]);
  const captions = timedCaptions(cues);
  expect(captions.map((caption) => caption.text)).toEqual([first, second]);
  expect(captions[1].startTime).toBe(5.2);
  expect(captionAt(captions, 6)).toBe(second);
});

it('preserves simultaneous speech and repeated dialogue instead of retiming overlapping cues', () => {
  const cues = [
    { startTime: 1, endTime: 4, text: 'Wait.\nPlease.' },
    { startTime: 2, endTime: 3, text: 'No. Stop.' },
    { startTime: 2, endTime: 5, text: 'Wait.\nPlease.' },
    { startTime: 6, endTime: 8, text: 'Later. Goodbye.' },
  ];
  const sentences = authoredSubtitleSentences(cues);
  expect(sentences.slice(0, 3)).toEqual(
    cues.slice(0, 3).map((cue) => ({ ...cue, text: cue.text.replace('\n', ' ') })),
  );
  expect(sentences.slice(3).map((cue) => cue.text)).toEqual(['Later.', 'Goodbye.']);
  expect(captionAt(sentences, 2.5)).toBe('Wait. Please.\nNo. Stop.\nWait. Please.');
});

import { expect, it } from 'vitest';
import { parseYoutubeCaptions } from '../src/platforms/youtube/captions';
import { captionAt, captionWindow, timedCaptions } from '../src/core/timeline';
import { githubCaption, githubCaptionTrack, githubCommaParts } from './fixtures/github-caption';
import {
  needsSubtitleSegmentation,
  splitSubtitleAtCommas,
} from '../src/shared/subtitle-segmentation';

it.each(['asr', 'authored'] as const)(
  'times each comma part of a long sentence from the original %s word timestamps',
  (kind) => {
    const cues = parseYoutubeCaptions(githubCaptionTrack, kind);
    expect(cues.map((cue) => cue.text)).toEqual([githubCaption]);
    const captions = timedCaptions(cues);
    expect(captions.map((caption) => caption.text)).toEqual(githubCommaParts);
    expect([0, 1.49, 1.5, 3, 6.75, 8.25, 2, 11].map((time) => captionAt(captions, time))).toEqual([
      githubCommaParts[0],
      githubCommaParts[0],
      githubCommaParts[1],
      githubCommaParts[1],
      githubCommaParts[1],
      githubCommaParts[1],
      githubCommaParts[1],
      '',
    ]);
  },
);

it('maps normalized whitespace back to the timed source blocks', () => {
  const cues = parseYoutubeCaptions(
    {
      events: [
        {
          tStartMs: 0,
          dDurationMs: 4000,
          segs: [
            {
              utf8: '  Myself, Mitchell the creator of Ghostie, and many other people are realizing\n\n',
            },
          ],
        },
        {
          tStartMs: 4000,
          dDurationMs: 3000,
          segs: [
            { utf8: 'that GitHub might not be the safest place for us to be leaving our code' },
          ],
        },
        {
          tStartMs: 7000,
          dDurationMs: 4000,
          segs: [
            {
              utf8: "now that they're randomly reverting merges and having downtime that is measured in days instead of minutes.",
            },
          ],
        },
      ],
    },
    'authored',
  );
  expect(cues[0].text).toBe(githubCaption);
  expect(captionAt(timedCaptions(cues), 4)).toBe(githubCommaParts[1]);
});

it('estimates part times within an untimed block without a gap between parts', () => {
  const captions = timedCaptions(
    parseYoutubeCaptions(
      { events: [{ tStartMs: 0, dDurationMs: 25600, segs: [{ utf8: githubCaption }] }] },
      'authored',
    ),
  );
  expect([4, 4.2].map((time) => captionAt(captions, time))).toEqual(githubCommaParts);
  expect(captions[0].endTime).toBe(captions[1].startTime);
});

it('joins authored fragments across cues and splits multiple sentences within one cue', () => {
  expect(
    parseYoutubeCaptions(
      {
        events: [
          { tStartMs: 1000, dDurationMs: 1000, segs: [{ utf8: ' This field\nbehind me ' }] },
          { tStartMs: 2000, dDurationMs: 2000, segs: [{ utf8: 'will become a city.' }] },
          { tStartMs: 2000, dDurationMs: 2000, segs: [{ utf8: 'will become a city.', pPenId: 2 }] },
          { tStartMs: 4000, dDurationMs: 15000, segs: [{ utf8: 'We can. We can.' }] },
        ],
      },
      'authored',
    ),
  ).toEqual([
    { startTime: 1, endTime: 4, text: 'This field behind me will become a city.' },
    { startTime: 4, endTime: 11, text: 'We can.' },
    { startTime: 12, endTime: 19, text: 'We can.' },
  ]);
});

it('joins ASR fragments, uses word timestamps within a cue and preserves the final sentence', () => {
  const cues = parseYoutubeCaptions(
    {
      events: [
        {
          tStartMs: 0,
          dDurationMs: 6000,
          segs: [
            { utf8: 'We', tOffsetMs: 0 },
            { utf8: ' are', tOffsetMs: 300 },
          ],
        },
        {
          tStartMs: 1000,
          dDurationMs: 3000,
          segs: [
            { utf8: 'ready.', tOffsetMs: 0 },
            { utf8: ' Are', tOffsetMs: 1000 },
            { utf8: ' you?', tOffsetMs: 1300 },
            { utf8: ' Let’s', tOffsetMs: 2000 },
            { utf8: ' go', tOffsetMs: 2300 },
          ],
        },
      ],
    },
    'asr',
  );
  expect(cues).toEqual([
    { startTime: 0, endTime: 2, text: 'We are ready.' },
    { startTime: 2, endTime: 3, text: 'Are you?' },
    { startTime: 3, endTime: 4, text: 'Let’s go' },
  ]);
  expect(captionWindow(timedCaptions(cues), 1.5)).toEqual({
    current: 'We are ready.',
    texts: ['We are ready.', 'Are you?', 'Let’s go'],
    needsSplit: [false, false, false],
    segments: [0, 0, 0],
  });
  expect(captionWindow(timedCaptions(cues), 2).current).toBe('Are you?');
});

it('keeps a punctuated authored sentence intact across a gap between caption blocks', () => {
  expect(
    parseYoutubeCaptions(
      {
        events: [
          { tStartMs: 1000, dDurationMs: 1000, segs: [{ utf8: 'This field behind me' }] },
          { tStartMs: 3200, dDurationMs: 1800, segs: [{ utf8: 'will become a city.' }] },
        ],
      },
      'authored',
    ),
  ).toEqual([{ startTime: 1, endTime: 5, text: 'This field behind me will become a city.' }]);
});

it('preserves simultaneous authored lines and removes duplicate drawing layers', () => {
  expect(
    parseYoutubeCaptions(
      {
        events: [
          { tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: 'This field behind me' }] },
          {
            tStartMs: 1000,
            dDurationMs: 2000,
            segs: [{ utf8: 'This field behind me', pPenId: 2 }],
          },
          { tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: 'will become a city.' }] },
          { tStartMs: 3000, dDurationMs: 1000, segs: [{ utf8: 'Let’s build it.' }] },
        ],
      },
      'authored',
    ),
  ).toEqual([
    { startTime: 1, endTime: 3, text: 'This field behind me will become a city.' },
    { startTime: 3, endTime: 4, text: 'Let’s build it.' },
  ]);
});

it('uses pauses in unpunctuated word timings and leaves silence between sentences', () => {
  const cues = parseYoutubeCaptions(
    {
      events: [
        {
          tStartMs: 0,
          dDurationMs: 5000,
          segs: [
            { utf8: 'we', tOffsetMs: 0 },
            { utf8: ' made', tOffsetMs: 250 },
            { utf8: ' it', tOffsetMs: 500 },
          ],
        },
        {
          tStartMs: 2500,
          dDurationMs: 1200,
          segs: [
            { utf8: 'let’s', tOffsetMs: 0 },
            { utf8: ' go', tOffsetMs: 400 },
          ],
        },
        { tStartMs: 6000, dDurationMs: 1000, segs: [{ utf8: 'goodbye' }] },
      ],
    },
    'asr',
  );
  expect(cues).toEqual([
    { startTime: 0, endTime: 1.1, text: 'we made it' },
    { startTime: 2.5, endTime: 3.7, text: 'let’s go' },
    { startTime: 6, endTime: 7, text: 'goodbye' },
  ]);
  expect(captionWindow(timedCaptions(cues), 2).current).toBe('');
  expect(captionWindow(timedCaptions(cues), 3).current).toBe('let’s go');
});

it('keeps decimals, abbreviations, split words and repeated spoken words intact', () => {
  const cues = parseYoutubeCaptions(
    {
      events: [
        {
          tStartMs: 0,
          dDurationMs: 4000,
          segs: [
            { utf8: 'Dr. Smith paid 3.14 dollars. ' },
            { utf8: 'I don' },
            { utf8: '’t know. Go go!' },
          ],
        },
        { tStartMs: 4000, dDurationMs: 2000, segs: [{ utf8: 'Go go!' }] },
      ],
    },
    'asr',
  );
  expect(cues.map((cue) => cue.text)).toEqual([
    'Dr. Smith paid 3.14 dollars.',
    'I don’t know.',
    'Go go!',
    'Go go!',
  ]);
});

it('joins CJK ASR fragments without inserting spaces and recognizes sentence punctuation', () => {
  expect(
    parseYoutubeCaptions(
      {
        events: [
          { tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: '今天我们' }] },
          { tStartMs: 1000, dDurationMs: 1000, segs: [{ utf8: '去公园。' }] },
          { tStartMs: 2000, dDurationMs: 1000, segs: [{ utf8: '好吗？' }] },
        ],
      },
      'asr',
    ),
  ).toEqual([
    { startTime: 0, endTime: 2, text: '今天我们去公园。' },
    { startTime: 2, endTime: 3, text: '好吗？' },
  ]);
});

it('does not cut a long phrase at an arbitrary character or word count', () => {
  const text =
    'The extraordinarily detailed description of the architecture of the original production deployment system in our main regional data center remains available.';
  const cues = parseYoutubeCaptions(
    { events: [{ tStartMs: 0, dDurationMs: 60000, segs: [{ utf8: text }] }] },
    'asr',
  );
  expect(cues.map(({ timing: _timing, ...cue }) => cue)).toEqual([
    {
      startTime: 0,
      endTime: 60,
      text: 'The extraordinarily detailed description of the architecture of the original production deployment system in our main regional data center remains available.',
    },
  ]);
});

it('keeps a list together when commas do not introduce clauses', () => {
  const text = `${'one more detail, '.repeat(40)}and that is all.`;
  const cues = parseYoutubeCaptions(
    { events: [{ tStartMs: 0, dDurationMs: 20000, segs: [{ utf8: text }] }] },
    'asr',
  );
  expect(cues.map(({ timing: _timing, ...cue }) => cue)).toEqual([
    { startTime: 0, endTime: 20, text },
  ]);
});

it('bounds model input windows without dropping words in an unpunctuated transcript', () => {
  const text = 'keep speaking '.repeat(500).trim();
  const cues = parseYoutubeCaptions(
    {
      events: Array.from({ length: 50 }, (_, index) => ({
        tStartMs: index * 3000,
        dDurationMs: 3000,
        segs: [{ utf8: 'keep speaking '.repeat(10).trim() }],
      })),
    },
    'asr',
  );
  expect(cues.map((cue) => cue.text).join(' ')).toBe(text);
  expect(cues.length).toBe(2);
  expect(
    cues.every(
      (cue) => cue.text.length <= 5000 && cue.timing?.length && cue.endTime > cue.startTime,
    ),
  ).toBe(true);
});

it('ignores malformed and non-text events while retaining valid captions', () => {
  expect(
    parseYoutubeCaptions(
      {
        events: [
          null,
          {},
          { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: '\n' }] },
          { tStartMs: -1, dDurationMs: 1000, segs: [{ utf8: 'Invalid' }] },
          { tStartMs: 0, dDurationMs: 0, segs: [{ utf8: 'Invalid' }] },
          { tStartMs: 0, dDurationMs: 1000, segs: [null, { utf8: 12 }, { utf8: '\u200bValid.' }] },
        ],
      },
      'asr',
    ),
  ).toEqual([{ startTime: 0, endTime: 1, text: 'Valid.' }]);
});

it('covers the rest of the current segment and the following segment, however far apart', () => {
  const cues = Array.from({ length: 30 }, (_, index) => ({
    startTime: index * 10,
    endTime: index * 10 + 8,
    text: `Cue ${index + 1}`,
  }));
  const captions = timedCaptions(cues);
  const texts = (from: number, to: number) => cues.slice(from, to).map((cue) => cue.text);
  expect(captionWindow(captions, 0).texts).toEqual(texts(0, 20));
  expect(captionWindow(captions, 95)).toEqual({
    current: 'Cue 10',
    texts: texts(9, 20),
    segments: [0, ...texts(10, 20).map(() => 1)],
    needsSplit: texts(9, 20).map(() => false),
  });
  expect(captionWindow(captions, 105).texts).toEqual(texts(10, 30));
  expect(captionWindow(captions, 165).texts).toEqual(texts(16, 30));
  expect(captionWindow(captions, 205).texts).toEqual(texts(20, 30));
  expect(captionWindow(captions, 9999)).toEqual({
    current: '',
    texts: [],
    segments: [],
    needsSplit: [],
  });
});

it('splits a long cue shown on its own at commas, but not overlapping cues joined into one line', () => {
  const first = 'When I first moved to the city, I didn’t know anyone at all,';
  const second = 'and every night I walked along the river, wondering why.';
  const long =
    'Years later, standing on the same bridge, I finally understood that the city had become my home.';
  const parts = splitSubtitleAtCommas(long).map((part) => long.slice(part.from, part.to));
  const captions = timedCaptions([
    { startTime: 2, endTime: 6, text: first },
    { startTime: 4, endTime: 8, text: second },
    { startTime: 8, endTime: 12, text: long },
  ]);
  expect(captions.map((caption) => caption.text)).toEqual([first, second, ...parts]);
  const window = captionWindow(captions, 0);
  expect(window.texts).toEqual([first, `${first}\n${second}`, second, ...parts]);
  expect(window.texts.map(needsSubtitleSegmentation)).toEqual([false, true, false, false, false]);
  expect(window.segments).toEqual([0, 0, 0, 0, 0]);
});

it('keeps a long cue whole while it overlaps another cue', () => {
  const long =
    'Years later, standing on the same bridge, I finally understood that the city had become my home.';
  const captions = timedCaptions([
    { startTime: 0, endTime: 5, text: long },
    { startTime: 4, endTime: 6, text: 'Overlap.' },
  ]);
  expect(captions.map((caption) => caption.text)).toEqual([long, 'Overlap.']);
});

it('packs up to ten captions into a segment and starts the next one rather than split a sentence', () => {
  const long = ['a', 'b', 'c'].map((letter) => letter.repeat(60)).join(', ');
  const captions = timedCaptions([
    ...Array.from({ length: 8 }, (_, index) => ({
      startTime: index * 4,
      endTime: index * 4 + 3,
      text: `Cue ${index + 1}.`,
    })),
    { startTime: 32, endTime: 44, text: long },
    { startTime: 44, endTime: 47, text: 'After.' },
  ]);
  expect(captions.map((caption) => caption.segment)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1]);
  expect(captions.slice(8, 11).map((caption) => caption.text)).toEqual(
    splitSubtitleAtCommas(long).map((part) => long.slice(part.from, part.to)),
  );
  expect(captionWindow(captions, 0).segments).toEqual(captions.map((caption) => caption.segment));
});

it('spreads a sentence with more than ten parts over consecutive segments', () => {
  const huge = Array.from({ length: 12 }, (_, index) => `${index}`.padEnd(85, 'x')).join(', ');
  const captions = timedCaptions([
    { startTime: 0, endTime: 2, text: 'Before.' },
    { startTime: 2, endTime: 26, text: huge },
    { startTime: 26, endTime: 28, text: 'After.' },
  ]);
  expect(captions.map((caption) => caption.segment)).toEqual([
    0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2,
  ]);
});

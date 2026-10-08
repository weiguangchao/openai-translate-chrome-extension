import { expect, it } from 'vitest';
import { parseYoutubeCaptions } from '../src/platforms/youtube/captions';
import {
  captionAt,
  captionWindow,
  timedCaptions,
  translatedCaptions,
  type TimedCaption,
} from '../src/core/timeline';
import { readCaptionTranslation, translationInput } from '../src/shared/caption-translation';
import { githubCaption, githubCaptionTrack, githubCommaParts } from './fixtures/github-caption';

function providerSplit(caption: TimedCaption, sources: readonly string[]) {
  const result = readCaptionTranslation(translationInput(caption.text, true), {
    parts: sources.map((source) => ({ source, translation: `译文：${source}` })),
  });
  if (!result || typeof result === 'string') throw new Error('Expected split result');
  return translatedCaptions(caption, result.parts);
}

it.each(['asr', 'authored'] as const)(
  'times each Provider part of a long sentence from the original %s word timestamps',
  (kind) => {
    const cues = parseYoutubeCaptions(githubCaptionTrack, kind);
    expect(cues.map((cue) => cue.text)).toEqual([githubCaption]);
    const captions = timedCaptions(cues);
    expect(captions.map((caption) => [caption.text, caption.needsSplit])).toEqual([
      [githubCaption, true],
    ]);
    const display = providerSplit(captions[0], githubCommaParts);
    expect([0, 1.49, 1.5, 3, 6.75, 8.25, 2, 11].map((time) => captionAt(display, time))).toEqual([
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
  expect(captionAt(providerSplit(timedCaptions(cues)[0], githubCommaParts), 4)).toBe(
    githubCommaParts[1],
  );
});

it('estimates part times within an untimed block without a gap between parts', () => {
  const captions = timedCaptions(
    parseYoutubeCaptions(
      { events: [{ tStartMs: 0, dDurationMs: 25600, segs: [{ utf8: githubCaption }] }] },
      'authored',
    ),
  );
  const display = providerSplit(captions[0], githubCommaParts);
  expect([4, 4.2].map((time) => captionAt(display, time))).toEqual(githubCommaParts);
  expect(display[0].endTime).toBe(display[1].startTime);
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
    items: [
      { text: 'We are ready.', segment: 0, needsSplit: false, batch: 0 },
      { text: 'Are you?', segment: 0, needsSplit: false, batch: 0 },
      { text: 'Let’s go', segment: 0, needsSplit: false, batch: 0 },
    ],
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

it('flags a long cue shown on its own for a Provider split, but not overlapping cues joined into one line', () => {
  const first = 'When I first moved to the city, I didn’t know anyone at all,';
  const second = 'and every night I walked along the river, wondering why.';
  const long =
    'Years later, standing on the same bridge, I finally understood that the city had become my home.';
  const captions = timedCaptions([
    { startTime: 2, endTime: 6, text: first },
    { startTime: 4, endTime: 8, text: second },
    { startTime: 8, endTime: 12, text: long },
  ]);
  expect(captions.map((caption) => [caption.text, caption.needsSplit])).toEqual([
    [first, false],
    [second, false],
    [long, true],
  ]);
  expect(captionWindow(captions, 0).items).toEqual([
    { text: first, segment: 0, needsSplit: false, batch: 0 },
    { text: `${first}\n${second}`, segment: 0, needsSplit: false, batch: 0 },
    { text: second, segment: 0, needsSplit: false, batch: 0 },
    { text: long, segment: 0, needsSplit: true, batch: 0 },
  ]);
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

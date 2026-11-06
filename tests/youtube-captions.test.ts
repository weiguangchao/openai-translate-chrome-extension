import { expect, it } from 'vitest';
import { parseYoutubeCaptions } from '../src/platforms/youtube/captions';
import { subtitleDisplayLength } from '../src/shared/segmenter';
import { playbackCues, timedCaptions } from '../src/core/timeline';
import { githubCaption, githubCaptionTrack } from './fixtures/github-caption';
import { captionDisplayLimit } from '../src/shared/tuning';

const githubCaptions = [
  'Myself, Mitchell the creator of Ghostie,',
  'and many other people are realizing that GitHub might not be the',
  "safest place for us to be leaving our code now that they're randomly",
  'reverting merges and having downtime that is measured in days.',
];

it.each(['asr', 'authored'] as const)(
  'times each caption of a long sentence from the original %s word timestamps',
  async (kind) => {
    const cues = await parseYoutubeCaptions(githubCaptionTrack, kind, 'en');
    expect(cues).toEqual([
      { startTime: 0, endTime: 1.5, text: githubCaptions[0] },
      { startTime: 1.5, endTime: 4.5, text: githubCaptions[1] },
      { startTime: 4.5, endTime: 7.75, text: githubCaptions[2] },
      { startTime: 7.75, endTime: 11, text: githubCaptions[3] },
    ]);
  },
);

it('maps normalized whitespace back to the timed source blocks', async () => {
  const cues = await parseYoutubeCaptions(
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
              utf8: "now that they're randomly reverting merges and having downtime that is measured in days.",
            },
          ],
        },
      ],
    },
    'authored',
    'en',
  );
  expect(cues[0].text).toBe(
    'Myself, Mitchell the creator of Ghostie, and many other people are realizing',
  );
  expect(cues.map((cue) => cue.text).join(' ')).toBe(githubCaption);
  expect(cues.map(({ startTime, endTime }) => [startTime, endTime])).toEqual([
    [0, 4],
    [4, 7],
    [7, 8.954545454545455],
    [8.954545454545455, 11],
  ]);
});

it('estimates caption times within an untimed block without a gap between captions', async () => {
  const captions = await parseYoutubeCaptions(
    { events: [{ tStartMs: 0, dDurationMs: 23700, segs: [{ utf8: githubCaption }] }] },
    'authored',
    'en',
  );
  expect(captions.map((caption) => caption.text)).toEqual(githubCaptions);
  expect(captions[0].startTime).toBe(0);
  expect(captions[0].endTime).toBeCloseTo(4.1, 1);
  expect(captions[1].startTime).toBeCloseTo(4.1, 1);
  expect(captions[1].endTime).toBeCloseTo(10.6, 1);
  expect(captions[2].startTime).toBeCloseTo(10.6, 1);
  expect(captions[2].endTime).toBeCloseTo(17.5, 1);
  expect(captions[3].startTime).toBeCloseTo(17.5, 1);
  expect(captions[3].endTime).toBe(23.7);
});

it('joins authored fragments across cues and splits multiple sentences within one cue', async () => {
  expect(
    await parseYoutubeCaptions(
      {
        events: [
          { tStartMs: 1000, dDurationMs: 1000, segs: [{ utf8: ' This field\nbehind me ' }] },
          { tStartMs: 2000, dDurationMs: 2000, segs: [{ utf8: 'will become a city.' }] },
          { tStartMs: 2000, dDurationMs: 2000, segs: [{ utf8: 'will become a city.', pPenId: 2 }] },
          { tStartMs: 4000, dDurationMs: 15000, segs: [{ utf8: 'We can. We can.' }] },
        ],
      },
      'authored',
      'en',
    ),
  ).toEqual([
    { startTime: 1, endTime: 4, text: 'This field behind me will become a city.' },
    { startTime: 4, endTime: 11, text: 'We can.' },
    { startTime: 12, endTime: 19, text: 'We can.' },
  ]);
});

it('joins ASR fragments, uses word timestamps within a cue and preserves the final sentence', async () => {
  const cues = await parseYoutubeCaptions(
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
    'en',
  );
  expect(cues).toEqual([
    { startTime: 0, endTime: 2, text: 'We are ready.' },
    { startTime: 2, endTime: 3, text: 'Are you?' },
    { startTime: 3, endTime: 4, text: 'Let’s go' },
  ]);
  expect(playbackCues(timedCaptions(cues), 1.5)).toEqual([
    { text: 'We are ready.', start: 0, end: 2 },
    { text: 'Are you?', start: 2, end: 3 },
    { text: 'Let’s go', start: 3, end: 4 },
  ]);
});

it.each([
  {
    kind: 'authored' as const,
    expected: [{ startTime: 1, endTime: 5, text: 'This field behind me will become a city.' }],
  },
  {
    kind: 'asr' as const,
    expected: [
      { startTime: 1, endTime: 2, text: 'This field behind me' },
      { startTime: 3.2, endTime: 5, text: 'will become a city.' },
    ],
  },
])('handles a pause within punctuated $kind dialogue', async ({ kind, expected }) => {
  expect(
    await parseYoutubeCaptions(
      {
        events: [
          { tStartMs: 1000, dDurationMs: 1000, segs: [{ utf8: 'This field behind me' }] },
          { tStartMs: 3200, dDurationMs: 1800, segs: [{ utf8: 'will become a city.' }] },
        ],
      },
      kind,
      'en',
    ),
  ).toEqual(expected);
});

it('preserves simultaneous authored lines and removes duplicate drawing layers', async () => {
  expect(
    await parseYoutubeCaptions(
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
      'en',
    ),
  ).toEqual([
    { startTime: 1, endTime: 3, text: 'This field behind me will become a city.' },
    { startTime: 3, endTime: 4, text: 'Let’s build it.' },
  ]);
});

it.each([
  {
    segments: [{ utf8: 'First person keeps talking.' }],
    first: 'First person keeps talking.',
    second: 'Second person answers.',
  },
  {
    segments: [
      { utf8: 'First person keeps', tOffsetMs: 0 },
      { utf8: ' talking', tOffsetMs: 1000 },
    ],
    first: 'First person keeps talking',
    second: 'while the second person answers',
  },
])('preserves staggered authored overlaps for $first', async ({ segments, first, second }) => {
  const cues = await parseYoutubeCaptions(
    {
      events: [
        { tStartMs: 1000, dDurationMs: 4000, segs: segments },
        { tStartMs: 3000, dDurationMs: 4000, segs: [{ utf8: second }] },
      ],
    },
    'authored',
    'en',
  );
  expect(cues).toEqual([
    { startTime: 1, endTime: 5, text: first },
    { startTime: 3, endTime: 7, text: second },
  ]);
  expect(playbackCues(timedCaptions(cues), 4)).toContainEqual({
    text: `${first}\n${second}`,
    start: 3,
    end: 5,
  });
});

it('uses pauses in unpunctuated word timings and leaves silence between sentences', async () => {
  const cues = await parseYoutubeCaptions(
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
    'en',
  );
  expect(cues).toEqual([
    { startTime: 0, endTime: 1.1, text: 'we made it' },
    { startTime: 2.5, endTime: 3.7, text: 'let’s go' },
    { startTime: 6, endTime: 7, text: 'goodbye' },
  ]);
});

it('keeps decimals, abbreviations, split words and repeated spoken words intact', async () => {
  const cues = await parseYoutubeCaptions(
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
    'en',
  );
  expect(cues.map((cue) => cue.text)).toEqual([
    'Dr. Smith paid 3.14 dollars.',
    'I don’t know.',
    'Go go!',
    'Go go!',
  ]);
});

it('joins CJK ASR fragments without inserting spaces and recognizes sentence punctuation', async () => {
  expect(
    await parseYoutubeCaptions(
      {
        events: [
          { tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: '今天我们' }] },
          { tStartMs: 1000, dDurationMs: 1000, segs: [{ utf8: '去公园。' }] },
          { tStartMs: 2000, dDurationMs: 1000, segs: [{ utf8: '好吗？' }] },
        ],
      },
      'asr',
      'zh-CN',
    ),
  ).toEqual([
    { startTime: 0, endTime: 2, text: '今天我们去公园。' },
    { startTime: 2, endTime: 3, text: '好吗？' },
  ]);
});

it('cuts a long unpunctuated phrase into balanced captions between words', async () => {
  const text =
    'The extraordinarily detailed description of the architecture of the original production deployment system in our main regional data center remains available.';
  const cues = await parseYoutubeCaptions(
    { events: [{ tStartMs: 0, dDurationMs: 60000, segs: [{ utf8: text }] }] },
    'asr',
    'en',
  );
  expect(cues.map((cue) => cue.text)).toEqual([
    'The extraordinarily detailed description of the architecture of the original',
    'production deployment system in our main regional data center remains available.',
  ]);
  expect([cues[0].startTime, cues[0].endTime, cues[1].endTime]).toEqual([0, cues[1].startTime, 60]);
});

it('cuts a long list into captions at its commas', async () => {
  const text = `${'one more detail, '.repeat(40)}and that is all.`;
  const cues = await parseYoutubeCaptions(
    { events: [{ tStartMs: 0, dDurationMs: 20000, segs: [{ utf8: text }] }] },
    'asr',
    'en',
  );
  expect(cues.map((cue) => cue.text).join(' ')).toBe(text);
  expect(cues).toHaveLength(11);
  expect(cues.every((cue) => subtitleDisplayLength(cue.text) <= captionDisplayLimit)).toBe(true);
  expect(cues.slice(0, -1).every((cue) => cue.text.endsWith(','))).toBe(true);
  expect([cues[0].startTime, cues[10].endTime]).toEqual([0, 20]);
});

it('cuts an unpunctuated transcript within each caption block without dropping words', async () => {
  const text = 'keep speaking '.repeat(500).trim();
  const cues = await parseYoutubeCaptions(
    {
      events: Array.from({ length: 50 }, (_, index) => ({
        tStartMs: index * 3000,
        dDurationMs: 3000,
        segs: [{ utf8: 'keep speaking '.repeat(10).trim() }],
      })),
    },
    'asr',
    'en',
  );
  expect(cues.map((cue) => cue.text).join(' ')).toBe(text);
  expect(cues).toHaveLength(100);
  expect(
    cues.every(
      (cue) =>
        subtitleDisplayLength(cue.text) <= captionDisplayLimit && cue.endTime > cue.startTime,
    ),
  ).toBe(true);
});

it('ignores malformed and non-text events while retaining valid captions', async () => {
  expect(
    await parseYoutubeCaptions(
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
      'en',
    ),
  ).toEqual([{ startTime: 0, endTime: 1, text: 'Valid.' }]);
});

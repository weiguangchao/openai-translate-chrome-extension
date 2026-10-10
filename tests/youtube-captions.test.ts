import { expect, it } from 'vitest';
import { parseYoutubeCaptions } from '../src/platforms/youtube/captions';
import { captionDisplayLimit, subtitleDisplayLength } from '../src/shared/segmenter';
import { captionAt, captionWindow, timedCaptions } from '../src/core/timeline';
import { githubCaption, githubCaptionTrack } from './fixtures/github-caption';

const githubCaptions = [
  'Myself, Mitchell the creator of Ghostie, and many other people are realizing',
  'that GitHub might not be the safest place for us to be leaving our code now',
  "that they're randomly reverting merges and having downtime that is measured in days.",
];

it.each(['asr', 'authored'] as const)(
  'times each caption of a long sentence from the original %s word timestamps',
  (kind) => {
    const cues = parseYoutubeCaptions(githubCaptionTrack, kind, 'en');
    expect(cues).toEqual([
      { startTime: 0, endTime: 3, text: githubCaptions[0] },
      { startTime: 3, endTime: 7, text: githubCaptions[1] },
      { startTime: 7, endTime: 11, text: githubCaptions[2] },
    ]);
    expect([2.9, 3, 10.9, 11].map((time) => captionAt(cues, time))).toEqual([
      githubCaptions[0],
      githubCaptions[1],
      githubCaptions[2],
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
              utf8: "now that they're randomly reverting merges and having downtime that is measured in days.",
            },
          ],
        },
      ],
    },
    'authored',
    'en',
  );
  expect(cues[0].text).toBe(githubCaptions[0]);
  expect(cues.map((cue) => cue.text).join(' ')).toBe(githubCaption);
  expect(cues.map(({ startTime, endTime }) => [startTime, endTime])).toEqual([
    [0, 4],
    [4, 7],
    [7, 11],
  ]);
});

it('estimates caption times within an untimed block without a gap between captions', () => {
  const captions = parseYoutubeCaptions(
    { events: [{ tStartMs: 0, dDurationMs: 23700, segs: [{ utf8: githubCaption }] }] },
    'authored',
    'en',
  );
  expect(captions.map((caption) => caption.text)).toEqual(githubCaptions);
  expect(captions[1].startTime).toBeCloseTo((23.7 * githubCaption.indexOf('that GitHub')) / 237);
  expect(captions[0].endTime).toBe(captions[1].startTime);
  expect(captions[1].endTime).toBe(captions[2].startTime);
  expect(captions[2].endTime).toBe(23.7);
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
      'en',
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
    'en',
  );
  expect(cues).toEqual([
    { startTime: 0, endTime: 2, text: 'We are ready.' },
    { startTime: 2, endTime: 3, text: 'Are you?' },
    { startTime: 3, endTime: 4, text: 'Let’s go' },
  ]);
  expect(captionWindow(timedCaptions(cues), 1.5)).toEqual({
    current: 'We are ready.',
    items: [
      { text: 'We are ready.', start: 0, end: 2 },
      { text: 'Are you?', start: 2, end: 3 },
      { text: 'Let’s go', start: 3, end: 4 },
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
      'en',
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
      'en',
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
    'en',
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
    'en',
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
      'zh-CN',
    ),
  ).toEqual([
    { startTime: 0, endTime: 2, text: '今天我们去公园。' },
    { startTime: 2, endTime: 3, text: '好吗？' },
  ]);
});

it('cuts a long unpunctuated phrase into balanced captions between words', () => {
  const text =
    'The extraordinarily detailed description of the architecture of the original production deployment system in our main regional data center remains available.';
  const cues = parseYoutubeCaptions(
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

it('cuts a long list into captions at its commas', () => {
  const text = `${'one more detail, '.repeat(40)}and that is all.`;
  const cues = parseYoutubeCaptions(
    { events: [{ tStartMs: 0, dDurationMs: 20000, segs: [{ utf8: text }] }] },
    'asr',
    'en',
  );
  expect(cues.map((cue) => cue.text).join(' ')).toBe(text);
  expect(cues).toHaveLength(9);
  expect(cues.every((cue) => subtitleDisplayLength(cue.text) <= captionDisplayLimit)).toBe(true);
  expect(cues.slice(0, -1).every((cue) => cue.text.endsWith(','))).toBe(true);
  expect([cues[0].startTime, cues[8].endTime]).toEqual([0, 20]);
});

it('cuts an unpunctuated transcript within each caption block without dropping words', () => {
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
      'en',
    ),
  ).toEqual([{ startTime: 0, endTime: 1, text: 'Valid.' }]);
});

it('joins overlapping captions into one line in the playback window', () => {
  const first = 'When I first moved to the city, I didn’t know anyone at all,';
  const second = 'and every night I walked along the river, wondering why.';
  const long =
    'Years later, standing on the same bridge, I finally understood that the city had become my home.';
  const captions = timedCaptions([
    { startTime: 2, endTime: 6, text: first },
    { startTime: 4, endTime: 8, text: second },
    { startTime: 8, endTime: 12, text: long },
  ]);
  expect(captionWindow(captions, 0).items).toEqual([
    { text: first, start: 2, end: 4 },
    { text: `${first}\n${second}`, start: 4, end: 6 },
    { text: second, start: 6, end: 8 },
    { text: long, start: 8, end: 12 },
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

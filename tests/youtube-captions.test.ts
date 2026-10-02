import { expect, it } from 'vitest';
import { parseYoutubeCaptions } from '../src/extension/youtube-captions';
import { captionWindow } from '../src/extension/timeline';
import { githubCaption, githubCaptionTrack, githubCommaSegments } from './fixtures/github-caption';
import { splitSubtitleAtCommas } from '../src/shared/subtitle-segmentation';
import { translatedCaptionAt } from '../src/extension/segmented-captions';

it.each(['asr', 'authored'] as const)(
  'maps comma segments to the original %s word timestamps',
  (kind) => {
    const cues = parseYoutubeCaptions(githubCaptionTrack, kind);
    expect(cues.map((cue) => cue.text)).toEqual([githubCaption]);
    const parts = splitSubtitleAtCommas(githubCaption);
    const result = {
      segments: parts.map((part) => ({
        ...part,
        translation: `译:${githubCaption.slice(part.from, part.to)}`,
      })),
    };
    const at = (time: number) => translatedCaptionAt(cues[0], result, time);
    expect(at(0)).toEqual({
      text: githubCommaSegments[0],
      translation: `译:${githubCommaSegments[0]}`,
    });
    expect(at(1.49)?.text).toBe(githubCommaSegments[0]);
    expect([1.5, 3, 6.75, 8.25, 2].map((time) => at(time)?.text)).toEqual([
      githubCommaSegments[1],
      githubCommaSegments[1],
      githubCommaSegments[1],
      githubCommaSegments[1],
      githubCommaSegments[1],
    ]);
    expect(at(11)).toBeNull();
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
  const parts = splitSubtitleAtCommas(githubCaption);
  const result = {
    segments: parts.map((part) => ({
      ...part,
      translation: `译:${githubCaption.slice(part.from, part.to)}`,
    })),
  };
  expect(translatedCaptionAt(cues[0], result, 4)?.text).toBe(githubCommaSegments[1]);
});

it('estimates segment times within an untimed block without a gap between segments', () => {
  const cues = parseYoutubeCaptions(
    { events: [{ tStartMs: 0, dDurationMs: 25600, segs: [{ utf8: githubCaption }] }] },
    'authored',
  );
  const parts = splitSubtitleAtCommas(githubCaption);
  const result = {
    segments: parts.map((part) => ({
      ...part,
      translation: `译:${githubCaption.slice(part.from, part.to)}`,
    })),
  };
  expect([4, 4.2].map((time) => translatedCaptionAt(cues[0], result, time)?.text)).toEqual([
    githubCommaSegments[0],
    githubCommaSegments[1],
  ]);
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
  expect(captionWindow(cues, 1.5)).toEqual({
    current: 'We are ready.',
    texts: ['We are ready.', 'Are you?', 'Let’s go'],
  });
  expect(captionWindow(cues, 2).current).toBe('Are you?');
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
  expect(captionWindow(cues, 2).current).toBe('');
  expect(captionWindow(cues, 3).current).toBe('let’s go');
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

it('covers the rest of the current block of ten cues and the next two blocks, however far apart', () => {
  const cues = Array.from({ length: 45 }, (_, index) => ({
    startTime: index * 10,
    endTime: index * 10 + 8,
    text: `Cue ${index + 1}`,
  }));
  const texts = (from: number, to: number) => cues.slice(from, to).map((cue) => cue.text);
  expect(captionWindow(cues, 0).texts).toEqual(texts(0, 30));
  expect(captionWindow(cues, 95)).toEqual({ current: 'Cue 10', texts: texts(9, 30) });
  expect(captionWindow(cues, 100).texts).toEqual(texts(10, 40));
  expect(captionWindow(cues, 205).texts).toEqual(texts(20, 45));
  expect(captionWindow(cues, 999)).toEqual({ current: '', texts: [] });
});

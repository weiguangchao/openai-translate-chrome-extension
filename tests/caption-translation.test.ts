import { expect, it } from 'vitest';
import {
  readCaptionTranslation,
  readStoredTranslation,
  translationInput,
} from '../src/shared/caption-translation';
import { captionWindow, timedCaptions, translatedCaptions } from '../src/core/timeline';
import { scanTranslationResults } from '../src/shared/model-json';
import { lineTranslation, rangesOf } from './fixtures/lines';

const text =
  'The most budget option by far is to talk to your friends and family and find somebody with an old laptop or desktop that they will give you for free.';
const sources = [
  'The most budget option by far is to talk to your friends and family',
  'and find somebody with an old laptop or desktop that they will give you for free.',
];
const lines = rangesOf(text, sources);
const translations = ['最省钱的办法就是问问你的亲朋好友，', '找个愿意免费送你旧电脑的人。'];
const whole = '最省钱的办法就是问问你的亲朋好友，找个愿意免费送你旧电脑的人。';

it('pairs each translation with its local line in order', () => {
  expect(readCaptionTranslation(text, lines, { parts: translations })).toEqual({
    parts: [
      { ...lines[0], translation: translations[0] },
      { ...lines[1], translation: translations[1] },
    ],
  });
  expect(
    readCaptionTranslation(text, lines, {
      parts: [{ translation: ` ${translations[0]} ` }, { text: translations[1] }],
    }),
  ).toEqual(readCaptionTranslation(text, lines, { parts: translations }));
});

it('joins every part of a caption shown on one line into one translation', () => {
  expect(translationInput(text, false).needsSplit).toBe(false);
  expect(translationInput('Short.', true).needsSplit).toBe(false);
  expect(translationInput(text, true).needsSplit).toBe(true);
  expect(readCaptionTranslation('Short.', [], { parts: [{ translation: ' 短句。 ' }] })).toBe(
    '短句。',
  );
  expect(readCaptionTranslation('Short.', [], { parts: translations })).toBe(whole);
  expect(readCaptionTranslation('Short.', [], { parts: ['你好', '世界'] })).toBe('你好世界');
  expect(readCaptionTranslation('Short.', [], { parts: ['Hello,', 'world.'] })).toBe(
    'Hello, world.',
  );
  expect(readCaptionTranslation('Short.', [], { parts: ['他说：', 'OK.'] })).toBe('他说：OK.');
});

it('shows the whole sentence when the Provider returns one translation for several lines', () => {
  expect(readCaptionTranslation(text, lines, { parts: [whole] })).toBe(whole);
});

it.each([
  ['no parts', []],
  ['an extra translation', [...translations, '多余的译文。']],
  ['an empty translation', [translations[0], ' ']],
  ['a translation longer than any caption', [translations[0], '字'.repeat(5001)]],
])('treats a reply with %s as unusable', (_, parts) => {
  expect(readCaptionTranslation(text, lines, { parts })).toBeNull();
});

it('waits for a whole result object in a fragmented stream, including escaped braces and quotes', () => {
  const first = { id: 1, parts: [{ translation: '他说："{你好}"' }] };
  const head = '```json\n{"note":[],"results":[' + JSON.stringify(first);
  expect(scanTranslationResults(head.slice(0, -1))).toEqual([]);
  expect(scanTranslationResults(head + ',{"id":0,"parts":[')).toEqual([first]);
});

it('reduces a complete but malformed result object to its id and keeps reading', () => {
  const ok = { id: 1, parts: [{ translation: '好' }] };
  expect(
    scanTranslationResults(
      `{"results":[{"id":0,"parts":[{"translation":"坏"} stray]},${JSON.stringify(ok)},{"parts":[} ]}]}`,
    ),
  ).toEqual([{ id: 0 }, ok]);
});

it('flags whole long sentences for line splitting and excludes overlapping cues', () => {
  const captions = timedCaptions([
    { text: 'Before, ' + text, startTime: 0, endTime: 10 },
    { text, startTime: 11, endTime: 20 },
    { text: 'Overlap.', startTime: 15, endTime: 21 },
  ]);
  expect(captions.map((caption) => [caption.text, caption.needsSplit])).toEqual([
    ['Before, ' + text, true],
    [text, false],
    ['Overlap.', false],
  ]);
  expect(captionWindow(captions, 0).items.map((item) => item.needsSplit)).toEqual([
    true,
    false,
    false,
    false,
  ]);
});

it('times lines from retained word timings and estimates untimed boundaries', () => {
  const source = 'Before, ' + text;
  const boundary = source.indexOf('and find');
  const cue = {
    text: source,
    startTime: 2,
    endTime: 20,
    timing: [
      { from: 0, to: 7, startTime: 2, endTime: 3 },
      { from: 8, to: boundary - 1, startTime: 3, endTime: 11 },
      { from: boundary, to: source.length, startTime: 11, endTime: 20 },
    ],
  };
  const [parent] = timedCaptions([cue]);
  const timed = lineTranslation(source, ['Before,', ...sources]);
  const captions = translatedCaptions(parent, timed.parts);
  expect(captions.map(({ startTime, endTime }) => [startTime, endTime])).toEqual([
    [2, 3],
    [3, 11],
    [11, 20],
  ]);
  expect(captions.map((caption) => caption.text).join(' ')).toBe(source);
  const estimated = translatedCaptions(
    { text, startTime: 0, endTime: 10 },
    lineTranslation(text, sources).parts,
  );
  expect(estimated[1].startTime).toBeCloseTo((10 * text.indexOf('and find')) / text.length);
  expect(estimated[0].endTime).toBe(estimated[1].startTime);
});

it('preserves display lines when invalid word timings require proportional timing', () => {
  const { parts } = lineTranslation(text, sources);
  const cue = { text, startTime: 0, endTime: 10 };
  const captions = translatedCaptions(
    { ...cue, timing: [{ from: 0, to: text.length, startTime: 0, endTime: 0 }] },
    parts,
  );
  expect(captions).toEqual(translatedCaptions(cue, parts));
  expect(captions).toHaveLength(2);
  expect(
    captions.every((caption) => caption.text !== text && caption.endTime > caption.startTime),
  ).toBe(true);
});

it('keeps segments based on input captions when one sentence has more than ten display lines', () => {
  const words = Array.from({ length: 12 }, (_, index) => `longword${index}`);
  const source = words.join(' ');
  const captions = timedCaptions([
    { text: source, startTime: 0, endTime: 12 },
    ...Array.from({ length: 9 }, (_, index) => ({
      text: `Next ${index}.`,
      startTime: 12 + index,
      endTime: 13 + index,
    })),
  ]);
  const display = translatedCaptions(captions[0], lineTranslation(source, words).parts);
  expect(display).toHaveLength(12);
  expect(display.every((part) => part.kind === 'display')).toBe(true);
  expect(captionWindow(captions, 0).items).toHaveLength(10);
  expect(captions.map((caption) => caption.segment)).toEqual([
    ...Array(4).fill(0),
    ...Array(4).fill(1),
    ...Array(2).fill(2),
  ]);
});

it('revalidates serialized translations before constructing display captions', () => {
  const input = translationInput(text, true);
  const valid = lineTranslation(text, sources);
  expect(readStoredTranslation(input, JSON.parse(JSON.stringify(valid)))).toEqual(valid);
  const [first, second] = valid.parts;
  expect(readStoredTranslation(input, ' 整句译文 ')).toBe('整句译文');
  for (const invalid of [
    ' ',
    { parts: [first] },
    { parts: [first, { ...second, to: second.to - 1 }] },
    { parts: [{ ...first, from: first.from + 1 }, second] },
    { parts: [first, { ...second, from: first.to - 1 }] },
    { parts: [first, { ...second, to: text.length + 1 }] },
    { parts: [first, { ...second, from: '74' }] },
    { parts: [first, { ...second, translation: ' ' }] },
    { parts: [first, { ...second, translation: '字'.repeat(5001) }] },
  ])
    expect(readStoredTranslation(input, invalid)).toBeNull();
  expect(
    readStoredTranslation(input, { parts: [{ ...first, to: first.to - 7 }, second] }),
  ).toBeNull();
  expect(readStoredTranslation(translationInput('Short.', false), ' 短句 ')).toBe('短句');
  expect(readStoredTranslation(translationInput('Short.', false), valid)).toBeNull();
});

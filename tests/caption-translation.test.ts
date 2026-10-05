import { expect, it } from 'vitest';
import {
  readCaptionTranslation,
  readStoredTranslation,
  subtitleUnits,
  translationInput,
} from '../src/shared/caption-translation';
import { captionWindow, timedCaptions, translatedCaptions } from '../src/core/timeline';
import {
  scanTranslationResults,
  subtitleDisplayLength,
  subtitleDisplayLimit,
} from '../src/shared/subtitle-segmentation';

const text =
  'The most budget option by far is to talk to your friends and family and find somebody with an old laptop or desktop that they will give you for free.';
const input = translationInput(text, true);
const count = subtitleUnits(text).length;
const parts = [
  { endExclusive: 14, translation: '最省钱的办法就是问问你的亲朋好友，' },
  { endExclusive: count, translation: '找个愿意免费送你旧电脑的人。' },
];

it.each([
  'Hello, world! Again.',
  '他说：“你好，世界！”然后离开。',
  '“A cafe\u0301” costs €3.50 — really?',
  '👨‍👩‍👧‍👦 hello 🌍 goodbye!',
])('retains every non-whitespace character and valid Unicode boundaries in %s', (source) => {
  const units = subtitleUnits(source);
  expect(
    units
      .map((unit) => source.slice(unit.from, unit.to))
      .join('')
      .replace(/\s/g, ''),
  ).toBe(source.replace(/\s/g, ''));
  expect(
    units.every(
      (unit, index) => unit.to > unit.from && (!index || unit.from >= units[index - 1].to),
    ),
  ).toBe(true);
});

it('accepts string unit indexes and a text field from a model split', () => {
  expect(
    readCaptionTranslation(input, {
      parts: [
        { end: '14', translation: parts[0].translation },
        { endExclusive: String(count), text: parts[1].translation },
      ],
    }),
  ).toEqual(readCaptionTranslation(input, { parts }));
});

it('accepts a complete split and reconstructs source spans without relying on model-written source text', () => {
  expect(readCaptionTranslation(input, { parts })).toEqual({
    parts: [
      { from: 0, to: text.indexOf(' and find'), translation: parts[0].translation },
      { from: text.indexOf('and find'), to: text.length, translation: parts[1].translation },
    ],
  });
  expect(translationInput(text, false).needsSplit).toBe(false);
  expect(translationInput('Short.', true).needsSplit).toBe(false);
  expect(
    readCaptionTranslation(translationInput('Short.', false), {
      parts: [{ translation: '短句。' }],
    }),
  ).toBe('短句。');
  expect(readCaptionTranslation(translationInput('Short.', false), { parts })).toBeNull();
});

it.each(
  [
    [],
    [{ endExclusive: count, translation: '未切分' }],
    [parts[0]],
    [parts[0], { endExclusive: count + 1, translation: '越界' }],
    [parts[0], { endExclusive: 14, translation: '重复' }],
    [{ endExclusive: -1, translation: '负数' }, parts[1]],
    [{ endExclusive: 1.5, translation: '小数' }, parts[1]],
    [parts[0], { endExclusive: count, translation: ' ' }],
    [parts[0], { endExclusive: count, translation: '字'.repeat(200) }],
  ].map((invalid) => ({ invalid })),
)('rejects incomplete, overlapping, out-of-range or unusable splits %#', ({ invalid }) => {
  expect(readCaptionTranslation(input, { parts: invalid })).toBeNull();
});

it('accepts a complete split whose clauses run past two lines', () => {
  const clause = `${'word '.repeat(50).trim()} `;
  const source = `${clause}${clause.trim()}`;
  const units = subtitleUnits(source);
  const mid = subtitleUnits(clause).length;
  const first = source.slice(units[0].from, units[mid - 1].to);
  expect(subtitleDisplayLength(first)).toBeGreaterThan(subtitleDisplayLimit * 1.5);
  expect(subtitleDisplayLength(first)).toBeLessThanOrEqual(subtitleDisplayLimit * 4);
  expect(
    readCaptionTranslation(translationInput(source, true), {
      parts: [
        { endExclusive: mid, translation: '前半句。' },
        { endExclusive: units.length, translation: '后半句。' },
      ],
    }),
  ).toEqual({
    parts: [
      { from: units[0].from, to: units[mid - 1].to, translation: '前半句。' },
      { from: units[mid].from, to: units.at(-1)!.to, translation: '后半句。' },
    ],
  });
});

it('rejects a split that leaves a large multi-word source block and keeps an indivisible word intact', () => {
  const huge = 'word '.repeat(100).trim();
  expect(
    readCaptionTranslation(translationInput(huge, true), {
      parts: [
        { endExclusive: 1, translation: '词' },
        { endExclusive: 100, translation: '长句' },
      ],
    }),
  ).toBeNull();
  const word = 'x'.repeat(150);
  expect(
    readCaptionTranslation(translationInput(word, true), {
      parts: [{ endExclusive: 1, translation: word }],
    }),
  ).toEqual({ parts: [{ from: 0, to: 150, translation: word }] });
});

it('waits for a whole result object in a fragmented stream, including escaped braces and quotes', () => {
  const first = { id: 1, parts: [{ translation: '他说："{你好}"' }] };
  const head = '```json\n{"note":[],"results":[' + JSON.stringify(first);
  expect(scanTranslationResults(head.slice(0, -1))).toEqual([]);
  expect(scanTranslationResults(head + ',{"id":0,"parts":[')).toEqual([first]);
});

it('marks only residual long captions after local comma splitting and excludes overlapping cues', () => {
  const captions = timedCaptions([
    { text: 'Before, ' + text, startTime: 0, endTime: 10 },
    { text, startTime: 11, endTime: 20 },
    { text: 'Overlap.', startTime: 15, endTime: 21 },
  ]);
  expect(captions.map((caption) => caption.needsSplit === true)).toEqual([
    false,
    true,
    false,
    false,
  ]);
  expect(captionWindow(captions, 0).items.map((item) => item.needsSplit)).toEqual([
    false,
    true,
    false,
    false,
    false,
  ]);
});

it('uses retained word timings after local splitting and estimates untimed boundaries', () => {
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
  const parent = timedCaptions([cue])[1];
  const result = readCaptionTranslation(input, { parts });
  if (!result || typeof result === 'string') throw new Error('Expected split result');
  const captions = translatedCaptions(parent, result.parts);
  expect(captions.map(({ startTime, endTime }) => [startTime, endTime])).toEqual([
    [3, 11],
    [11, 20],
  ]);
  expect(captions.map((caption) => caption.text).join(' ')).toBe(text);
  const estimated = translatedCaptions({ text, startTime: 0, endTime: 10 }, result.parts);
  expect(estimated[1].startTime).toBeCloseTo((10 * text.indexOf('and find')) / text.length);
  expect(estimated[0].endTime).toBe(estimated[1].startTime);
});

it('preserves display parts when invalid word timings require proportional timing', () => {
  const result = readCaptionTranslation(input, { parts });
  if (!result || typeof result === 'string') throw new Error('Expected split result');
  const cue = { text, startTime: 0, endTime: 10 };
  const captions = translatedCaptions(
    { ...cue, timing: [{ from: 0, to: text.length, startTime: 0, endTime: 0 }] },
    result.parts,
  );
  expect(captions).toEqual(translatedCaptions(cue, result.parts));
  expect(captions).toHaveLength(2);
  expect(
    captions.every((caption) => caption.text !== text && caption.endTime > caption.startTime),
  ).toBe(true);
});

it('keeps segments based on input captions when one provider result has more than ten display parts', () => {
  const source = Array.from({ length: 12 }, (_, index) => `longword${index}`).join(' ');
  const captions = timedCaptions([
    { text: source, startTime: 0, endTime: 12 },
    ...Array.from({ length: 9 }, (_, index) => ({
      text: `Next ${index}.`,
      startTime: 12 + index,
      endTime: 13 + index,
    })),
  ]);
  const result = readCaptionTranslation(translationInput(source, true), {
    parts: Array.from({ length: 12 }, (_, index) => ({
      endExclusive: index + 1,
      translation: `词${index}`,
    })),
  });
  if (!result || typeof result === 'string') throw new Error('Expected split result');
  const display = translatedCaptions(captions[0], result.parts);
  expect(display).toHaveLength(12);
  expect(display.every((part) => part.kind === 'display')).toBe(true);
  expect(captionWindow(captions, 0).items).toHaveLength(10);
  expect(captions.map((caption) => caption.segment)).toEqual(Array(10).fill(0));
});

it('revalidates serialized translations before constructing display captions', () => {
  const valid = readCaptionTranslation(input, { parts });
  expect(readStoredTranslation(input, JSON.parse(JSON.stringify(valid)))).toEqual(valid);
  if (!valid || typeof valid === 'string') throw new Error('Expected split result');
  const first = valid.parts[0];
  const second = valid.parts[1];
  for (const invalid of [
    'Whole translation without split spans',
    { parts: [first] },
    { parts: [{ ...first, from: first.from + 1 }, second] },
    { parts: [first, { ...second, from: first.to - 1 }] },
    { parts: [first, { ...second, translation: '字'.repeat(200) }] },
  ])
    expect(readStoredTranslation(input, invalid)).toBeNull();
  expect(readStoredTranslation(translationInput('Short.', false), ' 短句 ')).toBe('短句');
  expect(readStoredTranslation(translationInput('Short.', false), valid)).toBeNull();
});

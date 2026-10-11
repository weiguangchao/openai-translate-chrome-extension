import { expect, it } from 'vitest';
import { readCaptionTranslation, readStoredTranslation } from '../src/shared/caption-translation';
import { captionWindow, timedCaptions } from '../src/core/timeline';
import { scanTranslationResults } from '../src/shared/model-json';

it('reads only the translation field of a result', () => {
  expect(readCaptionTranslation({ id: 0, translation: ' 短句。 ' })).toBe('短句。');
});

it.each([
  ['no translation', { id: 0 }],
  ['an empty translation', { id: 0, translation: ' ' }],
  ['only the source text echoed back', { id: 0, text: 'Short line.' }],
  ['parts instead of a translation', { id: 0, parts: [{ translation: '短句。' }] }],
  ['a translation longer than any caption', { translation: '字'.repeat(5001) }],
])('treats a reply with %s as unusable', (_, value) => {
  expect(readCaptionTranslation(value)).toBeNull();
});

it('waits for a whole result object in a fragmented stream, including escaped braces and quotes', () => {
  const first = { id: 1, translation: '他说："{你好}"' };
  const head = '```json\n{"note":[],"results":[' + JSON.stringify(first);
  expect(scanTranslationResults(head.slice(0, -1))).toEqual([]);
  expect(scanTranslationResults(head + ',{"id":0,"translation":')).toEqual([first]);
});

it('reduces a complete but malformed result object to its id and keeps reading', () => {
  const ok = { id: 1, translation: '好' };
  expect(
    scanTranslationResults(
      `{"results":[{"id":0,"translation":"坏" stray},${JSON.stringify(ok)},{"translation":} ]}]}`,
    ),
  ).toEqual([{ id: 0 }, ok]);
});

it('numbers segments by caption, four to a segment', () => {
  const captions = timedCaptions(
    Array.from({ length: 10 }, (_, index) => ({
      text: `Caption ${index}.`,
      startTime: index,
      endTime: index + 1,
    })),
  );
  expect(captionWindow(captions, 0).items).toHaveLength(10);
  expect(captions.map((caption) => caption.segment)).toEqual([
    ...Array(4).fill(0),
    ...Array(4).fill(1),
    ...Array(2).fill(2),
  ]);
});

it('accepts only a stored translation string', () => {
  expect(readStoredTranslation(' 整句译文 ')).toBe('整句译文');
  for (const invalid of [' ', '字'.repeat(5001), { parts: ['整句译文'] }, null])
    expect(readStoredTranslation(invalid)).toBeNull();
});

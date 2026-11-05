import { expect, it } from 'vitest';
import { segmenterFor, subtitleDisplayLength } from '../src/shared/segmenter';
import { captionDisplayLimit } from '../src/shared/tuning';

async function captions(language: string, text: string, cueBreaks?: number[]): Promise<string[]> {
  const segmenter = segmenterFor(language);
  const ranges = await segmenter.splitLongSentence(text, cueBreaks);
  return ranges.map(({ from, to }) => text.slice(from, to));
}

it('counts display columns and combining marks', () => {
  expect(subtitleDisplayLength('Hello, world.')).toBe(13);
  expect(subtitleDisplayLength('你好，世界')).toBe(10);
  expect(subtitleDisplayLength('cafe\u0301')).toBe(4);
});

it('keeps decimals and abbreviations intact with UTF-16 sentence offsets', async () => {
  const sentences = ['Dr. Smith paid 3.14 dollars.', 'Café 😀 is ready!'];
  const text = sentences.join(' ');
  const ends = await segmenterFor('en').sentenceEnds(text);
  let from = 0;
  expect(
    ends.map((to) => {
      const sentence = text.slice(from, to).trim();
      from = to;
      return sentence;
    }),
  ).toEqual(sentences);
});

it('keeps line breaks inside a sentence without shifting its original offsets', async () => {
  const text = 'We are\r\nready. Next!';
  expect(await segmenterFor('en').sentenceEnds(text)).toEqual([text.indexOf('.') + 1, text.length]);
});

it('uses the default no-op for unsupported languages', async () => {
  expect(await segmenterFor('zh-CN').sentenceEnds('你好。再见。')).toEqual([]);
  expect(await captions('zh-CN', '短句。')).toEqual(['短句。']);
});

it('splits long English sentences only after the caller chooses the long path', async () => {
  const text = 'one '.repeat(30).trim();
  expect(subtitleDisplayLength(text)).toBeGreaterThan(captionDisplayLimit);
  const pieces = await captions('en', text);
  expect(pieces.length).toBeGreaterThan(1);
  expect(pieces.join(' ')).toBe(text);
  expect(pieces.every((piece) => subtitleDisplayLength(piece) <= captionDisplayLimit)).toBe(true);
});

it('keeps a short sentence as one caption', async () => {
  expect(await captions('en', 'Short line.')).toEqual(['Short line.']);
});

it('keeps an over-limit unsupported-language sentence whole', async () => {
  const text = '甲'.repeat(captionDisplayLimit);
  const pieces = await captions('zh-CN', text);
  expect(pieces).toEqual([text]);
});

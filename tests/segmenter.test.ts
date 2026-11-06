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

it('leaves unsupported languages unsplit, even over the display limit', async () => {
  const long = '甲'.repeat(captionDisplayLimit);
  expect(subtitleDisplayLength(long)).toBeGreaterThan(captionDisplayLimit);
  expect(await segmenterFor('ja').sentenceEnds('こんにちは。さようなら。')).toEqual([]);
  expect(await captions('ja', '短句。')).toEqual(['短句。']);
  expect(await captions('ja', long)).toEqual([long]);
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

it.each(['zh-CN', 'zh-TW', 'zh-Hans', 'zh-Hant'])(
  'finds Chinese sentence ends with quotes and UTF-16 offsets for %s',
  async (language) => {
    const first = '😀她说：“你好！”';
    const second = '接著說：「再見。」';
    const text = `${first}\r\n${second}沒有標點的結尾`;
    expect(await segmenterFor(language).sentenceEnds(text)).toEqual([
      first.length,
      first.length + 2 + second.length,
    ]);
  },
);

it.each(['zh-CN', 'zh-TW'])(
  'splits unpunctuated Chinese into balanced captions without losing text for %s',
  async (language) => {
    const text =
      '不会讲话不是口才不好是你思想不够立体这是发生在阿里公益基金会的会议现场马云当场怒怼秘书长不会讲话一句话便让整个会场的气氛瞬间变得尴尬和紧张关键时刻蔡崇信迅速站出来救场仅凭几句机智得体的话便轻松化解了这场突发危机';
    const pieces = await captions(language, text);
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.join('')).toBe(text);
    expect(pieces.every((piece) => subtitleDisplayLength(piece) <= captionDisplayLimit)).toBe(true);
    expect(pieces.every((piece) => piece.length > 1)).toBe(true);
  },
);

it('keeps Chinese punctuation with its words and preserves mixed-language tokens', async () => {
  const phrase = '我们使用 API 计算 3.14 的结果，并且向大家解释这个结果的含义，';
  const text = `${phrase.repeat(4)}「最后再说一句话。」`;
  const pieces = await captions('zh-CN', text);
  expect(pieces.length).toBeGreaterThan(1);
  expect(pieces.join('').replace(/\s/g, '')).toBe(text.replace(/\s/g, ''));
  expect(pieces.every((piece) => subtitleDisplayLength(piece) <= captionDisplayLimit)).toBe(true);
  expect(pieces.flatMap((piece) => piece.match(/API/g) ?? [])).toHaveLength(4);
  expect(pieces.flatMap((piece) => piece.match(/3\.14/g) ?? [])).toHaveLength(4);
  expect(pieces.every((piece) => !/^[，。！？；：」』”）]/u.test(piece))).toBe(true);
  expect(pieces.every((piece) => !/[「『“（]$/u.test(piece))).toBe(true);
});

it('keeps a Chinese word intact when a source cue ends inside it', async () => {
  const first = '会的会议现场马云当场怒怼秘书长不会讲话一句话便让整个会场的气';
  const second = '氛瞬间变得尴尬和紧张关键时刻蔡崇信迅速站出来救场仅';
  const pieces = await captions('zh-CN', first + second, [first.length]);
  expect(pieces.join('')).toBe(first + second);
  expect(pieces.some((piece) => piece.includes('气氛'))).toBe(true);
  expect(pieces.every((piece) => subtitleDisplayLength(piece) <= captionDisplayLimit)).toBe(true);
});

import { expect, it } from 'vitest';
import { segmenterFor, subtitleDisplayLength } from '../src/shared/segmenter';
import { githubCaption } from './fixtures/github-caption';
import { longCaption, longCaptionParts } from './fixtures/long-caption';
import { captionDisplayLimit } from '../src/shared/tuning';

function captions(language: string, text: string, cueBreaks?: number[]): string[] {
  return segmenterFor(language)
    .captions(text, cueBreaks)
    .map(({ from, to }) => text.slice(from, to));
}

it('counts CJK characters and full-width punctuation as two columns and combining marks as none', () => {
  expect(subtitleDisplayLength('Hello, world.')).toBe(13);
  expect(subtitleDisplayLength('你好，世界')).toBe(10);
  expect(subtitleDisplayLength('cafe\u0301')).toBe(4);
});

it('ends English sentences at terminal punctuation but not at abbreviations, decimals or initials', () => {
  const text =
    'Mr. Smith arrived at 3.30 p.m. today. He left! "Really?" she asked. J. R. R. Tolkien wrote it... Then e.g. this.';
  const after = (phrase: string) => text.indexOf(phrase) + phrase.length;
  expect(segmenterFor('en').sentenceEnds(text)).toEqual(
    ['today.', 'He left!', '"Really?"', 'she asked.', 'wrote it...', 'this.'].map(after),
  );
});

it.each([
  ['ko-KR', '안녕하세요. 반갑습니다! "정말요?"', [6, 13, 20]],
  ['zh-CN', '你好。我是谁？“走吧！”他说', [3, 7, 12]],
  ['ja-JP', 'こんにちは。誰ですか？「行こう！」と言った', [6, 11, 17]],
  ['zh-TW', '你好。我是誰？「走吧！」他說', [3, 7, 12]],
  ['zh-CN', '真的吗?我不信! OK.', [4, 8]],
])('ends %s sentences at terminal punctuation and closing quotes', (language, text, ends) => {
  expect(segmenterFor(language).sentenceEnds(text)).toEqual(ends);
});

it('keeps a caption within the limit on one line and returns nothing for blank text', () => {
  expect(captions('en', '  Short line.  ')).toEqual(['Short line.']);
  expect(captions('zh-CN', '短句。')).toEqual(['短句。']);
  expect(captions('en', '   ')).toEqual([]);
});

it('keeps short English and Japanese sentences whole even when they contain natural breaks', () => {
  const english = `${'a'.repeat(39)}; ${'b'.repeat(39)}`;
  expect(subtitleDisplayLength(english)).toBe(captionDisplayLimit);
  expect(captions('en', english)).toEqual([english]);
  expect(captions('en', `${english}b`)).toEqual([`${'a'.repeat(39)};`, 'b'.repeat(40)]);
  expect(captions('ja', '今日は天気がいいので友達と公園に行きます。')).toEqual([
    '今日は天気がいいので友達と公園に行きます。',
  ]);
});

it('accepts English clauses without forcing the remaining long clause under the limit', () => {
  const first = 'Although the weather was terrible,';
  const rest =
    'we decided to continue our journey because we had promised to meet our friends before sunset.';
  expect(captions('en', `${first} ${rest}`)).toEqual([first, rest]);
  expect(subtitleDisplayLength(rest)).toBeGreaterThan(captionDisplayLimit);
});

it('keeps an oversized English sentence whole when it has no clause break', () => {
  const text =
    'I think the book that you recommended last week explains the problem more clearly than the article we read yesterday.';
  expect(captions('en', text, [20, 50])).toEqual([text]);
});

it('preserves a real caption clause that still exceeds the display limit', () => {
  expect(captions('en', githubCaption)).toEqual([
    'Myself, Mitchell the creator of Ghostie,',
    'and many other people are realizing that GitHub might not be the safest place for us to be leaving our code',
    "now that they're randomly reverting merges and having downtime that is measured in days.",
  ]);
});

it('preserves punctuation, repeated phrases and contractions in English clauses', () => {
  const text = `  He said, "I can't believe it's true; I can't believe it's true", and left (although it was raining).  `;
  const ranges = segmenterFor('en').captions(text);
  expect(ranges.map(({ from, to }) => text.slice(from, to)).join(' ')).toBe(text.trim());
  expect(ranges.length).toBeGreaterThan(1);
});

it('splits long Japanese into phrases without joining short phrases together', () => {
  const text =
    'この問題についてはもう少し詳しく調べてから皆さんに説明したいと思います。今日はまだ結論を出せません。';
  const result = captions('ja', text);
  expect(result.join('')).toBe(text);
  expect(result.slice(0, 4)).toEqual(['この', '問題に', 'ついては', 'もう']);
});

it('splits Chinese at full-width punctuation and at spaces between Chinese clauses', () => {
  expect(
    captions(
      'zh-CN',
      '他站在车站等了很久很久，一直没有跟任何人说过一句话，最后他终于开口说：“这趟火车到底还会不会回来呢？”然后转身离开了。',
    ),
  ).toEqual([
    '他站在车站等了很久很久，一直没有跟任何人说过一句话，',
    '最后他终于开口说：“这趟火车到底还会不会回来呢？”然后转身离开了。',
  ]);
  expect(
    captions(
      'zh-TW',
      '我知道你很想去 但是我們現在真的沒有時間了 如果再不出發的話 我們就趕不上最後一班火車了 所以我們還是明天再去吧',
    ),
  ).toEqual([
    '我知道你很想去 但是我們現在真的沒有時間了 如果再不出發的話',
    '我們就趕不上最後一班火車了 所以我們還是明天再去吧',
  ]);
});

it.each([
  [
    'zh-CN',
    '我们今天要讨论的是新的编译器是怎样工作的以及为什么它对于你们团队的日常开发工作来说非常重要而且值得投入时间',
    [
      '我们今天要讨论的是新的编译器是怎样工作的',
      '以及为什么它对于你们团队的日常开发工作来说非常重要而且值得投入时间',
    ],
  ],
  [
    'zh-TW',
    '我們今天要討論的是新的編譯器是怎樣工作的以及為什麼它對於你們團隊的日常開發工作來說非常重要而且值得投入時間',
    [
      '我們今天要討論的是新的編譯器是怎樣工作的',
      '以及為什麼它對於你們團隊的日常開發工作來說非常重要而且值得投入時間',
    ],
  ],
])(
  'splits an unpunctuated %s clause between words, before a connective',
  (language, text, expected) => {
    expect(captions(language, text)).toEqual(expected);
  },
);

it('never starts a Chinese line with closing punctuation or a particle when another break fits', () => {
  const text =
    '这是一个非常非常长的句子它没有任何标点符号但是我们仍然需要把它拆成好几行来显示给观众看的吧而且还要再长一点才行';
  const result = captions('zh-CN', text);
  expect(result.join('')).toBe(text);
  expect(result.length).toBeGreaterThan(1);
  for (const line of result) {
    expect(subtitleDisplayLength(line)).toBeLessThanOrEqual(captionDisplayLimit);
    expect(line).not.toMatch(/^[，。！？、的了吗呢吧]/u);
  }
});

it.each([
  ['ko', '오늘 우리는 새로운 번역 기능을 함께 살펴보고 있습니다. '.repeat(20)],
  ['zh-CN', '我们一起去公园散步吧，'.repeat(40)],
  ['zh-TW', '這是一段沒有標點符號的很長的文字'.repeat(20)],
])(
  'covers every character of a long %s text with ordered lines within the limit',
  (language, text) => {
    const ranges = segmenterFor(language).captions(text);
    let end = 0;
    for (const { from, to } of ranges) {
      expect(text.slice(end, from).trim()).toBe('');
      expect(text.slice(from, to).trim()).toBe(text.slice(from, to));
      expect(subtitleDisplayLength(text.slice(from, to))).toBeLessThanOrEqual(captionDisplayLimit);
      end = to;
    }
    expect(text.slice(end).trim()).toBe('');
  },
);

it.each(['fr', 'constructor'])(
  'uses English sentence and caption rules when %s has no segmenter',
  (language) => {
    expect(segmenterFor(language).sentenceEnds('Hello. Goodbye!')).toEqual([6, 15]);
    expect(captions(language, longCaption)).toEqual(longCaptionParts);
  },
);

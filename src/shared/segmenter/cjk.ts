import { fitCaptions, type LanguageSegmenter, type WordBreak } from './lines';

interface CjkScript {
  readonly locale: 'zh-Hans' | 'zh-Hant' | 'ja';
  readonly connectives: readonly string[];
  readonly particles: string;
}

const closers = '”’」』）》】"\')\\]';

const sentenceEnd = new RegExp(
  `[。！？]+[${closers}]*|[!?]+[${closers}]*(?=\\s|$|[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}])`,
  'gu',
);
const clauseEnd = new RegExp(
  `(?:[，、；：]|[,;:](?=\\s|[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}])|…+|—{2,})[${closers}]*|(?<=[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{P}])\\s+(?=[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Ps}\\p{Pi}])`,
  'gu',
);

function sentenceEnds(text: string): number[] {
  return [...text.matchAll(sentenceEnd)].map((match) => match.index + match[0].length);
}

function clauseBreaks(text: string): number[] {
  return [
    ...sentenceEnds(text),
    ...[...text.matchAll(clauseEnd)].map((match) => match.index + match[0].length),
  ];
}

function cjk(script: CjkScript): LanguageSegmenter {
  const words = new Intl.Segmenter(script.locale, { granularity: 'word' });
  const wordBreaks = (text: string): WordBreak[] => {
    const breaks: WordBreak[] = [];
    let previous = '';
    for (const { segment, index } of words.segment(text)) {
      if (!segment.trim()) continue;
      if (previous && !/^[\p{Pe}\p{Pf}\p{Po}]/u.test(segment) && !/[\p{Ps}\p{Pi}]$/u.test(previous))
        breaks.push({
          at: index,
          cost:
            script.connectives.some((word) => text.startsWith(word, index)) ||
            /[，、；：,;:]$/.test(previous)
              ? 0
              : script.particles.includes(segment[0])
                ? 3
                : 1,
        });
      previous = segment;
    }
    return breaks;
  };
  return {
    sentenceEnds,
    captions: (text, cueBreaks) => fitCaptions(text, { clauseBreaks, wordBreaks }, cueBreaks),
  };
}

export const simplifiedChinese = cjk({
  locale: 'zh-Hans',
  connectives:
    '但是 可是 不过 而且 并且 然后 所以 因为 因此 如果 虽然 即使 或者 还是 而是 于是 只要 只有 除非 无论 不管 尽管 以及 甚至 否则'.split(
      ' ',
    ),
  particles: '的地得了着过吗呢吧啊呀嘛',
});

export const traditionalChinese = cjk({
  locale: 'zh-Hant',
  connectives:
    '但是 可是 不過 而且 並且 然後 所以 因為 因此 如果 雖然 即使 或者 還是 而是 於是 只要 只有 除非 無論 不管 儘管 以及 甚至 否則'.split(
      ' ',
    ),
  particles: '的地得了著過嗎呢吧啊呀嘛',
});

export const japanese = cjk({
  locale: 'ja',
  connectives:
    'けど けれど けれども しかし でも それでも だが だけど だから なので そして それから それで それに すると つまり ただし なぜなら また さらに あるいは または もし たとえ では じゃあ さて のに なのに'.split(
      ' ',
    ),
  particles: 'はがをにへとでもやかねよなぞわ',
});

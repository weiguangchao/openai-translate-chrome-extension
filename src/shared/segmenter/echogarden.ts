import { segmentText } from '@echogarden/text-segmentation';
import { fitCaptions, type LanguageSegmenter } from './lines';

function echogarden(language: 'en' | 'zh'): LanguageSegmenter {
  const words = language === 'zh' ? new Intl.Segmenter('zh', { granularity: 'word' }) : null;
  const segmentation = (text: string) =>
    segmentText(text.replace(/[\r\n]/g, ' '), {
      language,
      enableEastAsianPostprocessing: false,
    });

  return {
    async sentenceEnds(text) {
      const result = await segmentation(text);
      return result.sentences
        .map((sentence) => {
          let end = sentence.charRange.end;
          while (end > 0 && /\s/.test(text[end - 1])) end--;
          return end;
        })
        .filter(
          (end, index) =>
            index < result.sentences.length - 1 ||
            /[.!?…。！？][\p{Pe}\p{Pf}"']*$/u.test(text.slice(0, end)),
        );
    },
    async splitLongSentence(text, cueBreaks = []) {
      const result = await segmentation(text);
      const wordBreaks = result.words.entries
        .filter((entry) => !entry.isPunctuation)
        .flatMap((entry) => {
          const chineseWord = words !== null && /\p{Script=Han}/u.test(entry.text);
          const offsets = chineseWord
            ? [...words.segment(entry.text)]
                .filter((word) => word.isWordLike)
                .map((word) => entry.startOffset + word.index)
            : [entry.startOffset];
          return offsets.flatMap((startOffset) => {
            let at = startOffset;
            while (at > 0 && /[\p{Ps}\p{Pi}"'¿¡]/u.test(text[at - 1])) at--;
            return at > 0 && (chineseWord || /\s/.test(text[at - 1])) ? [{ at, cost: 1 }] : [];
          });
        });
      const wordStarts = new Set(wordBreaks.map(({ at }) => at));
      return fitCaptions(
        text,
        {
          clauseBreaks: () =>
            result.sentences.flatMap((sentence) =>
              sentence.phrases.slice(0, -1).map((phrase) => phrase.charRange.end),
            ),
          wordBreaks: () => wordBreaks,
        },
        words ? cueBreaks.filter((at) => wordStarts.has(at)) : cueBreaks,
      );
    },
  };
}

export const english = echogarden('en');
export const chinese = echogarden('zh');

export const noop: LanguageSegmenter = {
  async sentenceEnds() {
    return [];
  },
  async splitLongSentence(text) {
    const from = text.length - text.trimStart().length;
    const to = text.trimEnd().length;
    return to > from ? [{ from, to }] : [];
  },
};

import { segmentText } from '@echogarden/text-segmentation';
import { fitCaptions, type LanguageSegmenter } from './lines';

const options = { language: 'en', enableEastAsianPostprocessing: false } as const;

async function segmentation(text: string) {
  return segmentText(text.replace(/[\r\n]/g, ' '), options);
}

export const english: LanguageSegmenter = {
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
          index < result.sentences.length - 1 || /[.!?…]["'”’)\]]*$/u.test(text.slice(0, end)),
      );
  },
  async splitLongSentence(text, cueBreaks = []) {
    const result = await segmentation(text);
    return fitCaptions(
      text,
      {
        clauseBreaks: () =>
          result.sentences.flatMap((sentence) =>
            sentence.phrases.slice(0, -1).map((phrase) => phrase.charRange.end),
          ),
        wordBreaks: () =>
          result.words.entries
            .filter((entry) => !entry.isPunctuation)
            .flatMap(({ startOffset }) => {
              let at = startOffset;
              while (at > 0 && /[\p{Ps}\p{Pi}"'¿¡]/u.test(text[at - 1])) at--;
              return at > 0 && /\s/.test(text[at - 1]) ? [{ at, cost: 1 }] : [];
            }),
      },
      cueBreaks,
    );
  },
};

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

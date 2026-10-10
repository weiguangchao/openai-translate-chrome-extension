import { fitLines, type LanguageSegmenter, type WordBreak } from './lines';

const leading = new Set(
  'and but or nor so yet because although though while whereas unless until since if when whenever where wherever whether which who whom whose that than'.split(
    ' ',
  ),
);
const binding = new Set(
  'a an the to of my your his her its our their this these those i we you he she they it not very'.split(
    ' ',
  ),
);

function sentenceEnds(text: string): number[] {
  const ends: number[] = [];
  for (const match of text.matchAll(/[.!?]+["'”’)\]]*/g)) {
    const end = match.index + match[0].length;
    if (match[0][0] === '.') {
      const before = text.slice(0, match.index);
      const after = text.slice(end);
      if (/\d$/.test(before) && /^\d/.test(after)) continue;
      if (/\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e)$/i.test(before)) continue;
      if (/(?:^|\s)[A-Z]$/.test(before) && /^\s+[A-Z]/.test(after)) continue;
      if (/\b(?:[A-Za-z]\.)+[A-Za-z]$/.test(before) && /^\s+\p{Ll}/u.test(after)) continue;
    }
    if (end < text.length && !/\s/.test(text[end])) continue;
    ends.push(end);
  }
  return ends;
}

function clauseBreaks(text: string): number[] {
  const breaks = sentenceEnds(text);
  for (const match of text.matchAll(
    /(?:[,;:]|\.{3}|…)["'”’)\]]*(?=\s)|\s[-–—]+(?=\s)|—(?=[\p{L}\p{N}])/gu,
  ))
    breaks.push(match.index + match[0].length);
  return breaks;
}

const bare = (word: string) => word.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

function wordBreaks(text: string): WordBreak[] {
  const words = [...text.matchAll(/\S+/g)];
  const breaks: WordBreak[] = [];
  for (let index = 1; index < words.length; index++) {
    const word = words[index][0];
    const previous = words[index - 1][0];
    if (!/^[\p{Ps}\p{Pi}"'¿¡]*[\p{L}\p{N}$£€¥#@]/u.test(word) || /[\p{Ps}\p{Pi}]$/u.test(previous))
      continue;
    const cost =
      leading.has(bare(word)) || /[,;:]$/.test(previous)
        ? 0
        : binding.has(bare(previous)) && /[\p{L}\p{N}]$/u.test(previous)
          ? 3
          : 1;
    breaks.push({ at: words[index].index, cost });
  }
  return breaks;
}

export const english: LanguageSegmenter = {
  sentenceEnds,
  lines: (text, limit, breaks) => fitLines(text, { clauseBreaks, wordBreaks }, limit, breaks),
};

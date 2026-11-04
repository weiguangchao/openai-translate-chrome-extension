import nlp from 'compromise';
import { splitCaptions, type CaptionSplitter } from './captions';
import type { LanguageSegmenter } from './lines';

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

const splitClauses: CaptionSplitter = (text) => {
  const parts: string[] = [];
  nlp(text)
    .clauses()
    .forEach((clause) => {
      parts.push(
        clause
          .termList()
          .map((term) => term.pre + term.text + term.post)
          .join(''),
      );
    });
  return parts;
};

export const english: LanguageSegmenter = {
  sentenceEnds,
  captions: (text) => splitCaptions(text, splitClauses),
};

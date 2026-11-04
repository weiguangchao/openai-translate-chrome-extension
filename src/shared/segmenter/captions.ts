import { captionDisplayLimit } from '../tuning';
import type { TextRange } from './lines';
import { subtitleDisplayLength } from './width';

export type CaptionSplitter = (text: string) => readonly string[];

export function splitCaptions(text: string, split: CaptionSplitter): TextRange[] {
  const sentence = text.trim();
  if (!sentence) return [];
  const start = text.length - text.trimStart().length;
  if (subtitleDisplayLength(sentence) <= captionDisplayLimit)
    return [{ from: start, to: start + sentence.length }];
  let offset = start;
  return split(sentence).flatMap((part) => {
    const from = offset + part.length - part.trimStart().length;
    const to = offset + part.trimEnd().length;
    offset += part.length;
    return from < to ? [{ from, to }] : [];
  });
}

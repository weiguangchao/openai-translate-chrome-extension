export interface TranslatedPart {
  from: number;
  to: number;
  translation: string;
}

export interface SegmentedTranslation {
  segments: TranslatedPart[];
}

export type SubtitleTranslation = string | SegmentedTranslation;

export const subtitleDisplayLimit = 100;

export function subtitleDisplayLength(text: string): number {
  return [...text].reduce(
    (length, character) =>
      length +
      (/\p{Mark}/u.test(character)
        ? 0
        : /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\uFF01-\uFF60]/u.test(
              character,
            )
          ? 2
          : 1),
    0,
  );
}

export function needsSubtitleSegmentation(text: string): boolean {
  return subtitleDisplayLength(text) > subtitleDisplayLimit;
}

export function parseModelJson(response: string): unknown {
  return JSON.parse(response.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, '$1'));
}

function isComma(character: string): boolean {
  return character === ',' || character === '，';
}

export function splitSubtitleAtCommas(text: string): { from: number; to: number }[] {
  const cuts: number[] = [];
  for (let index = 0; index < text.length; index++) if (isComma(text[index])) cuts.push(index + 1);
  cuts.push(text.length);
  const segments: { from: number; to: number }[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    while (cursor < text.length && /\s/u.test(text[cursor])) cursor++;
    if (cursor >= text.length) break;
    let to = -1;
    for (const cut of cuts) {
      if (cut <= cursor) continue;
      const end = cursor + text.slice(cursor, cut).trimEnd().length;
      if (end <= cursor) continue;
      if (subtitleDisplayLength(text.slice(cursor, end)) <= subtitleDisplayLimit) to = end;
      else break;
    }
    if (to <= cursor) {
      const cut = cuts.find((item) => item > cursor) ?? text.length;
      to = cursor + text.slice(cursor, cut).trimEnd().length;
    }
    if (to <= cursor) break;
    segments.push({ from: cursor, to });
    cursor = to;
  }
  return segments;
}

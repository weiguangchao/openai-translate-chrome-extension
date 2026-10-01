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

export function parseSubtitleSegments(
  source: string,
  response: string,
  language: string,
): SegmentedTranslation {
  const invalid = () => new Error('模型未返回完整、有效的语义分段，请重试或更换模型。');
  let value: unknown;
  try {
    value = parseModelJson(response);
  } catch {
    throw invalid();
  }
  const segments = (value as { segments?: unknown } | null)?.segments;
  if (!Array.isArray(segments) || segments.length < 2 || segments.length > 128) throw invalid();
  const boundaries = new Set([0, source.length]);
  for (const part of new Intl.Segmenter(language, { granularity: 'word' }).segment(source)) {
    boundaries.add(part.index);
    boundaries.add(part.index + part.segment.length);
  }
  let cursor = 0;
  const result: TranslatedPart[] = [];
  for (const part of segments) {
    if (typeof part?.source !== 'string' || typeof part?.translation !== 'string') throw invalid();
    const text = part.source.trim();
    const translation = part.translation.trim();
    while (/\s/u.test(source[cursor] ?? '') && cursor < source.length) cursor++;
    const from = cursor;
    const to = from + text.length;
    if (
      !text ||
      !translation ||
      translation.length > 5000 ||
      !source.startsWith(text, from) ||
      !boundaries.has(from) ||
      !boundaries.has(to) ||
      needsSubtitleSegmentation(text) ||
      needsSubtitleSegmentation(translation)
    )
      throw invalid();
    result.push({ from, to, translation });
    cursor = to;
  }
  if (source.slice(cursor).trim()) throw invalid();
  return { segments: result };
}

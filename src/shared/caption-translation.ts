import {
  needsSubtitleSegmentation,
  subtitleDisplayLength,
  subtitleDisplayLimit,
} from './subtitle-segmentation';

declare const verifiedPart: unique symbol;
export interface TranslationPart {
  readonly [verifiedPart]: true;
  readonly from: number;
  readonly to: number;
  readonly translation: string;
}

export type CaptionTranslation = string | { readonly parts: readonly TranslationPart[] };

export interface TranslationInput {
  readonly text: string;
  readonly needsSplit: boolean;
}

export interface PrefetchItem extends TranslationInput {
  readonly segment: number;
}

export function subtitleUnits(text: string): { from: number; to: number }[] {
  const units: { from: number; to: number }[] = [];
  let prefix = 0;
  for (const part of new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text)) {
    if (!part.segment.trim()) continue;
    const to = part.index + part.segment.length;
    if (part.isWordLike) {
      units.push({ from: units.length ? part.index : prefix, to });
    } else if (units.length) units[units.length - 1].to = to;
    else if (!text.slice(prefix, part.index).trim()) prefix = part.index;
  }
  if (!units.length && text.trim())
    units.push({ from: text.length - text.trimStart().length, to: text.trimEnd().length });
  return units;
}

export function translationInput(text: string, needsSplit: boolean): TranslationInput {
  return { text, needsSplit: needsSplit && needsSubtitleSegmentation(text) };
}

function partTranslation(part: { translation?: unknown; text?: unknown } | null): string {
  const value = typeof part?.translation === 'string' ? part.translation : part?.text;
  return typeof value === 'string' ? value.trim() : '';
}

const fullWidthPunctuation = /[\u3000-\u303F\uFF00-\uFFEF]/u;
const unspaced =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\u3000-\u303F\uFF00-\uFFEF]/u;

function joinTranslations(translations: readonly string[]): string {
  return translations.reduce((joined, next) => {
    const last = /.$/u.exec(joined)?.[0] ?? '';
    const first = /^./u.exec(next)?.[0] ?? '';
    const tight = fullWidthPunctuation.test(last) || (unspaced.test(last) && unspaced.test(first));
    return joined + (tight ? '' : ' ') + next;
  });
}

function comparable(text: string): { letters: string[]; offsets: number[] } {
  const letters: string[] = [];
  const offsets: number[] = [];
  let offset = 0;
  for (const point of text) {
    for (const letter of point.normalize('NFKD').toLowerCase())
      if (/[\p{L}\p{N}]/u.test(letter)) {
        letters.push(letter);
        offsets.push(offset);
      }
    offset += point.length;
  }
  return { letters, offsets };
}

function fits(source: string, translation: string, multiUnit: boolean): boolean {
  const limit = subtitleDisplayLimit * 4;
  if (multiUnit && subtitleDisplayLength(source) > limit) return false;
  return subtitleDisplayLength(translation) <= limit || translation === source;
}

function alignedParts(
  text: string,
  parts: readonly { source: string; translation: string }[],
): TranslationPart[] | null {
  const units = subtitleUnits(text);
  const { letters, offsets } = comparable(text);
  const unitAt = (index: number) =>
    units.findIndex((unit) => unit.from <= offsets[index] && offsets[index] < unit.to);
  const accepted: TranslationPart[] = [];
  let position = 0;
  let first = 0;
  for (const part of parts) {
    const length = comparable(part.source).letters.length;
    if (!length) return null;
    position += length;
    const last = position === letters.length ? units.length - 1 : unitAt(position - 1);
    if (last < first || (position < letters.length && unitAt(position) === last)) return null;
    const from = units[first].from;
    const to = units[last].to;
    if (!fits(text.slice(from, to), part.translation, last > first)) return null;
    accepted.push({ from, to, translation: part.translation } as TranslationPart);
    first = last + 1;
  }
  return accepted;
}

export function readCaptionTranslation(
  input: TranslationInput,
  value: unknown,
): CaptionTranslation | null {
  const parts = (value as { parts?: unknown } | null)?.parts;
  if (!Array.isArray(parts) || !parts.length) return null;
  const items = parts.map((part) => {
    const record = (part && typeof part === 'object' ? part : {}) as {
      source?: unknown;
      translation?: unknown;
      text?: unknown;
    };
    return {
      source: typeof record.source === 'string' ? record.source : null,
      translation: partTranslation(record),
    };
  });
  if (items.some((item) => !item.translation)) return null;
  const whole = joinTranslations(items.map((item) => item.translation));
  if (whole.length > 5000) return null;
  if (!input.needsSplit) return whole;
  const quoted = items.filter(
    (item): item is { source: string; translation: string } => item.source !== null,
  );
  if (quoted.length !== items.length) return whole;
  const expected = comparable(input.text).letters.join('');
  const actual = quoted.map((item) => comparable(item.source).letters.join('')).join('');
  if (Math.abs(actual.length - expected.length) > expected.length * 0.1) return null;
  if (quoted.length < 2 || actual !== expected) return whole;
  const aligned = alignedParts(input.text, quoted);
  return aligned ? { parts: aligned } : whole;
}

export function readStoredTranslation(
  input: TranslationInput,
  value: unknown,
): CaptionTranslation | null {
  if (typeof value === 'string') {
    const translation = value.trim();
    return translation && translation.length <= 5000 ? translation : null;
  }
  const parts = (value as { parts?: unknown } | null)?.parts;
  if (!input.needsSplit || !Array.isArray(parts) || parts.length < 2) return null;
  const units = subtitleUnits(input.text);
  const accepted: TranslationPart[] = [];
  let first = 0;
  for (const part of parts) {
    const record = part as { from?: unknown; to?: unknown; translation?: unknown } | null;
    const last = units.findIndex((unit, index) => index >= first && unit.to === record?.to);
    const translation = typeof record?.translation === 'string' ? record.translation.trim() : '';
    if (record?.from !== units[first]?.from || last < 0 || !translation) return null;
    const from = units[first].from;
    const to = units[last].to;
    if (translation.length > 5000 || !fits(input.text.slice(from, to), translation, last > first))
      return null;
    accepted.push({ from, to, translation } as TranslationPart);
    first = last + 1;
  }
  return first === units.length ? { parts: accepted } : null;
}

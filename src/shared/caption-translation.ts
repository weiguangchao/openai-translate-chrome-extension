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

const letterLike = /[\p{L}\p{N}]/u;

interface SubtitleUnit {
  readonly from: number;
  readonly to: number;
  readonly word: boolean;
}

export function subtitleUnits(text: string): SubtitleUnit[] {
  const units: SubtitleUnit[] = [];
  for (const part of new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text)) {
    if (!part.segment.trim()) continue;
    const from = part.index;
    const to = from + part.segment.length;
    units.push({ from, to, word: letterLike.test(part.segment.normalize('NFKD')) });
  }
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
      if (letterLike.test(letter)) {
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

function displayPart(
  text: string,
  units: readonly SubtitleUnit[],
  first: number,
  last: number,
  translation: string,
): TranslationPart | null {
  const words = units.slice(first, last + 1).filter((unit) => unit.word).length;
  if (!words) return null;
  const from = units[first].from;
  const to = units[last].to;
  return fits(text.slice(from, to), translation, words > 1)
    ? ({ from, to, translation } as TranslationPart)
    : null;
}

const punctuation = (text: string) => text.replace(/[\s\p{M}]/gu, '');
const opening = /^[\p{Ps}\p{Pi}¿¡]/u;

function quotedSource(source: string): { letters: number; head: string; tail: string } {
  const { offsets } = comparable(source);
  if (!offsets.length) return { letters: 0, head: '', tail: '' };
  const last = offsets[offsets.length - 1];
  return {
    letters: offsets.length,
    head: punctuation(source.slice(0, offsets[0])),
    tail: punctuation(source.slice(last + String.fromCodePoint(source.codePointAt(last)!).length)),
  };
}

function gapSplit(
  gap: readonly string[],
  spaced: readonly boolean[],
  tail: string,
  head: string,
): number {
  const ends = Array.from({ length: gap.length + 1 }, (_, end) => end);
  const joined = (units: readonly string[]) => units.map(punctuation).join('');
  const byHead = head ? ends.find((end) => joined(gap.slice(end)) === head) : undefined;
  const byTail = tail ? ends.find((end) => joined(gap.slice(0, end)) === tail) : undefined;
  const opens = gap.findIndex((unit) => opening.test(unit));
  const attached = spaced.lastIndexOf(true);
  return (
    byHead ??
    byTail ??
    Math.min(opens < 0 ? gap.length : opens, attached < 0 ? gap.length : attached)
  );
}

function alignedParts(
  text: string,
  parts: readonly { source: string; translation: string }[],
): TranslationPart[] | null {
  const units = subtitleUnits(text);
  const { letters, offsets } = comparable(text);
  const unitAt = (index: number) =>
    units.findIndex((unit) => unit.from <= offsets[index] && offsets[index] < unit.to);
  const quoted = parts.map((part) => quotedSource(part.source));
  if (quoted.some((source) => !source.letters)) return null;
  const accepted: TranslationPart[] = [];
  let position = 0;
  let first = 0;
  for (const [index, part] of parts.entries()) {
    position += quoted[index].letters;
    let last = units.length - 1;
    if (position < letters.length) {
      const end = unitAt(position - 1);
      const next = unitAt(position);
      if (end < first || next <= end) return null;
      const span = units.slice(end, next + 1);
      const gap = span.slice(1, -1).map((unit) => text.slice(unit.from, unit.to));
      const spaced = span
        .slice(1)
        .map((unit, previous) => /\s/u.test(text.slice(span[previous].to, unit.from)));
      last = end + gapSplit(gap, spaced, quoted[index].tail, quoted[index + 1].head);
    }
    const accept = displayPart(text, units, first, last, part.translation);
    if (!accept) return null;
    accepted.push(accept);
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
    const accept =
      translation.length <= 5000 && displayPart(input.text, units, first, last, translation);
    if (!accept) return null;
    accepted.push(accept);
    first = last + 1;
  }
  return first === units.length ? { parts: accepted } : null;
}

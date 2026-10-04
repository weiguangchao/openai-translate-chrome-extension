import {
  needsSubtitleSegmentation,
  subtitleDisplayLength,
  subtitleDisplayLimit,
} from './subtitle-segmentation';

export interface TranslationPart {
  from: number;
  to: number;
  translation: string;
}

export type CaptionTranslation = string | { parts: TranslationPart[] };

export interface TranslationInput {
  text: string;
  needsSplit: boolean;
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

function integerValue(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value.trim())) return Number(value.trim());
  return Number.NaN;
}

export function readCaptionTranslation(
  input: TranslationInput,
  value: unknown,
): CaptionTranslation | null {
  const parts = (value as { parts?: unknown } | null)?.parts;
  if (!Array.isArray(parts) || !parts.length) return null;
  const units = subtitleUnits(input.text);
  if (parts.length > units.length) return null;
  if (!input.needsSplit && parts.length !== 1) return null;
  if (input.needsSplit && units.length > 1 && parts.length < 2) return null;
  const accepted: TranslationPart[] = [];
  let previous = 0;
  for (const part of parts) {
    const item = part as {
      translation?: unknown;
      text?: unknown;
      endExclusive?: unknown;
      end?: unknown;
    } | null;
    const translation = partTranslation(item);
    const end = input.needsSplit ? integerValue(item?.endExclusive ?? item?.end) : units.length;
    if (
      !translation ||
      translation.length > 5000 ||
      !Number.isSafeInteger(end) ||
      end <= previous ||
      end > units.length
    )
      return null;
    const from = units[previous].from;
    const to = units[end - 1].to;
    if (input.needsSplit) {
      const source = input.text.slice(from, to);
      const limit = subtitleDisplayLimit * 4;
      if (end - previous > 1 && subtitleDisplayLength(source) > limit) return null;
      if (subtitleDisplayLength(translation) > limit && translation !== source) return null;
    }
    accepted.push({ from, to, translation });
    previous = end;
  }
  if (previous !== units.length) return null;
  return input.needsSplit ? { parts: accepted } : accepted[0].translation;
}

import { needsSubtitleSegmentation, type TextRange } from './segmenter';

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

export function translationInput(text: string, needsSplit: boolean): TranslationInput {
  return { text, needsSplit: needsSplit && needsSubtitleSegmentation(text) };
}

function partTranslation(part: unknown): string {
  const record = part as { translation?: unknown; text?: unknown } | null;
  const value =
    typeof part === 'string'
      ? part
      : typeof record?.translation === 'string'
        ? record.translation
        : record?.text;
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

function verifiedParts(
  text: string,
  lines: readonly TextRange[],
  translations: readonly string[],
): TranslationPart[] | null {
  let end = 0;
  for (const { from, to } of lines) {
    if (
      !Number.isInteger(from) ||
      !Number.isInteger(to) ||
      from < end ||
      to > text.length ||
      text.slice(end, from).trim() ||
      !text.slice(from, to).trim()
    )
      return null;
    end = to;
  }
  if (text.slice(end).trim()) return null;
  return lines.map(
    ({ from, to }, index) => ({ from, to, translation: translations[index] }) as TranslationPart,
  );
}

export function readCaptionTranslation(
  text: string,
  lines: readonly TextRange[],
  value: unknown,
): CaptionTranslation | null {
  const parts = (value as { parts?: unknown } | null)?.parts;
  if (!Array.isArray(parts) || !parts.length) return null;
  const translations = parts.map(partTranslation);
  if (translations.some((translation) => !translation)) return null;
  const whole = joinTranslations(translations);
  if (whole.length > 5000) return null;
  if (lines.length < 2 || translations.length === 1) return whole;
  if (translations.length !== lines.length) return null;
  const verified = verifiedParts(text, lines, translations);
  return verified ? { parts: verified } : whole;
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
  const records = parts as ({ from?: unknown; to?: unknown; translation?: unknown } | null)[];
  const translations = records.map((record) =>
    typeof record?.translation === 'string' ? record.translation.trim() : '',
  );
  if (translations.some((translation) => !translation || translation.length > 5000)) return null;
  const verified = verifiedParts(
    input.text,
    records.map((record) => ({ from: record?.from as number, to: record?.to as number })),
    translations,
  );
  return verified ? { parts: verified } : null;
}

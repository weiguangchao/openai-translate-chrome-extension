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

export function readCaptionTranslation(value: unknown): string | null {
  const parts = (value as { parts?: unknown } | null)?.parts;
  const translations = (Array.isArray(parts) ? parts : [value]).map(partTranslation);
  if (!translations.length || translations.some((translation) => !translation)) return null;
  const whole = joinTranslations(translations);
  return whole.length <= 5000 ? whole : null;
}

export function readStoredTranslation(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const translation = value.trim();
  return translation && translation.length <= 5000 ? translation : null;
}

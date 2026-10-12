export function readStoredTranslation(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const translation = value.trim();
  return translation && translation.length <= 5000 ? translation : null;
}

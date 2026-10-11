function usableTranslation(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const translation = value.trim();
  return translation && translation.length <= 5000 ? translation : null;
}

export function readCaptionTranslation(value: unknown): string | null {
  return usableTranslation((value as { translation?: unknown } | null)?.translation);
}

export function readStoredTranslation(value: unknown): string | null {
  return usableTranslation(value);
}

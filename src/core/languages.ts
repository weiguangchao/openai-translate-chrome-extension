function matchScore(language: string, requested: string): number {
  try {
    const actual = new Intl.Locale(language.replaceAll('_', '-'));
    const target = new Intl.Locale(requested);
    if (actual.toString() === target.toString()) return 2;
    if (
      actual.language === target.language &&
      actual.maximize().script === target.maximize().script
    )
      return 1;
  } catch {}
  return 0;
}

export function languageTrack<T>(
  tracks: readonly T[],
  language: (track: T) => string,
  target: string,
): T | undefined {
  return tracks
    .map((track) => ({ track, score: matchScore(language(track), target) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.track;
}

export const captionDisplayLimit = 90;

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

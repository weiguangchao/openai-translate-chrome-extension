import { readCaptionTranslation } from '../../src/shared/caption-translation';
import type { TextRange } from '../../src/shared/segmenter';

export function rangesOf(text: string, lines: readonly string[]): TextRange[] {
  let end = 0;
  return lines.map((line) => {
    const from = text.indexOf(line, end);
    if (from < 0) throw new Error(`Line not in text: ${line}`);
    end = from + line.length;
    return { from, to: end };
  });
}

export function lineTranslation(
  text: string,
  lines: readonly string[],
  translate: (line: string) => string = (line) => `译文：${line}`,
) {
  const result = readCaptionTranslation(text, rangesOf(text, lines), {
    parts: lines.map(translate),
  });
  if (!result || typeof result === 'string') throw new Error('Expected a translation per line');
  return result;
}

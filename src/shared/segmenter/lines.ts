import { subtitleDisplayLength, subtitleDisplayLimit } from './width';

export interface TextRange {
  readonly from: number;
  readonly to: number;
}

export interface LanguageSegmenter {
  sentenceEnds(text: string): number[];
  lines(text: string): TextRange[];
}

export interface WordBreak {
  readonly at: number;
  readonly cost: number;
}

export interface BreakRules {
  clauseBreaks(text: string): number[];
  wordBreaks(text: string): WordBreak[];
}

const minClauseColumns = 12;
const lineCost = 1000;
const overflowCost = 100000;
const balanceCost = 4;

function trimmed(text: string, from: number, to: number): TextRange {
  while (from < to && /\s/.test(text[from])) from++;
  while (to > from && /\s/.test(text[to - 1])) to--;
  return { from, to };
}

function width(text: string, range: TextRange): number {
  return subtitleDisplayLength(text.slice(range.from, range.to));
}

function cut(text: string, range: TextRange, breaks: readonly number[]): TextRange[] {
  const lines: TextRange[] = [];
  let from = range.from;
  for (const at of [...breaks, range.to]) {
    const line = trimmed(text, from, at);
    if (line.to > line.from) lines.push(line);
    from = at;
  }
  return lines;
}

function clauses(text: string, range: TextRange, breaks: readonly number[]): TextRange[] {
  const inside = [...new Set(breaks)]
    .filter((at) => at > range.from && at < range.to)
    .sort((a, b) => a - b);
  const kept: number[] = [];
  let from = range.from;
  inside.forEach((at, index) => {
    const next = inside[index + 1] ?? range.to;
    if (
      width(text, trimmed(text, from, at)) >= minClauseColumns &&
      width(text, trimmed(text, at, next)) >= minClauseColumns
    ) {
      kept.push(at);
      from = at;
    }
  });
  return cut(text, range, kept);
}

function fewestLines(text: string, range: TextRange, candidates: readonly WordBreak[]): number[] {
  const points = [
    { at: range.from, cost: 0 },
    ...candidates.filter((point) => point.at > range.from && point.at < range.to),
    { at: range.to, cost: 0 },
  ];
  const target = width(text, range) / Math.ceil(width(text, range) / subtitleDisplayLimit);
  const best = [0];
  const previous = [0];
  for (let end = 1; end < points.length; end++) {
    best[end] = Infinity;
    for (let start = end - 1; start >= 0; start--) {
      const columns = width(text, trimmed(text, points[start].at, points[end].at));
      if (columns > subtitleDisplayLimit && start < end - 1) break;
      const cost =
        best[start] +
        lineCost +
        Math.max(0, columns - subtitleDisplayLimit) * overflowCost +
        balanceCost * ((columns - target) / subtitleDisplayLimit) ** 2 +
        (end < points.length - 1 ? points[end].cost : 0);
      if (cost < best[end]) {
        best[end] = cost;
        previous[end] = start;
      }
    }
  }
  const breaks: number[] = [];
  for (let end = previous[points.length - 1]; end > 0; end = previous[end])
    breaks.unshift(points[end].at);
  return breaks;
}

export function fitLines(text: string, rules: BreakRules): TextRange[] {
  const range = trimmed(text, 0, text.length);
  if (range.to === range.from) return [];
  if (width(text, range) <= subtitleDisplayLimit) return [range];
  const words = rules.wordBreaks(text);
  const pieces = clauses(text, range, rules.clauseBreaks(text)).flatMap((clause) =>
    width(text, clause) > subtitleDisplayLimit
      ? cut(text, clause, fewestLines(text, clause, words))
      : [clause],
  );
  const joins = pieces.slice(1).map((piece) => ({ at: piece.from, cost: 0 }));
  return cut(text, range, fewestLines(text, range, joins));
}

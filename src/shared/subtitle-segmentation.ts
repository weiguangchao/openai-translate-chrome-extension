export const subtitleDisplayLimit = 80;

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

export function needsSubtitleSegmentation(text: string): boolean {
  return subtitleDisplayLength(text) > subtitleDisplayLimit;
}

export function parseModelJson(response: string): unknown {
  return JSON.parse(response.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, '$1'));
}

function stripOpeningFence(source: string): string {
  const text = source.replace(/^\uFEFF/, '').trimStart();
  const line = /^```(?:json)?[^\S\r\n]*\r?\n/i.exec(text);
  if (line) return text.slice(line[0].length);
  const inline = /^```(?:json)?(?=\s*[{\[])/i.exec(text);
  if (inline) return text.slice(inline[0].length).trimStart();
  if (/^```(?:json)?\s*$/i.test(text)) return '';
  return text;
}

function skipSpace(text: string, index: number): number {
  let cursor = index;
  while (cursor < text.length) {
    const character = text[cursor];
    if (character === ' ' || character === '\n' || character === '\r' || character === '\t') {
      cursor++;
      continue;
    }
    if (text.startsWith('```', cursor)) {
      const lineEnd = text.indexOf('\n', cursor);
      cursor = lineEnd < 0 ? text.length : lineEnd + 1;
      continue;
    }
    break;
  }
  return cursor;
}

export function scanTranslationResults(source: string): unknown[] {
  const text = stripOpeningFence(source);
  const start = findArray(text, 'results');
  if (start < 0) return [];
  const values: unknown[] = [];
  let index = skipSpace(text, start + 1);
  while (index < text.length && text[index] !== ']') {
    const end = skipValue(text, index);
    if (end < 0) break;
    try {
      values.push(JSON.parse(text.slice(index, end)));
    } catch {
      break;
    }
    index = skipSpace(text, end);
    if (text[index] !== ',') break;
    index = skipSpace(text, index + 1);
  }
  return values;
}

function findArray(text: string, name: string): number {
  let index = skipSpace(text, 0);
  if (index >= text.length || text[index] !== '{') return -1;
  index++;
  while (index < text.length) {
    index = skipSpace(text, index);
    if (index >= text.length || text[index] === '}') return -1;
    if (text[index] !== '"') return -1;
    const key = readString(text, index);
    if (!key) return -1;
    index = skipSpace(text, key.end);
    if (text[index] !== ':') return -1;
    index = skipSpace(text, index + 1);
    if (key.value === name) return text[index] === '[' ? index : -1;
    const next = skipValue(text, index);
    if (next < 0) return -1;
    index = skipSpace(text, next);
    if (text[index] === ',') index++;
  }
  return -1;
}

function readString(text: string, index: number): { value: string; end: number } | null {
  if (text[index] !== '"') return null;
  let value = '';
  let cursor = index + 1;
  while (cursor < text.length) {
    const character = text[cursor];
    if (character === '"') return { value, end: cursor + 1 };
    if (character === '\\') {
      if (cursor + 1 >= text.length) return null;
      const escaped = text[cursor + 1];
      const simple: Record<string, string> = {
        '"': '"',
        '\\': '\\',
        '/': '/',
        b: '\b',
        f: '\f',
        n: '\n',
        r: '\r',
        t: '\t',
      };
      if (Object.hasOwn(simple, escaped)) {
        value += simple[escaped];
        cursor += 2;
        continue;
      }
      if (escaped === 'u') {
        if (cursor + 6 > text.length) return null;
        const hex = text.slice(cursor + 2, cursor + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) return null;
        value += String.fromCharCode(Number.parseInt(hex, 16));
        cursor += 6;
        continue;
      }
      return null;
    }
    if (character === '\n' || character === '\r') return null;
    value += character;
    cursor++;
  }
  return null;
}

function skipValue(text: string, index: number): number {
  const start = skipSpace(text, index);
  if (start >= text.length) return -1;
  const character = text[start];
  if (character === '"') return readString(text, start)?.end ?? -1;
  if (character === '{') return skipContainer(text, start, '{', '}');
  if (character === '[') return skipContainer(text, start, '[', ']');
  if (character === '-' || (character >= '0' && character <= '9')) {
    let cursor = start + 1;
    while (cursor < text.length && /[0-9eE+.-]/.test(text[cursor])) cursor++;
    return cursor > start + (character === '-' ? 1 : 0) ? cursor : -1;
  }
  for (const literal of ['true', 'false', 'null'])
    if (text.startsWith(literal, start)) return start + literal.length;
  return -1;
}

function skipContainer(text: string, index: number, open: string, close: string): number {
  let depth = 0;
  let cursor = index;
  while (cursor < text.length) {
    const character = text[cursor];
    if (character === '"') {
      const parsed = readString(text, cursor);
      if (!parsed) return -1;
      cursor = parsed.end;
      continue;
    }
    if (character === open) depth++;
    else if (character === close) {
      depth--;
      if (depth === 0) return cursor + 1;
    }
    cursor++;
  }
  return -1;
}

function isComma(character: string): boolean {
  return character === ',' || character === '，';
}

export function splitSubtitleAtCommas(text: string): { from: number; to: number }[] {
  const cuts: number[] = [];
  for (let index = 0; index < text.length; index++) if (isComma(text[index])) cuts.push(index + 1);
  cuts.push(text.length);
  const segments: { from: number; to: number }[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    while (cursor < text.length && /\s/u.test(text[cursor])) cursor++;
    if (cursor >= text.length) break;
    let to = -1;
    for (const cut of cuts) {
      if (cut <= cursor) continue;
      const end = cursor + text.slice(cursor, cut).trimEnd().length;
      if (end <= cursor) continue;
      if (subtitleDisplayLength(text.slice(cursor, end)) <= subtitleDisplayLimit) to = end;
      else break;
    }
    if (to <= cursor) {
      const cut = cuts.find((item) => item > cursor) ?? text.length;
      to = cursor + text.slice(cursor, cut).trimEnd().length;
    }
    if (to <= cursor) break;
    segments.push({ from: cursor, to });
    cursor = to;
  }
  return segments;
}

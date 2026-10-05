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

export function modelAnswer(source: string): string {
  const text = source.replace(/^\uFEFF/, '');
  const marker = '</think>';
  const end = text.toLowerCase().lastIndexOf(marker);
  if (end >= 0) {
    const after = text.slice(end + marker.length).trim();
    if (after) return after;
    return text
      .slice(0, end)
      .replace(/<think>/gi, '')
      .trimStart();
  }
  return text.replace(/<think>/gi, '').trimStart();
}

function hasTranslationPayload(value: unknown): boolean {
  if (Array.isArray(value))
    return value.some(
      (item) =>
        typeof item === 'string' ||
        (!!item &&
          typeof item === 'object' &&
          ('parts' in item || 'translation' in item || 'text' in item)),
    );
  if (!value || typeof value !== 'object') return false;
  const record = value as { results?: unknown; translations?: unknown };
  return Array.isArray(record.results) || Array.isArray(record.translations);
}

function lastTranslationPayload(text: string): unknown {
  let payload: unknown;
  let index = 0;
  while (index < text.length) {
    const objectAt = text.indexOf('{', index);
    const arrayAt = text.indexOf('[', index);
    const start = objectAt < 0 ? arrayAt : arrayAt < 0 ? objectAt : Math.min(objectAt, arrayAt);
    if (start < 0) break;
    const end = skipValue(text, start);
    if (end < 0) {
      index = start + 1;
      continue;
    }
    try {
      const value = JSON.parse(text.slice(start, end));
      if (hasTranslationPayload(value)) payload = value;
    } catch {
      index = start + 1;
      continue;
    }
    index = end;
  }
  return payload;
}

export function parseModelJson(response: string): unknown {
  const text = modelAnswer(response).trim();
  const fenced = text.replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, '$1');
  try {
    const value = JSON.parse(fenced);
    if (typeof value !== 'string') return value;
    return JSON.parse(value);
  } catch {
    const payload = lastTranslationPayload(stripOpeningFence(text));
    if (payload === undefined) throw new SyntaxError('Invalid model JSON');
    return payload;
  }
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
  let text = stripOpeningFence(modelAnswer(source));
  if (!text.trimStart().startsWith('{')) {
    const objectAt = text.indexOf('{');
    if (objectAt < 0) return [];
    text = text.slice(objectAt);
  }
  const start = findMember(text, 'results');
  if (start < 0 || text[start] !== '[') return [];
  const values: unknown[] = [];
  let index = skipSpace(text, start + 1);
  while (index < text.length && text[index] !== ']') {
    const end = skipValue(text, index);
    if (end < 0) break;
    const value = scannedResult(text, index, end);
    if (value !== undefined) values.push(value);
    index = skipSpace(text, end);
    if (text[index] !== ',') break;
    index = skipSpace(text, index + 1);
  }
  return values;
}

function scannedResult(text: string, start: number, end: number): unknown {
  const result = text.slice(start, end);
  const whole = parsedJson(result);
  if (whole) return whole.value;
  const at = findMember(result, 'id');
  const idEnd = at < 0 ? -1 : skipValue(result, at);
  const id = idEnd < 0 ? null : parsedJson(result.slice(at, idEnd));
  return id ? { id: id.value } : undefined;
}

function parsedJson(text: string): { value: unknown } | null {
  try {
    return { value: JSON.parse(text) as unknown };
  } catch {
    return null;
  }
}

function findMember(text: string, name: string): number {
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
    if (key.value === name) return index;
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

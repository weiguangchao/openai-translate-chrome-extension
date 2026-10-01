import type { CueTiming, TimedCue } from './timeline';
import { needsSubtitleSegmentation } from '../shared/subtitle-segmentation';

export type YoutubeCaptionKind = 'authored' | 'asr';

interface Segment {
  utf8?: string;
  tOffsetMs?: number;
}
interface CaptionEvent extends TimedCue {
  segments: Segment[];
}
interface TextSpan extends TimedCue {
  from: number;
  to: number;
  wordTimed: boolean;
}

const clean = (text: string) => text.replace(/\u200b/g, '');
const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u;

function readEvents(value: unknown): CaptionEvent[] {
  const events = (value as { events?: unknown } | null)?.events;
  if (!Array.isArray(events)) return [];
  const cues: CaptionEvent[] = [];
  const seen = new Set<string>();
  for (const event of events) {
    if (!Array.isArray(event?.segs) || !Number.isFinite(event.tStartMs)) continue;
    const segments = (event.segs as Segment[]).filter(
      (segment) => typeof segment?.utf8 === 'string',
    );
    const text = clean(segments.map((segment) => segment.utf8).join(''))
      .split('\n')
      .map((line) => line.trim())
      .join('\n')
      .trim();
    if (!text || text.length > 5000 || !Number.isFinite(event.dDurationMs)) continue;
    const startTime = event.tStartMs / 1000;
    const endTime = startTime + event.dDurationMs / 1000;
    if (startTime < 0 || endTime <= startTime) continue;
    const key = JSON.stringify([startTime, endTime, text]);
    if (seen.has(key)) continue;
    seen.add(key);
    cues.push({ startTime, endTime, text, segments });
  }
  return cues.sort((a, b) => a.startTime - b.startTime).slice(0, 30000);
}

function timedParts(event: CaptionEvent, endTime: number): TimedCue[] {
  const parts: TimedCue[] = [];
  for (const segment of event.segments) {
    const text = clean(segment.utf8!);
    const offset = segment.tOffsetMs;
    const timestamp = event.startTime + (offset ?? NaN) / 1000;
    const startTime =
      Number.isFinite(timestamp) && timestamp >= event.startTime && timestamp < endTime
        ? timestamp
        : undefined;
    const previous = parts.at(-1);
    if (
      !previous ||
      (startTime !== undefined && startTime > previous.startTime && startTime < endTime)
    ) {
      if (previous) previous.endTime = startTime!;
      parts.push({ text, startTime: startTime ?? event.startTime, endTime });
    } else previous.text += text;
  }
  return parts;
}

function sentenceStops(text: string): number[] {
  const stops: number[] = [];
  for (const match of text.matchAll(/[.!?。！？؟।]+["'”’」』）)\]]*/gu)) {
    const end = match.index + match[0].length;
    const punctuation = match[0][0];
    if (punctuation === '.') {
      const before = text.slice(0, match.index);
      const after = text.slice(end);
      if (/\d$/.test(before) && /^\d/.test(after)) continue;
      if (/\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e)$/i.test(before)) continue;
      if (/(?:^|\s)[A-Z]$/.test(before) && /^\s+[A-Z]/.test(after)) continue;
      if (/\b(?:[A-Za-z]\.)+[A-Za-z]$/.test(before) && /^\s+\p{Ll}/u.test(after)) continue;
    }
    if (end < text.length && !/\s/.test(text[end]) && /[.!?]/.test(punctuation)) continue;
    stops.push(end);
  }
  return stops;
}

function requestWindows(text: string): number[] {
  if (text.length <= 5000) return [text.length];
  const stops: number[] = [];
  let from = 0;
  for (const word of new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text)) {
    if (word.index + word.segment.length - from > 5000 && word.index > from) {
      stops.push(word.index);
      from = word.index;
    }
  }
  return [...stops, text.length];
}

function asSentences(events: CaptionEvent[], kind: YoutubeCaptionKind): TimedCue[] {
  const spans: TextSpan[] = [];
  const pauses: number[] = [];
  let text = '';
  for (let index = 0; index < events.length; index++) {
    const event = events[index];
    const endTime = Math.min(event.endTime, events[index + 1]?.startTime ?? Infinity);
    if (endTime <= event.startTime) continue;
    const parts = timedParts(event, endTime);
    if (
      text &&
      !/\s$/.test(text) &&
      !/^\s/.test(parts[0]?.text ?? '') &&
      !(cjk.test(text.at(-1)!) && cjk.test(parts[0]?.text[0] ?? ''))
    )
      text += ' ';
    const wordTimed =
      parts.length > 1 || event.segments.some((segment) => Number.isFinite(segment.tOffsetMs));
    for (const part of parts) {
      const previous = spans.at(-1);
      const words = previous?.text.trim().split(/\s+/).length ?? 0;
      const wordPause =
        kind === 'asr' &&
        previous?.wordTimed &&
        wordTimed &&
        words === 1 &&
        part.startTime - previous!.startTime >= 1.5;
      if (previous && (part.startTime - previous.endTime >= 0.8 || wordPause)) {
        pauses.push(text.length);
        if (wordPause) previous.endTime = Math.min(previous.endTime, previous.startTime + 0.6);
      }
      const from = text.length;
      text += part.text;
      if (part.text.trim()) spans.push({ ...part, from, to: text.length, wordTimed });
    }
  }
  const naturalStops = new Set(sentenceStops(text));
  if (kind === 'asr' || !naturalStops.size) for (const pause of pauses) naturalStops.add(pause);
  const boundaries = [...new Set([...naturalStops, text.length])].sort((a, b) => a - b);
  const sentences: TimedCue[] = [];
  let from = 0;
  let spanIndex = 0;
  for (const boundary of boundaries) {
    const stops = requestWindows(text.slice(from, boundary)).map((offset) => from + offset);
    for (const to of stops) {
      const raw = text.slice(from, to);
      const content = raw.replace(/\s+/g, ' ').trim();
      const first = from + raw.length - raw.trimStart().length;
      const last = to - (raw.length - raw.trimEnd().length);
      while (spanIndex < spans.length && spans[spanIndex].to <= first) spanIndex++;
      const startSpan = spans[spanIndex];
      let endIndex = spanIndex;
      while (endIndex + 1 < spans.length && spans[endIndex + 1].from < last) endIndex++;
      const endSpan = spans[endIndex];
      if (content && startSpan && endSpan) {
        const at = (span: TextSpan, position: number) => {
          const left = span.from + span.text.length - span.text.trimStart().length;
          const right = span.to - (span.text.length - span.text.trimEnd().length);
          const ratio = Math.max(0, Math.min(1, (position - left) / Math.max(1, right - left)));
          return span.startTime + (span.endTime - span.startTime) * ratio;
        };
        const startTime = at(startSpan, first);
        const endTime = at(endSpan, last);
        if (endTime > startTime) {
          const cue: TimedCue = { startTime, endTime, text: content };
          if (needsSubtitleSegmentation(content)) {
            const timing: CueTiming[] = [];
            for (let index = spanIndex; index <= endIndex; index++) {
              const span = spans[index];
              const left = Math.max(
                first,
                span.from + span.text.length - span.text.trimStart().length,
              );
              const right = Math.min(
                last,
                span.to - (span.text.length - span.text.trimEnd().length),
              );
              if (right > left)
                timing.push({
                  from: text.slice(first, left).replace(/\s+/g, ' ').length,
                  to: text.slice(first, right).replace(/\s+/g, ' ').length,
                  startTime: at(span, left),
                  endTime: at(span, right),
                });
            }
            cue.timing = timing;
          }
          sentences.push(cue);
        }
      }
      from = to;
    }
  }
  return sentences;
}

export function parseYoutubeCaptions(value: unknown, kind: YoutubeCaptionKind): TimedCue[] {
  const events = readEvents(value);
  const grouped: CaptionEvent[] = [];
  for (const event of events) {
    const previous = grouped.at(-1);
    if (kind === 'authored' && previous?.startTime === event.startTime) {
      if (previous.text !== event.text) previous.text += ` ${event.text}`;
      previous.endTime = Math.max(previous.endTime, event.endTime);
      previous.segments = [{ utf8: previous.text }];
    } else grouped.push(event);
  }
  return asSentences(grouped, kind);
}

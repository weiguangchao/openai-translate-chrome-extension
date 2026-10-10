import type { TimedCue } from '../../core/cues';
import { subtitleCaptions } from '../../core/sentences';

export type YoutubeCaptionKind = 'authored' | 'asr';

interface Segment {
  utf8?: string;
  tOffsetMs?: number;
}
interface CaptionEvent extends TimedCue {
  segments: Segment[];
}

const clean = (text: string) => text.replace(/\u200b/g, '');

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

export function parseYoutubeCaptions(
  value: unknown,
  kind: YoutubeCaptionKind,
  language: string,
): TimedCue[] {
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
  return subtitleCaptions(
    grouped.flatMap((event, index) => {
      const endTime = Math.min(event.endTime, grouped[index + 1]?.startTime ?? Infinity);
      if (endTime <= event.startTime) return [];
      const parts = timedParts(event, endTime);
      return [
        {
          ...event,
          endTime,
          parts,
          wordTimed:
            parts.length > 1 ||
            event.segments.some((segment) => Number.isFinite(segment.tOffsetMs)),
        },
      ];
    }),
    language,
    kind === 'asr',
  );
}

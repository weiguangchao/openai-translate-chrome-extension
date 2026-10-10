import {
  behindGraceSeconds,
  planLookaheadCues,
  planLookaheadSeconds,
  translationBatchLimit,
} from '../shared/limits';
import type { PlaybackCue } from '../shared/playback-plan';
import type { TimedCue } from './cues';

export type TimedCaption = Readonly<TimedCue> & { readonly segment: number };

const captionCache = new WeakMap<readonly TimedCue[], TimedCaption[]>();

export function timedCaptions(cues: readonly TimedCue[]): readonly TimedCaption[] {
  const cached = captionCache.get(cues);
  if (cached) return cached;
  const captions = cues
    .filter((cue) => cue.text)
    .map((cue, index) => ({ ...cue, segment: Math.floor(index / translationBatchLimit) }));
  captionCache.set(cues, captions);
  return captions;
}

function activeAt<T extends TimedCue>(cues: readonly T[], at: number): T[] {
  return cues.filter((cue) => cue.startTime <= at && at < cue.endTime && cue.text);
}

function joinedText(cues: readonly TimedCue[]): string {
  return cues
    .map((cue) => cue.text)
    .join('\n')
    .trim();
}

export function captionAt(cues: readonly TimedCue[], time: number): string {
  return joinedText(activeAt(cues, time));
}

export function playbackCues(captions: readonly TimedCaption[], time: number): PlaybackCue[] {
  const first = captions.findIndex((caption) => caption.endTime > time - behindGraceSeconds);
  if (first < 0) return [];
  const horizon = time + planLookaheadSeconds;
  const pool = captions
    .slice(first)
    .filter((caption) => caption.endTime > time - behindGraceSeconds && caption.startTime < horizon)
    .slice(0, planLookaheadCues);
  if (!pool.length) return [];
  const points = [
    ...new Set([time, ...pool.flatMap((caption) => [caption.startTime, caption.endTime])]),
  ]
    .filter((at) => at <= horizon)
    .sort((left, right) => left - right);
  const units: PlaybackCue[] = [];
  for (let index = 0; index < points.length; index++) {
    const at = points[index];
    const active = activeAt(pool, at);
    const text = joinedText(active);
    if (!text) continue;
    const next = points[index + 1] ?? Math.max(...active.map((cue) => cue.endTime));
    const end = Math.min(next, ...active.map((cue) => cue.endTime));
    const start = at;
    const previous = units[units.length - 1];
    if (previous && previous.end === start && previous.text === text) {
      units[units.length - 1] = { ...previous, end: Math.max(previous.end, end) };
      continue;
    }
    if (end <= time - behindGraceSeconds) continue;
    units.push({ text, start, end });
    if (units.length >= planLookaheadCues) break;
  }
  return units;
}

export function captionWindow(
  captions: readonly TimedCaption[],
  time: number,
): { current: string; items: readonly PlaybackCue[] } {
  return { current: captionAt(captions, time), items: playbackCues(captions, time) };
}

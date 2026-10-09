import {
  behindGraceSeconds,
  planLookaheadCues,
  planLookaheadSeconds,
  translationBatchLimit,
} from '../shared/limits';
import type { PlaybackCue } from '../shared/playback-plan';
import { needsSubtitleSegmentation } from '../shared/subtitle-segmentation';
import type { TranslationPart } from '../shared/caption-translation';
import type { TimedCue } from './cues';

export type SourceSentence = TimedCue & { readonly kind?: never };

export type TimedCaption = Readonly<TimedCue> & {
  readonly kind: 'input';
  readonly segment: number;
} & ({ readonly needsSplit: true } | { readonly needsSplit: false });

export type DisplayCaption = Readonly<TimedCue> & {
  readonly kind: 'display';
  readonly translation: string;
};

function boundaryTime(cue: TimedCue, position: number): number {
  const span = cue.timing?.find((part) => part.to > position) ?? {
    from: 0,
    to: cue.text.length,
    startTime: cue.startTime,
    endTime: cue.endTime,
  };
  const ratio = Math.max(0, Math.min(1, (position - span.from) / (span.to - span.from)));
  return span.startTime + (span.endTime - span.startTime) * ratio;
}

function splitTimedCue(cue: TimedCue, parts: readonly { from: number; to: number }[]): TimedCue[] {
  const starts = parts.map((part, index) => (index ? boundaryTime(cue, part.from) : cue.startTime));
  return parts.map((part, index) => ({
    startTime: starts[index],
    endTime: starts[index + 1] ?? cue.endTime,
    text: cue.text.slice(part.from, part.to),
  }));
}

export function translatedCaptions(
  cue: SourceSentence | TimedCaption,
  parts: readonly TranslationPart[],
): readonly DisplayCaption[] {
  let captions = splitTimedCue(cue, parts);
  if (
    captions.some(
      (caption) =>
        !Number.isFinite(caption.startTime) ||
        !Number.isFinite(caption.endTime) ||
        caption.endTime <= caption.startTime,
    )
  )
    captions = splitTimedCue({ ...cue, timing: undefined }, parts);
  return captions.map((caption, index) => ({
    ...caption,
    kind: 'display',
    translation: parts[index].translation,
  }));
}

const captionCache = new WeakMap<readonly TimedCue[], TimedCaption[]>();

export function timedCaptions(cues: readonly SourceSentence[]): readonly TimedCaption[] {
  const cached = captionCache.get(cues);
  if (cached) return cached;
  const sentences = cues.filter((cue) => cue.text);
  const captions: TimedCaption[] = [];
  let latestEnd = -Infinity;
  sentences.forEach((sentence, index) => {
    const overlapping =
      latestEnd > sentence.startTime ||
      (sentences[index + 1]?.startTime ?? Infinity) < sentence.endTime;
    latestEnd = Math.max(latestEnd, sentence.endTime);
    captions.push({
      ...sentence,
      kind: 'input',
      segment: Math.floor(index / translationBatchLimit),
      needsSplit: !overlapping && needsSubtitleSegmentation(sentence.text),
    });
  });
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
    const needsSplit = active.length === 1 && active[0].needsSplit === true;
    const start = at;
    const previous = units[units.length - 1];
    if (
      previous &&
      previous.end === start &&
      previous.text === text &&
      previous.needsSplit === needsSplit
    ) {
      units[units.length - 1] = { ...previous, end: Math.max(previous.end, end) };
      continue;
    }
    if (end <= time - behindGraceSeconds) continue;
    units.push({ text, start, end, needsSplit });
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

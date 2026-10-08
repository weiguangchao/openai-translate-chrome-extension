import {
  openingBatchCount,
  openingSoloCount,
  prefetchSegmentCount,
  translationBatchLimit,
} from '../shared/limits';
import { needsSubtitleSegmentation } from '../shared/subtitle-segmentation';
import type { PrefetchItem, TranslationPart } from '../shared/caption-translation';
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

export function captionWindow(
  captions: readonly TimedCaption[],
  time: number,
): { current: string; items: readonly PrefetchItem[] } {
  const first = captions.findIndex((caption) => caption.endTime > time);
  let end = first;
  if (first >= 0)
    while (
      end < captions.length &&
      captions[end].segment < captions[first].segment + prefetchSegmentCount
    )
      end++;
  const remaining = first < 0 ? [] : captions.slice(first, end);
  const boundaries = [...new Set(remaining.flatMap((cue) => [cue.startTime, cue.endTime]))]
    .filter((at) => at > time)
    .sort((a, b) => a - b);
  const items: PrefetchItem[] = [];
  for (const at of [time, ...boundaries]) {
    const active = activeAt(remaining, at);
    const text = joinedText(active);
    const split = active.length === 1 && active[0].needsSplit === true;
    if (!text || items.some((item) => item.text === text && item.needsSplit === split)) continue;
    items.push({ text, segment: active[0].segment, needsSplit: split });
  }
  return { current: captionAt(remaining, time), items };
}

export function openingPrefetch(
  captions: readonly TimedCaption[],
  time: number,
): readonly PrefetchItem[] {
  const first = captions.findIndex((caption) => caption.endTime > time);
  if (first < 0) return [];
  let segmentEnd = first;
  while (
    segmentEnd < captions.length &&
    captions[segmentEnd].segment < captions[first].segment + prefetchSegmentCount
  )
    segmentEnd++;
  const burstEnd = Math.min(captions.length, first + openingSoloCount + openingBatchCount);
  return captions.slice(first, Math.max(segmentEnd, burstEnd)).map((caption, index) => ({
    text: caption.text,
    segment: caption.segment,
    needsSplit: caption.needsSplit,
    ...(index < openingSoloCount
      ? { solo: true }
      : index < openingSoloCount + openingBatchCount
        ? { batch: 0 }
        : {}),
  }));
}

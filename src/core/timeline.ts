import { prefetchSegmentCount, translationBatchLimit } from '../shared/limits';
import { needsSubtitleSegmentation, splitSubtitleAtCommas } from '../shared/subtitle-segmentation';
import type { TranslationPart } from '../shared/caption-translation';
import type { TimedCue } from './cues';

export interface TimedCaption extends TimedCue {
  segment: number;
  needsSplit?: boolean;
}

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

function splitSentence(cue: TimedCue, overlapping: boolean): Omit<TimedCaption, 'segment'>[] {
  const parts =
    !overlapping && needsSubtitleSegmentation(cue.text) ? splitSubtitleAtCommas(cue.text) : [];
  const captions = parts.length < 2 ? [cue] : splitTimedCue(cue, parts);
  return captions.map((caption) => ({
    ...caption,
    ...(!overlapping && needsSubtitleSegmentation(caption.text) ? { needsSplit: true } : {}),
  }));
}

function splitTimedCue(cue: TimedCue, parts: { from: number; to: number }[]): TimedCue[] {
  const starts = parts.map((part, index) => (index ? boundaryTime(cue, part.from) : cue.startTime));
  return parts.map((part, index) => ({
    startTime: starts[index],
    endTime: starts[index + 1] ?? cue.endTime,
    text: cue.text.slice(part.from, part.to),
    ...(cue.timing
      ? {
          timing: cue.timing
            .filter((span) => span.to > part.from && span.from < part.to)
            .map((span) => {
              const from = Math.max(span.from, part.from);
              const to = Math.min(span.to, part.to);
              const at = (position: number) =>
                span.startTime +
                ((span.endTime - span.startTime) * (position - span.from)) / (span.to - span.from);
              return {
                from: from - part.from,
                to: to - part.from,
                startTime: at(from),
                endTime: at(to),
              };
            }),
        }
      : {}),
  }));
}

export function translatedCaptions(
  cue: TimedCue,
  parts: TranslationPart[],
): (TimedCue & { translation: string })[] {
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
  return captions.map((caption, index) => ({ ...caption, translation: parts[index].translation }));
}

const captionCache = new WeakMap<readonly TimedCue[], TimedCaption[]>();

export function timedCaptions(cues: readonly TimedCue[]): TimedCaption[] {
  const cached = captionCache.get(cues);
  if (cached) return cached;
  const sentences = cues.filter((cue) => cue.text);
  const captions: TimedCaption[] = [];
  let segment = 0;
  let size = 0;
  let latestEnd = -Infinity;
  sentences.forEach((sentence, index) => {
    const overlapping =
      latestEnd > sentence.startTime ||
      (sentences[index + 1]?.startTime ?? Infinity) < sentence.endTime;
    latestEnd = Math.max(latestEnd, sentence.endTime);
    const parts = splitSentence(sentence, overlapping);
    if (size && size + parts.length > translationBatchLimit) {
      segment++;
      size = 0;
    }
    for (const part of parts) {
      if (size === translationBatchLimit) {
        segment++;
        size = 0;
      }
      captions.push({ ...part, segment });
      size++;
    }
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

export function captionWindow(captions: readonly TimedCaption[], time: number) {
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
  const texts: string[] = [];
  const segments: number[] = [];
  const needsSplit: boolean[] = [];
  for (const at of [time, ...boundaries]) {
    const active = activeAt(remaining, at);
    const text = joinedText(active);
    const split = active.length === 1 && active[0].needsSplit === true;
    if (!text || texts.some((item, index) => item === text && needsSplit[index] === split))
      continue;
    texts.push(text);
    segments.push(active[0].segment);
    needsSplit.push(split);
  }
  return { current: captionAt(remaining, time), texts, segments, needsSplit };
}

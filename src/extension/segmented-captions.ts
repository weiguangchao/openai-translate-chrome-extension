import {
  needsSubtitleSegmentation,
  splitSubtitleAtCommas,
  type SegmentedTranslation,
} from '../shared/subtitle-segmentation';
import type { TimedCue } from './timeline';

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

export function sourceCaptionAt(cue: TimedCue, time: number): string | null {
  if (time < cue.startTime || time >= cue.endTime) return null;
  const parts = needsSubtitleSegmentation(cue.text) ? splitSubtitleAtCommas(cue.text) : [];
  if (parts.length < 2) return cue.text;
  for (let index = parts.length - 1; index >= 0; index--) {
    const part = parts[index];
    if (time >= (index === 0 ? cue.startTime : boundaryTime(cue, part.from)))
      return cue.text.slice(part.from, part.to);
  }
  return null;
}

export function translatedCaptionAt(
  cue: TimedCue,
  result: SegmentedTranslation,
  time: number,
): { text: string; translation: string } | null {
  if (time < cue.startTime || time >= cue.endTime) return null;
  for (let index = result.segments.length - 1; index >= 0; index--) {
    const segment = result.segments[index];
    if (time >= (index === 0 ? cue.startTime : boundaryTime(cue, segment.from)))
      return { text: cue.text.slice(segment.from, segment.to), translation: segment.translation };
  }
  return null;
}

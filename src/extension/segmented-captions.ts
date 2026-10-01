import type { SegmentedTranslation } from '../shared/subtitle-segmentation';
import type { TimedCue } from './timeline';

export function translatedCaptionAt(
  cue: TimedCue,
  result: SegmentedTranslation,
  time: number,
): { text: string; translation: string } | null {
  if (time < cue.startTime || time >= cue.endTime) return null;
  const at = (position: number) => {
    const span = cue.timing?.find((part) => part.to > position) ?? {
      from: 0,
      to: cue.text.length,
      startTime: cue.startTime,
      endTime: cue.endTime,
    };
    const ratio = Math.max(0, Math.min(1, (position - span.from) / (span.to - span.from)));
    return span.startTime + (span.endTime - span.startTime) * ratio;
  };
  for (let index = result.segments.length - 1; index >= 0; index--) {
    const segment = result.segments[index];
    if (time >= (index === 0 ? cue.startTime : at(segment.from)))
      return { text: cue.text.slice(segment.from, segment.to), translation: segment.translation };
  }
  return null;
}

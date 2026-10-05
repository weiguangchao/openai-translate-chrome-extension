export interface CueTiming {
  readonly from: number;
  readonly to: number;
  readonly startTime: number;
  readonly endTime: number;
}

export interface TimedCue {
  startTime: number;
  endTime: number;
  text: string;
  timing?: readonly CueTiming[];
}

export const cueLimit = 30000;
export const cueTextLimit = 5000;

function validTiming(cue: TimedCue, timing: unknown): boolean {
  return (
    timing === undefined ||
    (Array.isArray(timing) &&
      timing.length <= cueTextLimit &&
      timing.every(
        (span: CueTiming, index) =>
          span &&
          Number.isInteger(span.from) &&
          Number.isInteger(span.to) &&
          span.from >= 0 &&
          span.to > span.from &&
          span.to <= cue.text.length &&
          Number.isFinite(span.startTime) &&
          Number.isFinite(span.endTime) &&
          span.startTime >= cue.startTime &&
          span.endTime > span.startTime &&
          span.endTime <= cue.endTime &&
          (index === 0 ||
            (span.from >= timing[index - 1].to && span.startTime >= timing[index - 1].endTime)),
      ))
  );
}

export function validCues(value: unknown): value is TimedCue[] {
  return (
    Array.isArray(value) &&
    value.length <= cueLimit &&
    value.every(
      (cue: TimedCue) =>
        cue &&
        Number.isFinite(cue.startTime) &&
        Number.isFinite(cue.endTime) &&
        cue.startTime >= 0 &&
        cue.endTime > cue.startTime &&
        typeof cue.text === 'string' &&
        cue.text.length <= cueTextLimit &&
        validTiming(cue, cue.timing),
    )
  );
}

export function copyCues(cues: readonly TimedCue[]): TimedCue[] {
  return cues
    .map(({ startTime, endTime, text, timing }) => ({
      startTime,
      endTime,
      text,
      ...(timing
        ? {
            timing: timing.map(({ from, to, startTime, endTime }) => ({
              from,
              to,
              startTime,
              endTime,
            })),
          }
        : {}),
    }))
    .sort((a, b) => a.startTime - b.startTime);
}

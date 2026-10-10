export interface TimedCue {
  startTime: number;
  endTime: number;
  text: string;
}

export const cueLimit = 30000;
export const cueTextLimit = 5000;

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
        cue.text.length <= cueTextLimit,
    )
  );
}

export function copyCues(cues: readonly TimedCue[]): TimedCue[] {
  return cues
    .map(({ startTime, endTime, text }) => ({ startTime, endTime, text }))
    .sort((a, b) => a.startTime - b.startTime);
}

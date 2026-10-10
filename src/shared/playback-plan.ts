import {
  latencyDefaultMs,
  latencyMaxMs,
  latencyMinMs,
  latencySampleLimit,
  minShowSeconds,
  packSpanSeconds,
  planBufferSeconds,
  planSentenceCap,
  translationBatchLimit,
} from './limits';

export interface PlaybackCue {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

export interface PlannedRequest {
  readonly cues: readonly PlaybackCue[];
  readonly atRisk: boolean;
}

export function slackSeconds(start: number, time: number, rate: number): number {
  return (start - time) / Math.max(rate, 0.25);
}

export function typicalLatency(samples: readonly number[]): number {
  const recent = samples.slice(-latencySampleLimit).sort((left, right) => left - right);
  if (!recent.length) return latencyDefaultMs;
  const mid = Math.floor(recent.length / 2);
  const median = recent.length % 2 === 0 ? (recent[mid - 1] + recent[mid]) / 2 : recent[mid];
  return Math.min(latencyMaxMs, Math.max(latencyMinMs, median));
}

export function slowLatency(samples: readonly number[]): number {
  if (!samples.length) return 2 * latencyDefaultMs;
  const sorted = [...samples].sort((left, right) => left - right);
  return Math.max(latencyMinMs, sorted[Math.ceil(sorted.length * 0.9) - 1]);
}

export function planPlayback(input: {
  time: number;
  rate: number;
  cues: readonly PlaybackCue[];
  samples?: readonly number[];
}): PlannedRequest[] {
  const samples = input.samples ?? [];
  const typical = typicalLatency(samples) / 1000;
  const slow = slowLatency(samples) / 1000;
  const buffer = Math.max(planBufferSeconds, 3 * slow);
  const slack = (cue: PlaybackCue) => slackSeconds(cue.start, input.time, input.rate);
  const ordered = input.cues
    .filter((cue) => slackSeconds(cue.end, input.time, input.rate) > minShowSeconds)
    .sort((left, right) => left.start - right.start || left.end - right.end)
    .slice(0, planSentenceCap);
  const requests: PlannedRequest[] = [];
  let index = 0;
  if (ordered.length && slack(ordered[0]) < typical) {
    requests.push({ cues: ordered.slice(0, 1), atRisk: true });
    index = 1;
  }
  while (index < ordered.length && slack(ordered[index]) < buffer) {
    let size = 1;
    while (
      size < translationBatchLimit &&
      index + size < ordered.length &&
      ordered[index + size].end - ordered[index].start <= packSpanSeconds
    )
      size++;
    const growing = size < translationBatchLimit && index + size === ordered.length;
    if (growing && slack(ordered[index]) >= 2 * slow) break;
    requests.push({
      cues: ordered.slice(index, index + size),
      atRisk: typical > slack(ordered[index]),
    });
    index += size;
  }
  return requests;
}

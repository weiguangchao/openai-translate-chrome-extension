import {
  behindGraceSeconds,
  latencyDefaultMs,
  latencyMaxMs,
  latencyMinMs,
  latencySampleLimit,
  planSentenceCap,
  translationBatchLimit,
} from './limits';

export interface PlaybackCue {
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly needsSplit: boolean;
}

export interface LatencySample {
  readonly sentences: number;
  readonly ms: number;
}

export interface PlannedRequest {
  readonly cues: readonly PlaybackCue[];
  readonly atRisk: boolean;
}

export function slackSeconds(start: number, time: number, rate: number): number {
  return (start - time) / Math.max(rate, 0.25);
}

export function predictLatency(samples: readonly LatencySample[], sentences: number): number {
  const sized = samples
    .filter((sample) => sample.sentences === sentences)
    .slice(-latencySampleLimit);
  const pool = (sized.length ? sized : samples.slice(-latencySampleLimit)).map(
    (sample) => sample.ms,
  );
  if (!pool.length) return latencyDefaultMs;
  const sorted = [...pool].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return Math.min(latencyMaxMs, Math.max(latencyMinMs, median));
}

function packSize(
  cues: readonly PlaybackCue[],
  index: number,
  time: number,
  rate: number,
  samples: readonly LatencySample[],
  room: number,
): number {
  const firstSlack = slackSeconds(cues[index].start, time, rate);
  const max = Math.min(translationBatchLimit, room, cues.length - index);
  for (let size = max; size > 1; size--) {
    const predicted = predictLatency(samples, size);
    const spread = cues.slice(index, index + size).every((cue) => {
      return slackSeconds(cue.start, time, rate) - firstSlack <= predicted / 1000;
    });
    if (spread && predicted <= Math.max(0, firstSlack) * 1000) return size;
  }
  return 1;
}

export function planPlayback(input: {
  time: number;
  rate: number;
  cues: readonly PlaybackCue[];
  samples?: readonly LatencySample[];
}): PlannedRequest[] {
  const samples = input.samples ?? [];
  const eligible = input.cues.filter((cue) => {
    const active = cue.start <= input.time && input.time < cue.end;
    return active || cue.end >= input.time - behindGraceSeconds;
  });
  const ordered = [...eligible].sort(
    (left, right) => left.start - right.start || left.end - right.end,
  );
  const horizon = (2 * predictLatency(samples, 1)) / 1000;
  const requests: PlannedRequest[] = [];
  let index = 0;
  let count = 0;
  while (index < ordered.length && count < planSentenceCap) {
    if (requests.length && slackSeconds(ordered[index].start, input.time, input.rate) >= horizon)
      break;
    const size = packSize(ordered, index, input.time, input.rate, samples, planSentenceCap - count);
    const cues = ordered.slice(index, index + size);
    const slack = slackSeconds(cues[0].start, input.time, input.rate);
    requests.push({
      cues,
      atRisk: predictLatency(samples, size) > Math.max(0, slack) * 1000,
    });
    index += size;
    count += size;
  }
  return requests;
}

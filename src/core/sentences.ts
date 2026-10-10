import type { TimedCue } from './cues';
import { sentencePauseSeconds } from '../shared/limits';
import { segmenterFor } from '../shared/segmenter';

interface CaptionInput extends TimedCue {
  parts?: TimedCue[];
  wordTimed?: boolean;
}
interface TextSpan extends TimedCue {
  from: number;
  to: number;
  wordTimed: boolean;
}
const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u;
const standalone = /^(?:♪[\s\S]*♪|\[[^\]]*\])$/u;

export function subtitleCaptions(
  events: readonly CaptionInput[],
  language: string,
  automatic = false,
): TimedCue[] {
  const segmenter = segmenterFor(language);
  const spans: TextSpan[] = [];
  const pauses: number[] = [];
  const stops: number[] = [];
  const cueStarts: number[] = [];
  let text = '';
  for (let index = 0; index < events.length; index++) {
    const event = events[index];
    const parts = event.parts ?? [event];
    if (
      text &&
      !/\s$/.test(text) &&
      !/^\s/.test(parts[0]?.text ?? '') &&
      !(cjk.test(text.at(-1)!) && cjk.test(parts[0]?.text[0] ?? ''))
    )
      text += ' ';
    if (index && [event, events[index - 1]].some((cue) => standalone.test(cue.text.trim())))
      stops.push(text.length);
    cueStarts.push(text.length);
    const wordTimed = event.wordTimed === true;
    for (const part of parts) {
      const previous = spans.at(-1);
      const words = previous?.text.trim().split(/\s+/).length ?? 0;
      const gap = previous ? part.startTime - previous.endTime : 0;
      const wordPause =
        automatic &&
        previous?.wordTimed &&
        wordTimed &&
        words === 1 &&
        part.startTime - previous!.startTime >= 1.5;
      if (previous && (gap >= 0.8 || wordPause)) {
        pauses.push(text.length);
        if (wordPause) previous.endTime = Math.min(previous.endTime, previous.startTime + 0.6);
      }
      if (gap >= sentencePauseSeconds) stops.push(text.length);
      const from = text.length;
      text += part.text;
      if (part.text.trim()) spans.push({ ...part, from, to: text.length, wordTimed });
    }
  }
  const naturalStops = new Set(segmenter.sentenceEnds(text));
  if (automatic || !naturalStops.size) for (const pause of pauses) naturalStops.add(pause);
  const boundaries = [...new Set([...naturalStops, ...stops, text.length])].sort((a, b) => a - b);
  const captions: TimedCue[] = [];
  let from = 0;
  let spanIndex = 0;
  for (const boundary of boundaries) {
    const starts = cueStarts.filter((at) => at > from && at < boundary).map((at) => at - from);
    const pieces = segmenter.captions(text.slice(from, boundary), starts);
    const sentence: TimedCue[] = [];
    for (const to of [...pieces.slice(1).map((piece) => from + piece.from), boundary]) {
      const raw = text.slice(from, to);
      const content = raw.replace(/\s+/g, ' ').trim();
      const first = from + raw.length - raw.trimStart().length;
      const last = to - (raw.length - raw.trimEnd().length);
      while (spanIndex < spans.length && spans[spanIndex].to <= first) spanIndex++;
      const startSpan = spans[spanIndex];
      let endIndex = spanIndex;
      while (endIndex + 1 < spans.length && spans[endIndex + 1].from < last) endIndex++;
      const endSpan = spans[endIndex];
      if (content && startSpan && endSpan) {
        const at = (span: TextSpan, position: number) => {
          const left = span.from + span.text.length - span.text.trimStart().length;
          const right = span.to - (span.text.length - span.text.trimEnd().length);
          const ratio = Math.max(0, Math.min(1, (position - left) / Math.max(1, right - left)));
          return span.startTime + (span.endTime - span.startTime) * ratio;
        };
        const startTime = at(startSpan, first);
        const endTime = at(endSpan, last);
        if (endTime > startTime) sentence.push({ startTime, endTime, text: content });
      }
      from = to;
    }
    sentence.forEach((caption, index) => {
      const next = sentence[index + 1];
      if (next && next.startTime > caption.startTime) caption.endTime = next.startTime;
    });
    captions.push(...sentence);
  }
  return captions;
}

export function authoredSubtitleCaptions(cues: readonly TimedCue[], language: string): TimedCue[] {
  const captions: TimedCue[] = [];
  let run: TimedCue[] = [];
  let latestEnd = -Infinity;
  const flush = () => {
    captions.push(...subtitleCaptions(run, language));
    run = [];
  };
  cues.forEach((cue, index) => {
    const overlapping =
      latestEnd > cue.startTime || (cues[index + 1]?.startTime ?? Infinity) < cue.endTime;
    latestEnd = Math.max(latestEnd, cue.endTime);
    if (overlapping) {
      flush();
      captions.push({ ...cue, text: cue.text.replace(/\s+/g, ' ').trim() });
    } else run.push(cue);
  });
  flush();
  return captions;
}

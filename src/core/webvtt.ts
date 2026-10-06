import { cueLimit, cueTextLimit, type TimedCue } from './cues';

export interface SubtitleFile {
  url: string;
  offset: number;
}

function timestamp(value: string): number {
  if (!/^(?:\d{2,}:)?\d{2}:\d{2}\.\d{3}$/.test(value)) return NaN;
  const parts = value.split(':').map(Number);
  if (parts.at(-1)! >= 60 || parts.at(-2)! >= 60) return NaN;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

export function parseWebVtt(value: string, offset = 0): TimedCue[] {
  const text = value.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (!/^WEBVTT(?:[ \t\n]|$)/.test(text)) throw new Error('Invalid WebVTT');
  const cues: TimedCue[] = [];
  for (const block of text.split(/\n[ \t]*\n/).slice(1)) {
    if (/^(NOTE|STYLE|REGION)(?:\s|$)/.test(block)) continue;
    const lines = block.trim().split('\n');
    const index = lines[0]?.includes('-->') ? 0 : 1;
    const timing = lines[index]?.match(/^(\S+)\s+-->\s+(\S+)(?:[ \t].*)?$/);
    if (!timing) continue;
    const startTime = timestamp(timing[1]) + offset;
    const endTime = timestamp(timing[2]) + offset;
    const raw = lines
      .slice(index + 1)
      .join('\n')
      .replace(/<[^>]*>/g, '');
    const text = raw
      .replace(
        /&(amp|lt|gt|nbsp|lrm|rlm);/g,
        (_, entity: string) =>
          ({ amp: '&', lt: '<', gt: '>', nbsp: ' ', lrm: '\u200e', rlm: '\u200f' })[entity]!,
      )
      .trim();
    if (
      Number.isFinite(startTime) &&
      startTime >= 0 &&
      endTime > startTime &&
      text &&
      text.length <= cueTextLimit
    )
      cues.push({ startTime, endTime, text });
    if (cues.length > cueLimit) throw new Error('Caption track too large');
  }
  return cues;
}

export async function fetchSubtitleText(url: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(url, {
    credentials: 'omit',
    signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
  });
  if (!response.ok || Number(response.headers.get('content-length')) > 4_000_000)
    throw new Error('Subtitle resource unavailable');
  const text = await response.text();
  if (text.length > 4_000_000) throw new Error('Subtitle resource too large');
  return text;
}

export async function loadWebVtt(
  files: readonly SubtitleFile[],
  signal: AbortSignal,
): Promise<TimedCue[]> {
  const results: TimedCue[][] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, files.length) }, async () => {
      while (next < files.length) {
        const index = next++;
        const file = files[index];
        results[index] = parseWebVtt(await fetchSubtitleText(file.url, signal), file.offset);
      }
    }),
  );
  const cues = results.flat().sort((a, b) => a.startTime - b.startTime || a.endTime - b.endTime);
  if (cues.length > cueLimit) throw new Error('Caption track too large');
  return cues.filter(
    (cue, index) =>
      !index ||
      cue.startTime !== cues[index - 1].startTime ||
      cue.endTime !== cues[index - 1].endTime ||
      cue.text !== cues[index - 1].text,
  );
}

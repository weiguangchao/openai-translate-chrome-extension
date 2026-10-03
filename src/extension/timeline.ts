import { prefetchSegmentCount, translationBatchLimit } from '../shared/limits';
import { needsSubtitleSegmentation, splitSubtitleAtCommas } from '../shared/subtitle-segmentation';
import { languageTrack } from './languages';
import type { YoutubeCaptionKind } from './youtube-captions';

export interface TimedCue {
  startTime: number;
  endTime: number;
  text: string;
  timing?: CueTiming[];
}

export interface TimedCaption {
  startTime: number;
  endTime: number;
  text: string;
  segment: number;
}

export interface CueTiming {
  from: number;
  to: number;
  startTime: number;
  endTime: number;
}

export interface SubtitleTimeline {
  mode: 'checking' | 'model' | 'existing';
  sourceId?: string;
  sourceKind?: YoutubeCaptionKind | null;
  source: TimedCue[] | null;
  translation: TimedCue[] | null;
}

const trackCueCache = new WeakMap<TextTrack, TimedCue[]>();

function trackCues(track: TextTrack | undefined): TimedCue[] | null {
  if (!track?.cues) return null;
  const cues = [...track.cues].map((cue) => ({
    startTime: cue.startTime,
    endTime: cue.endTime,
    text: captionText(cue),
  }));
  const cached = trackCueCache.get(track);
  if (
    cached?.length === cues.length &&
    cached.every(
      (cue, index) =>
        cue.startTime === cues[index].startTime &&
        cue.endTime === cues[index].endTime &&
        cue.text === cues[index].text,
    )
  )
    return cached;
  trackCueCache.set(track, cues);
  return cues;
}

export class NativeTimeline {
  private video: HTMLVideoElement | null = null;
  private src = '';
  private enabledTracks = new Set<TextTrack>();

  read(video: HTMLVideoElement, sourceLanguage: string, targetLanguage: string): SubtitleTimeline {
    if (video !== this.video || video.currentSrc !== this.src) {
      this.reset();
      this.video = video;
      this.src = video.currentSrc;
    }
    const tracks = [...video.textTracks].filter((track) =>
      ['subtitles', 'captions'].includes(track.kind),
    );
    const target = languageTrack(tracks, (track) => track.language, targetLanguage);
    const source = target
      ? languageTrack(tracks, (track) => track.language, sourceLanguage)
      : selectedTrack(video, sourceLanguage);
    const needed = target ? [target, source] : [];
    for (const track of this.enabledTracks) if (!needed.includes(track)) this.release(track);
    for (const track of needed) {
      if (track?.mode === 'disabled') {
        this.enabledTracks.add(track);
        track.mode = 'hidden';
      }
    }
    return {
      mode: target ? 'existing' : video.readyState >= 1 ? 'model' : 'checking',
      source: target && !source ? [] : trackCues(source),
      translation: trackCues(target),
    };
  }

  private release(track: TextTrack): void {
    if (track.mode === 'hidden') track.mode = 'disabled';
    this.enabledTracks.delete(track);
  }

  reset(): void {
    for (const track of this.enabledTracks) this.release(track);
    this.video = null;
    this.src = '';
  }
}

const cueTextCache = new WeakMap<TextTrackCue, { source: unknown; text: string }>();

export function captionText(cue: TextTrackCue): string {
  const source = 'text' in cue ? cue.text : undefined;
  const cached = cueTextCache.get(cue);
  if (cached && cached.source === source) return cached.text;
  const text = (
    'getCueAsHTML' in cue
      ? ((cue as VTTCue).getCueAsHTML().textContent ?? '')
      : 'text' in cue
        ? String(cue.text)
        : ''
  ).trim();
  cueTextCache.set(cue, { source, text });
  return text;
}

export function selectedTrack(video: HTMLVideoElement, language: string): TextTrack | undefined {
  const tracks = [...video.textTracks].filter(
    (track) => track.mode === 'showing' && ['subtitles', 'captions'].includes(track.kind),
  );
  return languageTrack(tracks, (track) => track.language, language) ?? tracks[0];
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
  if (parts.length < 2) return [{ startTime: cue.startTime, endTime: cue.endTime, text: cue.text }];
  const starts = parts.map((part, index) => (index ? boundaryTime(cue, part.from) : cue.startTime));
  return parts.map((part, index) => ({
    startTime: starts[index],
    endTime: starts[index + 1] ?? cue.endTime,
    text: cue.text.slice(part.from, part.to),
  }));
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
  for (const at of [time, ...boundaries]) {
    const active = activeAt(remaining, at);
    const text = joinedText(active);
    if (!text || texts.includes(text)) continue;
    texts.push(text);
    segments.push(active[0].segment);
  }
  return { current: captionAt(remaining, time), texts, segments };
}

export class YoutubeTimeline {
  private requestId = 0;
  private pendingId = 0;
  private requestedAt = -Infinity;
  private context = '';
  private state: SubtitleTimeline = { mode: 'checking', source: null, translation: null };
  private revision = -1;

  constructor(private changed: () => void) {
    window.addEventListener('message', this.receive);
  }

  read(video: HTMLVideoElement, language: string, targetLanguage: string): SubtitleTimeline | null {
    if (!/(^|\.)youtube\.com$/.test(location.hostname)) return null;
    const videoId =
      new URL(location.href).searchParams.get('v') ?? location.pathname.split('/')[2] ?? '';
    const context = `${videoId}:${language}:${targetLanguage}:${video.currentSrc}`;
    if (this.context !== context) {
      this.reset();
      this.context = context;
    }
    if (
      video.closest('.ad-showing') ||
      video
        .closest('.html5-video-player')
        ?.querySelector('.ytp-subtitles-button')
        ?.getAttribute('aria-pressed') === 'false'
    ) {
      this.reset();
      return this.state;
    }
    if (Date.now() - this.requestedAt >= 1000) {
      this.requestedAt = Date.now();
      this.pendingId = ++this.requestId;
      window.postMessage(
        {
          type: 'subline:timeline-request',
          requestId: this.pendingId,
          videoId,
          sourceLanguage: language,
          targetLanguage,
          revision: this.revision,
        },
        location.origin,
      );
    }
    return this.state;
  }

  private receive = (event: MessageEvent) => {
    const data = event.data;
    if (
      event.source !== window ||
      event.origin !== location.origin ||
      data?.type !== 'subline:timeline-response' ||
      data.requestId !== this.pendingId
    )
      return;
    if (data.unchanged === true) return;
    const state = data.state;
    if (!state || !['checking', 'model'].includes(state.mode)) return;
    if (state.sourceKind != null && !['authored', 'asr'].includes(state.sourceKind)) return;
    const cues = state.source;
    if (
      cues !== null &&
      (!Array.isArray(cues) ||
        cues.length > 30000 ||
        !cues.every(
          (cue: TimedCue) =>
            cue &&
            Number.isFinite(cue.startTime) &&
            Number.isFinite(cue.endTime) &&
            cue.startTime >= 0 &&
            cue.endTime > cue.startTime &&
            typeof cue.text === 'string' &&
            cue.text.length <= 5000 &&
            (cue.timing === undefined ||
              (Array.isArray(cue.timing) &&
                cue.timing.length <= 5000 &&
                cue.timing.every(
                  (span, index) =>
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
                      (span.from >= cue.timing![index - 1].to &&
                        span.startTime >= cue.timing![index - 1].endTime)),
                ))),
        ))
    )
      return;
    this.state = {
      mode: state.mode,
      sourceKind: state.sourceKind,
      source: state.source,
      translation: null,
    };
    this.revision = Number.isSafeInteger(data.revision) ? data.revision : -1;
    this.changed();
  };

  reset(): void {
    this.context = '';
    this.state = { mode: 'checking', source: null, translation: null };
    this.pendingId = 0;
    this.requestedAt = -Infinity;
    this.revision = -1;
  }

  destroy(): void {
    window.removeEventListener('message', this.receive);
  }
}

import type { TimelineState } from './bridge/protocol';
import type { TimedCue } from './cues';
import { supportedLanguage } from '../shared/languages';
import type { LiveCaption } from './platform';
import { authoredSubtitleCaptions } from './sentences';

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

export function selectedTrack(video: HTMLVideoElement): TextTrack | undefined {
  const tracks = [...video.textTracks].filter(
    (track) => track.mode === 'showing' && ['subtitles', 'captions'].includes(track.kind),
  );
  return tracks[0];
}

export function activeTrackCaption(video: HTMLVideoElement): LiveCaption {
  const track = selectedTrack(video);
  const text = track?.activeCues ? [...track.activeCues].map(captionText).join('\n').trim() : '';
  return { text, layers: [], nativeTrack: Boolean(text) };
}

export class NativeTimeline {
  private video: HTMLVideoElement | null = null;
  private src = '';
  private track: TextTrack | undefined;
  private cues: TimedCue[] | null = null;
  private captions: TimedCue[] | null = null;

  read(video: HTMLVideoElement): TimelineState {
    const track = selectedTrack(video);
    if (video !== this.video || video.currentSrc !== this.src || track !== this.track) {
      this.reset();
      this.video = video;
      this.src = video.currentSrc;
      this.track = track;
    }
    const cues = track?.cues
      ? [...track.cues].map((cue) => ({
          startTime: cue.startTime,
          endTime: cue.endTime,
          text: captionText(cue),
        }))
      : null;
    if (
      !cues ||
      !this.cues ||
      cues.length !== this.cues.length ||
      cues.some(
        (cue, i) =>
          cue.startTime !== this.cues![i].startTime ||
          cue.endTime !== this.cues![i].endTime ||
          cue.text !== this.cues![i].text,
      )
    ) {
      this.cues = cues;
      this.captions =
        cues && track && supportedLanguage(track.language)
          ? authoredSubtitleCaptions(cues, track.language)
          : cues;
    }
    return {
      mode: video.readyState >= 1 ? 'model' : 'checking',
      source: this.captions,
      language: track ? track.language : null,
    };
  }

  reset(): void {
    this.video = null;
    this.src = '';
    this.track = undefined;
    this.cues = null;
    this.captions = null;
  }
}

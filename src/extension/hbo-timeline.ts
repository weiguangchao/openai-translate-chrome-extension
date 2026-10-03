import type { SubtitleTimeline, TimedCue } from './timeline';
import { pageVideoId } from './source-cache';
import { authoredSubtitleSentences } from './subtitle-sentences';

function validCues(value: unknown): value is TimedCue[] | null {
  return (
    value === null ||
    (Array.isArray(value) &&
      value.length <= 30000 &&
      value.every(
        (cue) =>
          cue &&
          Number.isFinite(cue.startTime) &&
          Number.isFinite(cue.endTime) &&
          cue.startTime >= 0 &&
          cue.endTime > cue.startTime &&
          typeof cue.text === 'string' &&
          cue.text.length <= 5000,
      ))
  );
}

export class HboTimeline {
  private requestId = 0;
  private pendingId = 0;
  private requestedAt = -Infinity;
  private context = '';
  private state: SubtitleTimeline | null = null;
  private revision = -1;

  constructor(private changed: () => void) {
    window.addEventListener('message', this.receive);
  }

  read(sourceLanguage: string): SubtitleTimeline | null {
    if (!/(^|\.)(max\.com|hbomax\.com|hbo\.com)$/.test(location.hostname)) return null;
    const videoId = pageVideoId();
    const context = JSON.stringify([videoId, sourceLanguage]);
    if (context !== this.context) {
      this.reset();
      this.context = context;
    }
    if (Date.now() - this.requestedAt >= 1000) {
      this.requestedAt = Date.now();
      this.pendingId = ++this.requestId;
      window.postMessage(
        {
          type: 'subline:hbo-timeline-request',
          requestId: this.pendingId,
          videoId,
          sourceLanguage,
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
      data?.type !== 'subline:hbo-timeline-response' ||
      !this.pendingId ||
      data.requestId !== this.pendingId ||
      data.unchanged === true
    )
      return;
    const state = data.state;
    if (
      !state ||
      !['checking', 'model'].includes(state.mode) ||
      !Number.isSafeInteger(data.revision) ||
      !validCues(state.source)
    )
      return;
    const copy = (cues: TimedCue[] | null) =>
      cues
        ?.map(({ startTime, endTime, text }) => ({ startTime, endTime, text }))
        .sort((a, b) => a.startTime - b.startTime) ?? null;
    const source = copy(state.source);
    this.state = {
      mode: state.mode,
      source: source === null ? null : authoredSubtitleSentences(source),
      sourceId: typeof state.sourceId === 'string' ? state.sourceId : undefined,
    };
    this.revision = data.revision;
    this.changed();
  };

  reset(): void {
    if (this.pendingId)
      window.postMessage(
        { type: 'subline:hbo-timeline-stop', requestId: this.pendingId },
        location.origin,
      );
    this.context = '';
    this.state = null;
    this.pendingId = 0;
    this.requestedAt = -Infinity;
    this.revision = -1;
  }

  destroy(): void {
    this.reset();
    window.removeEventListener('message', this.receive);
  }
}

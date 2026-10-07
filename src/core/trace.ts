import {
  TRACE_ATTRIBUTE,
  TRACE_TEXT_LIMIT,
  TRACE_WORKER_ATTRIBUTE,
  type TraceRequest,
  type ViewState,
} from '../shared/trace';

const HEARTBEAT_MS = 2000;

export interface TraceCaption {
  readonly text: string;
  readonly cue?: number;
  readonly start?: number;
  readonly end?: number;
  readonly segment?: number;
}

export class TraceReporter {
  private last = '';
  private sentAt = 0;

  constructor(
    private send: (message: TraceRequest) => void,
    private extensionId: () => string,
  ) {}

  note(video: HTMLVideoElement, caption: TraceCaption | null, state: ViewState): void {
    const run = document.documentElement.getAttribute(TRACE_ATTRIBUTE);
    if (!run) {
      this.last = '';
      return;
    }
    const root = document.documentElement;
    const id = this.extensionId();
    if (root.getAttribute(TRACE_WORKER_ATTRIBUTE) !== id)
      root.setAttribute(TRACE_WORKER_ATTRIBUTE, id);
    const key = JSON.stringify([run, caption, state, video.paused, video.seeking]);
    const now = Date.now();
    if (key === this.last && (video.paused || now - this.sentAt < HEARTBEAT_MS)) return;
    this.last = key;
    this.sentAt = now;
    this.send({
      type: 'trace',
      run: run.slice(0, 64),
      time: Math.round(video.currentTime * 100) / 100,
      paused: video.paused,
      seeking: video.seeking,
      state,
      ...(caption && { ...caption, text: caption.text.slice(0, TRACE_TEXT_LIMIT) }),
    });
  }
}

import { readStoredTranslation } from '../shared/caption-translation';
import type { PlaybackCue } from '../shared/playback-plan';
import { providerTimeoutMessage } from '../shared/provider-error';
import type { ViewState } from '../shared/trace';
import type { ExtensionConnection } from './connection';
import type { CaptionView, SubtitleOverlay, TranslationLine } from './overlay';

const LOADING_DELAY_MS = 300;
const PLAN_REFRESH_SECONDS = 1;

export interface CaptionFrame {
  readonly text: string;
  readonly cacheOnly: boolean;
  readonly debounce: number;
}

interface Request {
  readonly cacheOnly: boolean;
}

interface Caption {
  readonly text: string;
  since: number;
  line: TranslationLine;
  request: Request | null;
  checked: boolean;
}

const VIEW_STATES: Record<TranslationLine['kind'], ViewState> = {
  none: 'empty',
  loading: 'loading',
  ready: 'ready',
  failed: 'error',
  timedOut: 'timeout',
};

function captionView(caption: Caption | null): CaptionView {
  if (!caption) return { original: '', line: { kind: 'none' } };
  const { line } = caption;
  const withSource = line.kind === 'ready' || line.kind === 'failed';
  return { original: withSource ? caption.text : '', line };
}

export class CaptionTranslator {
  private caption: Caption | null = null;
  private windowKey = '';
  private holdKey = '';
  private active = false;
  private prefetchedAt = 0;
  private playbackHeld = false;

  constructor(
    private connection: ExtensionConnection,
    private overlay: SubtitleOverlay,
    private changed: () => void,
  ) {}

  get state(): ViewState {
    return VIEW_STATES[this.caption?.line.kind ?? 'none'];
  }

  hasTranslation(text: string): boolean {
    return this.caption?.text === text && this.caption.line.kind === 'ready';
  }

  cancel(): void {
    const { caption } = this;
    if (!caption) return;
    if (caption.line.kind === 'loading') caption.line = { kind: 'none' };
    if (caption.request) {
      caption.request = null;
      caption.checked = false;
    }
    this.render();
  }

  clear(): void {
    this.caption = null;
    this.render();
  }

  reset(): void {
    this.caption = null;
    this.playbackHeld = false;
    this.windowKey = '';
    this.holdKey = '';
    this.active = false;
  }

  show(frame: CaptionFrame): void {
    if (frame.text !== this.caption?.text)
      this.caption = {
        text: frame.text,
        since: Date.now(),
        line: { kind: 'none' },
        request: null,
        checked: false,
      };
    this.update(this.caption, frame);
    this.render();
  }

  notePlayback(paused: boolean): void {
    if (paused) {
      if (this.playbackHeld || !this.active) return;
      this.playbackHeld = true;
    } else {
      if (!this.playbackHeld) return;
      this.playbackHeld = false;
    }
    void this.connection
      .sendMessage({ type: paused ? 'prefetch-pause' : 'prefetch-resume' })
      .catch(() => {});
  }

  plan(time: number, rate: number, cues: readonly PlaybackCue[]): void {
    const key = JSON.stringify(
      cues.length
        ? [Math.floor(time / PLAN_REFRESH_SECONDS) * PLAN_REFRESH_SECONDS, rate, cues]
        : [rate, cues],
    );
    if (key === this.windowKey && (cues.length === 0 || Date.now() - this.prefetchedAt < 15000))
      return;
    this.windowKey = key;
    this.holdKey = '';
    this.active = cues.length > 0;
    this.prefetchedAt = Date.now();
    void this.connection.sendMessage({ type: 'prefetch', time, rate, cues }).catch(() => {});
  }

  hold(time: number): void {
    const key = String(time);
    if (key === this.holdKey) return;
    this.holdKey = key;
    this.windowKey = '';
    this.active = true;
    void this.connection.sendMessage({ type: 'prefetch-hold', time }).catch(() => {});
  }

  release(): void {
    if (!this.active) return;
    this.active = false;
    this.windowKey = '';
    this.holdKey = '';
    void this.connection
      .sendMessage({ type: 'prefetch', time: 0, rate: 1, cues: [] })
      .catch(() => {});
  }

  private render(): void {
    this.overlay.render(captionView(this.caption));
  }

  private update(caption: Caption, frame: CaptionFrame): void {
    const { line } = caption;
    if (line.kind === 'ready' || line.kind === 'timedOut') return;
    const pending = caption.request !== null;
    if (frame.cacheOnly && (caption.checked || pending)) return;
    const waited = Date.now() - caption.since;
    if (pending || waited < frame.debounce) {
      if (!frame.cacheOnly && line.kind !== 'failed' && waited >= LOADING_DELAY_MS)
        caption.line = { kind: 'loading' };
      return;
    }
    this.request(caption, frame.cacheOnly, waited);
  }

  private request(caption: Caption, cacheOnly: boolean, waited: number): void {
    const request: Request = { cacheOnly };
    const current = () => this.caption === caption && caption.request === request;
    caption.request = request;
    if (cacheOnly) caption.checked = true;
    else {
      this.active = true;
      if (caption.line.kind === 'failed' || waited >= LOADING_DELAY_MS)
        caption.line = { kind: 'loading' };
    }
    void this.connection
      .sendMessage<unknown>({
        type: 'translate',
        text: caption.text,
        ...(cacheOnly ? { cacheOnly: true } : {}),
      })
      .then((response) => {
        if (!current()) return;
        const data = response?.data;
        if (cacheOnly && response?.ok && data === null) {
          caption.request = null;
          return;
        }
        const translation = readStoredTranslation(data);
        if (!response?.ok || translation === null)
          throw new Error(response?.error ?? '翻译未完成，请检查扩展配置。');
        caption.request = null;
        caption.line = { kind: 'ready', translation };
      })
      .catch((error) => {
        if (!current()) return;
        const message = error instanceof Error ? error.message : '翻译失败，请检查配置。';
        caption.request = null;
        if (message === providerTimeoutMessage) caption.line = { kind: 'timedOut' };
        else {
          caption.line = { kind: 'failed', message };
          caption.since = Date.now() + 15000;
        }
      })
      .finally(() => this.changed());
  }
}

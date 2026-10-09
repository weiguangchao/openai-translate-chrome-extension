import { readStoredTranslation, type CaptionTranslation } from '../shared/caption-translation';
import type { PlaybackCue } from '../shared/playback-plan';
import { providerTimeoutMessage } from '../shared/provider-error';
import type { ExtensionConnection } from './connection';
import type { SubtitleOverlay } from './overlay';
import { translatedCaptions, type TimedCaption } from './timeline';

const LOADING_DELAY_MS = 300;
const PLAN_REFRESH_SECONDS = 1;

export type CaptionFrame = {
  readonly time: number;
  readonly cacheOnly: boolean;
  readonly debounce: number;
} & (
  | { readonly kind: 'ordinary'; readonly text: string; readonly cue?: never }
  | {
      readonly kind: 'split';
      readonly cue: TimedCaption & { readonly needsSplit: true };
      readonly text?: never;
    }
);

type CaptionView =
  | { kind: 'waiting' }
  | { kind: 'failed'; original: string }
  | { kind: 'ready'; original: string; translation: string };

export class CaptionTranslator {
  private text = '';
  private needsSplit = false;
  private changedAt = 0;
  private requested = '';
  private version = 0;
  private result: CaptionTranslation | null = null;
  private checkedCache = false;
  private windowKey = '';
  private holdKey = '';
  private active = false;
  private prefetchedAt = 0;
  private playbackHeld = false;
  private timedOut = false;

  constructor(
    private connection: ExtensionConnection,
    private overlay: SubtitleOverlay,
    private changed: () => void,
  ) {}

  get requesting(): boolean {
    return this.requested !== '';
  }

  hasTranslation(text: string, needsSplit: boolean): boolean {
    return this.result !== null && this.text === text && this.needsSplit === needsSplit;
  }

  invalidate(): void {
    this.version++;
  }

  cancel(): void {
    if (!this.requested) return;
    this.version++;
    this.requested = '';
    this.checkedCache = false;
  }

  clear(): void {
    if (this.text) this.version++;
    this.forget();
  }

  reset(): void {
    this.version++;
    this.forget();
    this.playbackHeld = false;
    this.windowKey = '';
    this.holdKey = '';
    this.active = false;
  }

  show(frame: CaptionFrame): void {
    const text = frame.kind === 'split' ? frame.cue.text : frame.text;
    const needsSplit = frame.kind === 'split';
    if (text !== this.text || needsSplit !== this.needsSplit) {
      this.version++;
      this.forget();
      this.text = text;
      this.needsSplit = needsSplit;
      this.changedAt = Date.now();
      this.overlay.hideTranslation();
    }
    if (this.timedOut) {
      this.overlay.showOriginal('');
      this.overlay.showTimeout();
      return;
    }
    const view = this.view(frame);
    this.overlay.showOriginal(view.kind === 'waiting' ? '' : view.original);
    if (view.kind === 'ready') {
      this.overlay.showTranslation(view.translation);
      return;
    }
    const pending = this.requested === this.text && this.requested !== '';
    if (frame.cacheOnly && (this.checkedCache || pending)) return;
    const waited = Date.now() - this.changedAt;
    if (pending || waited < frame.debounce) {
      if (!frame.cacheOnly && !this.overlay.failed && waited >= LOADING_DELAY_MS)
        this.overlay.showLoading();
      return;
    }
    this.request(frame.cacheOnly);
  }

  notePlayback(paused: boolean): void {
    if (paused) {
      if (this.playbackHeld || (!this.windowKey && !this.requested)) return;
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

  private forget(): void {
    this.text = '';
    this.needsSplit = false;
    this.requested = '';
    this.result = null;
    this.checkedCache = false;
    this.timedOut = false;
  }

  private view(frame: CaptionFrame): CaptionView {
    const text = frame.kind === 'split' ? frame.cue.text : frame.text;
    if (!this.result)
      return this.overlay.failed ? { kind: 'failed', original: text } : { kind: 'waiting' };
    if (typeof this.result === 'string')
      return { kind: 'ready', original: text, translation: this.result };
    if (frame.kind === 'ordinary') return { kind: 'waiting' };
    const active = translatedCaptions(frame.cue, this.result.parts).find(
      (part) => part.startTime <= frame.time && frame.time < part.endTime,
    );
    return active
      ? { kind: 'ready', original: active.text, translation: active.translation }
      : { kind: 'waiting' };
  }

  private request(cacheOnly: boolean): void {
    const { text, needsSplit, version } = this;
    this.requested = text;
    this.active = true;
    if (cacheOnly) this.checkedCache = true;
    else if (this.overlay.failed || Date.now() - this.changedAt >= LOADING_DELAY_MS)
      this.overlay.showLoading();
    void this.connection
      .sendMessage<unknown>({
        type: 'translate',
        text,
        ...(needsSplit ? { needsSplit: true } : {}),
        ...(cacheOnly ? { cacheOnly: true } : {}),
      })
      .then((response) => {
        const data = response?.data;
        if (cacheOnly && response?.ok && data === null) {
          if (this.version === version) this.requested = '';
          this.changed();
          return;
        }
        if (this.version !== version || !this.overlay.mounted) {
          this.changed();
          return;
        }
        const translation = readStoredTranslation({ text, needsSplit }, data);
        if (!response?.ok || translation === null)
          throw new Error(response?.error ?? '翻译未完成，请检查扩展配置。');
        this.result = translation;
        this.changed();
      })
      .catch((error) => {
        if (this.version === version && this.overlay.mounted) {
          const message = error instanceof Error ? error.message : '翻译失败，请检查配置。';
          this.requested = '';
          if (message === providerTimeoutMessage) {
            this.timedOut = true;
            this.overlay.showOriginal('');
            this.overlay.showTimeout();
          } else {
            this.overlay.showError(message);
            this.changedAt = Date.now() + 15000;
          }
        }
        this.changed();
      });
  }
}

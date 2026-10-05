import {
  readStoredTranslation,
  type CaptionTranslation,
  type PrefetchItem,
} from '../shared/caption-translation';
import type { ExtensionConnection } from './connection';
import type { SubtitleOverlay } from './overlay';
import { translatedCaptions, type TimedCaption } from './timeline';

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
  | { kind: 'source'; original: string }
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
  private prefetchedAt = 0;
  private playbackHeld = false;

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
  }

  passThrough(text: string): void {
    this.clear();
    this.overlay.hideTranslation();
    this.overlay.showOriginal(text);
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
    const view = this.view(frame);
    this.overlay.showOriginal(view.kind === 'waiting' ? '' : view.original);
    if (view.kind === 'ready') {
      this.overlay.showTranslation(view.translation);
      return;
    }
    const pending = this.requested === this.text && this.requested !== '';
    if (frame.cacheOnly && (this.checkedCache || pending)) return;
    if (pending || Date.now() - this.changedAt < frame.debounce) {
      if (!frame.cacheOnly && !this.overlay.failed) this.overlay.showLoading();
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

  prefetch(items: readonly PrefetchItem[], force = false): void {
    const key = JSON.stringify(items);
    if (
      !force &&
      ((!this.windowKey && !items.length) ||
        (key === this.windowKey && (!items.length || Date.now() - this.prefetchedAt < 15000)))
    )
      return;
    this.windowKey = key;
    this.prefetchedAt = Date.now();
    void this.connection.sendMessage({ type: 'prefetch', items }).catch(() => {});
  }

  private forget(): void {
    this.text = '';
    this.needsSplit = false;
    this.requested = '';
    this.result = null;
    this.checkedCache = false;
  }

  private view(frame: CaptionFrame): CaptionView {
    if (frame.kind === 'ordinary') {
      return typeof this.result === 'string'
        ? { kind: 'ready', original: frame.text, translation: this.result }
        : { kind: 'source', original: frame.text };
    }
    if (!this.result) return { kind: 'waiting' };
    if (typeof this.result === 'string')
      return { kind: 'ready', original: frame.cue.text, translation: this.result };
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
    if (cacheOnly) this.checkedCache = true;
    else this.overlay.showLoading();
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
        this.changed();
        if (this.version !== version || !this.overlay.mounted) return;
        this.overlay.showError(error instanceof Error ? error.message : '翻译失败，请检查配置。');
        this.requested = '';
        this.changedAt = Date.now() + 15000;
      });
  }
}

import type { CaptionTranslation } from '../shared/caption-translation';
import type { ExtensionConnection } from './connection';
import type { SubtitleOverlay } from './overlay';
import { translatedCaptions, type TimedCaption } from './timeline';

export interface CaptionFrame {
  text: string;
  needsSplit: boolean;
  cue?: TimedCaption;
  time: number;
  cacheOnly: boolean;
  debounce: number;
}

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

  invalidate(): void {
    this.version++;
  }

  cancel(): void {
    if (!this.requested) return;
    this.version++;
    this.requested = '';
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
    if (frame.text !== this.text || frame.needsSplit !== this.needsSplit) {
      this.version++;
      this.forget();
      this.text = frame.text;
      this.needsSplit = frame.needsSplit;
      this.changedAt = Date.now();
      this.overlay.hideTranslation();
    }
    const view = this.view(frame);
    this.overlay.showOriginal(view.original);
    if (view.translation !== null) {
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

  prefetch(
    texts: string[],
    force = false,
    segments: readonly number[] = [],
    needsSplit: readonly boolean[] = [],
  ): void {
    const groups = texts.map((_, index) => segments[index] ?? 0);
    const flags = texts.map((_, index) => needsSplit[index] === true);
    const key = JSON.stringify([texts, groups, flags]);
    if (
      !force &&
      ((!this.windowKey && !texts.length) ||
        (key === this.windowKey && (!texts.length || Date.now() - this.prefetchedAt < 15000)))
    )
      return;
    this.windowKey = key;
    this.prefetchedAt = Date.now();
    void this.connection
      .sendMessage({
        type: 'prefetch',
        texts,
        segments: groups,
        ...(flags.some(Boolean) ? { needsSplit: flags } : {}),
      })
      .catch(() => {});
  }

  private forget(): void {
    this.text = '';
    this.needsSplit = false;
    this.requested = '';
    this.result = null;
    this.checkedCache = false;
  }

  private view({ cue, time }: CaptionFrame): { original: string; translation: string | null } {
    const original = this.needsSplit ? '' : this.text;
    if (this.result === null) return { original, translation: null };
    if (typeof this.result === 'string') return { original, translation: this.result };
    const parts = this.result.parts;
    const active =
      cue && this.needsSplit
        ? translatedCaptions(cue, parts).find(
            (part) => part.startTime <= time && time < part.endTime,
          )
        : undefined;
    return {
      original: active?.text ?? original,
      translation:
        active?.translation ??
        (this.needsSplit ? null : parts.map((part) => part.translation).join(' ')),
    };
  }

  private request(cacheOnly: boolean): void {
    const { text, needsSplit, version } = this;
    this.requested = text;
    if (cacheOnly) this.checkedCache = true;
    else this.overlay.showLoading();
    void this.connection
      .sendMessage<CaptionTranslation | null>({
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
        if (
          !response?.ok ||
          (typeof data !== 'string' && (!data || !Array.isArray(data.parts) || !data.parts.length))
        )
          throw new Error(response?.error ?? '翻译未完成，请检查扩展配置。');
        this.result = data;
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

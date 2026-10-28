import { t } from '../shared/i18n';
import type { Language } from '../shared/languages';
import { readStoredTranslation } from '../shared/caption-translation';
import type { PlaybackCue } from '../shared/playback-plan';
import { failureOf, type TranslateFailure } from '../shared/provider-error';
import type { ViewState } from '../shared/trace';
import { loadingDelayMs, planRefreshSeconds } from '../shared/tuning';
import type { ExtensionConnection } from './connection';
import type { CaptionView, SubtitleOverlay, TranslationLine } from './overlay';

export interface CaptionFrame {
  readonly text: string;
  readonly cacheOnly: boolean;
  readonly debounce: number;
  readonly captionLanguage: Language;
}

interface Request {
  readonly cacheOnly: boolean;
}

interface Caption {
  readonly text: string;
  readonly captionLanguage: Language | null;
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
  repeated: 'empty',
  'unsupported-language': 'error',
};

function failedLine(failure: TranslateFailure): TranslationLine {
  switch (failure.kind) {
    case 'timeout':
      return { kind: 'timedOut' };
    case 'copied-source':
      return { kind: 'repeated' };
    case 'unsupported-language':
      return { kind: 'unsupported-language' };
    case 'http':
    case 'error':
      return { kind: 'failed', message: failure.message };
  }
}

function captionView(caption: Caption | null, translationOnly: boolean): CaptionView {
  if (!caption) return { original: '', line: { kind: 'none' } };
  const { line } = caption;
  if (line.kind === 'repeated') return { original: caption.text, line: { kind: 'none' } };
  const withSource = !translationOnly && line.kind === 'ready';
  return { original: withSource ? caption.text : '', line };
}

export class CaptionTranslator {
  private caption: Caption | null = null;
  private windowKey = '';
  private holdKey = '';
  private active = false;
  private playback: { desired: boolean; confirmed: boolean | undefined; sending: boolean } = {
    desired: false,
    confirmed: false,
    sending: false,
  };

  constructor(
    private connection: ExtensionConnection,
    private overlay: SubtitleOverlay,
    private changed: () => void,
    private translationOnly: () => boolean,
    private targetLanguage: () => string,
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
    this.playback = { desired: false, confirmed: false, sending: false };
    this.windowKey = '';
    this.holdKey = '';
    this.active = false;
  }

  show(frame: CaptionFrame): void {
    if (frame.text !== this.caption?.text || frame.captionLanguage !== this.caption.captionLanguage)
      this.caption = {
        text: frame.text,
        captionLanguage: frame.captionLanguage,
        since: Date.now(),
        line: { kind: 'none' },
        request: null,
        checked: false,
      };
    this.update(this.caption, frame);
    this.render();
  }

  unsupportedLanguage(): void {
    this.release();
    this.caption = {
      text: '',
      captionLanguage: null,
      since: Date.now(),
      line: { kind: 'unsupported-language' },
      request: null,
      checked: true,
    };
    this.render();
  }

  notePlayback(paused: boolean): void {
    if (paused && !this.active) return;
    const playback = this.playback;
    playback.desired = paused;
    if (playback.sending || playback.confirmed === paused) return;
    playback.sending = true;
    playback.confirmed = undefined;
    void this.connection
      .sendMessage({ type: paused ? 'prefetch-pause' : 'prefetch-resume' })
      .then((response) => {
        if (response?.ok) playback.confirmed = paused;
      })
      .catch(() => {})
      .finally(() => {
        if (this.playback !== playback) return;
        playback.sending = false;
        if (playback.desired !== paused) this.notePlayback(playback.desired);
      });
  }

  plan(time: number, rate: number, cues: readonly PlaybackCue[], captionLanguage: Language): void {
    if (captionLanguage === this.targetLanguage()) {
      this.release();
      return;
    }
    const key = JSON.stringify(
      cues.length
        ? [Math.floor(time / planRefreshSeconds) * planRefreshSeconds, rate, cues, captionLanguage]
        : [rate, cues, captionLanguage],
    );
    if (key === this.windowKey) return;
    this.windowKey = key;
    this.holdKey = '';
    this.active = cues.length > 0;
    void this.connection
      .sendMessage({
        type: 'prefetch',
        time,
        rate,
        cues,
        captionLanguage,
      })
      .catch(() => {});
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
      .sendMessage({ type: 'prefetch', time: 0, rate: 1, cues: [], captionLanguage: null })
      .catch(() => {});
  }

  private render(): void {
    this.overlay.render(captionView(this.caption, this.translationOnly()));
  }

  private update(caption: Caption, frame: CaptionFrame): void {
    const { line } = caption;
    if (line.kind !== 'none' && line.kind !== 'loading') return;
    if (frame.captionLanguage === this.targetLanguage()) {
      caption.line = { kind: 'repeated' };
      return;
    }
    const pending = caption.request !== null;
    if (frame.cacheOnly && (caption.checked || pending)) return;
    const waited = Date.now() - caption.since;
    if (pending || waited < frame.debounce) {
      if (!frame.cacheOnly && waited >= loadingDelayMs) caption.line = { kind: 'loading' };
      return;
    }
    this.request(caption, frame.cacheOnly, waited, frame.captionLanguage);
  }

  private request(
    caption: Caption,
    cacheOnly: boolean,
    waited: number,
    captionLanguage: Language,
  ): void {
    const request: Request = { cacheOnly };
    const current = () => this.caption === caption && caption.request === request;
    caption.request = request;
    if (cacheOnly) caption.checked = true;
    else {
      this.active = true;
      if (waited >= loadingDelayMs) caption.line = { kind: 'loading' };
    }
    void this.connection
      .sendMessage<unknown>({
        type: 'translate',
        text: caption.text,
        captionLanguage,
        ...(cacheOnly ? { cacheOnly: true } : {}),
      })
      .then((response) => {
        if (!current()) return;
        caption.request = null;
        if (response?.ok && cacheOnly && response.data === null) return;
        const translation = response?.ok ? readStoredTranslation(response.data) : null;
        if (translation !== null) caption.line = { kind: 'ready', translation };
        else
          caption.line = failedLine(
            response?.ok === false
              ? response.failure
              : {
                  kind: 'error',
                  message: t(
                    '翻译未完成，请检查扩展配置。',
                    'Translation incomplete. Check your extension settings.',
                  ),
                },
          );
      })
      .catch((error) => {
        if (!current()) return;
        caption.request = null;
        caption.line = failedLine(
          failureOf(error, t('翻译失败，请检查配置。', 'Translation failed. Check your settings.')),
        );
      })
      .finally(() => this.changed());
  }
}

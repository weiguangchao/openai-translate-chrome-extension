import { t } from '../shared/i18n';
import type { Language } from '../shared/languages';
import { readStoredTranslation } from '../shared/caption-translation';
import type { PlaybackCue } from '../shared/playback-plan';
import { failureOf, type TranslateFailure } from '../shared/provider-error';
import type { ViewState } from '../shared/trace';
import { loadingDelayMs, planRefreshSeconds } from '../shared/tuning';
import type { ExtensionConnection } from './connection';
import type { CaptionView, SubtitleOverlay, TranslationLine } from './overlay';
import type { PageStatus } from '../shared/messages';
import { RECOVERY_PORT, recoveryEvent } from '../shared/recovery';

export interface CaptionFrame {
  readonly text: string;
  readonly cacheOnly: boolean;
  readonly debounce: number;
  readonly captionLanguage: Language;
  readonly pageTitle: string;
}

interface Request {
  readonly cacheOnly: boolean;
}

interface Caption {
  readonly text: string;
  readonly identity: string;
  since: number;
  line: TranslationLine;
  request: Request | null;
  checked: boolean;
  playedMs: number;
  sampledAt: number;
  wasPlaying: boolean;
  recoveryTried: boolean;
  supplement: { port: chrome.runtime.Port; sent: boolean } | null;
  failure: TranslateFailure | null;
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
  private paused = false;
  private hasPlayed = false;
  private resumed: Caption | null = null;
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
    private recoverySettings: () => { provider: string; translationRevision: string } = () => ({
      provider: 'microsoft',
      translationRevision: '',
    }),
  ) {}

  get state(): ViewState {
    return VIEW_STATES[this.caption?.line.kind ?? 'none'];
  }

  get pageStatus(): PageStatus {
    const kind = this.caption?.line.kind ?? 'none';
    switch (kind) {
      case 'none':
        return 'waiting';
      case 'loading':
        return 'loading';
      case 'ready':
        return this.translationOnly() ? 'translation-only' : 'bilingual';
      case 'repeated':
        return 'original';
      case 'unsupported-language':
        return 'unsupported-language';
      case 'failed':
      case 'timedOut':
        return 'error';
      default: {
        const exhaustive: never = kind;
        return exhaustive;
      }
    }
  }

  hasTranslation(text: string): boolean {
    return this.caption?.text === text && this.caption.line.kind === 'ready';
  }

  cancel(): void {
    this.closeSupplement();
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
    this.closeSupplement();
    this.caption = null;
    this.resumed = null;
    this.render();
  }

  reset(): void {
    this.closeSupplement();
    this.caption = null;
    this.playback = { desired: false, confirmed: false, sending: false };
    this.windowKey = '';
    this.holdKey = '';
    this.active = false;
    this.paused = false;
    this.hasPlayed = false;
    this.resumed = null;
  }

  show(frame: CaptionFrame): void {
    const identity = JSON.stringify([frame.text, frame.captionLanguage, frame.pageTitle]);
    if (identity !== this.caption?.identity) {
      this.closeSupplement();
      this.caption = {
        text: frame.text,
        identity,
        since: Date.now(),
        line: { kind: 'none' },
        request: null,
        checked: false,
        playedMs: 0,
        sampledAt: Date.now(),
        wasPlaying: !frame.cacheOnly,
        recoveryTried: false,
        supplement: null,
        failure: null,
      };
    }
    if (this.resumed === this.caption && !frame.cacheOnly) this.openSupplement(this.caption, frame);
    this.resumed = null;
    this.update(this.caption, frame);
    this.render();
  }

  unsupportedLanguage(): void {
    this.release();
    this.caption = {
      text: '',
      identity: '',
      since: Date.now(),
      line: { kind: 'unsupported-language' },
      request: null,
      checked: true,
      playedMs: 0,
      sampledAt: Date.now(),
      wasPlaying: !this.paused,
      recoveryTried: true,
      supplement: null,
      failure: null,
    };
    this.render();
  }

  notePlayback(paused: boolean): void {
    const now = Date.now();
    const caption = this.caption;
    if (caption) {
      if (caption.wasPlaying && (caption.line.kind === 'none' || caption.line.kind === 'loading'))
        caption.playedMs += Math.max(0, now - caption.sampledAt);
      caption.sampledAt = now;
      caption.wasPlaying = !paused;
    }
    if (this.hasPlayed && this.paused && !paused) this.resumed = caption;
    this.hasPlayed ||= !paused;
    const changed = this.paused !== paused;
    this.paused = paused;
    if (changed && caption?.supplement) {
      try {
        caption.supplement.port.postMessage({ type: 'state', paused });
      } catch {
        this.closeSupplement();
      }
    }
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

  plan(
    time: number,
    rate: number,
    cues: readonly PlaybackCue[],
    captionLanguage: Language,
    pageTitle: string,
  ): void {
    if (captionLanguage === this.targetLanguage()) {
      this.release();
      return;
    }
    const key = JSON.stringify(
      cues.length
        ? [
            Math.floor(time / planRefreshSeconds) * planRefreshSeconds,
            rate,
            cues,
            captionLanguage,
            pageTitle,
          ]
        : [rate, cues, captionLanguage, pageTitle],
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
        pageTitle,
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
    this.closeSupplement();
    this.resumed = null;
    if (!this.active) return;
    this.active = false;
    this.windowKey = '';
    this.holdKey = '';
    void this.connection
      .sendMessage({
        type: 'prefetch',
        time: 0,
        rate: 1,
        cues: [],
        captionLanguage: null,
        pageTitle: '',
      })
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
    if (caption.failure) {
      if (!frame.cacheOnly && caption.playedMs >= loadingDelayMs)
        caption.line = { kind: 'loading' };
      return;
    }
    if (frame.cacheOnly && (caption.checked || pending)) return;
    const waited = Date.now() - caption.since;
    if (pending || waited < frame.debounce) {
      if (!frame.cacheOnly && caption.playedMs >= loadingDelayMs)
        caption.line = { kind: 'loading' };
      return;
    }
    this.request(caption, frame);
  }

  private request(caption: Caption, frame: CaptionFrame): void {
    const { cacheOnly, captionLanguage, pageTitle } = frame;
    const request: Request = { cacheOnly };
    const current = () => this.caption === caption && caption.request === request;
    caption.request = request;
    if (cacheOnly) caption.checked = true;
    else {
      this.active = true;
      if (caption.playedMs >= loadingDelayMs) caption.line = { kind: 'loading' };
    }
    void this.connection
      .sendMessage<unknown>({
        type: 'translate',
        text: caption.text,
        captionLanguage,
        pageTitle,
        ...(cacheOnly ? { cacheOnly: true } : {}),
      })
      .then((response) => {
        if (!current()) return;
        caption.request = null;
        if (response?.ok && cacheOnly && response.data === null) return;
        const translation = response?.ok ? readStoredTranslation(response.data) : null;
        if (caption.line.kind !== 'none' && caption.line.kind !== 'loading') return;
        if (translation !== null) {
          caption.line = { kind: 'ready', translation };
          this.closeSupplement();
        } else
          this.fail(
            caption,
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
        this.fail(
          caption,
          failureOf(error, t('翻译失败，请检查配置。', 'Translation failed. Check your settings.')),
        );
      })
      .finally(() => this.changed());
  }

  private fail(caption: Caption, failure: TranslateFailure): void {
    if (
      this.caption !== caption ||
      (caption.line.kind !== 'none' && caption.line.kind !== 'loading')
    )
      return;
    caption.failure = failure;
    if (caption.supplement?.sent) return;
    this.closeSupplement();
    caption.line = failedLine(failure);
  }

  private closeSupplement(): void {
    const caption = this.caption;
    const supplement = caption?.supplement;
    if (!caption || !supplement) return;
    caption.supplement = null;
    try {
      supplement.port.disconnect();
    } catch {}
    if (caption.failure && (caption.line.kind === 'none' || caption.line.kind === 'loading'))
      caption.line = failedLine(caption.failure);
  }

  private openSupplement(caption: Caption, frame: CaptionFrame): void {
    const settings = this.recoverySettings();
    if (
      caption.recoveryTried ||
      settings.provider !== 'openai' ||
      (caption.line.kind !== 'none' && caption.line.kind !== 'loading')
    )
      return;
    caption.recoveryTried = true;
    try {
      const port = this.connection.connect(
        RECOVERY_PORT +
          JSON.stringify({
            type: 'translate',
            text: caption.text,
            captionLanguage: frame.captionLanguage,
            pageTitle: frame.pageTitle,
            revision: settings.translationRevision,
            paused: frame.cacheOnly,
          }),
      );
      const supplement = { port, sent: false };
      caption.supplement = supplement;
      port.onDisconnect.addListener(() => {
        if (this.caption !== caption || caption.supplement !== supplement) return;
        this.closeSupplement();
        this.changed();
      });
      port.onMessage.addListener((value: unknown) => {
        if (this.caption !== caption || caption.supplement !== supplement) return;
        const event = recoveryEvent(value);
        if (!event) return;
        if (event.type === 'sync') {
          try {
            port.postMessage({ type: 'sync-state', paused: this.paused });
          } catch {
            this.closeSupplement();
          }
        } else if (event.type === 'sent') supplement.sent = true;
        else {
          if (
            event.type === 'translation' &&
            (caption.line.kind === 'none' || caption.line.kind === 'loading')
          )
            caption.line = { kind: 'ready', translation: event.translation };
          this.closeSupplement();
        }
        this.changed();
      });
    } catch {}
  }
}

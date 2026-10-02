import type { PublicSettings } from '../shared/settings';
import {
  needsSubtitleSegmentation,
  type SubtitleTranslation,
} from '../shared/subtitle-segmentation';
import { ExtensionConnection } from './connection';
import { sourceCaptionAt, translatedCaptionAt } from './segmented-captions';
import {
  captionText,
  captionWindow,
  NativeTimeline,
  selectedTrack,
  YoutubeTimeline,
  type SubtitleTimeline,
} from './timeline';

export interface Caption {
  text: string;
  element: HTMLElement | null;
  nativeTrack: boolean;
}
const HBO_CAPTIONS =
  '[data-testid="subtitles"], [data-testid="subtitle-text"], [data-testid="cue"], [class*="SubtitleRenderer"], [class*="CaptionsRenderer"], .shaka-text-container, .vjs-text-track-display';
function visible(element: HTMLElement): boolean {
  if (element.hidden || element.closest('[hidden], [aria-hidden="true"]')) return false;
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    const replaced = node.matches('.subline-youtube .ytp-caption-window-container');
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      (style.opacity === '0' && !replaced)
    )
      return false;
  }
  return true;
}
export function readCaption(
  player: HTMLElement,
  video: HTMLVideoElement,
  sourceLanguage: string,
): Caption {
  if (
    video.closest('.ad-showing') ||
    player.querySelector('.ytp-subtitles-button')?.getAttribute('aria-pressed') === 'false'
  )
    return { text: '', element: null, nativeTrack: false };
  const youtube = player.querySelector<HTMLElement>('.ytp-caption-window-container');
  if (youtube && visible(youtube)) {
    const windows = [...youtube.querySelectorAll<HTMLElement>('.caption-window')].filter(visible);
    const root = windows[0] ?? youtube;
    const lines = [...root.querySelectorAll<HTMLElement>('.caption-visual-line')].filter(visible);
    const text = (
      lines.length
        ? lines.map((line) => line.textContent ?? '').join('\n')
        : [...root.querySelectorAll<HTMLElement>('.ytp-caption-segment')]
            .filter(visible)
            .map((node) => node.textContent ?? '')
            .join(' ')
    ).trim();
    if (text) return { text, element: root, nativeTrack: false };
  }
  const hbo = [...player.querySelectorAll<HTMLElement>(HBO_CAPTIONS)].find(
    (element) => visible(element) && element.textContent?.trim(),
  );
  if (hbo) return { text: (hbo.textContent ?? '').trim(), element: hbo, nativeTrack: false };
  const track = selectedTrack(video, sourceLanguage);
  const text = track?.activeCues ? [...track.activeCues].map(captionText).join('\n').trim() : '';
  return { text, element: null, nativeTrack: Boolean(text) };
}

function findPlayer(video: HTMLVideoElement): HTMLElement | null {
  const fullscreen = document.fullscreenElement;
  if (fullscreen === video) return null;
  if (fullscreen instanceof HTMLElement && fullscreen.contains(video)) return fullscreen;
  const known = video.closest<HTMLElement>(
    '.html5-video-player, [data-testid="player-container"], [data-testid="video-player"], [data-testid="video-player-container"], .shaka-video-container, .video-js',
  );
  if (known) return known;
  let parent = video.parentElement;
  for (
    let depth = 0;
    parent && parent !== document.body && depth < 6;
    depth++, parent = parent.parentElement
  ) {
    if (parent.querySelector(HBO_CAPTIONS) && parent.querySelectorAll('video').length === 1)
      return parent;
  }
  return video.parentElement;
}

const SEEK_SETTLE_MS = 400;
const LOOKAHEAD_DELAY_MS = 1000;
const SEEK_JUMP_SECONDS = 1;
const SEEK_JUMP_TOLERANCE = 1e-3;
const SEEK_PREVIEW_CUES = 4;
const STYLE = `
.subline-player:not(.subline-youtube) [data-subline-caption] { translate: 0 calc(-1 * var(--subline-reserve)) !important; }
.subline-player:not(.subline-youtube) [data-subline-caption], .subline-player:not(.subline-youtube) [data-subline-caption] * {
  color: var(--subline-source-color) !important; font-size: var(--subline-source-size) !important;
}
video.subline-native::cue { color: transparent !important; background: transparent !important; text-shadow: none !important; }
.subline-player [data-subline-timeline] { visibility: hidden !important; }
.subline-player.subline-youtube .ytp-caption-window-container { opacity: 0 !important; pointer-events: none !important; }
`;
const LOADING_TRANSLATION = '翻译中';

function isTranslation(data: unknown, segment: boolean): data is SubtitleTranslation {
  return (
    typeof data === 'string' ||
    (segment &&
      typeof data === 'object' &&
      data !== null &&
      'segments' in data &&
      Array.isArray(data.segments))
  );
}

export class CaptionController {
  private settings: PublicSettings;
  private connection: ExtensionConnection;
  private player: HTMLElement | null = null;
  private video: HTMLVideoElement | null = null;
  private host: HTMLDivElement | null = null;
  private stack: HTMLDivElement | null = null;
  private original: HTMLDivElement | null = null;
  private translated: HTMLDivElement | null = null;
  private captionElement: HTMLElement | null = null;
  private style: HTMLStyleElement;
  private interval: ReturnType<typeof setInterval>;
  private currentText = '';
  private changedAt = 0;
  private requested = '';
  private version = 0;
  private pageUrl = location.href;
  private positionedPlayer = false;
  private translations = new Map<string, SubtitleTranslation>();
  private destroyed = false;
  private youtube = new YoutubeTimeline(() => this.tick());
  private native = new NativeTimeline();
  private translationMode: SubtitleTimeline['mode'] | null = null;
  private windowKey = '';
  private prefetchedAt = 0;
  private source = '';
  private nativeTrack: TextTrack | undefined;
  private scheduleLead = true;
  private leadUntil = 0;
  private observedTime = Number.NaN;
  private seekSettlesAt = 0;
  private lookaheadAt = 0;
  private seekTimer: ReturnType<typeof setTimeout> | undefined;
  private lookaheadTimer: ReturnType<typeof setTimeout> | undefined;
  private playbackHeld = false;
  private mediaEvents = [
    'play',
    'pause',
    'loadedmetadata',
    'timeupdate',
    'seeking',
    'seeked',
    'ratechange',
    'emptied',
  ];
  private onMediaChange = (event: Event) => {
    if (event.type === 'seeking' || event.type === 'seeked') this.holdForSeek();
    this.tick();
  };

  constructor(settings: PublicSettings, connection?: ExtensionConnection) {
    this.settings = settings;
    this.connection = connection ?? new ExtensionConnection(() => this.destroy());
    this.style = document.createElement('style');
    this.style.textContent = STYLE;
    document.documentElement.append(this.style);
    this.interval = setInterval(() => this.tick(), 150);
    this.tick();
  }

  update(settings: PublicSettings): void {
    if (this.destroyed) return;
    this.settings = settings;
    this.translations = new Map();
    this.unmount();
    this.resetSources();
    this.tick();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    clearInterval(this.interval);
    this.unmount();
    this.resetSources();
    this.style.remove();
    this.youtube.destroy();
    this.translations = new Map();
  }

  private unmount(): void {
    this.prefetch([], Boolean(this.video));
    this.translationMode = null;
    for (const event of this.mediaEvents)
      this.video?.removeEventListener(event, this.onMediaChange);
    this.captionElement?.removeAttribute('data-subline-timeline');
    this.source = '';
    this.nativeTrack = undefined;
    this.version++;
    this.currentText = '';
    this.requested = '';
    this.captionElement?.removeAttribute('data-subline-caption');
    this.captionElement = null;
    this.video?.classList.remove('subline-native');
    if (this.player) {
      this.player.classList.remove('subline-player', 'subline-youtube');
      for (const name of ['--subline-source-color', '--subline-source-size', '--subline-reserve'])
        this.player.style.removeProperty(name);
      if (this.positionedPlayer && this.player.style.position === 'relative')
        this.player.style.removeProperty('position');
    }
    this.host?.remove();
    this.player = null;
    this.video = null;
    this.host = null;
    this.stack = null;
    this.original = null;
    this.translated = null;
    this.positionedPlayer = false;
    this.scheduleLead = true;
    this.observedTime = Number.NaN;
    this.seekSettlesAt = 0;
    this.lookaheadAt = 0;
    clearTimeout(this.seekTimer);
    clearTimeout(this.lookaheadTimer);
    this.seekTimer = undefined;
    this.lookaheadTimer = undefined;
    this.playbackHeld = false;
  }

  private resetSources(): void {
    this.youtube.reset();
    this.native.reset();
  }

  private mount(video: HTMLVideoElement, player: HTMLElement): void {
    this.unmount();
    this.player = player;
    this.video = video;
    for (const event of this.mediaEvents) video.addEventListener(event, this.onMediaChange);
    this.positionedPlayer = getComputedStyle(player).position === 'static';
    if (this.positionedPlayer) player.style.position = 'relative';
    player.classList.add('subline-player');
    player.classList.toggle('subline-youtube', Boolean(video.closest('.html5-video-player')));
    player.style.setProperty('--subline-source-color', this.settings.original.color);
    player.style.setProperty('--subline-source-size', `${this.settings.original.size}px`);
    player.style.setProperty(
      '--subline-reserve',
      `${this.settings.translation.size * 1.4 + this.settings.subtitleGap}px`,
    );
    this.host = document.createElement('div');
    this.host.dataset.sublineOverlay = '';
    this.host.style.cssText =
      'position:absolute;inset:0;z-index:2147483646;pointer-events:none;overflow:hidden;';
    const shadow = this.host.attachShadow({ mode: 'open' });
    const css = document.createElement('style');
    css.textContent =
      ':host{all:initial}.stack{position:absolute;left:4%;width:92%;text-align:center;font-family:Arial,"PingFang SC",sans-serif;line-height:1.4;pointer-events:none}.line{width:fit-content;max-width:100%;margin-inline:auto;padding:1px 8px;border-radius:3px;white-space:pre-line;overflow-wrap:anywhere;text-shadow:0 1px 3px #000;box-sizing:border-box}.error{font-size:13px!important;color:#ffe3b0!important}';
    this.stack = document.createElement('div');
    this.stack.className = 'stack';
    this.original = document.createElement('div');
    this.original.className = 'line original';
    this.translated = document.createElement('div');
    this.translated.className = 'line translation';
    this.translated.setAttribute('dir', 'auto');
    this.original.setAttribute('dir', 'auto');
    for (const [node, style] of [
      [this.original, this.settings.original],
      [this.translated, this.settings.translation],
    ] as const) {
      node.style.color = style.color;
      node.style.fontSize = `${style.size}px`;
      node.style.backgroundColor = `rgba(0,0,0,${this.settings.backgroundOpacity / 100})`;
      node.hidden = true;
    }
    this.translated.style.marginTop = `${this.settings.subtitleGap}px`;
    this.stack.append(this.original, this.translated);
    shadow.append(css, this.stack);
    player.append(this.host);
  }

  private tick(): void {
    if (this.destroyed) return;
    if (!this.connection.active) {
      this.destroy();
      return;
    }
    const allowed = location.hostname.endsWith('youtube.com')
      ? this.settings.youtube
      : this.settings.hbo;
    if (!this.settings.enabled || !allowed) {
      if (this.host) this.unmount();
      this.resetSources();
      return;
    }
    if (location.href !== this.pageUrl) {
      this.pageUrl = location.href;
      this.translations = new Map();
      this.unmount();
      this.resetSources();
    }
    const video = [...document.querySelectorAll('video')].find((v) => visible(v) && !v.ended);
    if (!video) {
      if (this.host) this.unmount();
      this.resetSources();
      return;
    }
    const player = findPlayer(video);
    if (!player) {
      if (this.host) this.unmount();
      this.resetSources();
      return;
    }
    const youtubeTimeline = this.youtube.read(
      video,
      this.settings.sourceLanguage,
      this.settings.targetLanguage,
    );
    if (youtubeTimeline) this.native.reset();
    const subtitles =
      youtubeTimeline ??
      this.native.read(video, this.settings.sourceLanguage, this.settings.targetLanguage);
    if (!this.settings.configured && subtitles.mode !== 'existing') {
      if (this.host) this.unmount();
      return;
    }
    if (this.video !== video || this.player !== player || !this.host?.isConnected)
      this.mount(video, player);
    if (!this.player || !this.stack || !this.original || !this.translated) return;
    if (subtitles.mode !== this.translationMode) {
      this.prefetch([], Boolean(this.requested));
      this.clearCaption();
      this.translations = new Map();
      this.translationMode = subtitles.mode;
    }
    if (video.seeking) {
      this.notePlaybackTime(video.currentTime);
      this.holdForSeek();
      this.clearCaption();
      return;
    }
    this.notePlaybackTime(video.currentTime);
    const track = selectedTrack(video, this.settings.sourceLanguage);
    const source = video.currentSrc;
    if (source !== this.source || track !== this.nativeTrack) {
      this.source = source;
      this.nativeTrack = track;
      this.scheduleLead = true;
      this.version++;
      this.clearCaption();
      this.translations = new Map();
      this.prefetch([]);
    }
    const cues = subtitles.source;
    if (cues && this.scheduleLead) {
      this.leadUntil = video.currentTime + 1;
      this.scheduleLead = false;
    }
    const translationTime = Math.max(video.currentTime, this.leadUntil);
    const timeline = cues ? captionWindow(cues, video.currentTime) : null;
    const translationWindow =
      cues && translationTime !== video.currentTime
        ? captionWindow(cues, translationTime)
        : timeline;
    const existingText =
      subtitles.mode === 'existing' && subtitles.translation
        ? captionWindow(subtitles.translation, video.currentTime).current
        : '';
    const usesModel =
      this.settings.configured &&
      subtitles.mode === 'model' &&
      (!youtubeTimeline || Boolean(timeline));
    const youtube = this.player.classList.contains('subline-youtube');
    const siteElement = timeline
      ? this.player.querySelector<HTMLElement>(`.ytp-caption-window-container, ${HBO_CAPTIONS}`)
      : null;
    const caption: Caption = timeline
      ? { text: timeline.current, element: siteElement, nativeTrack: true }
      : youtubeTimeline
        ? { text: '', element: null, nativeTrack: true }
        : readCaption(this.player, video, this.settings.sourceLanguage);
    const settling = Date.now() < this.seekSettlesAt;
    this.notePlayback(video.paused);
    const upcoming = usesModel && !video.paused ? (translationWindow?.texts ?? []) : [];
    const texts = settling
      ? []
      : Date.now() < this.lookaheadAt
        ? upcoming.slice(0, SEEK_PREVIEW_CUES)
        : upcoming;
    if (!video.paused) this.prefetch(texts, false, translationWindow?.segments);
    if (caption.element !== this.captionElement) {
      this.captionElement?.removeAttribute('data-subline-caption');
      this.captionElement?.removeAttribute('data-subline-timeline');
      this.captionElement = caption.element;
      this.captionElement?.setAttribute('data-subline-caption', '');
    }
    this.captionElement?.toggleAttribute('data-subline-timeline', Boolean(timeline) && !youtube);
    video.classList.toggle('subline-native', caption.nativeTrack);
    const customOriginal = youtube || caption.nativeTrack;
    const timedCaption = cues?.find(
      (cue) =>
        cue.startTime <= video.currentTime &&
        video.currentTime < cue.endTime &&
        cue.text === caption.text,
    );
    const segment = Boolean(usesModel && timedCaption && needsSubtitleSegmentation(caption.text));
    const translationKey = JSON.stringify([caption.text, segment]);
    const visibleSource =
      customOriginal && timedCaption
        ? (sourceCaptionAt(timedCaption, video.currentTime) ?? '')
        : customOriginal
          ? caption.text
          : '';
    this.original.hidden = !visibleSource;
    this.original.textContent = visibleSource;
    if (!caption.text && !existingText) {
      this.clearCaption();
      return;
    }
    if (caption.element && !timeline && !youtube) {
      const rect = caption.element.getBoundingClientRect();
      const parent = this.player.getBoundingClientRect();
      this.stack.style.bottom = 'auto';
      this.stack.style.top = `${Math.max(0, Math.min(parent.height - this.stack.offsetHeight - 8, rect.bottom - parent.top))}px`;
    } else {
      this.stack.style.top = 'auto';
      this.stack.style.bottom = '9%';
    }
    if (!usesModel) {
      if (this.currentText) this.version++;
      this.currentText = '';
      this.requested = '';
      this.translated.classList.remove('error');
      this.translated.textContent = existingText;
      this.translated.hidden = !existingText;
      return;
    }
    if (caption.text !== this.currentText) {
      this.version++;
      this.currentText = caption.text;
      this.changedAt = Date.now();
      this.requested = '';
      this.translated.hidden = true;
      this.translated.textContent = '';
      this.translated.classList.remove('error');
    }
    const cached = this.translations.get(translationKey);
    if (cached !== undefined) {
      const display =
        typeof cached === 'string'
          ? { text: visibleSource || caption.text, translation: cached }
          : translatedCaptionAt(timedCaption!, cached, video.currentTime);
      this.original.textContent = customOriginal ? (display?.text ?? '') : '';
      this.original.hidden = !customOriginal || !display?.text;
      this.translated.classList.remove('error');
      this.translated.textContent = display?.translation ?? '';
      this.translated.hidden = !display?.translation;
      this.requested = caption.text;
      return;
    }
    if (video.paused) {
      if (!this.requested) this.clearLoadingTranslation();
      return;
    }
    if (
      timedCaption &&
      video.currentTime < this.leadUntil &&
      timedCaption.endTime <= this.leadUntil
    )
      return;
    if (Date.now() < this.seekSettlesAt) return;
    const providerPending = this.requested === this.currentText && this.requested !== '';
    if (providerPending || Date.now() - this.changedAt < (timeline ? 0 : 300)) {
      if (!this.translated.classList.contains('error')) this.showLoadingTranslation();
      return;
    }
    const text = this.currentText,
      version = this.version;
    this.requested = text;
    this.showLoadingTranslation();
    void this.connection
      .sendMessage<SubtitleTranslation>({
        type: 'translate',
        text,
        ...(segment ? { segment: true } : {}),
      })
      .then((response) => {
        this.tick();
        if (this.destroyed || this.version !== version || !this.translated) return;
        const data = response?.data;
        if (!response?.ok || !isTranslation(data, segment))
          throw new Error(response?.error ?? '翻译未完成，请检查扩展配置。');
        this.translations.set(translationKey, data);
        this.tick();
      })
      .catch((error) => {
        this.tick();
        if (this.destroyed || this.version !== version || !this.translated) return;
        this.translated.textContent = `Subline：${error instanceof Error ? error.message : '翻译失败，请检查配置。'}`;
        this.translated.classList.add('error');
        this.translated.hidden = false;
        this.requested = '';
        this.changedAt = Date.now() + 15000;
      });
  }

  private notePlaybackTime(time: number): void {
    const previous = this.observedTime;
    this.observedTime = time;
    if (
      Number.isFinite(previous) &&
      Math.abs(time - previous) > SEEK_JUMP_SECONDS + SEEK_JUMP_TOLERANCE
    ) {
      this.holdForSeek();
    }
  }

  private holdForSeek(): void {
    this.scheduleLead = true;
    this.seekSettlesAt = Date.now() + SEEK_SETTLE_MS;
    this.lookaheadAt = Number.POSITIVE_INFINITY;
    this.prefetch([]);
    if (this.requested) {
      this.version++;
      this.requested = '';
    }
    this.clearLoadingTranslation();
    clearTimeout(this.seekTimer);
    clearTimeout(this.lookaheadTimer);
    this.lookaheadTimer = undefined;
    this.seekTimer = setTimeout(() => this.releaseSeekHold(), SEEK_SETTLE_MS);
  }

  private releaseSeekHold(): void {
    this.seekTimer = undefined;
    if (this.destroyed) return;
    this.seekSettlesAt = 0;
    this.lookaheadAt = Date.now() + LOOKAHEAD_DELAY_MS;
    clearTimeout(this.lookaheadTimer);
    this.lookaheadTimer = setTimeout(() => {
      this.lookaheadTimer = undefined;
      if (!this.destroyed) this.tick();
    }, LOOKAHEAD_DELAY_MS);
    this.tick();
  }

  private notePlayback(paused: boolean): void {
    if (paused) {
      if (this.playbackHeld || (!this.windowKey && !this.requested)) return;
      this.playbackHeld = true;
    } else {
      if (!this.playbackHeld) return;
      this.playbackHeld = false;
    }
    void this.connection
      .sendMessage({ type: 'prefetch', texts: [], pause: paused })
      .catch(() => {});
  }

  private prefetch(texts: string[], force = false, segments: readonly boolean[] = []): void {
    const flags = texts.map((_, index) => segments[index] === true);
    const key = JSON.stringify([texts, flags]);
    if (
      !force &&
      ((!this.windowKey && !texts.length) ||
        (key === this.windowKey && (!texts.length || Date.now() - this.prefetchedAt < 15000)))
    )
      return;
    this.windowKey = key;
    this.prefetchedAt = Date.now();
    const translations = this.translations;
    void this.connection
      .sendMessage<unknown[]>({
        type: 'prefetch',
        texts,
        ...(flags.some(Boolean) ? { segments: flags } : {}),
      })
      .then((response) => {
        if (
          this.destroyed ||
          this.windowKey !== key ||
          this.translations !== translations ||
          !response?.ok ||
          !Array.isArray(response.data)
        )
          return;
        response.data.forEach((data, index) => {
          const text = texts[index];
          if (text && isTranslation(data, flags[index]))
            translations.set(JSON.stringify([text, flags[index]]), data);
        });
        this.tick();
      })
      .catch(() => {});
  }

  private showLoadingTranslation(): void {
    if (
      !this.translated ||
      (this.translated.textContent === LOADING_TRANSLATION && !this.translated.hidden)
    )
      return;
    this.translated.classList.remove('error');
    this.translated.textContent = LOADING_TRANSLATION;
    this.translated.hidden = false;
  }

  private clearLoadingTranslation(): void {
    if (!this.translated || this.translated.textContent !== LOADING_TRANSLATION) return;
    this.translated.textContent = '';
    this.translated.hidden = true;
  }

  private clearCaption(): void {
    if (this.currentText) this.version++;
    this.currentText = '';
    this.requested = '';
    if (this.translated) {
      this.translated.hidden = true;
      this.translated.textContent = '';
    }
    if (this.original) {
      this.original.hidden = true;
      this.original.textContent = '';
    }
  }
}

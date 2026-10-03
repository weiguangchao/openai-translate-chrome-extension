import type { PublicSettings } from '../shared/settings';
import type { SourceMode } from './bridge/protocol';
import { ExtensionConnection } from './connection';
import { visible } from './dom';
import { selectedTrack } from './native';
import { SubtitleOverlay } from './overlay';
import type { CaptionSource, LiveCaption, Platform, PlatformFactory } from './platform';
import { PlaybackGate } from './playback';
import { captionWindow, timedCaptions } from './timeline';
import { CaptionTranslator } from './translator';

const SEEK_PREVIEW_CUES = 4;
const STYLE = `
video.subline-native::cue { color: transparent !important; background: transparent !important; text-shadow: none !important; }
.subline-player [data-subline-caption] { opacity: 0 !important; pointer-events: none !important; }
`;
const MEDIA_EVENTS = [
  'play',
  'pause',
  'loadedmetadata',
  'timeupdate',
  'seeking',
  'seeked',
  'ratechange',
  'emptied',
];

function playerFor(video: HTMLVideoElement, platform: Platform): HTMLElement | null {
  const fullscreen = document.fullscreenElement;
  if (fullscreen === video) return null;
  if (fullscreen instanceof HTMLElement && fullscreen.contains(video)) return fullscreen;
  return platform.findPlayer(video);
}

function currentCaption(source: CaptionSource, timelineText: string): LiveCaption {
  if (source.kind === 'timeline')
    return { text: timelineText, layers: source.layers(), nativeTrack: true };
  if (source.kind === 'live') return source.read();
  return { text: '', layers: [], nativeTrack: true };
}

export class CaptionController {
  private settings: PublicSettings;
  private connection: ExtensionConnection;
  private platform: Platform;
  private overlay = new SubtitleOverlay();
  private translator: CaptionTranslator;
  private gate: PlaybackGate;
  private style: HTMLStyleElement;
  private interval: ReturnType<typeof setInterval>;
  private video: HTMLVideoElement | null = null;
  private pageVideo: string;
  private mode: SourceMode | null = null;
  private source = '';
  private nativeTrack: TextTrack | undefined;
  private destroyed = false;
  private onMediaChange = (event: Event) => {
    if (event.type === 'seeking' || event.type === 'seeked') this.gate.hold();
    this.tick();
  };

  constructor(
    createPlatform: PlatformFactory,
    settings: PublicSettings,
    connection?: ExtensionConnection,
  ) {
    this.settings = settings;
    this.connection = connection ?? new ExtensionConnection(() => this.destroy());
    this.platform = createPlatform(() => this.tick());
    this.pageVideo = this.platform.videoId();
    this.translator = new CaptionTranslator(this.connection, this.overlay, () => this.tick());
    this.gate = new PlaybackGate({
      hold: () => {
        this.translator.prefetch([]);
        this.translator.cancel();
        this.overlay.clearLoading();
      },
      changed: () => this.tick(),
    });
    this.style = document.createElement('style');
    this.style.textContent = STYLE + this.platform.style;
    document.documentElement.append(this.style);
    this.interval = setInterval(() => this.tick(), 150);
    this.tick();
  }

  update(settings: PublicSettings): void {
    if (this.destroyed) return;
    this.settings = settings;
    this.unmount();
    this.tick();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    clearInterval(this.interval);
    this.unmount();
    this.style.remove();
    this.platform.destroy();
  }

  private stop(): void {
    if (this.overlay.mounted) this.unmount();
    this.platform.reset();
  }

  private unmount(): void {
    this.translator.prefetch([], Boolean(this.video));
    this.mode = null;
    for (const event of MEDIA_EVENTS) this.video?.removeEventListener(event, this.onMediaChange);
    this.overlay.unmount();
    this.video?.classList.remove('subline-native');
    this.video = null;
    this.source = '';
    this.nativeTrack = undefined;
    this.translator.reset();
    this.gate.reset();
  }

  private mount(video: HTMLVideoElement, player: HTMLElement): void {
    this.unmount();
    this.video = video;
    for (const event of MEDIA_EVENTS) video.addEventListener(event, this.onMediaChange);
    this.overlay.mount(player, this.settings);
  }

  private clearCaption(): void {
    this.translator.clear();
    this.overlay.clear();
  }

  private tick(): void {
    if (this.destroyed) return;
    if (!this.connection.active) {
      this.destroy();
      return;
    }
    if (!this.settings.enabled || !this.settings[this.platform.id]) {
      this.stop();
      return;
    }
    const pageVideo = this.platform.videoId();
    if (pageVideo !== this.pageVideo) {
      this.pageVideo = pageVideo;
      this.unmount();
      this.platform.reset();
    }
    const video = [...document.querySelectorAll('video')].find((v) => visible(v) && !v.ended);
    const player = video ? playerFor(video, this.platform) : null;
    if (!video || !player) {
      this.stop();
      return;
    }
    const source = this.platform.source(video, player, this.settings.sourceLanguage);
    if (!this.settings.configured) {
      if (this.overlay.mounted) this.unmount();
      return;
    }
    if (this.video !== video || this.overlay.player !== player || !this.overlay.connected)
      this.mount(video, player);
    if (source.mode !== this.mode) {
      this.translator.prefetch([], this.translator.requesting);
      this.clearCaption();
      this.mode = source.mode;
    }
    const time = video.currentTime;
    if (video.seeking) {
      this.gate.observe(time);
      this.gate.hold();
      this.clearCaption();
      return;
    }
    this.gate.observe(time);
    const track = selectedTrack(video, this.settings.sourceLanguage);
    const sourceId = source.id ?? video.currentSrc;
    if (sourceId !== this.source || track !== this.nativeTrack) {
      this.source = sourceId;
      this.nativeTrack = track;
      this.gate.restartLead();
      this.translator.invalidate();
      this.clearCaption();
      this.translator.prefetch([]);
    }
    const captions = source.kind === 'timeline' ? timedCaptions(source.cues) : null;
    const translationTime = this.gate.lead(time, captions !== null);
    const current = captions ? captionWindow(captions, time) : null;
    const upcoming =
      captions && translationTime !== time ? captionWindow(captions, translationTime) : current;
    const usesModel = source.mode === 'model';
    const caption = currentCaption(source, current?.current ?? '');
    this.translator.notePlayback(video.paused);
    const texts = usesModel && !video.paused ? (upcoming?.texts ?? []) : [];
    if (!video.paused)
      this.translator.prefetch(
        this.gate.settling ? [] : this.gate.previewing ? texts.slice(0, SEEK_PREVIEW_CUES) : texts,
        false,
        upcoming?.segments,
        upcoming?.needsSplit,
      );
    this.overlay.hide(caption.layers);
    video.classList.toggle('subline-native', caption.nativeTrack);
    const cue = captions?.find(
      (item) => item.startTime <= time && time < item.endTime && item.text === caption.text,
    );
    if (!caption.text) {
      this.clearCaption();
      return;
    }
    if (!usesModel) {
      this.translator.passThrough(caption.text);
      return;
    }
    this.translator.show({
      text: caption.text,
      needsSplit: cue?.needsSplit === true,
      cue,
      time,
      cacheOnly:
        video.paused ||
        Boolean(cue && time < this.gate.leadUntil && cue.endTime <= this.gate.leadUntil) ||
        this.gate.settling,
      debounce: current ? 0 : 300,
    });
  }
}

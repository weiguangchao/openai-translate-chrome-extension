import type { PlatformId } from '../shared/platforms';
import type { SourceMode } from './bridge/protocol';
import type { TimedCue } from './cues';

export interface LiveCaption {
  text: string;
  layers: HTMLElement[];
  nativeTrack: boolean;
}

interface SourceBase {
  mode: SourceMode;
  id?: string;
}

export type CaptionSource =
  | (SourceBase & {
      kind: 'timeline';
      cues: readonly TimedCue[];
      layers(): HTMLElement[];
    })
  | (SourceBase & { kind: 'live'; read(): LiveCaption })
  | (SourceBase & { kind: 'waiting' });

export interface Platform {
  readonly id: PlatformId;
  readonly style: string;
  videoId(): string;
  findVideo?(): HTMLVideoElement | undefined;
  findPlayer(video: HTMLVideoElement): HTMLElement | null;
  source(video: HTMLVideoElement, player: HTMLElement, sourceLanguage: string): CaptionSource;
  reset(): void;
  destroy(): void;
}

export type PlatformFactory = (changed: () => void) => Platform;

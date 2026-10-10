import { planLookaheadCues } from './limits';
import type { PlaybackCue } from './playback-plan';
import type { PublicSettings } from './settings';
import type { TraceRequest } from './trace';

export interface Reply<T> {
  ok?: boolean;
  data?: T;
  error?: string;
}

export interface TranslateRequest {
  type: 'translate';
  text: string;
  cacheOnly?: boolean;
}

export interface PrefetchRequest {
  type: 'prefetch';
  time: number;
  rate: number;
  cues: readonly PlaybackCue[];
}

export interface PrefetchHoldRequest {
  type: 'prefetch-hold';
  time: number;
}

export type ContentRequest =
  | { type: 'settings' }
  | TranslateRequest
  | PrefetchRequest
  | PrefetchHoldRequest
  | TraceRequest
  | { type: 'prefetch-pause' }
  | { type: 'prefetch-resume' };

export interface ProviderCheckRequest {
  type: 'models' | 'test';
  settings: unknown;
}

export interface SettingsUpdated {
  type: 'settings-updated';
  settings: PublicSettings;
}

export function requestType(message: unknown): string | undefined {
  if (!message || typeof message !== 'object' || !('type' in message)) return;
  return typeof message.type === 'string' ? message.type : undefined;
}

function validText(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim()) && value.length <= 5000;
}

export function readTranslateRequest(message: object): Required<TranslateRequest> {
  const { text, cacheOnly } = message as Record<string, unknown>;
  if (!validText(text)) throw new Error('字幕内容无效。');
  return { type: 'translate', text, cacheOnly: cacheOnly === true };
}

function finiteTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function readHoldRequest(message: object): PrefetchHoldRequest {
  const { time } = message as Record<string, unknown>;
  if (!finiteTime(time)) throw new Error('预加载字幕内容无效。');
  return { type: 'prefetch-hold', time };
}

export function readPrefetchRequest(message: object): PrefetchRequest {
  const { time, rate, cues } = message as Record<string, unknown>;
  if (!finiteTime(time) || !finiteTime(rate) || rate === 0 || !Array.isArray(cues))
    throw new Error('预加载字幕内容无效。');
  if (cues.length > planLookaheadCues) throw new Error('预加载字幕内容无效。');
  return {
    type: 'prefetch',
    time,
    rate,
    cues: cues.map((cue: unknown): PlaybackCue => {
      if (!cue || typeof cue !== 'object') throw new Error('预加载字幕内容无效。');
      const { text, start, end } = cue as Record<string, unknown>;
      if (!validText(text) || !finiteTime(start) || !finiteTime(end) || end <= start)
        throw new Error('预加载字幕内容无效。');
      return { text, start, end };
    }),
  };
}

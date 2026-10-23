import { t } from './i18n';
import { supportedLanguage, type Language } from './languages';
import { UnsupportedLanguageError } from './provider-error';
import { planLookaheadCues } from './tuning';
import type { PlaybackCue } from './playback-plan';
import type { TranslateFailure } from './provider-error';
import type { PublicSettings } from './settings';
import type { TraceRequest } from './trace';

export type Reply<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly failure: TranslateFailure };

export interface TranslateRequest {
  type: 'translate';
  text: string;
  captionLanguage: Language;
  cacheOnly?: boolean;
}

export interface PrefetchRequest {
  type: 'prefetch';
  captionLanguage: Language | null;
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

function captionLanguageOf(message: object): Language {
  const { captionLanguage } = message as Record<string, unknown>;
  const language = typeof captionLanguage === 'string' ? supportedLanguage(captionLanguage) : null;
  if (!language) throw new UnsupportedLanguageError();
  return language;
}

export function readTranslateRequest(message: object): TranslateRequest & { cacheOnly: boolean } {
  const { text, cacheOnly } = message as Record<string, unknown>;
  if (!validText(text)) throw new Error(t('字幕内容无效。', 'Invalid subtitle text.'));
  return {
    type: 'translate',
    text,
    cacheOnly: cacheOnly === true,
    captionLanguage: captionLanguageOf(message),
  };
}

function finiteTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function readHoldRequest(message: object): PrefetchHoldRequest {
  const { time } = message as Record<string, unknown>;
  if (!finiteTime(time))
    throw new Error(t('预加载字幕内容无效。', 'Invalid subtitle prefetch data.'));
  return { type: 'prefetch-hold', time };
}

export function readPrefetchRequest(message: object): PrefetchRequest {
  const { time, rate, cues } = message as Record<string, unknown>;
  if (!finiteTime(time) || !finiteTime(rate) || rate === 0 || !Array.isArray(cues))
    throw new Error(t('预加载字幕内容无效。', 'Invalid subtitle prefetch data.'));
  if (cues.length > planLookaheadCues)
    throw new Error(t('预加载字幕内容无效。', 'Invalid subtitle prefetch data.'));
  return {
    type: 'prefetch',
    captionLanguage: cues.length ? captionLanguageOf(message) : null,
    time,
    rate,
    cues: cues.map((cue: unknown): PlaybackCue => {
      if (!cue || typeof cue !== 'object')
        throw new Error(t('预加载字幕内容无效。', 'Invalid subtitle prefetch data.'));
      const { text, start, end } = cue as Record<string, unknown>;
      if (!validText(text) || !finiteTime(start) || !finiteTime(end) || end <= start)
        throw new Error(t('预加载字幕内容无效。', 'Invalid subtitle prefetch data.'));
      return { text, start, end };
    }),
  };
}

import { prefetchWindowLimit } from './limits';
import type { PublicSettings } from './settings';

export interface Reply<T> {
  ok?: boolean;
  data?: T;
  error?: string;
}

export interface TranslateRequest {
  type: 'translate';
  text: string;
  needsSplit?: boolean;
  cacheOnly?: boolean;
}

export interface PrefetchRequest {
  type: 'prefetch';
  texts: string[];
  segments?: number[];
  needsSplit?: boolean[];
}

export type ContentRequest =
  | { type: 'settings' }
  | TranslateRequest
  | PrefetchRequest
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

function optionalList(value: unknown, length: number, valid: (item: unknown) => boolean): boolean {
  return (
    value === undefined || (Array.isArray(value) && value.length === length && value.every(valid))
  );
}

export function emptyPrefetch(message: object): boolean {
  const texts = (message as { texts?: unknown }).texts;
  return Array.isArray(texts) && !texts.length;
}

export function readTranslateRequest(message: object): Required<TranslateRequest> {
  const { text, needsSplit, cacheOnly } = message as Record<string, unknown>;
  if (!validText(text) || (needsSplit !== undefined && typeof needsSplit !== 'boolean'))
    throw new Error('字幕内容无效。');
  return {
    type: 'translate',
    text,
    needsSplit: needsSplit === true,
    cacheOnly: cacheOnly === true,
  };
}

export function readPrefetchRequest(message: object): Required<PrefetchRequest> {
  const { texts, segments, needsSplit } = message as Record<string, unknown>;
  if (
    !Array.isArray(texts) ||
    texts.length > prefetchWindowLimit ||
    !texts.every(validText) ||
    !optionalList(
      segments,
      texts.length,
      (segment) => Number.isSafeInteger(segment) && (segment as number) >= 0,
    ) ||
    !optionalList(needsSplit, texts.length, (flag) => typeof flag === 'boolean')
  )
    throw new Error('预加载字幕内容无效。');
  return {
    type: 'prefetch',
    texts,
    segments: (segments as number[] | undefined) ?? texts.map(() => 0),
    needsSplit: (needsSplit as boolean[] | undefined) ?? texts.map(() => false),
  };
}

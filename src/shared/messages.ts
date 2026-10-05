import type { PrefetchItem } from './caption-translation';
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
  items: readonly PrefetchItem[];
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

export function readPrefetchRequest(message: object): PrefetchRequest {
  const { items } = message as Record<string, unknown>;
  if (!Array.isArray(items) || items.length > prefetchWindowLimit)
    throw new Error('预加载字幕内容无效。');
  return {
    type: 'prefetch',
    items: items.map((item: unknown): PrefetchItem => {
      if (!item || typeof item !== 'object') throw new Error('预加载字幕内容无效。');
      const { text, segment, needsSplit } = item as Record<string, unknown>;
      if (
        !validText(text) ||
        typeof segment !== 'number' ||
        !Number.isSafeInteger(segment) ||
        segment < 0 ||
        typeof needsSplit !== 'boolean'
      )
        throw new Error('预加载字幕内容无效。');
      return { text, segment, needsSplit };
    }),
  };
}

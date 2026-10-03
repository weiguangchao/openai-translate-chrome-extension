import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  STORAGE_KEY,
  validateBaseUrl,
  type Settings,
} from './settings';
import { fetchModels, translate } from './api';

export const isExtension = typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);
export async function loadSettings(): Promise<Settings> {
  if (isExtension)
    return normalizeSettings((await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY]);
  try {
    return normalizeSettings(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}
export async function saveSettings(settings: Settings): Promise<void> {
  if (isExtension) await chrome.storage.local.set({ [STORAGE_KEY]: settings });
  else localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...settings, apiKey: '' }));
}

type ModelProvider = Pick<Settings, 'baseUrl' | 'apiKey'>;

async function modelCacheKey(settings: ModelProvider): Promise<string> {
  const baseUrl = validateBaseUrl(settings.baseUrl).href.replace(/\/+$/, '');
  const identity = JSON.stringify([baseUrl, settings.apiKey.trim()]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  return `subline.models.v1.${hash}`;
}

function modelIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((id): id is string => typeof id === 'string')
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ];
}

export async function loadCachedModels(settings: ModelProvider): Promise<string[]> {
  if (!settings.apiKey.trim()) return [];
  try {
    const key = await modelCacheKey(settings);
    const value = isExtension
      ? (await chrome.storage.local.get(key))[key]
      : JSON.parse(localStorage.getItem(key) ?? 'null');
    return modelIds(value);
  } catch {
    return [];
  }
}

export async function saveCachedModels(settings: ModelProvider, models: string[]): Promise<void> {
  try {
    const key = await modelCacheKey(settings);
    const ids = modelIds(models);
    if (isExtension) await chrome.storage.local.set({ [key]: ids });
    else localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    throw new Error('模型已获取，但无法缓存到本地，请重试。');
  }
}

export async function allowApiHost(settings: Settings): Promise<void> {
  const url = validateBaseUrl(settings.baseUrl);
  if (!isExtension) return;
  const granted = await chrome.permissions.request({
    origins: [`${url.protocol}//${url.hostname}/*`],
  });
  if (!granted) throw new Error('需要授权访问此 API 地址，才能获取模型或翻译字幕。');
}
export async function apiAction(
  kind: 'models' | 'test',
  settings: Settings,
): Promise<string[] | string> {
  if (!isExtension)
    return kind === 'models'
      ? fetchModels(settings)
      : translate(settings, 'The world is full of wonderful things.');
  const response = await chrome.runtime.sendMessage({ type: kind, settings });
  if (!response?.ok) throw new Error(response?.error ?? '扩展后台没有响应，请重新加载扩展。');
  return response.data;
}

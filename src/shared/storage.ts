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

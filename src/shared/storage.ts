import { t } from './i18n';
import {
  DEFAULT_SETTINGS,
  applySettingsPatch,
  normalizeSettings,
  STORAGE_KEY,
  validateBaseUrl,
  type Settings,
  type SettingsPatch,
} from './settings';
import { fetchModels, translate } from './api';
import { decryptApiKey, encryptApiKey } from './api-key';
import type { Reply } from './messages';
import { failureText } from './provider-error';

export const isExtension = typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);
async function readSettings(): Promise<{ settings: Settings; plaintext: boolean }> {
  if (isExtension) {
    const stored = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
    const plaintext = typeof stored?.apiKey === 'string' && Boolean(stored.apiKey);
    const apiKey = plaintext ? stored.apiKey : await decryptApiKey(stored?.apiKey);
    return { settings: normalizeSettings({ ...stored, apiKey }), plaintext };
  }
  try {
    return {
      settings: normalizeSettings(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')),
      plaintext: false,
    };
  } catch {
    return { settings: structuredClone(DEFAULT_SETTINGS), plaintext: false };
  }
}
export async function loadSettings(): Promise<Settings> {
  const { settings, plaintext } = await readSettings();
  return plaintext ? saveSettings({}) : settings;
}
export async function saveSettings(patch: SettingsPatch): Promise<Settings> {
  return navigator.locks.request(STORAGE_KEY, async () => {
    const { settings } = await readSettings();
    const next = applySettingsPatch(settings, patch);
    if (isExtension) {
      const apiKey = next.apiKey && (await encryptApiKey(next.apiKey));
      await chrome.storage.local.set({ [STORAGE_KEY]: { ...next, apiKey } });
    } else localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...next, apiKey: '' }));
    return next;
  });
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
    throw new Error(
      t(
        '模型已获取，但无法缓存到本地，请重试。',
        'Models were fetched but could not be cached locally. Try again.',
      ),
    );
  }
}

export async function allowApiHost(settings: Settings): Promise<void> {
  const url = validateBaseUrl(settings.baseUrl);
  if (!isExtension) return;
  const granted = await chrome.permissions.request({
    origins: [`${url.protocol}//${url.hostname}/*`],
  });
  if (!granted)
    throw new Error(
      t(
        '需要授权访问此 API 地址，才能获取模型或翻译字幕。',
        'Allow access to this API address to fetch models or translate subtitles.',
      ),
    );
}
export async function apiAction(
  kind: 'models' | 'test',
  settings: Settings,
): Promise<string[] | string> {
  if (!isExtension)
    return kind === 'models'
      ? fetchModels(settings)
      : translate(settings, 'The world is full of wonderful things.');
  const response: Reply<string[] | string> | undefined = await chrome.runtime.sendMessage({
    type: kind,
    settings,
  });
  if (!response)
    throw new Error(
      t(
        '扩展后台没有响应，请重新加载扩展。',
        'The extension background did not respond. Reload the extension.',
      ),
    );
  if (!response.ok) throw new Error(failureText(response.failure));
  return response.data;
}

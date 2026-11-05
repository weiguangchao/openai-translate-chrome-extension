import { afterEach, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  STORAGE_KEY,
  settingsPatch,
  publicSettings,
  type Settings,
} from '../src/shared/settings';
import { extensionStorage } from './fixtures/extension-storage';

const saved = { ...DEFAULT_SETTINGS, apiKey: 'sk-private-key', model: 'model', subtitleGap: 16 };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function openStorage(previous?: Map<string, unknown>) {
  const { stored, local, onChanged } = extensionStorage(previous);
  vi.stubGlobal('chrome', { runtime: { id: 'extension-id' }, storage: { local, onChanged } });
  vi.resetModules();
  return { stored, ...(await import('../src/shared/storage')) };
}

it.each(['original', 'translation'] as const)(
  'reads malformed %s styles using defaults without losing other settings',
  async (kind) => {
    const { stored, loadSettings } = await openStorage();
    for (const style of [
      { color: ['#123456'] },
      { color: { toString: null } },
      null,
      { size: '32' },
    ]) {
      stored.set(STORAGE_KEY, { ...DEFAULT_SETTINGS, model: 'kept-model', [kind]: style });
      await expect(loadSettings()).resolves.toEqual({ ...DEFAULT_SETTINGS, model: 'kept-model' });
    }
    const style = { color: '#123456', size: 32 };
    stored.set(STORAGE_KEY, { ...DEFAULT_SETTINGS, model: 'kept-model', [kind]: style });
    await expect(loadSettings()).resolves.toEqual({
      ...DEFAULT_SETTINGS,
      model: 'kept-model',
      [kind]: style,
    });
  },
);

it('stores the API key encrypted and reads it back in a new extension context', async () => {
  const { stored, saveSettings } = await openStorage();
  await saveSettings(saved);
  expect(JSON.stringify([...stored])).not.toContain(saved.apiKey);
  vi.resetModules();
  const reopened = await import('../src/shared/storage');
  await expect(reopened.loadSettings()).resolves.toEqual(saved);
});

it('encrypts a plaintext API key saved by an earlier version when it is first read', async () => {
  const { stored, loadSettings } = await openStorage();
  stored.set(STORAGE_KEY, saved);
  await expect(loadSettings()).resolves.toEqual(saved);
  expect(JSON.stringify([...stored])).not.toContain(saved.apiKey);
  await expect(loadSettings()).resolves.toEqual(saved);
});

it('reads an API key encrypted under a lost device key as unset and keeps the other settings', async () => {
  const first = await openStorage();
  await first.saveSettings(saved);
  const other = await openStorage(first.stored);
  await expect(other.loadSettings()).resolves.toEqual({ ...saved, apiKey: '' });
});

it('preserves independent edits from stale drafts and serializes writes across contexts', async () => {
  const first = await openStorage();
  await first.saveSettings(saved);
  const draft = await first.loadSettings();
  vi.resetModules();
  const second = await import('../src/shared/storage');
  await second.saveSettings({ enabled: false });
  await first.saveSettings(
    settingsPatch(draft, { ...draft, translation: { ...draft.translation, size: 32 } }),
  );
  await expect(first.loadSettings()).resolves.toMatchObject({
    enabled: false,
    translation: { size: 32 },
  });
  await Promise.all([
    first.saveSettings({ original: { color: '#123456' } }),
    second.saveSettings({ original: { size: 30 }, targetLanguage: 'ja' }),
  ]);
  await expect(first.loadSettings()).resolves.toMatchObject({
    enabled: false,
    original: { color: '#123456', size: 30 },
    translation: { size: 32 },
    targetLanguage: 'ja',
    apiKey: saved.apiKey,
  });
  await Promise.all([
    first.saveSettings({ targetLanguage: 'en' }),
    second.saveSettings({ targetLanguage: 'zh-TW' }),
  ]);
  await expect(first.loadSettings()).resolves.toMatchObject({ targetLanguage: 'zh-TW' });
  expect(JSON.stringify([...first.stored])).not.toContain(saved.apiKey);
});

it('defaults a fresh install to Microsoft and requires consent to its origin', async () => {
  const { loadSettings } = await openStorage();
  const settings = await loadSettings();
  expect(settings.provider).toBe('microsoft');
  expect(settings.apiKey).toBe('');
  expect(publicSettings(settings).configured).toBe(false);
  expect(
    publicSettings({ ...settings, providerConsent: 'https://edge.microsoft.com' }).configured,
  ).toBe(true);
  expect(
    publicSettings({ ...settings, providerConsent: 'https://api.openai.com' }).configured,
  ).toBe(false);
});

it.each(['plaintext', 'encrypted'] as const)(
  'preserves legacy OpenAI configuration with a %s key across saves',
  async (kind) => {
    const storage = await openStorage();
    const configured: Settings = {
      ...saved,
      provider: 'openai',
      providerConsent: 'https://api.openai.com',
    };
    await storage.saveSettings(configured);
    const legacy: unknown = storage.stored.get(STORAGE_KEY);
    if (!legacy || typeof legacy !== 'object') throw new Error('Missing saved settings');
    Reflect.deleteProperty(legacy, 'provider');
    if (kind === 'plaintext') Reflect.set(legacy, 'apiKey', saved.apiKey);
    storage.stored.set(STORAGE_KEY, legacy);
    const loaded = await storage.loadSettings();
    expect(loaded).toEqual(configured);
    expect(publicSettings(loaded).configured).toBe(true);
    expect(await storage.saveSettings({ subtitleGap: 8 })).toMatchObject({
      provider: 'openai',
      apiKey: saved.apiKey,
      model: saved.model,
      providerConsent: configured.providerConsent,
    });
    expect(JSON.stringify([...storage.stored])).not.toContain(saved.apiKey);
  },
);

it('keeps OpenAI credentials when selecting Microsoft and persists the selected provider', async () => {
  const { loadSettings, saveSettings } = await openStorage();
  await saveSettings({ ...saved, provider: 'openai' });
  await saveSettings({ provider: 'microsoft', providerConsent: 'https://edge.microsoft.com' });
  expect(await loadSettings()).toMatchObject({
    provider: 'microsoft',
    apiKey: saved.apiKey,
    model: saved.model,
  });
  expect(await saveSettings({ provider: 'openai' })).toMatchObject({
    provider: 'openai',
    apiKey: saved.apiKey,
    model: saved.model,
  });
});

it('requests host access for the selected Microsoft provider instead of the stored OpenAI address', async () => {
  const { allowApiHost } = await openStorage();
  const request = vi.fn().mockResolvedValue(true);
  vi.stubGlobal('chrome', { ...chrome, permissions: { request } });
  await allowApiHost({ ...DEFAULT_SETTINGS, baseUrl: 'https://unused.example/v1' });
  expect(request).toHaveBeenCalledExactlyOnceWith({ origins: ['https://edge.microsoft.com/*'] });
});

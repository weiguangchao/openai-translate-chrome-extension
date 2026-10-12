import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, STORAGE_KEY } from '../src/shared/settings';
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

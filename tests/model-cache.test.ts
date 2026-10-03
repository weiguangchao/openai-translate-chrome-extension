import { afterEach, expect, it, vi } from 'vitest';

const provider = { baseUrl: 'https://provider.example/api/v1/', apiKey: 'private-cache-key' };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function cacheEnvironment(extension: boolean) {
  const stored = new Map<string, unknown>();
  const get = vi.fn(async (key: string) => ({ [key]: stored.get(key) }));
  const set = vi.fn(async (values: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(values)) stored.set(key, structuredClone(value));
  });
  const setItem = vi.fn((key: string, value: string) => stored.set(key, value));
  vi.stubGlobal(
    'chrome',
    extension ? { runtime: { id: 'extension' }, storage: { local: { get, set } } } : undefined,
  );
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem,
  });
  return { stored, get, set, setItem, cache: await import('../src/shared/storage') };
}

it.each([true, false])(
  'persists and refreshes complete model lists across reloads with extension=%s',
  async (extension) => {
    const { stored, cache } = await cacheEnvironment(extension);
    await cache.saveCachedModels(provider, ['model-a', 'model-b', 'model-a']);
    vi.resetModules();
    const reopened = await import('../src/shared/storage');
    const normalized = {
      baseUrl: 'https://provider.example/api/v1',
      apiKey: ' private-cache-key ',
    };
    await expect(reopened.loadCachedModels(normalized)).resolves.toEqual(['model-a', 'model-b']);
    await reopened.saveCachedModels(normalized, ['model-c', 'model-d']);
    await expect(reopened.loadCachedModels(provider)).resolves.toEqual(['model-c', 'model-d']);
    expect(stored.size).toBe(1);
    expect([...stored.keys()][0]).toMatch(/^subline\.models\.v1\.[a-f0-9]{64}$/);
    expect(JSON.stringify([...stored])).not.toContain(provider.apiKey);
  },
);

it.each([true, false])(
  'keeps caches separate for each provider URL and API key with extension=%s',
  async (extension) => {
    const { cache } = await cacheEnvironment(extension);
    const otherUrl = { ...provider, baseUrl: 'https://provider.example/other/v1' };
    const otherKey = { ...provider, apiKey: 'another-cache-key' };
    await cache.saveCachedModels(provider, ['model-a']);
    await expect(cache.loadCachedModels(otherUrl)).resolves.toEqual([]);
    await expect(cache.loadCachedModels(otherKey)).resolves.toEqual([]);
    await cache.saveCachedModels(otherUrl, ['model-b']);
    await cache.saveCachedModels(otherKey, ['model-c']);
    await expect(cache.loadCachedModels(provider)).resolves.toEqual(['model-a']);
    await expect(cache.loadCachedModels(otherUrl)).resolves.toEqual(['model-b']);
    await expect(cache.loadCachedModels(otherKey)).resolves.toEqual(['model-c']);
  },
);

it.each([true, false])(
  'ignores invalid cache entries and incomplete credentials with extension=%s',
  async (extension) => {
    const { stored, cache } = await cacheEnvironment(extension);
    await cache.saveCachedModels(provider, ['model-a']);
    const key = [...stored.keys()][0];
    const malformed = [' model-a ', null, {}, 42, '', 'model-a', 'model-b'];
    stored.set(key, extension ? malformed : JSON.stringify(malformed));
    await expect(cache.loadCachedModels(provider)).resolves.toEqual(['model-a', 'model-b']);
    stored.set(key, extension ? {} : 'invalid json');
    await expect(cache.loadCachedModels(provider)).resolves.toEqual([]);
    await expect(cache.loadCachedModels({ ...provider, baseUrl: 'invalid' })).resolves.toEqual([]);
    await expect(cache.loadCachedModels({ ...provider, apiKey: '' })).resolves.toEqual([]);
  },
);

it.each([true, false])(
  'reports a failed cache write without replacing the last successful list with extension=%s',
  async (extension) => {
    const { cache, set, setItem } = await cacheEnvironment(extension);
    await cache.saveCachedModels(provider, ['model-a']);
    if (extension) set.mockRejectedValueOnce(new Error('Quota exceeded'));
    else
      setItem.mockImplementationOnce(() => {
        throw new Error('Quota exceeded');
      });
    await expect(cache.saveCachedModels(provider, ['model-b'])).rejects.toThrow('无法缓存到本地');
    await expect(cache.loadCachedModels(provider)).resolves.toEqual(['model-a']);
  },
);

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchModels, translate } from '../src/shared/api';
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  publicSettings,
  validateSettings,
  type Settings,
} from '../src/shared/settings';

const config = (): Settings => ({
  ...structuredClone(DEFAULT_SETTINGS),
  baseUrl: 'https://provider.example/api/v1/',
  apiKey: 'private-test-key',
  model: 'subtitle-model',
});
afterEach(() => vi.unstubAllGlobals());

describe('OpenAI-compatible provider contract', () => {
  it.each(['http://9.9.9.9:59271/v1', 'http://provider.example:8080/api/v1'])(
    'fetches models from the configured HTTP service at %s before a model is selected',
    async (baseUrl) => {
      const fetch = vi.fn().mockResolvedValue(Response.json({ data: [{ id: 'subtitle-model' }] }));
      vi.stubGlobal('fetch', fetch);

      await expect(fetchModels({ ...config(), baseUrl, model: '' })).resolves.toEqual([
        'subtitle-model',
      ]);
      expect(fetch).toHaveBeenCalledWith(
        `${baseUrl}/models`,
        expect.objectContaining({
          method: 'GET',
          headers: { Authorization: 'Bearer private-test-key' },
        }),
      );
    },
  );

  it('fetches and deduplicates model IDs, falling back to /model only when /models is unavailable', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(
        Response.json({ data: [{ id: 'model-b' }, { id: 'model-a' }, { id: 'model-a' }, {}] }),
      );
    vi.stubGlobal('fetch', fetch);
    await expect(fetchModels(config())).resolves.toEqual(['model-a', 'model-b']);
    expect(fetch.mock.calls.map((call) => call[0])).toEqual([
      'https://provider.example/api/v1/models',
      'https://provider.example/api/v1/model',
    ]);
    expect(fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer private-test-key');
  });

  it('reports an authentication error without retrying or exposing provider error bodies', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({ error: { message: 'Your private-test-key is invalid' } }, { status: 401 }),
      );
    vi.stubGlobal('fetch', fetch);
    await expect(fetchModels(config())).rejects.toThrow('API Key 无效或已过期。');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['chat', 'completions'] as const)(
    'translates with the %s protocol and preserves literal subtitle content',
    async (apiFormat) => {
      const fetch = vi
        .fn()
        .mockResolvedValue(
          Response.json(
            apiFormat === 'chat'
              ? { choices: [{ message: { content: '  保留字幕中的变量。  ' } }] }
              : { choices: [{ text: '  保留字幕中的变量。  ' }] },
          ),
        );
      vi.stubGlobal('fetch', fetch);
      const settings = {
        ...config(),
        apiFormat,
        prompt: '{{source_language}} → {{target_language}}\n{{text}}',
      };
      await expect(translate(settings, 'Keep {{target_language}} and $& literal.')).resolves.toBe(
        '保留字幕中的变量。',
      );
      const [url, init] = fetch.mock.calls[0];
      expect(url).toBe(
        `https://provider.example/api/v1/${apiFormat === 'chat' ? 'chat/completions' : 'completions'}`,
      );
      const body = JSON.parse(init.body);
      expect(body.model).toBe('subtitle-model');
      expect(apiFormat === 'chat' ? body.messages[1].content : body.prompt).toBe(
        'English → 简体中文\nKeep {{target_language}} and $& literal.',
      );
      expect(body.stream).toBe(false);
      expect(init.redirect).toBe('error');
      expect(init.credentials).toBe('omit');
    },
  );

  it('rejects non-JSON and empty completions instead of painting an undefined translation', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response('<html>login</html>'))
        .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: null } }] })),
    );
    await expect(translate(config(), 'Hello')).rejects.toThrow('有效的 JSON');
    await expect(translate(config(), 'Hello')).rejects.toThrow('模型未返回译文');
  });

  it('rejects unsafe URLs before sending any credentials', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    for (const baseUrl of [
      'ftp://provider.example/v1',
      'file:///v1',
      'https://provider.example/v1?token=oops',
      'https://user:password@provider.example/v1',
      'https://provider.example/v1/chat/completions',
    ]) {
      await expect(fetchModels({ ...config(), baseUrl })).rejects.toThrow();
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('saved configuration contract', () => {
  it('allows partial setup, but requires the text placeholder and different languages', () => {
    expect(() => validateSettings(structuredClone(DEFAULT_SETTINGS))).not.toThrow();
    expect(() => validateSettings({ ...config(), prompt: 'Translate this' })).toThrow('{{text}}');
    expect(() => validateSettings({ ...config(), sourceLanguage: 'zh-CN' })).toThrow('需要不同');
  });

  it('bounds persisted styles and strips service secrets from content-script settings', () => {
    const settings = normalizeSettings({
      ...config(),
      original: { color: 'url(https://tracker.example)', size: 999 },
      translation: { color: '#ffe3a3', size: 0 },
      backgroundOpacity: 1000,
      enabled: 'false',
      sourceLanguage: 'invalid',
    });
    expect(settings.original).toEqual({ color: '#FFFFFF', size: 48 });
    expect(settings.translation).toEqual({ color: '#ffe3a3', size: 12 });
    expect(settings.backgroundOpacity).toBe(90);
    expect(settings.enabled).toBe(true);
    expect(settings.sourceLanguage).toBe('en');
    const exposed = publicSettings(settings);
    expect(exposed.configured).toBe(true);
    for (const secret of ['apiKey', 'baseUrl', 'prompt', 'model', 'apiFormat'])
      expect(exposed).not.toHaveProperty(secret);
    expect(JSON.stringify(exposed)).not.toContain('private-test-key');
  });
});

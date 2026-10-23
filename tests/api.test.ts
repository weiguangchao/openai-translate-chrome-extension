import { afterEach, describe, expect, it, vi } from 'vitest';
import manifest from '../public/manifest.json';
import { fetchModels, translate, translateCaptionBatch } from '../src/shared/api';
import { translationBatchLimit } from '../src/shared/tuning';
import { TOKEN_USAGE_KEY } from '../src/shared/token-usage';
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  publicSettings,
  validateSettings,
  type CaptionTranslationSettings,
} from '../src/shared/settings';

const config = (): CaptionTranslationSettings => ({
  ...structuredClone(DEFAULT_SETTINGS),
  captionLanguage: 'en',
  baseUrl: 'https://provider.example/api/v1/',
  apiKey: 'private-test-key',
  model: 'subtitle-model',
});
afterEach(() => vi.unstubAllGlobals());

const localHttpProviders = ['http://localhost:11434/api/v1', 'http://127.0.0.1:59271/v1'];

describe('OpenAI-compatible provider contract', () => {
  it.each(localHttpProviders)(
    'fetches models from the local HTTP service at %s before a model is selected',
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
    await expect(fetchModels(config())).rejects.toThrow('The API Key is invalid or expired.');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, 'chat', 'completions'])(
    'translates through chat completions with saved apiFormat=%s and literal content',
    async (apiFormat) => {
      const fetch = vi
        .fn()
        .mockResolvedValue(
          Response.json({ choices: [{ message: { content: '  保留字幕中的变量。  ' } }] }),
        );
      vi.stubGlobal('fetch', fetch);
      const text = 'Keep {{target_language}} and $& literal.';
      const settings = normalizeSettings({ ...config(), apiFormat });
      expect(settings).not.toHaveProperty('apiFormat');
      await expect(translate(settings, text)).resolves.toBe('保留字幕中的变量。');
      const [url, init] = fetch.mock.calls[0];
      expect(url).toBe('https://provider.example/api/v1/chat/completions');
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body);
      expect(body.model).toBe('subtitle-model');
      const instructions: string = body.messages[0].content;
      expect(instructions).toMatch(/^Translate the given text into Simplified Chinese\./);
      expect(instructions).toContain('Output only the translation');
      expect(instructions).not.toMatch(/subtitle|film|movie/i);
      expect(instructions).toMatch(/^[\x20-\x7E\n]+$/);
      expect(body.messages[0].role).toBe('system');
      expect(body.messages[1]).toEqual({ role: 'user', content: text });
      expect(body).not.toHaveProperty('prompt');
      expect(body.stream).toBe(false);
      expect(body.max_tokens).toBe(65536);
      expect(body).not.toHaveProperty('reasoning_effort');
      expect(init.redirect).toBe('error');
      expect(init.credentials).toBe('omit');
    },
  );

  it.each([undefined, 'chat', 'completions'])(
    'translates batches through chat completions with saved apiFormat=%s and preserves cue order',
    async (apiFormat) => {
      const content =
        '```json\n{"results":[{"id":2,"translation":"第三句"},{"id":0,"translation":" 第一句 "},{"id":1,"translation":"第二句"}]}\n```';
      const fetch = vi.fn().mockResolvedValue(
        Response.json({
          choices: [{ message: { content } }],
        }),
      );
      vi.stubGlobal('fetch', fetch);
      const texts = ['One.', 'Two "quoted"\nlines.', 'Three.'];
      const published = vi.fn();
      await expect(
        translateCaptionBatch(
          { ...normalizeSettings({ ...config(), apiFormat }), captionLanguage: 'en' },
          texts,
          undefined,
          published,
        ),
      ).resolves.toEqual(['第一句', '第二句', '第三句']);
      expect(published.mock.calls).toEqual([
        [2, '第三句'],
        [0, '第一句'],
        [1, '第二句'],
      ]);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[0][0]).toBe('https://provider.example/api/v1/chat/completions');
      const body = JSON.parse(fetch.mock.calls[0][1].body);
      const instructions: string = body.messages[0].content;
      expect(instructions).toMatch(/^Translate the given English into Simplified Chinese\./);
      expect(instructions).toContain('{"id":0,"text":"..."} becomes {"id":0,"translation":"..."}');
      expect(JSON.parse(body.messages[1].content)).toEqual(texts.map((text, id) => ({ id, text })));
      expect(body).not.toHaveProperty('prompt');
      expect(body.stream).toBe(false);
      expect(body.max_tokens).toBe(65536);
      expect(body).not.toHaveProperty('reasoning_effort');
      expect(body.response_format).toEqual({ type: 'json_object' });
    },
  );

  it('refuses a batch larger than the caption limit before contacting the provider', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(
      translateCaptionBatch(
        config(),
        Array.from({ length: translationBatchLimit + 1 }, (_, index) => `${index}`),
      ),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([400, 401, 422, 429, 500])(
    'reports HTTP %s without retrying either translation request',
    async (status) => {
      const fetch = vi.fn().mockImplementation(async () => new Response('', { status }));
      vi.stubGlobal('fetch', fetch);
      await expect(translate(config(), 'Hello')).rejects.toThrow();
      expect(fetch).toHaveBeenCalledTimes(1);
      await expect(translateCaptionBatch(config(), ['Hello'])).rejects.toThrow();
      expect(fetch).toHaveBeenCalledTimes(2);
    },
  );

  it('records input, output, and cache tokens for each provider response', async () => {
    const values: Record<string, unknown> = {};
    vi.stubGlobal('chrome', {
      runtime: { id: 'extension-id' },
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: values[key] })),
          set: vi.fn(async (items: Record<string, unknown>) => Object.assign(values, items)),
        },
      },
    });
    const usage = {
      prompt_tokens: 1800,
      completion_tokens: 260,
      total_tokens: 2060,
      prompt_tokens_details: { cached_tokens: 900 },
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('<html>login</html>'))
      .mockResolvedValueOnce(
        Response.json({
          choices: [{ message: { content: '   ' } }],
          usage: {
            ...usage,
            prompt_tokens: 11,
            completion_tokens: 1,
            prompt_tokens_details: { cached_tokens: 4 },
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ choices: [{ message: { content: '  第一句  ' } }], usage }),
      )
      .mockResolvedValueOnce(
        Response.json({
          choices: [{ message: { content: '第二句' } }],
          usage: {
            prompt_tokens: 20,
            completion_tokens: 5,
            prompt_tokens_details: { cached_tokens: 2 },
          },
        }),
      );
    vi.stubGlobal('fetch', fetch);
    await expect(translate(config(), 'Hello')).rejects.toThrow('invalid JSON');
    expect(values[TOKEN_USAGE_KEY]).toBeUndefined();
    await expect(translate(config(), 'Hello')).rejects.toThrow('The model returned no translation');
    await expect(translate(config(), 'Hello')).resolves.toBe('第一句');
    await expect(translate(config(), 'Next')).resolves.toBe('第二句');
    expect(values[TOKEN_USAGE_KEY]).toEqual({ input: 1831, output: 266, cache: 906 });
    expect(chrome.storage.local.set).toHaveBeenCalledTimes(3);
  });

  it('rejects non-JSON and empty completions instead of painting an undefined translation', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response('<html>login</html>'))
        .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: null } }] })),
    );
    await expect(translate(config(), 'Hello')).rejects.toThrow('invalid JSON');
    await expect(translate(config(), 'Hello')).rejects.toThrow('The model returned no translation');
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
      'http://provider.example:8080/api/v1',
      'http://192.168.1.10:11434/v1',
      'http://localhost.provider.example/v1',
    ]) {
      await expect(fetchModels({ ...config(), baseUrl })).rejects.toThrow();
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('asks for plain HTTP host access only on this computer', () => {
    expect(
      manifest.optional_host_permissions.filter((origin) => origin.startsWith('http:')),
    ).toEqual(localHttpProviders.map((baseUrl) => `http://${new URL(baseUrl).hostname}/*`));
  });
});

describe('saved configuration contract', () => {
  it('allows partial setup without a configured caption language', () => {
    expect(() => validateSettings(structuredClone(DEFAULT_SETTINGS))).not.toThrow();
    expect(() => validateSettings({ ...config(), targetLanguage: 'en' })).not.toThrow();
  });

  it('bounds persisted styles and strips service secrets from content-script settings', () => {
    const settings = normalizeSettings({
      ...config(),
      providerConsent: 'https://provider.example',
      original: { color: 'url(https://tracker.example)', size: 999 },
      translation: { color: '#ffe3a3', size: 0 },
      backgroundOpacity: 1000,
      enabled: 'false',
      sourceLanguage: 'invalid',
      prompt: 'A custom prompt saved by an earlier version',
    });
    expect(settings).not.toHaveProperty('prompt');
    expect(settings.original).toEqual({ color: '#FFFFFF', size: 48 });
    expect(settings.translation).toEqual({ color: '#ffe3a3', size: 12 });
    expect(settings.backgroundOpacity).toBe(90);
    expect(settings.enabled).toBe(true);
    expect(settings).not.toHaveProperty('sourceLanguage');
    const exposed = publicSettings(settings);
    expect(exposed.configured).toBe(true);
    for (const secret of ['apiKey', 'baseUrl', 'model', 'providerConsent', 'apiFormat'])
      expect(exposed).not.toHaveProperty(secret);
    expect(JSON.stringify(exposed)).not.toMatch(/private-test-key|provider\.example/);
  });

  it.each([
    [{ sourceLanguage: 'ja', targetLanguage: 'ko' }, 'zh-CN'],
    [{ sourceLanguage: 'zh-CN', targetLanguage: 'ja' }, 'ja'],
    [{ sourceLanguage: 'fr', targetLanguage: 'en' }, 'en'],
    [{ sourceLanguage: 'zh-TW', targetLanguage: 'zh-TW' }, 'zh-TW'],
  ])('migrates saved languages to a translation-only preference: %o', (saved, target) => {
    const settings = normalizeSettings({ ...config(), ...saved });
    expect(settings.targetLanguage).toBe(target);
    expect(settings).not.toHaveProperty('sourceLanguage');
  });
});

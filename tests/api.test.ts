import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import manifest from '../public/manifest.json';
import { TOKEN_USAGE_KEY } from '../src/shared/token-usage';
import { providerSendWindowMs } from '../src/shared/tuning';
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  publicSettings,
  type CaptionTranslationSettings,
} from '../src/shared/settings';

const config = (): CaptionTranslationSettings => ({
  ...structuredClone(DEFAULT_SETTINGS),
  provider: 'openai',
  captionLanguage: 'en',
  pageTitle: 'Video title',
  baseUrl: 'https://provider.example/api/v1/',
  apiKey: 'private-test-key',
  model: 'subtitle-model',
});
let fetchModels: typeof import('../src/shared/api').fetchModels;
let translate: typeof import('../src/shared/api').translate;
let translateCaptionBatch: typeof import('../src/shared/api').translateCaptionBatch;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  ({ fetchModels, translate, translateCaptionBatch } = await import('../src/shared/api'));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const localHttpProviders = ['http://localhost:11434/api/v1', 'http://127.0.0.1:59271/v1'];

describe('OpenAI-compatible provider contract', () => {
  it.each([
    ...localHttpProviders.map((baseUrl) => ({ baseUrl, accepted: true })),
    ...[
      'ftp://provider.example/v1',
      'file:///v1',
      'https://provider.example/v1?token=oops',
      'https://user:password@provider.example/v1',
      'https://provider.example/v1/chat/completions',
      'http://provider.example:8080/api/v1',
      'http://192.168.1.10:11434/v1',
      'http://localhost.provider.example/v1',
    ].map((baseUrl) => ({ baseUrl, accepted: false })),
  ])(
    'sends credentials to $baseUrl only when it is accepted: $accepted',
    async ({ baseUrl, accepted }) => {
      const fetch = vi.fn().mockResolvedValue(Response.json({ data: [{ id: 'subtitle-model' }] }));
      vi.stubGlobal('fetch', fetch);
      const models = fetchModels({ ...config(), baseUrl, model: '' });
      await expect(models.catch(() => null)).resolves.toEqual(accepted ? ['subtitle-model'] : null);
      expect(fetch.mock.calls).toEqual(
        accepted
          ? [
              [
                `${baseUrl}/models`,
                expect.objectContaining({
                  method: 'GET',
                  headers: { Authorization: 'Bearer private-test-key' },
                }),
              ],
            ]
          : [],
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

  it.each([
    {
      name: 'translate',
      send: (text: string) => translate(config(), text),
      reply: '  保留字幕中的变量。  ',
      result: '保留字幕中的变量。',
      instructions: /^You are a professional native Simplified Chinese translator\./,
      titled: false,
    },
    {
      name: 'translateCaptionBatch',
      send: (text: string) => translateCaptionBatch(config(), [text]),
      reply: '[[p0]]\n保留字幕中的变量。',
      result: ['保留字幕中的变量。'],
      instructions:
        /^You are a professional native Simplified Chinese translator\.[\s\S]*Video title/,
      titled: true,
    },
  ])(
    '$name sends one chat completion with the translation instructions and literal content',
    async ({ send, reply, result, instructions, titled }) => {
      const fetch = vi
        .fn()
        .mockResolvedValue(Response.json({ choices: [{ message: { content: reply } }] }));
      vi.stubGlobal('fetch', fetch);
      const text = 'Keep {{target_language}} and $& literal.\nSecond "quoted" line.';
      await expect(send(text)).resolves.toEqual(result);
      expect(fetch).toHaveBeenCalledTimes(1);
      const [url, init] = fetch.mock.calls[0];
      expect(url).toBe('https://provider.example/api/v1/chat/completions');
      expect(init.method).toBe('POST');
      expect(init.redirect).toBe('error');
      expect(init.credentials).toBe('omit');
      const body = JSON.parse(init.body);
      expect(body.model).toBe('subtitle-model');
      expect(body.messages[0]).toEqual({
        role: 'system',
        content: expect.stringMatching(instructions),
      });
      expect(body.messages[0].content.includes('titled')).toBe(titled);
      expect(body.messages[1]).toEqual({
        role: 'user',
        content: expect.stringMatching(/^Translate to Simplified Chinese:\n\n/),
      });
      expect(body.messages[1].content).toContain(text);
      expect(body).not.toHaveProperty('prompt');
      expect(body).not.toHaveProperty('response_format');
      expect(body.stream).toBe(false);
      expect(body.max_tokens).toBe(65536);
      expect(body).not.toHaveProperty('reasoning_effort');
      expect(body.temperature).toBe(0);
      expect(body.thinking).toEqual({ type: 'disabled' });
    },
  );

  it('refuses a batch larger than the caption limit before contacting the provider', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(
      translateCaptionBatch(
        config(),
        Array.from({ length: 9 }, (_, index) => `${index}`),
      ),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([400, 401, 422, 429, 500])(
    'reports HTTP %s without retrying either translation request',
    async (status) => {
      const fetch = vi.fn().mockImplementation(async () => new Response('', { status }));
      vi.stubGlobal('fetch', fetch);
      const failure = { failure: { kind: 'http', status } };
      await expect(translate(config(), 'Hello')).rejects.toMatchObject(failure);
      expect(fetch).toHaveBeenCalledTimes(1);
      await expect(translateCaptionBatch(config(), ['Hello'])).rejects.toMatchObject(failure);
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
    const next = translate(config(), 'Next');
    await vi.advanceTimersByTimeAsync(providerSendWindowMs);
    await expect(next).resolves.toBe('第二句');
    expect(values[TOKEN_USAGE_KEY]).toEqual({ input: 1831, output: 266, cache: 906 });
  });

  it('asks for plain HTTP host access only on this computer', () => {
    expect(
      manifest.optional_host_permissions.filter((origin) => origin.startsWith('http:')),
    ).toEqual(localHttpProviders.map((baseUrl) => `http://${new URL(baseUrl).hostname}/*`));
  });
});

describe('saved configuration contract', () => {
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
      apiFormat: 'completions',
    });
    expect(settings).not.toHaveProperty('prompt');
    expect(settings).not.toHaveProperty('apiFormat');
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
    [{ sourceLanguage: 'ja', targetLanguage: 'ko' }, 'ko'],
    [{ sourceLanguage: 'ja', targetLanguage: 'fr' }, 'zh-CN'],
    [{ sourceLanguage: 'zh-CN', targetLanguage: 'ja' }, 'ja'],
    [{ sourceLanguage: 'fr', targetLanguage: 'en' }, 'en'],
    [{ sourceLanguage: 'zh-TW', targetLanguage: 'zh-TW' }, 'zh-TW'],
  ])('migrates saved languages to a translation-only preference: %o', (saved, target) => {
    const settings = normalizeSettings({ ...config(), ...saved });
    expect(settings.targetLanguage).toBe(target);
    expect(settings).not.toHaveProperty('sourceLanguage');
  });
});

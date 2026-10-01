import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchModels, translate, translateBatch } from '../src/shared/api';
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  publicSettings,
  validateSettings,
  type Settings,
} from '../src/shared/settings';

vi.mock('../src/shared/rate-limiter', () => ({
  RateLimiter: class {
    acquire() {
      return Promise.resolve();
    }
  },
}));

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
    'translates with the %s protocol using the built-in English translator prompt and literal content',
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
      const text = 'Keep {{target_language}} and $& literal.';
      await expect(translate({ ...config(), apiFormat }, text)).resolves.toBe('保留字幕中的变量。');
      const [url, init] = fetch.mock.calls[0];
      expect(url).toBe(
        `https://provider.example/api/v1/${apiFormat === 'chat' ? 'chat/completions' : 'completions'}`,
      );
      const body = JSON.parse(init.body);
      expect(body.model).toBe('subtitle-model');
      const instructions: string =
        apiFormat === 'chat' ? body.messages[0].content : body.prompt.split('\n\nInput:\n')[0];
      expect(instructions).toMatch(
        /^You are a professional translator, fluent in both English and Simplified Chinese\./,
      );
      expect(instructions).toContain('Output only the translation');
      expect(instructions).not.toMatch(/subtitle|film|movie/i);
      expect(instructions).toMatch(/^[\x20-\x7E\n]+$/);
      if (apiFormat === 'chat') {
        expect(body.messages[0].role).toBe('system');
        expect(body.messages[1]).toEqual({ role: 'user', content: text });
      } else expect(body.prompt).toBe(`${instructions}\n\nInput:\n${text}\n\nOutput:`);
      expect(body.stream).toBe(false);
      expect(body.reasoning_effort).toBe(apiFormat === 'chat' ? 'low' : undefined);
      expect(init.redirect).toBe('error');
      expect(init.credentials).toBe('omit');
    },
  );

  it.each(['chat', 'completions'] as const)(
    'translates up to five cues in one %s request and returns translations in cue order',
    async (apiFormat) => {
      const content = '```json\n{"translations":[" 第一句 ","第二句","第三句"]}\n```';
      const fetch = vi.fn().mockResolvedValue(
        Response.json({
          choices: [apiFormat === 'chat' ? { message: { content } } : { text: content }],
        }),
      );
      vi.stubGlobal('fetch', fetch);
      const texts = ['One.', 'Two "quoted"\nlines.', 'Three.'];
      await expect(translateBatch({ ...config(), apiFormat }, texts)).resolves.toEqual([
        '第一句',
        '第二句',
        '第三句',
      ]);
      expect(fetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(fetch.mock.calls[0][1].body);
      const instructions: string =
        apiFormat === 'chat' ? body.messages[0].content : body.prompt.split('\n\nInput:\n')[0];
      expect(instructions).toMatch(/^You are a professional translator/);
      expect(instructions).toContain('exactly 3 strings');
      expect(apiFormat === 'chat' ? body.messages[1].content : body.prompt).toContain(
        JSON.stringify(texts),
      );
    },
  );

  it.each([
    ['plain text', '第一句\n第二句'],
    ['too few translations', '{"translations":["第一句"]}'],
    ['an empty translation', '{"translations":["第一句","  "]}'],
    ['the wrong shape', '{"segments":["第一句","第二句"]}'],
  ])('reports an unusable batch reply with %s', async (_, content) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content } }] })),
    );
    await expect(translateBatch(config(), ['One.', 'Two.'])).resolves.toBeNull();
  });

  it('refuses batches larger than five cues before contacting the provider', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(translateBatch(config(), ['1', '2', '3', '4', '5', '6'])).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('retries without reasoning_effort when a model rejects it and remembers that model', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          { error: { message: "Unsupported value: 'reasoning_effort' does not support 'low'" } },
          { status: 400 },
        ),
      )
      .mockImplementation(async () =>
        Response.json({ choices: [{ message: { content: '你好' } }] }),
      );
    vi.stubGlobal('fetch', fetch);
    const settings = { ...config(), model: 'non-reasoning-model' };
    await expect(translate(settings, 'Hello')).resolves.toBe('你好');
    await expect(translate(settings, 'Hi')).resolves.toBe('你好');
    await expect(translate({ ...settings, model: 'reasoning-model' }, 'Hey')).resolves.toBe('你好');
    expect(
      fetch.mock.calls.map((call) => [
        JSON.parse(call[1].body).model,
        JSON.parse(call[1].body).reasoning_effort,
      ]),
    ).toEqual([
      ['non-reasoning-model', 'low'],
      ['non-reasoning-model', undefined],
      ['non-reasoning-model', undefined],
      ['reasoning-model', 'low'],
    ]);
  });

  it.each([401, 429, 500])(
    'does not resend without reasoning_effort after HTTP %s',
    async (status) => {
      const fetch = vi.fn(async () => new Response('', { status }));
      vi.stubGlobal('fetch', fetch);
      await expect(translate({ ...config(), model: `model-${status}` }, 'Hello')).rejects.toThrow();
      expect(fetch).toHaveBeenCalledTimes(1);
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
  it('allows partial setup, but requires different languages', () => {
    expect(() => validateSettings(structuredClone(DEFAULT_SETTINGS))).not.toThrow();
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
      prompt: 'A custom prompt saved by an earlier version',
    });
    expect(settings).not.toHaveProperty('prompt');
    expect(settings.original).toEqual({ color: '#FFFFFF', size: 48 });
    expect(settings.translation).toEqual({ color: '#ffe3a3', size: 12 });
    expect(settings.backgroundOpacity).toBe(90);
    expect(settings.enabled).toBe(true);
    expect(settings.sourceLanguage).toBe('en');
    const exposed = publicSettings(settings);
    expect(exposed.configured).toBe(true);
    for (const secret of ['apiKey', 'baseUrl', 'model', 'apiFormat'])
      expect(exposed).not.toHaveProperty(secret);
    expect(JSON.stringify(exposed)).not.toContain('private-test-key');
  });
});

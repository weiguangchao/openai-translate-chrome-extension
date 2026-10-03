import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchModels, translate, translateBatch } from '../src/shared/api';
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
      expect(instructions).toMatch(/^Translate the given English into Simplified Chinese\./);
      expect(instructions).toContain('Output only the translation');
      expect(instructions).not.toMatch(/subtitle|film|movie/i);
      expect(instructions).toMatch(/^[\x20-\x7E\n]+$/);
      expect(body.messages[0].role).toBe('system');
      expect(body.messages[1]).toEqual({ role: 'user', content: text });
      expect(body).not.toHaveProperty('prompt');
      expect(body.stream).toBe(false);
      expect(body.max_tokens).toBe(1024);
      expect(body.reasoning_effort).toBe('low');
      expect(init.redirect).toBe('error');
      expect(init.credentials).toBe('omit');
    },
  );

  it.each([undefined, 'chat', 'completions'])(
    'translates batches through chat completions with saved apiFormat=%s and preserves cue order',
    async (apiFormat) => {
      const content = '```json\n{"translations":[" 第一句 ","第二句","第三句"]}\n```';
      const fetch = vi.fn().mockResolvedValue(
        Response.json({
          choices: [{ message: { content } }],
        }),
      );
      vi.stubGlobal('fetch', fetch);
      const texts = ['One.', 'Two "quoted"\nlines.', 'Three.'];
      await expect(
        translateBatch(normalizeSettings({ ...config(), apiFormat }), texts),
      ).resolves.toEqual(['第一句', '第二句', '第三句']);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[0][0]).toBe('https://provider.example/api/v1/chat/completions');
      const body = JSON.parse(fetch.mock.calls[0][1].body);
      const instructions: string = body.messages[0].content;
      expect(instructions).toMatch(/^Translate the given English into Simplified Chinese\./);
      expect(instructions).toContain('exactly 3 strings');
      expect(body.messages[1].content).toBe(JSON.stringify(texts));
      expect(body).not.toHaveProperty('prompt');
      expect(body.stream).toBe(true);
      expect(body.max_tokens).toBe(Math.min(16384, Math.max(2048, texts.join('').length * 4)));
      expect(body.reasoning_effort).toBe('low');
    },
  );

  it.each([
    ['plain text', '第一句\n第二句'],
    ['too few translations', '{"translations":["第一句"]}'],
    ['an empty translation', '{"translations":["第一句","  "]}'],
    ['the wrong shape', '{"segments":["第一句","第二句"]}'],
  ])('reports an unusable batch reply with %s', async (_, content) => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content } }] }));
    vi.stubGlobal('fetch', fetch);
    await expect(translateBatch(config(), ['One.', 'Two.'])).resolves.toBeNull();
    expect(JSON.parse(fetch.mock.calls[0][1].body).max_tokens).toBe(2048);
  });

  it('refuses batches larger than ten cues before contacting the provider', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(
      translateBatch(
        config(),
        Array.from({ length: 11 }, (_, index) => `${index}`),
      ),
    ).rejects.toThrow();
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
      fetch.mock.calls.map((call) => {
        const body = JSON.parse(call[1].body);
        return [body.model, body.reasoning_effort, body.max_tokens, body.stream];
      }),
    ).toEqual([
      ['non-reasoning-model', 'low', 1024, false],
      ['non-reasoning-model', undefined, 1024, false],
      ['non-reasoning-model', undefined, 1024, false],
      ['reasoning-model', 'low', 1024, false],
    ]);
  });

  it.each([401, 429, 500])(
    'does not resend without reasoning_effort after HTTP %s',
    async (status) => {
      const fetch = vi.fn().mockImplementation(async () => new Response('', { status }));
      vi.stubGlobal('fetch', fetch);
      await expect(translate({ ...config(), model: `model-${status}` }, 'Hello')).rejects.toThrow();
      expect(fetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(fetch.mock.calls[0][1].body as string);
      expect(body.max_tokens).toBe(1024);
      expect(body.stream).toBe(false);
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

function sseControl() {
  let control!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      control = controller;
    },
  });
  return {
    response: new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }),
    push(chunk: string) {
      control.enqueue(new TextEncoder().encode(chunk));
    },
    close() {
      control.close();
    },
  };
}
function chatEvent(content: string, reasoning?: string): string {
  const delta = reasoning
    ? { reasoning_content: reasoning, ...(content ? { content } : {}) }
    : { content };
  return `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`;
}
const pause = () => new Promise((resolve) => setTimeout(resolve, 30));

describe('streaming batch replies', () => {
  it('submits each translation when its string closes, including a chunk cut through the string', async () => {
    const gate = sseControl();
    const fetch = vi.fn().mockImplementation(async () => gate.response);
    vi.stubGlobal('fetch', fetch);
    const seen: [number, string][] = [];
    let open = true;
    const model = '```json\n{"translations":["第一句","他说\\"你好\\"\\n中\\/\\u6587"]}\n```';
    const cut = model.indexOf('第一句') + 2;
    const pending = translateBatch(
      { ...config(), model: 'sse-batch' },
      ['One.', 'Two.'],
      undefined,
      (index, translation) => {
        expect(open).toBe(true);
        seen.push([index, translation]);
      },
    );
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    gate.push(chatEvent(model.slice(0, cut)));
    await pause();
    expect(seen).toEqual([]);
    gate.push(chatEvent('', '思考过程，不是译文'));
    await pause();
    expect(seen).toEqual([]);
    gate.push(chatEvent(model.slice(cut)));
    await vi.waitFor(() =>
      expect(seen).toEqual([
        [0, '第一句'],
        [1, '他说"你好"\n中/文'],
      ]),
    );
    open = false;
    gate.push('data: [DONE]\n\n');
    gate.close();
    await expect(pending).resolves.toEqual(['第一句', '他说"你好"\n中/文']);
    expect(fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.stream).toBe(true);
    expect(body.max_tokens).toBeGreaterThan(0);
    expect(body.reasoning_effort).toBe('low');
  });

  it('reads a chat stream when upgrading a legacy completions setting', async () => {
    const gate = sseControl();
    const fetch = vi.fn().mockImplementation(async () => gate.response);
    vi.stubGlobal('fetch', fetch);
    const seen: string[] = [];
    const pending = translateBatch(
      normalizeSettings({ ...config(), apiFormat: 'completions', model: 'legacy-sse' }),
      ['One.', 'Two.'],
      undefined,
      (index, translation) => seen.splice(index, 1, translation),
    );
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    gate.push(chatEvent('{"translations":["甲'));
    await pause();
    expect(seen).toEqual([]);
    gate.push(chatEvent('","乙"]}'));
    await vi.waitFor(() => expect(seen).toEqual(['甲', '乙']));
    gate.close();
    await expect(pending).resolves.toEqual(['甲', '乙']);
    expect(fetch.mock.calls[0][0]).toBe('https://provider.example/api/v1/chat/completions');
    expect(JSON.parse(fetch.mock.calls[0][1].body).stream).toBe(true);
  });

  it('keeps qualified strings from a non-stream JSON body when a later string is empty', async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        choices: [{ message: { content: '{"translations":["第一句","  "]}' } }],
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const seen: [number, string][] = [];
    await expect(
      translateBatch(
        { ...config(), model: 'partial-json' },
        ['One.', 'Two.'],
        undefined,
        (index, translation) => seen.push([index, translation]),
      ),
    ).resolves.toBeNull();
    expect(seen).toEqual([[0, '第一句']]);
    expect(JSON.parse(fetch.mock.calls[0][1].body).stream).toBe(true);
  });

  it('does not submit anything when the whole JSON body cannot be parsed', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ choices: [{ message: { content: '第一句\n第二句' } }] }),
        ),
    );
    const seen: number[] = [];
    await expect(
      translateBatch({ ...config(), model: 'unparsed-batch' }, ['One.', 'Two.'], undefined, () =>
        seen.push(1),
      ),
    ).resolves.toBeNull();
    expect(seen).toEqual([]);
  });

  it('drops stream after a 400 and keeps max_tokens and reasoning_effort on the retry', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 400 }))
      .mockImplementation(async () =>
        Response.json({ choices: [{ message: { content: '{"translations":["甲","乙"]}' } }] }),
      );
    vi.stubGlobal('fetch', fetch);
    const settings = { ...config(), model: 'no-stream-model' };
    await expect(translateBatch(settings, ['A', 'B'])).resolves.toEqual(['甲', '乙']);
    await expect(translateBatch(settings, ['C', 'D'])).resolves.toEqual(['甲', '乙']);
    const bodies = fetch.mock.calls.map((call) => JSON.parse(call[1].body));
    expect(bodies.map((body) => body.stream)).toEqual([true, false, false]);
    expect(bodies[1]).toMatchObject({ reasoning_effort: 'low' });
    expect(bodies[1].max_tokens).toBeGreaterThan(0);
    expect(bodies[2].max_tokens).toBe(bodies[1].max_tokens);
    expect(bodies[2].reasoning_effort).toBe('low');
  });

  it('does not remember a stream rejection when removing reasoning_effort is what succeeds', async () => {
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as {
        stream?: boolean;
        reasoning_effort?: string;
      };
      if (body.stream === true || body.reasoning_effort) return new Response('', { status: 400 });
      return Response.json({ choices: [{ message: { content: '{"translations":["甲","乙"]}' } }] });
    });
    vi.stubGlobal('fetch', fetch);
    const settings = { ...config(), model: 'reasoning-not-stream' };
    await expect(translateBatch(settings, ['A', 'B'])).resolves.toEqual(['甲', '乙']);
    const first = fetch.mock.calls.map((call) => JSON.parse(call[1].body as string).stream);
    expect(first).toEqual([true, false, false]);
    await expect(translateBatch(settings, ['C', 'D'])).resolves.toEqual(['甲', '乙']);
    expect(JSON.parse(fetch.mock.calls[3][1].body as string).stream).toBe(true);
    expect(JSON.parse(fetch.mock.calls[3][1].body as string).reasoning_effort).toBeUndefined();
  });

  it('remembers a chat max_tokens rejection only after the bare request succeeds', async () => {
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as {
        reasoning_effort?: string;
        max_tokens?: number;
      };
      if (body.reasoning_effort || body.max_tokens) return new Response('', { status: 422 });
      return Response.json({ choices: [{ message: { content: '你好' } }] });
    });
    vi.stubGlobal('fetch', fetch);
    const settings = { ...config(), model: 'no-max-tokens' };
    await expect(translate(settings, 'Hello')).resolves.toBe('你好');
    expect(
      fetch.mock.calls.map((call) => {
        const body = JSON.parse(call[1].body as string);
        return [body.reasoning_effort, body.max_tokens];
      }),
    ).toEqual([
      ['low', 1024],
      [undefined, 1024],
      [undefined, undefined],
    ]);
    await expect(translate(settings, 'Hi')).resolves.toBe('你好');
    const again = fetch.mock.calls.slice(3).map((call) => JSON.parse(call[1].body as string));
    expect(again.map((body) => [body.reasoning_effort, body.max_tokens])).toEqual([
      ['low', undefined],
      [undefined, undefined],
    ]);
    await expect(translate(settings, 'Hey')).resolves.toBe('你好');
    expect(fetch).toHaveBeenCalledTimes(6);
    expect(JSON.parse(fetch.mock.calls[5][1].body as string).max_tokens).toBeUndefined();
    expect(JSON.parse(fetch.mock.calls[5][1].body as string).reasoning_effort).toBeUndefined();
  });

  it('does not remember a max_tokens rejection when the bare request also fails', async () => {
    const fetch = vi.fn().mockImplementation(async () => new Response('', { status: 422 }));
    vi.stubGlobal('fetch', fetch);
    const settings = { ...config(), model: 'reject-chat-options' };
    await expect(translate(settings, 'Hello')).rejects.toThrow('HTTP 422');
    expect(fetch).toHaveBeenCalledTimes(3);
    await expect(translate(settings, 'Hello')).rejects.toThrow('HTTP 422');
    expect(fetch).toHaveBeenCalledTimes(6);
    expect(JSON.parse(fetch.mock.calls[3][1].body).max_tokens).toBe(1024);
  });

  it('keeps every batch retry on chat completions for a legacy completions setting', async () => {
    const fetch = vi.fn().mockImplementation(async () => new Response('', { status: 400 }));
    vi.stubGlobal('fetch', fetch);
    await expect(
      translateBatch(
        normalizeSettings({ ...config(), apiFormat: 'completions', model: 'legacy-400' }),
        ['A', 'B'],
      ),
    ).rejects.toThrow('HTTP 400');
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(fetch.mock.calls.map((call) => call[0])).toEqual(
      Array(4).fill('https://provider.example/api/v1/chat/completions'),
    );
    const bodies = fetch.mock.calls.map((call) => JSON.parse(call[1].body));
    expect(bodies.map((body) => body.stream)).toEqual([true, false, false, false]);
    expect(bodies.map((body) => body.reasoning_effort)).toEqual([
      'low',
      'low',
      undefined,
      undefined,
    ]);
    expect(bodies.map((body) => body.max_tokens)).toEqual([2048, 2048, 2048, undefined]);
    expect(bodies.every((body) => Array.isArray(body.messages) && !('prompt' in body))).toBe(true);
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

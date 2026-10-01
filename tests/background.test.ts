import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, STORAGE_KEY } from '../src/shared/settings';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it('keeps credentials in the background and rejects content-script requests to use draft API settings', async () => {
  type Reply = { ok: boolean; data?: unknown; error?: string };
  let listener!: (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    reply: (value: Reply) => void,
  ) => boolean | undefined;
  const fetch = vi
    .fn()
    .mockResolvedValue(Response.json({ choices: [{ message: { content: '你好' } }] }));
  vi.stubGlobal('fetch', fetch);
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'extension-id',
      getURL: (path: string) => `chrome-extension://extension-id/${path}`,
      onMessage: {
        addListener: (callback: typeof listener) => {
          listener = callback;
        },
      },
    },
    storage: {
      local: {
        setAccessLevel: vi.fn().mockResolvedValue(undefined),
        get: vi.fn().mockResolvedValue({
          [STORAGE_KEY]: {
            ...structuredClone(DEFAULT_SETTINGS),
            apiKey: 'trusted-secret',
            model: 'saved-model',
          },
        }),
      },
      onChanged: { addListener: vi.fn() },
    },
  });
  await import('../src/extension/background');
  const sender = {
    id: 'extension-id',
    url: 'https://www.youtube.com/watch?v=example',
    frameId: 0,
    tab: { id: 1 },
  } as chrome.runtime.MessageSender;
  const send = (message: unknown) =>
    new Promise<Reply>((resolve) => listener(message, sender, resolve));
  const publicReply = await send({ type: 'settings' });
  expect(publicReply.ok).toBe(true);
  expect(publicReply.data).not.toHaveProperty('apiKey');
  expect(JSON.stringify(publicReply)).not.toContain('trusted-secret');
  const forbidden = await send({
    type: 'models',
    settings: { apiKey: 'page-key', baseUrl: 'https://untrusted.example' },
  });
  expect(forbidden.ok).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
  await expect(
    send({
      type: 'translate',
      text: 'Hello',
      settings: { apiKey: 'page-key', baseUrl: 'https://untrusted.example' },
    }),
  ).resolves.toEqual({ ok: true, data: '你好' });
  expect(fetch.mock.calls[0][0]).toBe('https://api.openai.com/v1/chat/completions');
  expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer trusted-secret');
});

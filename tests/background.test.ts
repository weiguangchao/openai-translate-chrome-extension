import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, STORAGE_KEY } from '../src/shared/settings';
import { providerReply, requestedTexts } from './fixtures/provider';
import { longCaption, longResult, structuredReply } from './fixtures/long-caption';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

type Reply = { ok: boolean; data?: unknown; error?: string };

it('answers cache-only lookups without starting model work and reuses background translations', async () => {
  const fetch = vi.fn().mockResolvedValue(providerReply(['Hello'], () => '你好'));
  vi.stubGlobal('fetch', fetch);
  const send = await loadBackground({ ...DEFAULT_SETTINGS, apiKey: 'key', model: 'model' });
  await expect(send({ type: 'translate', text: 'Hello', cacheOnly: true })).resolves.toEqual({
    ok: true,
    data: null,
  });
  expect(fetch).not.toHaveBeenCalled();
  await expect(send({ type: 'translate', text: 'Hello' })).resolves.toEqual({
    ok: true,
    data: '你好',
  });
  await expect(send({ type: 'translate', text: 'Hello', cacheOnly: true })).resolves.toEqual({
    ok: true,
    data: '你好',
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});

async function loadBackground(saved: object) {
  let listener!: (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    reply: (value: Reply) => void,
  ) => boolean | undefined;
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
        get: vi.fn().mockResolvedValue({ [STORAGE_KEY]: saved }),
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
  return (message: unknown) => new Promise<Reply>((resolve) => listener(message, sender, resolve));
}

it('keeps credentials in the background and rejects content-script requests to use draft API settings', async () => {
  const fetch = vi.fn().mockResolvedValue(providerReply(['Hello'], () => '你好'));
  vi.stubGlobal('fetch', fetch);
  const send = await loadBackground({
    ...structuredClone(DEFAULT_SETTINGS),
    apiKey: 'trusted-secret',
    model: 'saved-model',
  });
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

it('answers a prefetch with translations in the order asked, settling cues a later window drops', async () => {
  const pending: { texts: string[]; resolve: (value: Response) => void }[] = [];
  const fetch = vi.fn(
    (_url: string, init: RequestInit) =>
      new Promise<Response>((resolve) => pending.push({ texts: requestedTexts(init), resolve })),
  );
  vi.stubGlobal('fetch', fetch);
  const send = await loadBackground({
    ...structuredClone(DEFAULT_SETTINGS),
    apiKey: 'key',
    model: 'model',
  });
  const opening = send({ type: 'prefetch', texts: ['A', 'B', 'A'] });
  await vi.waitFor(() => expect(pending).toHaveLength(1));
  const sliding = send({ type: 'prefetch', texts: ['B', 'C'] });
  await vi.waitFor(() => expect(pending).toHaveLength(2));
  for (const request of pending)
    request.resolve(providerReply(request.texts, (text) => `${text} 译文`));
  await expect(opening).resolves.toEqual({ ok: true, data: [null, 'B 译文', null] });
  await expect(sliding).resolves.toEqual({ ok: true, data: ['B 译文', 'C 译文'] });
  await expect(send({ type: 'prefetch', texts: ['A', 'C'] })).resolves.toEqual({
    ok: true,
    data: ['A 译文', 'C 译文'],
  });
  await expect(send({ type: 'prefetch-pause' })).resolves.toEqual({ ok: true });
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('batches a prefetch by the segment of each caption and rejects malformed segment numbers', async () => {
  const pending: string[][] = [];
  const fetch = vi.fn((_url: string, init: RequestInit) => {
    pending.push(requestedTexts(init));
    return new Promise<Response>(() => {});
  });
  vi.stubGlobal('fetch', fetch);
  const send = await loadBackground({
    ...structuredClone(DEFAULT_SETTINGS),
    apiKey: 'key',
    model: 'model',
  });
  for (const segments of [[0], [0, -1], [0, 1.5], 'segments'])
    await expect(send({ type: 'prefetch', texts: ['A', 'B'], segments })).resolves.toEqual({
      ok: false,
      error: '预加载字幕内容无效。',
    });
  expect(fetch).not.toHaveBeenCalled();
  void send({ type: 'prefetch', texts: ['A', 'B', 'A', 'C'], segments: [0, 0, 0, 1] });
  await vi.waitFor(() => expect(pending).toEqual([['A', 'B'], ['C']]));
});

it('validates split flags and keeps split and unsplit duplicates separate across messages', async () => {
  const fetch = vi
    .fn()
    .mockImplementation(async () =>
      structuredReply([{ id: 0, parts: [{ translation: '完整译文' }] }, longResult(1)]),
    );
  vi.stubGlobal('fetch', fetch);
  const send = await loadBackground({ ...DEFAULT_SETTINGS, apiKey: 'key', model: 'model' });
  for (const needsSplit of [true, [true], [true, 1]])
    await expect(
      send({ type: 'prefetch', texts: [longCaption, longCaption], needsSplit }),
    ).resolves.toMatchObject({ ok: false });
  await expect(
    send({ type: 'translate', text: longCaption, needsSplit: [] }),
  ).resolves.toMatchObject({ ok: false });
  expect(fetch).not.toHaveBeenCalled();
  const reply = await send({
    type: 'prefetch',
    texts: [longCaption, longCaption, longCaption],
    needsSplit: [false, true, true],
  });
  expect(reply.ok).toBe(true);
  const data = reply.data as unknown[];
  expect(data[0]).toBe('完整译文');
  expect(data[1]).toEqual(data[2]);
  expect(data[1]).toMatchObject({ parts: expect.any(Array) });
  await expect(
    send({ type: 'translate', text: longCaption, needsSplit: true, cacheOnly: true }),
  ).resolves.toEqual({ ok: true, data: data[1] });
  expect(fetch).toHaveBeenCalledTimes(1);
});

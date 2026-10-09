import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, STORAGE_KEY } from '../src/shared/settings';
import { packedCues, providerReply, requestedTexts } from './fixtures/provider';
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

async function loadBackground(saved: object, session = new Map<string, unknown>()) {
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
    tabs: {
      query: vi.fn().mockResolvedValue([{ id: 1 }]),
      sendMessage: vi.fn().mockResolvedValue(undefined),
    },
    storage: {
      local: {
        setAccessLevel: vi.fn().mockResolvedValue(undefined),
        get: vi.fn().mockResolvedValue({ [STORAGE_KEY]: saved }),
      },
      session: {
        get: vi.fn(async () => Object.fromEntries(session)),
        set: vi.fn(async (items: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(items)) session.set(key, value);
        }),
        remove: vi.fn(async (keys: string[]) => {
          for (const key of keys) session.delete(key);
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
  return (message: unknown, override: Partial<chrome.runtime.MessageSender> = {}) =>
    new Promise<Reply>((resolve) => listener(message, { ...sender, ...override }, resolve));
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
  const opening = send({
    type: 'prefetch',
    time: 0,
    rate: 1,
    cues: [
      ...packedCues([{ text: 'A' }, { text: 'B' }]),
      { text: 'A', start: 6, end: 6.5, needsSplit: false },
    ],
  });
  await vi.waitFor(() => expect(pending).toHaveLength(1));
  const sliding = send({
    type: 'prefetch',
    time: 0,
    rate: 1,
    cues: packedCues([{ text: 'B' }, { text: 'C' }]),
  });
  await vi.waitFor(() => expect(pending).toHaveLength(2));
  for (const request of pending)
    request.resolve(providerReply(request.texts, (text) => `${text} 译文`));
  await expect(opening).resolves.toEqual({ ok: true, data: [null, 'B 译文', null] });
  await expect(sliding).resolves.toEqual({ ok: true, data: ['B 译文', 'C 译文'] });
  await expect(
    send({
      type: 'prefetch',
      time: 0,
      rate: 1,
      cues: packedCues([{ text: 'A' }, { text: 'C' }]),
    }),
  ).resolves.toEqual({
    ok: true,
    data: ['A 译文', 'C 译文'],
  });
  await expect(send({ type: 'prefetch-pause' })).resolves.toEqual({ ok: true });
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('starts a new page in the same tab without the pause the previous page left', async () => {
  const fetch = vi.fn(async (_url: string, init: RequestInit) =>
    providerReply(requestedTexts(init), (text) => `${text} 译文`),
  );
  vi.stubGlobal('fetch', fetch);
  const send = await loadBackground({
    ...structuredClone(DEFAULT_SETTINGS),
    apiKey: 'key',
    model: 'model',
  });
  const first = { documentId: 'first-page' };
  await send(
    { type: 'prefetch', time: 0, rate: 1, cues: packedCues([{ text: 'Old.' }], 2) },
    first,
  );
  await expect(send({ type: 'prefetch-pause' }, first)).resolves.toEqual({ ok: true });
  const next = send(
    { type: 'prefetch', time: 0, rate: 1, cues: packedCues([{ text: 'New.' }], 2) },
    { url: 'https://www.youtube.com/watch?v=next', documentId: 'next-page' },
  );
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  await expect(next).resolves.toEqual({ ok: true, data: ['New. 译文'] });
});

it('packs a prefetch by its time span and rejects a snapshot without usable times', async () => {
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
  for (const cues of [
    [{ text: 'A', needsSplit: false }],
    [{ text: 'A', start: -1, end: 1, needsSplit: false }],
    [{ text: 'A', start: 2, end: 2, needsSplit: false }],
    [{ text: 'A', start: 0, end: 1, needsSplit: 'yes' }],
  ])
    await expect(send({ type: 'prefetch', time: 0, rate: 1, cues })).resolves.toEqual({
      ok: false,
      error: '预加载字幕内容无效。',
    });
  await expect(
    send({ type: 'prefetch', time: 0, rate: 0, cues: packedCues([{ text: 'A' }]) }),
  ).resolves.toEqual({
    ok: false,
    error: '预加载字幕内容无效。',
  });
  expect(fetch).not.toHaveBeenCalled();
  void send({
    type: 'prefetch',
    time: 0,
    rate: 1,
    cues: [
      ...packedCues([{ text: 'A' }, { text: 'B' }]),
      { text: 'A', start: 6, end: 6.5, needsSplit: false },
      { text: 'C', start: 80, end: 81, needsSplit: false },
    ],
  });
  await vi.waitFor(() => expect(pending).toEqual([['A', 'B']]));
});

it('validates split flags and keeps split and unsplit duplicates separate across messages', async () => {
  const fetch = vi
    .fn()
    .mockImplementation(async () =>
      structuredReply([{ id: 0, parts: [{ translation: '完整译文' }] }, longResult(1)]),
    );
  vi.stubGlobal('fetch', fetch);
  const send = await loadBackground({ ...DEFAULT_SETTINGS, apiKey: 'key', model: 'model' });
  for (const needsSplit of [undefined, [true], 1])
    await expect(
      send({
        type: 'prefetch',
        time: 0,
        rate: 1,
        cues: [{ text: longCaption, start: 0, end: 1, needsSplit }],
      }),
    ).resolves.toMatchObject({ ok: false });
  await expect(
    send({ type: 'translate', text: longCaption, needsSplit: [] }),
  ).resolves.toMatchObject({ ok: false });
  expect(fetch).not.toHaveBeenCalled();
  const reply = await send({
    type: 'prefetch',
    time: 0,
    rate: 1,
    cues: packedCues([
      { text: longCaption, needsSplit: false },
      { text: longCaption, needsSplit: true },
      { text: longCaption, needsSplit: true },
    ]),
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

it.each([
  { name: 'font size', patch: { original: { color: '#FFFFFF', size: 36 } }, abort: false },
  { name: 'text color', patch: { translation: { color: '#000000', size: 20 } }, abort: false },
  { name: 'background', patch: { backgroundOpacity: 70 }, abort: false },
  { name: 'gap', patch: { subtitleGap: 16 }, abort: false },
  { name: 'target language', patch: { targetLanguage: 'ja' }, abort: true },
  { name: 'source language', patch: { sourceLanguage: 'es' }, abort: true },
  { name: 'model', patch: { model: 'new-model' }, abort: true },
  { name: 'credentials', patch: { apiKey: 'new-secret' }, abort: true },
  { name: 'provider', patch: { baseUrl: 'https://other.example/v1' }, abort: true },
  { name: 'extension disabled', patch: { enabled: false }, abort: true },
  { name: 'active platform disabled', patch: { youtube: false }, abort: true },
  { name: 'other platform disabled', patch: { hbo: false }, abort: false },
])('updates $name with the correct in-flight lifetime', async ({ patch, abort }) => {
  let signal!: AbortSignal;
  let finish!: (response: Response) => void;
  const fetch = vi.fn((_url: string, init: RequestInit) => {
    signal = init.signal!;
    return new Promise<Response>((resolve) => {
      finish = resolve;
    });
  });
  vi.stubGlobal('fetch', fetch);
  const initial = { ...DEFAULT_SETTINGS, apiKey: 'old-secret', model: 'model' };
  const send = await loadBackground(initial);
  const pending = send({ type: 'translate', text: 'Original.' });
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  const changed = vi.mocked(chrome.storage.onChanged.addListener).mock.calls[0][0];
  changed({ [STORAGE_KEY]: { oldValue: initial, newValue: { ...initial, ...patch } } }, 'local');
  await vi.waitFor(() => expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(1));
  expect(signal.aborted).toBe(abort);
  finish(providerReply(['Original.'], () => '原来的译文'));
  if (abort) await expect(pending).resolves.toMatchObject({ ok: false });
  else {
    await expect(pending).resolves.toEqual({ ok: true, data: '原来的译文' });
    await expect(send({ type: 'translate', text: 'Original.', cacheOnly: true })).resolves.toEqual({
      ok: true,
      data: '原来的译文',
    });
  }
  expect(fetch).toHaveBeenCalledTimes(1);
  const update = JSON.stringify(vi.mocked(chrome.tabs.sendMessage).mock.calls);
  expect(update).not.toMatch(/old-secret|new-secret|other\.example|baseUrl|apiKey/);
});

it('retains shared work when only one consuming platform is disabled', async () => {
  let signal!: AbortSignal;
  let finish!: (response: Response) => void;
  const fetch = vi.fn((_url: string, init: RequestInit) => {
    signal = init.signal!;
    return new Promise<Response>((resolve) => {
      finish = resolve;
    });
  });
  vi.stubGlobal('fetch', fetch);
  const initial = { ...DEFAULT_SETTINGS, apiKey: 'key', model: 'model' };
  const send = await loadBackground(initial);
  const youtube = send({ type: 'translate', text: 'Shared.' });
  const hbo = send(
    { type: 'translate', text: 'Shared.' },
    { url: 'https://play.hbomax.com/video/watch/episode', tab: { id: 2 } as chrome.tabs.Tab },
  );
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  vi.mocked(chrome.storage.onChanged.addListener).mock.calls[0][0](
    { [STORAGE_KEY]: { newValue: { ...initial, youtube: false } } },
    'local',
  );
  await vi.waitFor(() => expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(1));
  expect(signal.aborted).toBe(false);
  finish(providerReply(['Shared.'], () => '共享译文'));
  await expect(hbo).resolves.toEqual({ ok: true, data: '共享译文' });
  await youtube;
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('sends only an opaque translation revision, retaining it for style changes', async () => {
  const initial = { ...DEFAULT_SETTINGS, apiKey: 'secret-key', model: 'private-model' };
  const send = await loadBackground(initial);
  const before = await send({ type: 'settings' });
  const changed = vi.mocked(chrome.storage.onChanged.addListener).mock.calls[0][0];
  changed({ [STORAGE_KEY]: { newValue: { ...initial, subtitleGap: 16 } } }, 'local');
  await vi.waitFor(() => expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(1));
  const style = await send({ type: 'settings' });
  expect(style.data).toMatchObject({
    translationRevision: (before.data as { translationRevision: string }).translationRevision,
  });
  changed({ [STORAGE_KEY]: { newValue: { ...initial, model: 'other-private-model' } } }, 'local');
  await vi.waitFor(() => expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(2));
  const provider = await send({ type: 'settings' });
  expect(provider.data).not.toMatchObject({
    translationRevision: (before.data as { translationRevision: string }).translationRevision,
  });
  expect(JSON.stringify(provider)).not.toMatch(/secret-key|private-model|api\.openai/);
});

it('prints a page trace event with its tab and only the known fields', async () => {
  const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
  const send = await loadBackground({ ...DEFAULT_SETTINGS, apiKey: 'trusted-secret', model: 'm' });
  const event = {
    type: 'trace',
    run: 'run-1',
    time: 12.5,
    paused: false,
    seeking: false,
    state: 'loading',
    cue: 4,
    start: 12,
    end: 15,
    segment: 0,
    text: 'Hello',
    apiKey: 'page-supplied',
  };
  await expect(send(event)).resolves.toEqual({ ok: true });
  await expect(send({ ...event, time: -1 })).resolves.toMatchObject({ ok: false });
  expect(debug.mock.calls).toEqual([
    [
      '[subline] {"e":"view","tab":"1:0","run":"run-1","t":12.5,"state":"loading","paused":false,"seeking":false,"cue":4,"start":12,"end":15,"seg":0,"text":"Hello"}',
    ],
  ]);
  debug.mockRestore();
});

it('keeps translations in session storage, without the API key, for a restarted worker', async () => {
  const fetch = vi.fn().mockResolvedValue(providerReply(['Hello'], () => '你好'));
  vi.stubGlobal('fetch', fetch);
  const session = new Map<string, unknown>();
  const saved = { ...DEFAULT_SETTINGS, apiKey: 'trusted-secret', model: 'model' };
  let send = await loadBackground(saved, session);
  await expect(send({ type: 'translate', text: 'Hello' })).resolves.toEqual({
    ok: true,
    data: '你好',
  });
  await vi.waitFor(() => expect([...session.values()]).toContain('你好'));
  expect(JSON.stringify([...session])).not.toContain('trusted-secret');

  vi.resetModules();
  send = await loadBackground(saved, session);
  await expect(send({ type: 'translate', text: 'Hello', cacheOnly: true })).resolves.toEqual({
    ok: true,
    data: '你好',
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});

import { sessionStorage } from './fixtures/extension-storage';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { providerReply } from './fixtures/provider';
import { DEFAULT_SETTINGS, type CaptionTranslationSettings } from '../src/shared/settings';
import { providerTimeoutMs } from '../src/shared/tuning';

let translateCaptionBatch: (typeof import('../src/shared/api'))['translateCaptionBatch'];
let translate: (typeof import('../src/shared/api'))['translate'];
let TranslationQueue: (typeof import('../src/extension/queue'))['TranslationQueue'];

beforeEach(async () => {
  vi.stubGlobal('chrome', { storage: { session: sessionStorage() } });
  vi.resetModules();
  ({ translate, translateCaptionBatch } = await import('../src/shared/api'));
  ({ TranslationQueue } = await import('../src/extension/queue'));
});

const settings: CaptionTranslationSettings = {
  ...DEFAULT_SETTINGS,
  captionLanguage: 'en',
  pageTitle: '',
};
const reply = (texts: string[], to = 'zh-Hans') =>
  new Response(JSON.stringify(texts.map((text) => ({ translations: [{ text, to }] }))), {
    headers: { 'Content-Type': 'text/plain' },
  });

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('translates eight captions in one unauthenticated POST and publishes in input order', async () => {
  const texts = ['One.', 'Two.', 'Three.', 'Four.', 'Five.', 'Six.', 'Seven.', '2026'];
  const translations = ['一。', '二。', '三。', '四。', '五。', '六。', '七。', '2026'];
  const fetch = vi.fn().mockResolvedValue(reply(translations));
  vi.stubGlobal('fetch', fetch);
  const published = vi.fn();
  await expect(
    translateCaptionBatch(
      { ...settings, apiKey: 'unused-secret', model: 'unused' },
      texts,
      undefined,
      published,
    ),
  ).resolves.toEqual(translations);
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, init] = fetch.mock.calls[0];
  expect(url).toBe(
    'https://edge.microsoft.com/translate/translatetext?from=en&to=zh-Hans&isEnterpriseClient=false',
  );
  expect(init).toMatchObject({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(texts),
    credentials: 'omit',
    redirect: 'error',
  });
  expect(JSON.stringify(init)).not.toContain('unused-secret');
  expect(published.mock.calls).toEqual(translations.map((text, index) => [index, text]));
});

it.each([
  ['en', 'en'],
  ['zh-CN', 'zh-Hans'],
  ['zh-TW', 'zh-Hant'],
  ['ja', 'ja'],
  ['ko', 'ko'],
] as const)('maps %s for both source and target language', async (language, code) => {
  const fetch = vi.fn().mockResolvedValue(reply(['Translation'], code));
  vi.stubGlobal('fetch', fetch);
  await expect(
    translateCaptionBatch({ ...settings, captionLanguage: language, targetLanguage: language }, [
      'Source',
    ]),
  ).resolves.toEqual(['Translation']);
  const url = new URL(fetch.mock.calls[0][0]);
  expect(url.searchParams.get('from')).toBe(code);
  expect(url.searchParams.get('to')).toBe(code);
});

it.each(
  [
    [],
    [{ translations: [{ text: '一', to: 'zh-Hans' }] }],
    [
      { translations: [{ text: '一', to: 'zh-Hans' }] },
      { translations: [{ text: '', to: 'zh-Hans' }] },
    ],
    [
      { translations: [{ text: '一', to: 'zh-Hans' }] },
      { translations: [{ text: '字'.repeat(5001), to: 'zh-Hans' }] },
    ],
    [
      { translations: [{ text: '一', to: 'zh-Hans' }] },
      { translations: [{ text: '二', to: 'ja' }] },
    ],
    [{ translations: [{ text: '一', to: 'zh-Hans' }] }, null],
  ].map((payload) => ({ payload })),
)('fails the entire malformed batch without publishing or retrying: %j', async ({ payload }) => {
  const fetch = vi.fn().mockResolvedValue(Response.json(payload));
  vi.stubGlobal('fetch', fetch);
  const published = vi.fn();
  await expect(
    translateCaptionBatch(settings, ['One.', 'Two.'], undefined, published),
  ).resolves.toBeNull();
  expect(published).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('reports HTTP status without exposing response bodies or retrying', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(new Response('private upstream details', { status: 429 }));
  vi.stubGlobal('fetch', fetch);
  const result = translateCaptionBatch(settings, ['One.']);
  await expect(result).rejects.toMatchObject({ status: 429, message: 'Provider request failed' });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('keeps the deadline while reading the body', async () => {
  vi.useFakeTimers();
  const stream = new ReadableStream();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream)));
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException('Timeout', 'TimeoutError')), ms);
    return controller.signal;
  });
  const result = expect(translateCaptionBatch(settings, ['One.'])).rejects.toMatchObject({
    failure: { kind: 'timeout' },
  });
  await vi.advanceTimersByTimeAsync(providerTimeoutMs);
  await result;
});

it('uses the same provider for a connection test without requiring OpenAI settings', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(['你好。'])));
  await expect(translate(DEFAULT_SETTINGS, 'Hello.')).resolves.toBe('你好。');
});

it('isolates cached translations by provider and reuses each one when switching back', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(providerReply(['Source.'], () => 'OpenAI译文'))
    .mockResolvedValueOnce(reply(['微软译文']));
  vi.stubGlobal('fetch', fetch);
  const queue = new TranslationQueue();
  const openai: CaptionTranslationSettings = {
    ...settings,
    provider: 'openai',
    apiKey: 'key',
    model: 'model',
  };
  await expect(queue.request('tab', openai, 'Source.')).resolves.toBe('OpenAI译文');
  await expect(queue.lookup(settings, 'Source.')).resolves.toBeNull();
  await expect(queue.request('tab', settings, 'Source.')).resolves.toBe('微软译文');
  await expect(queue.lookup(openai, 'Source.')).resolves.toBe('OpenAI译文');
  expect(fetch).toHaveBeenCalledTimes(2);
});

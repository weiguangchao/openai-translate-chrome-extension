import { afterEach, expect, it, vi } from 'vitest';
import { translateCaptionBatch } from '../src/shared/api';
import { DEFAULT_SETTINGS, type CaptionTranslationSettings } from '../src/shared/settings';
import { translationReply } from './fixtures/provider';

const settings: CaptionTranslationSettings = {
  ...DEFAULT_SETTINGS,
  provider: 'openai',
  captionLanguage: 'en' as const,
  pageTitle: '',
  apiKey: 'key',
  model: 'test',
};
afterEach(() => vi.unstubAllGlobals());

it.each([
  '第一行\n\n第二段',
  'OpenAI',
  '[[placeholder]]\n保留占位符',
  'Use <think> and </think> tags.',
  '```ts\nconst value = "{{text}}";\n```',
  '{"results":[{"id":0,"translation":"literal JSON"}]}',
])('preserves translated content and meaningful formatting: %s', async (translation) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => translationReply(translation)),
  );
  const published = vi.fn();
  await expect(translateCaptionBatch(settings, ['OpenAI'], undefined, published)).resolves.toEqual([
    translation,
  ]);
  expect(published.mock.calls).toEqual([[0, translation]]);
});

it.each(['', ' ', '字'.repeat(5001)])(
  'rejects empty or oversized translations',
  async (content) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => translationReply(content)),
    );
    const published = vi.fn();
    await expect(
      translateCaptionBatch(settings, ['One.'], undefined, published),
    ).resolves.toBeNull();
    expect(published).not.toHaveBeenCalled();
  },
);

it('reads text content parts without displaying reasoning', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        choices: [
          {
            message: {
              content: [
                { type: 'thinking', text: 'draft' },
                { type: 'text', text: '[[p0]]\n第一行\n' },
                { type: 'text', text: '第二行' },
              ],
              reasoning_content: 'draft',
            },
          },
        ],
      }),
    ),
  );
  await expect(translateCaptionBatch(settings, ['One.'])).resolves.toEqual(['第一行\n第二行']);
});

it('does not substitute reasoning for an absent translation', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({ choices: [{ message: { content: null, reasoning_content: 'draft' } }] }),
    ),
  );
  await expect(translateCaptionBatch(settings, ['One.'])).resolves.toBeNull();
});

it('translates eight independent captions in one request and maps out-of-order ids', async () => {
  const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
    translationReply(
      Array.from({ length: 8 }, (_, index) => `[[p${7 - index}]]\n译文 ${7 - index}`).join('\n'),
      false,
    ),
  );
  vi.stubGlobal('fetch', fetch);
  const published = vi.fn();
  const sources = [
    'First\nline',
    'OpenAI',
    '<b>three</b>',
    '{{four}}',
    'five',
    'six',
    'seven',
    'eight',
  ];
  const translations = Array.from({ length: 8 }, (_, index) => `译文 ${index}`);
  await expect(translateCaptionBatch(settings, sources, undefined, published)).resolves.toEqual(
    translations,
  );
  expect(fetch).toHaveBeenCalledTimes(1);
  const body = JSON.parse(String(fetch.mock.calls[0][1].body));
  expect(body.messages[1].content).toBe(
    'Translate to Simplified Chinese:\n\n' +
      sources.map((text, index) => `[[p${index}]]\n${text}`).join('\n') +
      '\n[[source_end]]',
  );
  expect(body.messages[0].content).toContain('## Multi-item processing protocol');
  expect(published.mock.calls).toEqual(translations.map((text, index) => [index, text]));
});

it('accepts one echoed [[source_end]] line at the end of the reply', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => translationReply('[[p1]]\n第二项\n[[p0]]\n第一项\n[[source_end]]', false)),
  );
  const published = vi.fn();
  await expect(
    translateCaptionBatch(settings, ['One', 'Two'], undefined, published),
  ).resolves.toEqual(['第一项', '第二项']);
  expect(published.mock.calls).toEqual([
    [0, '第一项'],
    [1, '第二项'],
  ]);
});

it.each([
  '[[p0]]\n第一项',
  '[[p0]]\n第一项\n[[source_end]]\n[[p1]]\n第二项',
  '[[p0]]\n第一项\n[[p1]]\n第二项\n[[source_end]]\n[[source_end]]',
  '[[p0]]\n第一项\n[[p0]]\n重复',
  '[[p0]]\n第一项\n[[p2]]\n未知',
  '[[p00]]\n第一项\n[[p1]]\n第二项',
  '说明\n[[p0]]\n第一项\n[[p1]]\n第二项',
  '```\n[[p0]]\n第一项\n[[p1]]\n第二项\n```',
  '[[p0]]\n第一项\n[[p1]]\n',
  '[[p0]]\n第一项\n[[p1]]\n' + '字'.repeat(5001),
])(
  'rejects malformed batches without publishing partial captions or retrying, case %#',
  async (content) => {
    const fetch = vi.fn(async () => translationReply(content, false));
    vi.stubGlobal('fetch', fetch);
    const published = vi.fn();
    await expect(
      translateCaptionBatch(settings, ['One', 'Two'], undefined, published),
    ).resolves.toBeNull();
    expect(published).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);

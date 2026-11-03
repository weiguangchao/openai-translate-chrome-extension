import { afterEach, expect, it, vi } from 'vitest';
import { translateCaptionBatch } from '../src/shared/api';
import { DEFAULT_SETTINGS } from '../src/shared/settings';
import { translationReply } from './fixtures/provider';

const settings = {
  ...DEFAULT_SETTINGS,
  captionLanguage: 'en' as const,
  apiKey: 'key',
  model: 'test',
};
afterEach(() => vi.unstubAllGlobals());

it.each([
  '第一行\n\n第二段',
  'OpenAI',
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
                { type: 'text', text: '第一行\n' },
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

import { afterEach, expect, it, vi } from 'vitest';
import { translateCaptionBatch } from '../src/shared/api';
import { DEFAULT_SETTINGS } from '../src/shared/settings';
import { translationInput } from '../src/shared/caption-translation';
import {
  longCaption,
  longCaptionParts,
  longResult,
  longSplit,
  structuredReply,
} from './fixtures/long-caption';

const settings = { ...DEFAULT_SETTINGS, apiKey: 'test-key', model: 'split-test' };
afterEach(() => vi.unstubAllGlobals());

it('sends a long caption as local lines next to ordinary captions and matches results by id', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      structuredReply([
        longResult(1),
        { id: 2, translation: '之后。' },
        { id: 0, parts: [{ translation: '之前。' }] },
      ]),
    );
  vi.stubGlobal('fetch', fetch);
  const inputs = [
    translationInput('Before.', false),
    translationInput(longCaption, true),
    translationInput('After.', false),
  ];
  const result = await translateCaptionBatch(settings, inputs);
  expect(result).toEqual(['之前。', longSplit(), '之后。']);
  expect(fetch).toHaveBeenCalledTimes(1);
  const body = JSON.parse(fetch.mock.calls[0][1].body);
  expect(JSON.parse(body.messages[1].content)).toEqual([
    { id: 0, text: 'Before.' },
    { id: 1, parts: longCaptionParts },
    { id: 2, text: 'After.' },
  ]);
  expect(body.stream).toBe(false);
  const split = result![1];
  if (typeof split === 'string') throw new Error('Expected a translation per line');
  expect(split.parts.map((part) => longCaption.slice(part.from, part.to))).toEqual(
    longCaptionParts,
  );
});

it('asks only for translations, not for splitting or copied source text', async () => {
  const fetch = vi.fn().mockResolvedValue(structuredReply([longResult()]));
  vi.stubGlobal('fetch', fetch);
  await translateCaptionBatch(settings, [translationInput(longCaption, true)]);
  const instructions: string = JSON.parse(fetch.mock.calls[0][1].body).messages[0].content;
  expect(instructions).toContain('one translation per line, in the same order');
  expect(instructions).not.toMatch(/display columns|"source"|split/);
});

it('uses the source language rules to cut Chinese lines', async () => {
  const text =
    '我知道你很想去 但是我們現在真的沒有時間了 如果再不出發的話 我們就趕不上最後一班火車了';
  const fetch = vi
    .fn()
    .mockResolvedValue(
      structuredReply([{ id: 0, parts: ['I know you want to go,', "but we're out of time."] }]),
    );
  vi.stubGlobal('fetch', fetch);
  await translateCaptionBatch({ ...settings, sourceLanguage: 'zh-TW', targetLanguage: 'en' }, [
    translationInput(text, true),
  ]);
  expect(JSON.parse(JSON.parse(fetch.mock.calls[0][1].body).messages[1].content)).toEqual([
    {
      id: 0,
      parts: [
        '我知道你很想去 但是我們現在真的沒有時間了',
        '如果再不出發的話 我們就趕不上最後一班火車了',
      ],
    },
  ]);
});

it('publishes ordinary and line results together once the JSON response is complete', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      structuredReply([{ id: 0, parts: [{ translation: '之前。' }] }, longResult(1)]),
    );
  vi.stubGlobal('fetch', fetch);
  const delivered = vi.fn();
  await expect(
    translateCaptionBatch(
      settings,
      [translationInput('Before.', false), translationInput(longCaption, true)],
      undefined,
      delivered,
    ),
  ).resolves.toEqual(['之前。', longSplit()]);
  expect(delivered.mock.calls).toEqual([
    [0, '之前。'],
    [1, longSplit()],
  ]);
  expect(JSON.parse(fetch.mock.calls[0][1].body).stream).toBe(false);
});

it('retains valid neighbors while an empty line translation and unknown id remain unusable', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        structuredReply([
          { id: 0, parts: [{ translation: '之前。' }] },
          { id: 1, parts: [...longResult().parts.slice(0, 2), ' '] },
          longResult(99),
        ]),
      ),
  );
  const delivered = vi.fn();
  await expect(
    translateCaptionBatch(
      settings,
      [translationInput('Before.', false), translationInput(longCaption, true)],
      undefined,
      delivered,
    ),
  ).resolves.toBeNull();
  expect(delivered.mock.calls).toEqual([[0, '之前。']]);
});

it('rejects conflicting results with a duplicate id before publishing', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        structuredReply([longResult(), { id: 0, parts: [{ translation: '重复内容' }] }]),
      ),
  );
  const delivered = vi.fn();
  await expect(
    translateCaptionBatch(settings, [translationInput(longCaption, true)], undefined, delivered),
  ).resolves.toBeNull();
  expect(delivered).not.toHaveBeenCalled();
});

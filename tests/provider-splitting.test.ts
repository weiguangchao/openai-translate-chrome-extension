import { afterEach, expect, it, vi } from 'vitest';
import { translateCaptionBatch } from '../src/shared/api';
import { DEFAULT_SETTINGS } from '../src/shared/settings';
import { readCaptionTranslation, translationInput } from '../src/shared/caption-translation';
import {
  longCaption,
  longCaptionParts,
  longResult,
  structuredReply,
} from './fixtures/long-caption';

const settings = { ...DEFAULT_SETTINGS, apiKey: 'test-key', model: 'split-test' };
afterEach(() => vi.unstubAllGlobals());

it('translates ordinary captions and splits only flagged captions in one request, matching results by id', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      structuredReply([
        longResult(1),
        { id: 2, parts: [{ translation: '之后。' }] },
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
  expect(result).toEqual(['之前。', readCaptionTranslation(inputs[1], longResult()), '之后。']);
  expect(fetch).toHaveBeenCalledTimes(1);
  const body = JSON.parse(fetch.mock.calls[0][1].body);
  const payload = JSON.parse(body.messages[1].content);
  expect(payload).toEqual([
    { id: 0, text: 'Before.' },
    { id: 1, text: longCaption, split: true },
    { id: 2, text: 'After.' },
  ]);
  expect(body.stream).toBe(false);
  expect(body.messages[0].content).toContain('With "split":true');
  const split = result![1];
  if (typeof split === 'string') throw new Error('Expected split result');
  expect(split.parts.map((part) => longCaption.slice(part.from, part.to))).toEqual(
    longCaptionParts,
  );
});

it('publishes ordinary and split results together once the JSON response is complete', async () => {
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
  ).resolves.toEqual([
    '之前。',
    readCaptionTranslation(translationInput(longCaption, true), longResult()),
  ]);
  expect(delivered.mock.calls).toEqual([
    [0, '之前。'],
    [1, readCaptionTranslation(translationInput(longCaption, true), longResult())],
  ]);
  expect(JSON.parse(fetch.mock.calls[0][1].body).stream).toBe(false);
});

it('retains valid neighbors while an incomplete split and unknown id remain unusable', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        structuredReply([
          { id: 0, parts: [{ translation: '之前。' }] },
          { id: 1, parts: longResult().parts.slice(0, 2) },
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

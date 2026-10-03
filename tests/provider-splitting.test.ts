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
  expect(
    payload.map((item: { id: number; needsSplit: boolean }) => [item.id, item.needsSplit]),
  ).toEqual([
    [0, false],
    [1, true],
    [2, false],
  ]);
  expect(payload[0]).not.toHaveProperty('units');
  expect(payload[1].units).toHaveLength(46);
  expect(body.stream).toBe(true);
  expect(body.messages[0].content).toContain('split AND translate');
  const split = result![1];
  if (typeof split === 'string') throw new Error('Expected split result');
  expect(split.parts.map((part) => longCaption.slice(part.from, part.to))).toEqual(
    longCaptionParts,
  );
});

it('streams ordinary results immediately but publishes a split only after all of its parts close', async () => {
  let control!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        control = controller;
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream' } },
  );
  const fetch = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetch);
  const delivered = vi.fn();
  const pending = translateCaptionBatch(
    settings,
    [translationInput('Before.', false), translationInput(longCaption, true)],
    undefined,
    delivered,
  );
  const push = (text: string) =>
    control.enqueue(
      new TextEncoder().encode(
        `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`,
      ),
    );
  await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
  const result = JSON.stringify(longResult(1));
  push('{"results":[{"id":0,"parts":[{"translation":"之前。"}]},' + result.slice(0, -1));
  await vi.waitFor(() => expect(delivered).toHaveBeenCalledTimes(1));
  expect(delivered).toHaveBeenCalledWith(0, '之前。');
  push('}');
  await vi.waitFor(() => expect(delivered).toHaveBeenCalledTimes(2));
  push(']}');
  control.close();
  await expect(pending).resolves.toEqual([
    '之前。',
    readCaptionTranslation(translationInput(longCaption, true), longResult()),
  ]);
  expect(delivered).toHaveBeenCalledTimes(2);
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

it('does not overwrite an already published result with a duplicate id', async () => {
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
  ).resolves.toEqual([readCaptionTranslation(translationInput(longCaption, true), longResult())]);
  expect(delivered).toHaveBeenCalledTimes(1);
});

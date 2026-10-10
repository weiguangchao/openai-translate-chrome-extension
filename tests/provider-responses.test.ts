import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/shared/settings';

let translateCaptionBatch: typeof import('../src/shared/api').translateCaptionBatch;
const settings = { ...DEFAULT_SETTINGS, apiKey: 'key', model: 'response-test' };
beforeEach(async () => {
  vi.resetModules();
  ({ translateCaptionBatch } = await import('../src/shared/api'));
});
afterEach(() => vi.unstubAllGlobals());
const result = (id: unknown, translation: string) => ({ id, parts: [{ translation }] });
const payload = (results: unknown[]) => JSON.stringify({ results });
function respond(content: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ choices: [{ message: { content } }] })),
  );
}

it('selects the final JSON once for both its return value and publications', async () => {
  respond(`${payload([result(0, '草稿')])}\nFinal\n${payload([result(0, '最终')])}`);
  const published = vi.fn();
  await expect(
    translateCaptionBatch(settings, ['Original.'], undefined, published),
  ).resolves.toEqual(['最终']);
  expect(published.mock.calls).toEqual([[0, '最终']]);
});

it.each([
  { label: 'unclosed array', suffix: '' },
  { label: 'unclosed object', suffix: ']' },
  { label: 'unfinished key', suffix: ',{"id":1,"parts":[{"transl' },
  { label: 'unfinished string', suffix: ',{"id":1,"parts":[{"translation":"unfinished' },
])('selects the final JSON after a draft with an $label', async ({ suffix }) => {
  const draft = '{"results":[' + JSON.stringify(result(0, '草稿')) + suffix;
  respond(`${draft}\nFinal\n${payload([result(0, '最终')])}`);
  const published = vi.fn();
  await expect(
    translateCaptionBatch(settings, ['Original.'], undefined, published),
  ).resolves.toEqual(['最终']);
  expect(published.mock.calls).toEqual([[0, '最终']]);
});

it.each([
  { values: [result(0, '草稿'), result('0', '冲突'), result(1, '有效')] },
  { values: [result('bad', '无效'), result(0, '有效')] },
])(
  'rejects all duplicate or malformed IDs while preserving unambiguous peers',
  async ({ values }) => {
    respond(payload(values));
    const published = vi.fn();
    await expect(
      translateCaptionBatch(settings, ['One.', 'Two.'], undefined, published),
    ).resolves.toBeNull();
    expect(published.mock.calls).toEqual([[values.length === 3 ? 1 : 0, '有效']]);
  },
);

it.each([{ values: [result(1, '歧义')] }, { values: [result('9007199254740993', '无效')] }])(
  'rejects incomplete ambiguous IDs and unsafe numeric strings',
  async ({ values }) => {
    respond(payload(values));
    const published = vi.fn();
    await expect(
      translateCaptionBatch(settings, ['One.', 'Two.'], undefined, published),
    ).resolves.toBeNull();
    expect(published).not.toHaveBeenCalled();
  },
);

it('aligns an unordered complete one-based list', async () => {
  respond(payload([result('2', '乙'), result('1', '甲')]));
  await expect(translateCaptionBatch(settings, ['One.', 'Two.'])).resolves.toEqual(['甲', '乙']);
});

it('does not treat an invalid single ID as a missing ID', async () => {
  respond(payload([result('bad', '无效')]));
  const published = vi.fn();
  await expect(
    translateCaptionBatch(settings, ['Only.'], undefined, published),
  ).resolves.toBeNull();
  expect(published).not.toHaveBeenCalled();
});

it('recovers complete results from a truncated response only after parsing fails', async () => {
  respond('{"results":[' + JSON.stringify(result(0, '完整')) + ',{"id":1,"parts":[');
  const published = vi.fn();
  await expect(
    translateCaptionBatch(settings, ['One.', 'Two.'], undefined, published),
  ).resolves.toBeNull();
  expect(published.mock.calls).toEqual([[0, '完整']]);
});

it('does not publish a parts array from an incomplete result as a standalone reply', async () => {
  respond('{"results":[{"id":0,"parts":[{"translation":"未完成"}]');
  const published = vi.fn();
  await expect(
    translateCaptionBatch(settings, ['Original.'], undefined, published),
  ).resolves.toBeNull();
  expect(published).not.toHaveBeenCalled();
});

it.each(
  [
    {
      label: 'malformed',
      final:
        '{"results":[{"id":0,"parts":[{"translation":"一"} stray]},' +
        JSON.stringify(result(1, '二')) +
        ']}',
      published: [[1, '二']],
    },
    {
      label: 'truncated',
      final: '{"results":[' + JSON.stringify(result(0, '一')) + ',{"id":1,"parts":[{"transl',
      published: [[0, '一']],
    },
  ].flatMap((test) =>
    [
      { draftLabel: 'complete', draft: payload([result(0, '草稿一'), result(1, '草稿二')]) },
      { draftLabel: 'truncated', draft: '{"results":[' + JSON.stringify(result(0, '草稿一')) },
    ].map((draft) => ({ ...test, ...draft })),
  ),
)(
  'never falls back to a $draftLabel draft when the final JSON is $label',
  async ({ draft, final, published }) => {
    respond(`${draft}\nFinal\n${final}`);
    const publish = vi.fn();
    await expect(
      translateCaptionBatch(settings, ['One.', 'Two.'], undefined, publish),
    ).resolves.toBeNull();
    expect(publish.mock.calls).toEqual(published);
  },
);

it('discards a response that arrives after cancellation even if the provider ignores abort', async () => {
  let finish!: (response: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    ),
  );
  const controller = new AbortController();
  const published = vi.fn();
  const work = translateCaptionBatch(settings, ['Old source.'], controller.signal, published);
  controller.abort();
  finish(Response.json({ choices: [{ message: { content: payload([result(0, '旧译文')]) } }] }));
  await expect(work).rejects.toThrow();
  expect(published).not.toHaveBeenCalled();
});

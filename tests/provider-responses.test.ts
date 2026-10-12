import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/shared/settings';

let translateCaptionBatch: typeof import('../src/shared/api').translateCaptionBatch;
const settings = { ...DEFAULT_SETTINGS, apiKey: 'key', model: 'response-test' };
beforeEach(async () => {
  vi.resetModules();
  ({ translateCaptionBatch } = await import('../src/shared/api'));
});
afterEach(() => vi.unstubAllGlobals());
const result = (id: unknown, translation: string) => ({ id, translation });
const payload = (results: unknown[]) => JSON.stringify({ results });
const resultsContent = (translations: string[]) =>
  payload(translations.map((translation, id) => result(id, translation)));
function respond(content: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ choices: [{ message: { content } }] })),
  );
}

const four = ['One.', 'Two.', 'Three.', 'Four.'];
it.each([
  { label: 'translations by position', texts: four, reply: { translations: ['甲乙', '丙', '丁'] } },
  { label: 'a bare array by position', texts: four, reply: ['甲乙', '丙', '丁'] },
  { label: 'plain text', texts: ['One.', 'Two.'], reply: '第一句\n第二句' },
  { label: 'the wrong shape', texts: ['One.', 'Two.'], reply: { segments: ['第一句', '第二句'] } },
  {
    label: 'the request echoed back',
    texts: ['One.'],
    reply: { results: [{ id: 0, text: 'One.' }] },
  },
  {
    label: 'parts',
    texts: ['One.'],
    reply: { results: [{ id: 0, parts: [{ translation: '甲' }] }] },
  },
  {
    label: 'a result without an id',
    texts: ['One.'],
    reply: { results: [{ translation: '甲' }] },
  },
  { label: 'no translation', texts: ['One.'], reply: { results: [{ id: 0 }] } },
  {
    label: 'an empty translation',
    texts: ['One.'],
    reply: { results: [result(0, ' ')] },
  },
  {
    label: 'an oversized translation',
    texts: ['One.'],
    reply: { results: [result(0, '字'.repeat(5001))] },
  },
])('publishes nothing from $label', async ({ texts, reply }) => {
  respond(typeof reply === 'string' ? reply : JSON.stringify(reply));
  const published = vi.fn();
  await expect(translateCaptionBatch(settings, texts, undefined, published)).resolves.toBeNull();
  expect(published).not.toHaveBeenCalled();
});

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
  { label: 'unfinished key', suffix: ',{"id":1,"transl' },
  { label: 'unfinished string', suffix: ',{"id":1,"translation":"unfinished' },
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

it('trims a translation without reading source or parts fields', async () => {
  respond(payload([{ id: 0, translation: ' 短句。 ', text: 'Original.', parts: ['wrong'] }]));
  const published = vi.fn();
  await expect(
    translateCaptionBatch(settings, ['Original.'], undefined, published),
  ).resolves.toEqual(['短句。']);
  expect(published.mock.calls).toEqual([[0, '短句。']]);
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
  const translation = '他说："{你好}"';
  respond(
    '```json\n{"note":[],"results":[' +
      JSON.stringify(result(0, translation)) +
      ',{"id":1,"translation":',
  );
  const published = vi.fn();
  await expect(
    translateCaptionBatch(settings, ['One.', 'Two.'], undefined, published),
  ).resolves.toBeNull();
  expect(published.mock.calls).toEqual([[0, translation]]);
});

it('does not publish a result object the reply never closed', async () => {
  respond(
    '```json\n{"note":[],"results":[' + JSON.stringify(result(0, '他说："{你好}"')).slice(0, -1),
  );
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
        '{"results":[{"id":0,"translation":"一" stray},' + JSON.stringify(result(1, '二')) + ']}',
      published: [[1, '二']],
    },
    {
      label: 'truncated',
      final: '{"results":[' + JSON.stringify(result(0, '一')) + ',{"id":1,"transl',
      published: [[0, '一']],
    },
    {
      label: 'malformed with a duplicated ID',
      final:
        '{"results":[{"id":0,"translation":"坏" stray},' +
        JSON.stringify(result(0, '歧义')) +
        ',' +
        JSON.stringify(result(1, '好')) +
        ']}',
      published: [[1, '好']],
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

it.each([
  { label: 'an empty peer', values: [result(0, '第一句'), result(1, ' ')] },
  { label: 'an omitted peer', values: [result(0, '第一句')] },
])('publishes a usable result beside $label without completing the batch', async ({ values }) => {
  respond(payload(values));
  const published = vi.fn();
  await expect(
    translateCaptionBatch(settings, ['One.', 'Two.'], undefined, published),
  ).resolves.toBeNull();
  expect(published.mock.calls).toEqual([[0, '第一句']]);
});

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

it('submits each translation from a complete fenced JSON body', async () => {
  const content =
    '```json\n{"results":[{"id":0,"translation":"第一句"},{"id":1,"translation":"他说\\"你好\\"\\n中\\/\\u6587"}]}\n```';
  const fetch = vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content } }] }));
  vi.stubGlobal('fetch', fetch);
  const seen: [number, string][] = [];
  await expect(
    translateCaptionBatch(
      { ...settings, model: 'json-batch' },
      ['One.', 'Two.'],
      undefined,
      (index, translation) => {
        if (typeof translation === 'string') seen.push([index, translation]);
      },
    ),
  ).resolves.toEqual(['第一句', '他说"你好"\n中/文']);
  expect(seen).toEqual([
    [0, '第一句'],
    [1, '他说"你好"\n中/文'],
  ]);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('reads a GLM answer that follows the thinking block, including string ids', async () => {
  const body = JSON.parse(resultsContent(['第一句', '第二句'])) as {
    results: { id: number | string }[];
  };
  body.results.forEach((item) => {
    item.id = String(item.id);
  });
  const content = `Need one part per caption.\n</think>\n${JSON.stringify(body)}`;
  const fetch = vi.fn().mockResolvedValue(
    Response.json({
      choices: [{ message: { content, reasoning_content: 'ignored draft' } }],
    }),
  );
  vi.stubGlobal('fetch', fetch);
  await expect(
    translateCaptionBatch({ ...settings, model: 'glm-thinking' }, ['One.', 'Two.']),
  ).resolves.toEqual(['第一句', '第二句']);
});

it('finds the results JSON beside prose, in text content parts and in reasoning_content', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        choices: [
          {
            message: {
              content: `译文如下：\n${resultsContent(['甲', '乙'])}\n完成。`,
            },
          },
        ],
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        choices: [
          {
            message: {
              content: [
                { type: 'reasoning', text: 'draft' },
                {
                  type: 'text',
                  text: JSON.stringify({
                    results: [
                      { id: 1, translation: '后一句' },
                      { id: '0', translation: '前一句' },
                    ],
                  }),
                },
              ],
            },
          },
        ],
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        choices: [
          {
            message: {
              content: null,
              reasoning_content: `<think>draft</think>${resultsContent(['单独'])}`,
            },
          },
        ],
      }),
    );
  vi.stubGlobal('fetch', fetch);
  const provider = { ...settings, model: 'glm-shapes' };
  await expect(translateCaptionBatch(provider, ['One.', 'Two.'])).resolves.toEqual(['甲', '乙']);
  await expect(translateCaptionBatch(provider, ['One.', 'Two.'])).resolves.toEqual([
    '前一句',
    '后一句',
  ]);
  await expect(translateCaptionBatch(provider, ['Only.'])).resolves.toEqual(['单独']);
});

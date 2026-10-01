import { afterEach, expect, it, vi } from 'vitest';
import { translateSubtitle } from '../src/shared/api';
import { DEFAULT_SETTINGS } from '../src/shared/settings';
import { parseSubtitleSegments } from '../src/shared/subtitle-segmentation';
import { githubCaption, githubModelResponse } from './fixtures/github-caption';

vi.mock('../src/shared/rate-limiter', () => ({
  RateLimiter: class {
    acquire() {
      return Promise.resolve();
    }
  },
}));

const settings = { ...DEFAULT_SETTINGS, apiKey: 'fixture-key', model: 'fixture-model' };
afterEach(() => vi.unstubAllGlobals());

it.each(['chat', 'completions'] as const)(
  'translates and segments a long subtitle in one %s request with validated source offsets',
  async (apiFormat) => {
    const fetch = vi.fn(async () =>
      Response.json({
        choices: [
          apiFormat === 'chat'
            ? { message: { content: JSON.stringify(githubModelResponse) } }
            : { text: JSON.stringify(githubModelResponse) },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetch);
    await expect(
      translateSubtitle({ ...settings, apiFormat }, githubCaption, undefined, true),
    ).resolves.toEqual({
      segments: [
        { from: 0, to: 76, translation: '我、Ghostie 的创作者米切尔，还有许多人都开始意识到' },
        { from: 77, to: 148, translation: 'GitHub 可能已经不是存放我们代码最安全的地方了' },
        { from: 149, to: 191, translation: '因为他们会莫名其妙地撤销合并' },
        { from: 192, to: 256, translation: '停机时间更是按天计算，而不是按分钟。' },
      ],
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);

it('keeps short subtitles on the plain translation path', async () => {
  const fetch = vi.fn(async () =>
    Response.json({ choices: [{ message: { content: '我们走吧。' } }] }),
  );
  vi.stubGlobal('fetch', fetch);
  await expect(translateSubtitle(settings, 'Let’s go.', undefined, true)).resolves.toBe(
    '我们走吧。',
  );
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('accepts semantic boundaries in unspaced Japanese without an English grammar dictionary', async () => {
  const text =
    '私たちは長い間このサービスに大切なソースコードを保存してきましたが最近は予告のない障害が何度も発生しているため別のサービスへの移行を検討しています';
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                segments: [
                  {
                    source: '私たちは長い間このサービスに大切なソースコードを保存してきましたが',
                    translation: '我们长期把重要的源代码保存在这个服务上',
                  },
                  {
                    source: '最近は予告のない障害が何度も発生しているため',
                    translation: '但最近频繁出现毫无预警的故障',
                  },
                  {
                    source: '別のサービスへの移行を検討しています',
                    translation: '所以我们正在考虑迁移到其他服务',
                  },
                ],
              }),
            },
          },
        ],
      }),
    ),
  );
  const result = await translateSubtitle(
    { ...settings, sourceLanguage: 'ja' },
    text,
    undefined,
    true,
  );
  expect(
    typeof result === 'string'
      ? result
      : result.segments.map((part) => [text.slice(part.from, part.to), part.translation]),
  ).toEqual([
    [
      '私たちは長い間このサービスに大切なソースコードを保存してきましたが',
      '我们长期把重要的源代码保存在这个服务上',
    ],
    ['最近は予告のない障害が何度も発生しているため', '但最近频繁出现毫无预警的故障'],
    ['別のサービスへの移行を検討しています', '所以我们正在考虑迁移到其他服务'],
  ]);
});

it('corrects an invalid response once without returning the unsegmented paragraph', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '整段译文' } }] }))
    .mockResolvedValueOnce(
      Response.json({
        choices: [
          { message: { content: `\`\`\`json\n${JSON.stringify(githubModelResponse)}\n\`\`\`` } },
        ],
      }),
    );
  vi.stubGlobal('fetch', fetch);
  const result = await translateSubtitle(settings, githubCaption, undefined, true);
  expect(
    typeof result === 'string' ? result : result.segments.map((part) => part.translation),
  ).toEqual([
    '我、Ghostie 的创作者米切尔，还有许多人都开始意识到',
    'GitHub 可能已经不是存放我们代码最安全的地方了',
    '因为他们会莫名其妙地撤销合并',
    '停机时间更是按天计算，而不是按分钟。',
  ]);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('fails after one correction when the provider cannot produce valid segments', async () => {
  const fetch = vi.fn(async () =>
    Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              segments: [{ source: githubCaption, translation: '整段译文' }],
            }),
          },
        },
      ],
    }),
  );
  vi.stubGlobal('fetch', fetch);
  await expect(translateSubtitle(settings, githubCaption, undefined, true)).rejects.toThrow(
    '有效的语义分段',
  );
  expect(fetch).toHaveBeenCalledTimes(2);
});

it.each([
  { name: 'omitted words', segments: githubModelResponse.segments.slice(1) },
  {
    name: 'repeated words',
    segments: [githubModelResponse.segments[0], ...githubModelResponse.segments],
  },
  { name: 'reordered words', segments: [...githubModelResponse.segments].reverse() },
  {
    name: 'rewritten words',
    segments: githubModelResponse.segments.map((part) => ({
      ...part,
      source: part.source.replace('GitHub', 'Gitlab'),
    })),
  },
  {
    name: 'empty translations',
    segments: githubModelResponse.segments.map((part) => ({ ...part, translation: '' })),
  },
  {
    name: 'oversized source chunks',
    segments: [
      { source: githubCaption.slice(0, 148), translation: '太长' },
      { source: githubCaption.slice(149), translation: '依然太长' },
    ],
  },
  {
    name: 'oversized translations',
    segments: githubModelResponse.segments.map((part) => ({
      ...part,
      translation: '译文'.repeat(100),
    })),
  },
])(
  'rejects $name instead of losing source text or drawing an oversized caption',
  ({ segments }) => {
    expect(() => parseSubtitleSegments(githubCaption, JSON.stringify({ segments }), 'en')).toThrow(
      '有效的语义分段',
    );
  },
);

it('rejects boundaries inside words even when the combined text is exact', () => {
  expect(() =>
    parseSubtitleSegments(
      'GitHub stays.',
      JSON.stringify({
        segments: [
          { source: 'Git', translation: 'Git' },
          { source: 'Hub stays.', translation: 'Hub 留下来。' },
        ],
      }),
      'en',
    ),
  ).toThrow('有效的语义分段');
});

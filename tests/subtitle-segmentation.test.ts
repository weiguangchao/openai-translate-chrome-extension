import { afterEach, expect, it, vi } from 'vitest';
import { translateSubtitle } from '../src/shared/api';
import { DEFAULT_SETTINGS } from '../src/shared/settings';
import { splitSubtitleAtCommas, subtitleDisplayLength } from '../src/shared/subtitle-segmentation';
import { githubCaption, githubCommaSegments } from './fixtures/github-caption';

const settings = { ...DEFAULT_SETTINGS, apiKey: 'fixture-key', model: 'fixture-model' };
afterEach(() => vi.unstubAllGlobals());

it('packs comma-separated clauses into as few segments as the display limit allows', () => {
  const clause = 'a'.repeat(40);
  const text = `${clause}, ${clause}, ${clause}`;
  expect(splitSubtitleAtCommas(text).map((part) => text.slice(part.from, part.to))).toEqual([
    `${clause}, ${clause},`,
    clause,
  ]);
  expect(subtitleDisplayLength(`${clause}, ${clause},`)).toBeLessThanOrEqual(100);
  expect(subtitleDisplayLength(text)).toBeGreaterThan(100);
});

it('does not split a caption that already fits', () => {
  const text = 'Hello, world, again.';
  expect(splitSubtitleAtCommas(text)).toEqual([{ from: 0, to: text.length }]);
});

it('splits on a Chinese comma and keeps an overlong clause without one intact', () => {
  const head = '甲'.repeat(40);
  const tail = '乙'.repeat(20);
  const chinese = `${head}，${tail}`;
  expect(splitSubtitleAtCommas(chinese).map((part) => chinese.slice(part.from, part.to))).toEqual([
    `${head}，`,
    tail,
  ]);
  const unbroken = `${'a'.repeat(120)}, tail`;
  expect(splitSubtitleAtCommas(unbroken).map((part) => unbroken.slice(part.from, part.to))).toEqual(
    [`${'a'.repeat(120)},`, 'tail'],
  );
});

it('splits the sample caption only at the comma that keeps the first clause on screen', () => {
  expect(
    splitSubtitleAtCommas(githubCaption).map((part) => githubCaption.slice(part.from, part.to)),
  ).toEqual(githubCommaSegments);
});

it.each(['chat', 'completions'] as const)(
  'translates comma segments with the normal %s translation request',
  async (apiFormat) => {
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as {
        messages?: { content: string }[];
        prompt?: string;
      };
      const instructions = body.messages?.[0].content ?? body.prompt?.split('\n\nInput:\n')[0];
      const input =
        body.messages?.[1].content ??
        body.prompt?.split('\n\nInput:\n')[1]?.split('\n\nOutput:')[0];
      expect(instructions).toContain(`exactly ${githubCommaSegments.length} strings`);
      expect(instructions).not.toContain('exact contiguous original');
      expect(JSON.parse(input!)).toEqual(githubCommaSegments);
      return Response.json({
        choices: [
          apiFormat === 'chat'
            ? {
                message: {
                  content: JSON.stringify({
                    translations: githubCommaSegments.map((part) => `译:${part}`),
                  }),
                },
              }
            : {
                text: JSON.stringify({
                  translations: githubCommaSegments.map((part) => `译:${part}`),
                }),
              },
        ],
      });
    });
    vi.stubGlobal('fetch', fetch);
    const parts = splitSubtitleAtCommas(githubCaption);
    await expect(
      translateSubtitle({ ...settings, apiFormat }, githubCaption, undefined, true),
    ).resolves.toEqual({
      segments: parts.map((part) => ({
        ...part,
        translation: `译:${githubCaption.slice(part.from, part.to)}`,
      })),
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);

it('keeps short subtitles and comma-free long subtitles on the plain translation path', async () => {
  const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
    Response.json({ choices: [{ message: { content: '整句译文' } }] }),
  );
  vi.stubGlobal('fetch', fetch);
  await expect(translateSubtitle(settings, 'Let’s go.', undefined, true)).resolves.toBe('整句译文');
  await expect(translateSubtitle(settings, 'a'.repeat(120), undefined, true)).resolves.toBe(
    '整句译文',
  );
  const bodies = fetch.mock.calls.map(
    (call) => JSON.parse(String(call[1].body)).messages[1].content as string,
  );
  expect(bodies).toEqual(['Let’s go.', 'a'.repeat(120)]);
});

it('translates each comma segment separately when the batch reply is unusable', async () => {
  const parts = splitSubtitleAtCommas(githubCaption).map((part) =>
    githubCaption.slice(part.from, part.to),
  );
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    const content = JSON.parse(init.body as string).messages[1].content as string;
    return Response.json({
      choices: [
        {
          message: {
            content: content.startsWith('[') ? '不是译文列表' : `译:${content}`,
          },
        },
      ],
    });
  });
  vi.stubGlobal('fetch', fetch);
  await expect(translateSubtitle(settings, githubCaption, undefined, true)).resolves.toEqual({
    segments: splitSubtitleAtCommas(githubCaption).map((part, index) => ({
      ...part,
      translation: `译:${parts[index]}`,
    })),
  });
  expect(fetch).toHaveBeenCalledTimes(1 + parts.length);
});

it('translates comma segments beyond one batch without asking the provider to choose boundaries', async () => {
  const pieces = Array.from({ length: 11 }, (_, index) => `${index}`.padEnd(90, 'x'));
  const text = pieces.join(', ');
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    const content = JSON.parse(init.body as string).messages[1].content as string;
    const batch = content.startsWith('[') ? (JSON.parse(content) as string[]) : [content];
    return Response.json({
      choices: [
        {
          message: {
            content:
              batch.length > 1
                ? JSON.stringify({ translations: batch.map((part) => `译:${part}`) })
                : `译:${batch[0]}`,
          },
        },
      ],
    });
  });
  vi.stubGlobal('fetch', fetch);
  const result = await translateSubtitle(settings, text, undefined, true);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(typeof result === 'string' ? [] : result.segments.map((part) => part.translation)).toEqual(
    splitSubtitleAtCommas(text).map((part) => `译:${text.slice(part.from, part.to)}`),
  );
  const firstInput = JSON.parse(
    JSON.parse(String(fetch.mock.calls[0][1].body)).messages[1].content,
  ) as string[];
  expect(firstInput).toHaveLength(10);
  expect(JSON.parse(String(fetch.mock.calls[1][1].body)).messages[0].content).toContain(
    'Output only the translation',
  );
});

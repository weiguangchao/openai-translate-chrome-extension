import { ESLint } from 'eslint';
import { expect, it } from 'vitest';

const eslint = new ESLint();

it.each([
  'fetch(url, { method: "POST" });',
  'globalThis.fetch(url, { method: "POST" });',
  'globalThis["fetch"](url);',
  'const send = fetch; send(url);',
])('rejects a provider transport bypass: %s', async (source) => {
  const [result] = await eslint.lintText(source, { filePath: 'src/shared/provider/probe.ts' });
  expect(result.messages).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        ruleId: 'local/provider-transport',
        message: expect.stringContaining('retries also consume a send slot'),
      }),
    ]),
  );
});

it('allows the transport and unrelated subtitle downloads', async () => {
  for (const filePath of [
    'src/shared/provider/transport.ts',
    'src/platforms/youtube/captions.ts',
  ]) {
    const [result] = await eslint.lintText('fetch(url);', { filePath });
    expect(result.messages).toEqual([]);
  }
  const [result] = await eslint.lintText(
    'import { providerFetch } from "./transport"; providerFetch(url, init);',
    { filePath: 'src/shared/provider/probe.ts' },
  );
  expect(result.messages).toEqual([]);
});

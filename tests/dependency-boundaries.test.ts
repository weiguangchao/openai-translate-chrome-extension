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

it.each([
  ['src/core/probe.ts', 'import "../platforms/youtube/platform";'],
  ['src/core/probe.ts', 'import("../platforms/youtube/platform");'],
  ['src/core/probe.ts', 'type P = import("../platforms/hbo/platform").Platform;'],
  ['src/core/probe.ts', 'export * from "../platforms/hbo/platform";'],
  ['src/shared/probe.ts', 'import("../core/platform");'],
  ['src/extension/probe.ts', 'import("../core/overlay");'],
  ['src/platforms/third/probe.ts', 'import "../youtube/captions";'],
  ['src/platforms/third/probe.ts', 'import("../hbo/captions");'],
  ['src/platforms/youtube/probe.ts', 'import("../third/captions");'],
  ['src/platforms/third/probe.ts', 'require("../hbo/captions");'],
  ['src/platforms/third/probe.ts', 'import("../../shared/../ui/App");'],
])('rejects cross-layer imports in %s: %s', async (filePath, source) => {
  const [result] = await eslint.lintText(source, { filePath });
  expect(result.messages).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        ruleId: 'local/dependency-boundaries',
        message: expect.stringContaining('src/core/platform.ts'),
      }),
    ]),
  );
});

it.each([
  ['src/platforms/third/probe.ts', 'import type { Platform } from "../../core/platform";'],
  ['src/platforms/third/probe.ts', 'import("../../core/sentences");'],
  ['src/platforms/third/probe.ts', 'import("./captions");'],
  ['src/core/probe.ts', 'import("../shared/caption-translation");'],
])('allows shared implementation and same-platform imports in %s', async (filePath, source) => {
  const [result] = await eslint.lintText(source, { filePath });
  expect(result.messages).toEqual([]);
});

it('forbids free-text translation in the caption queue', async () => {
  const [result] = await eslint.lintText('import { translate as bypass } from "../shared/api";', {
    filePath: 'src/extension/queue.ts',
  });
  expect(result.messages).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        message: expect.stringContaining('Caption queues must use translateCaptionBatch'),
      }),
    ]),
  );
});

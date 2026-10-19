import { spawnSync } from 'node:child_process';
import path from 'node:path';
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

it.each([
  ['src/extension/queue.ts', 'import { translate as bypass } from "../shared/api";'],
  ['src/extension/queue.ts', 'import { translate } from "../shared/api.ts";'],
  ['src/extension/prefetch.ts', 'import { translate } from "../shared/api";'],
])('forbids free-text translation for captions in %s: %s', async (filePath, source) => {
  const [result] = await eslint.lintText(source, { filePath });
  expect(result.messages).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        message: expect.stringContaining('Caption queues must use translateCaptionBatch'),
      }),
    ]),
  );
});

it('lets the background run the connection check', async () => {
  const [result] = await eslint.lintText('import { translate } from "../shared/api";', {
    filePath: 'src/extension/background.ts',
  });
  expect(result.messages).toEqual([]);
});

it.each([
  ['src/extension/background.ts', 'fetch(url, { method: "POST" });'],
  ['src/extension/queue.ts', 'new XMLHttpRequest();'],
  ['src/ui/App.tsx', 'navigator.sendBeacon(url, body);'],
  ['src/shared/probe.ts', 'globalThis[name](url);'],
])('rejects a network call outside the transport in %s: %s', async (filePath, source) => {
  const [result] = await eslint.lintText(source, { filePath });
  expect(result.messages).toEqual(
    expect.arrayContaining([expect.objectContaining({ ruleId: 'local/provider-transport' })]),
  );
});

it.each([
  ['src/shared/settings.ts', 'chrome.storage.local.set({ settings });'],
  ['src/extension/background.ts', 'chrome.storage.session.set({ settings });'],
  ['src/ui/App.tsx', 'localStorage.setItem("settings", JSON.stringify(settings));'],
])('rejects a storage write outside the storage owners in %s: %s', async (filePath, source) => {
  const [result] = await eslint.lintText(source, { filePath });
  expect(result.messages).toEqual([
    expect.objectContaining({
      ruleId: 'local/storage-writers',
      message: expect.stringContaining('saveSettings'),
    }),
  ]);
});

it.each([
  ['src/ui/probe.tsx', 'import "../core/overlay";'],
  ['src/main.tsx', 'import "./extension/background";'],
])('keeps the settings pages off content and worker code in %s: %s', async (filePath, source) => {
  const [result] = await eslint.lintText(source, { filePath });
  expect(result.messages).toEqual(
    expect.arrayContaining([expect.objectContaining({ ruleId: 'local/dependency-boundaries' })]),
  );
});

it('checks dependency boundaries when ESLint runs from a subdirectory', () => {
  const run = spawnSync(
    process.execPath,
    [
      path.resolve('node_modules/eslint/bin/eslint.js'),
      '--stdin',
      '--stdin-filename',
      'core/probe.ts',
    ],
    {
      cwd: path.resolve('src'),
      input: 'import "../platforms/youtube/platform";',
      encoding: 'utf8',
    },
  );
  expect(run.stdout).toContain('local/dependency-boundaries');
});

it.each([
  'if (error.message === "译文与原文相同。") show();',
  'const TIMEOUT = "接口调用超时"; if (node.textContent === TIMEOUT) show();',
  'if (node.classList.contains("timeout")) show();',
])('rejects caption state read back from a message or the DOM: %s', async (source) => {
  const [result] = await eslint.lintText(source, { filePath: 'src/core/probe.ts' });
  expect(result.messages).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        ruleId: 'local/typed-outcomes',
        message: expect.stringContaining('TranslationLine'),
      }),
    ]),
  );
});

it('allows a caption state chosen by its failure kind', async () => {
  const [result] = await eslint.lintText(
    'switch (failure.kind) { case "timeout": show(); break; }',
    { filePath: 'src/core/probe.ts' },
  );
  expect(result.messages).toEqual([]);
});

it.each([
  'export class SubtitleOverlay { line = ""; }',
  'export class SubtitleOverlay { get state() { return "ready"; } }',
  'export class SubtitleOverlay { current(): string { return ""; } }',
])('rejects state exposed by the overlay: %s', async (source) => {
  const [result] = await eslint.lintText(source, { filePath: 'src/core/overlay.ts' });
  expect(result.messages).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        ruleId: 'local/write-only-overlay',
        message: expect.stringContaining('SubtitleOverlay only renders'),
      }),
    ]),
  );
});

it('keeps new tuning numbers in src/shared/tuning.ts', async () => {
  const [outside] = await eslint.lintText('export const retryDelayMs = 15_000;', {
    filePath: 'src/core/probe.ts',
  });
  expect(outside.messages).toEqual([
    expect.objectContaining({
      ruleId: 'local/tuning-home',
      message: expect.stringContaining('src/shared/tuning.ts'),
    }),
  ]);
  const [home] = await eslint.lintText('export const retryDelayMs = 15_000;', {
    filePath: 'src/shared/tuning.ts',
  });
  expect(home.messages).toEqual([]);
});

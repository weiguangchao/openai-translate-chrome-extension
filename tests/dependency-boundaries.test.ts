import { ESLint } from 'eslint';
import { expect, it } from 'vitest';

const eslint = new ESLint();

it.each([
  [
    'src/shared/provider/probe.ts',
    'fetch(url, { method: "POST" });',
    'local/provider-transport/bypass',
  ],
  [
    'src/shared/provider/probe.ts',
    'globalThis.fetch(url, { method: "POST" });',
    'local/provider-transport/bypass',
  ],
  ['src/shared/provider/probe.ts', 'globalThis["fetch"](url);', 'local/provider-transport/bypass'],
  [
    'src/shared/provider/probe.ts',
    'const send = fetch; send(url);',
    'local/provider-transport/bypass',
  ],
  [
    'src/extension/background.ts',
    'fetch(url, { method: "POST" });',
    'local/provider-transport/bypass',
  ],
  ['src/extension/queue.ts', 'new XMLHttpRequest();', 'local/provider-transport/bypass'],
  ['src/ui/App.tsx', 'navigator.sendBeacon(url, body);', 'local/provider-transport/bypass'],
  ['src/shared/probe.ts', 'globalThis[name](url);', 'local/provider-transport/computed'],
  ['src/shared/provider/transport.ts', 'fetch(url);', null],
  ['src/platforms/youtube/captions.ts', 'fetch(url);', null],
  [
    'src/shared/provider/probe.ts',
    'import { providerFetch } from "./transport"; providerFetch(url, init);',
    null,
  ],
  [
    'src/core/probe.ts',
    'import "../platforms/youtube/platform";',
    'local/dependency-boundaries/boundary',
  ],
  [
    'src/core/probe.ts',
    'import("../platforms/youtube/platform");',
    'local/dependency-boundaries/boundary',
  ],
  [
    'src/core/probe.ts',
    'type P = import("../platforms/x/platform").Platform;',
    'local/dependency-boundaries/boundary',
  ],
  [
    'src/core/probe.ts',
    'export * from "../platforms/x/platform";',
    'local/dependency-boundaries/boundary',
  ],
  ['src/shared/probe.ts', 'import("../core/platform");', 'local/dependency-boundaries/boundary'],
  ['src/extension/probe.ts', 'import("../core/overlay");', 'local/dependency-boundaries/boundary'],
  [
    'src/platforms/third/probe.ts',
    'import "../youtube/captions";',
    'local/dependency-boundaries/boundary',
  ],
  [
    'src/platforms/third/probe.ts',
    'import("../x/captions");',
    'local/dependency-boundaries/boundary',
  ],
  [
    'src/platforms/youtube/probe.ts',
    'import("../third/captions");',
    'local/dependency-boundaries/boundary',
  ],
  [
    'src/platforms/third/probe.ts',
    'require("../x/captions");',
    'local/dependency-boundaries/boundary',
  ],
  [
    'src/platforms/third/probe.ts',
    'import("../../shared/../ui/App");',
    'local/dependency-boundaries/boundary',
  ],
  ['src/ui/probe.tsx', 'import "../core/overlay";', 'local/dependency-boundaries/boundary'],
  ['src/main.tsx', 'import "./extension/background";', 'local/dependency-boundaries/boundary'],
  ['src/platforms/third/probe.ts', 'import type { Platform } from "../../core/platform";', null],
  ['src/platforms/third/probe.ts', 'import("../../core/sentences");', null],
  ['src/platforms/third/probe.ts', 'import("./captions");', null],
  ['src/core/probe.ts', 'import("../shared/caption-translation");', null],
  [
    'src/extension/queue.ts',
    'import { translate as bypass } from "../shared/api";',
    'no-restricted-imports',
  ],
  [
    'src/extension/queue.ts',
    'import { translate } from "../shared/api.ts";',
    'no-restricted-imports',
  ],
  [
    'src/extension/prefetch.ts',
    'import { translate } from "../shared/api";',
    'no-restricted-imports',
  ],
  ['src/extension/background.ts', 'import { translate } from "../shared/api";', null],
  [
    'src/shared/settings.ts',
    'chrome.storage.local.set({ settings });',
    'local/storage-writers/write',
  ],
  [
    'src/extension/background.ts',
    'chrome.storage.session.set({ settings });',
    'local/storage-writers/write',
  ],
  [
    'src/ui/App.tsx',
    'localStorage.setItem("settings", JSON.stringify(settings));',
    'local/storage-writers/write',
  ],
  [
    'src/core/probe.ts',
    'if (error.message === "译文与原文相同。") show();',
    'local/typed-outcomes/compare',
  ],
  [
    'src/core/probe.ts',
    'const TIMEOUT = "接口调用超时"; if (node.textContent === TIMEOUT) show();',
    'local/typed-outcomes/compare',
  ],
  [
    'src/core/probe.ts',
    'if (node.classList.contains("timeout")) show();',
    'local/typed-outcomes/dom',
  ],
  ['src/core/probe.ts', 'switch (failure.kind) { case "timeout": show(); break; }', null],
  [
    'src/core/overlay.ts',
    'export class SubtitleOverlay { line = ""; }',
    'local/write-only-overlay/state',
  ],
  [
    'src/core/overlay.ts',
    'export class SubtitleOverlay { get state() { return "ready"; } }',
    'local/write-only-overlay/state',
  ],
  [
    'src/core/overlay.ts',
    'export class SubtitleOverlay { current(): string { return ""; } }',
    'local/write-only-overlay/state',
  ],
  ['src/core/probe.ts', 'export const retryDelayMs = 15_000;', 'local/tuning-home/home'],
  ['src/shared/tuning.ts', 'export const retryDelayMs = 15_000;', null],
] as const)('lints %s: %s and reports %s', async (filePath, source, ruleId) => {
  const [result] = await eslint.lintText(source, { filePath });
  expect(
    result.messages.map(({ ruleId, messageId }) =>
      ruleId?.startsWith('local/') ? `${ruleId}/${messageId}` : ruleId,
    ),
  ).toEqual(ruleId ? [ruleId] : []);
});

it.each([
  ['src/shared/provider/probe.ts', 'fetch(url);', 'retries also consume a send slot'],
  ['src/core/probe.ts', 'import "../platforms/youtube/platform";', 'src/core/platform.ts'],
  [
    'src/extension/queue.ts',
    'import { translate } from "../shared/api";',
    'Caption queues must use translateCaptionBatch',
  ],
  ['src/shared/settings.ts', 'chrome.storage.local.set({ settings });', 'saveSettings'],
  ['src/core/probe.ts', 'if (node.classList.contains("timeout")) show();', 'TranslationLine'],
  [
    'src/core/overlay.ts',
    'export class SubtitleOverlay { line = ""; }',
    'SubtitleOverlay only renders',
  ],
  ['src/core/probe.ts', 'export const retryDelayMs = 15_000;', 'src/shared/tuning.ts'],
])('names the fix when %s breaks a rule with %s', async (filePath, source, fix) => {
  const [result] = await eslint.lintText(source, { filePath });
  expect(result.messages).toEqual([
    expect.objectContaining({ message: expect.stringContaining(fix) }),
  ]);
});

it('checks dependency boundaries when ESLint runs from a subdirectory', async () => {
  const root = process.cwd();
  process.chdir('src');
  try {
    const [result] = await new ESLint().lintText('import "../platforms/youtube/platform";', {
      filePath: 'core/probe.ts',
    });
    expect(result.messages).toEqual([
      expect.objectContaining({ ruleId: 'local/dependency-boundaries' }),
    ]);
  } finally {
    process.chdir(root);
  }
});

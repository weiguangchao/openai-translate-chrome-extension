import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const root = realpathSync(mkdtempSync(join(tmpdir(), 'subline-correct-')));
const results = [];
const git = (...args) => execFileSync('git', args, { cwd: repo });
const baseline = git('rev-parse', '774dd06').toString().trim();

function extract(ref, target, paths) {
  execFileSync('tar', ['-xf', '-', '-C', target], {
    input: git('archive', ref, ...paths),
  });
}

function run({ id, source, tests, file, pattern, environment = 'node', url, probe, expected }) {
  const directory = join(root, `${results.length}-${id}`);
  mkdirSync(directory);
  extract(tests ?? source, directory, ['package.json', 'tests', 'public']);
  extract(source, directory, ['src']);
  symlinkSync(join(repo, 'node_modules'), join(directory, 'node_modules'));
  if (probe) writeFileSync(join(directory, 'tests/correct-probe.test.ts'), probe);
  const config = {
    test: {
      environment,
      include: [file],
      ...(url ? { environmentOptions: { jsdom: { url } } } : {}),
    },
  };
  writeFileSync(
    join(directory, 'replay.config.mjs'),
    `export default ${JSON.stringify(config)};\n`,
  );
  const report = join(directory, 'result.json');
  const execution = spawnSync(
    process.execPath,
    [
      join(repo, 'node_modules/vitest/vitest.mjs'),
      'run',
      '--root',
      directory,
      '--config',
      join(directory, 'replay.config.mjs'),
      '--reporter=json',
      '--outputFile',
      report,
      ...(pattern ? ['--testNamePattern', pattern] : []),
    ],
    { cwd: directory, encoding: 'utf8', timeout: 45000, maxBuffer: 8 * 1024 * 1024 },
  );
  if (execution.error) throw execution.error;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(report, 'utf8'));
  } catch {
    throw new Error(`${id}: no test report\n${execution.stdout}\n${execution.stderr}`);
  }
  const assertions = parsed.testResults.flatMap((suite) => suite.assertionResults);
  const failures = assertions.filter((test) => test.status === 'failed');
  const messages = failures.flatMap((test) => test.failureMessages);
  const passed = assertions.filter((test) => test.status === 'passed').length;
  const matched =
    expected === 'pass'
      ? execution.status === 0 && passed > 0 && failures.length === 0
      : execution.status === 1 &&
        failures.length > 0 &&
        messages.every((m) => /AssertionError|expected |promise rejected/.test(m));
  const row = {
    id,
    source: git('rev-parse', source).toString().trim(),
    tests: tests ?? 'audit probe',
    expected,
    passed,
    failed: failures.length,
    matched,
    diagnostics: matched
      ? []
      : [execution.stderr, ...parsed.testResults.map((suite) => suite.message ?? '')],
    failure: messages.map((message) => message.replace(/\u001b\[[0-9;]*m/g, '').split('\n')[0]),
  };
  results.push(row);
  process.stderr.write(
    `${matched ? 'CONFIRMED' : 'UNEXPECTED'} ${id} ${source}: ${passed} passed, ${failures.length} assertion failures\n`,
  );
}

const historical = [
  {
    id: 'translation-cache',
    tests: '6a2922f',
    file: 'tests/queue.test.ts',
    pattern: 'does not cache a failed request, but still serves cached cues',
  },
  {
    id: 'source-cache',
    tests: 'd7a3d88',
    file: 'tests/youtube.test.ts',
    pattern: 'keeps the YouTube source across target/provider/style changes',
    environment: 'jsdom',
    url: 'https://www.youtube.com/watch?v=video-1',
  },
  {
    id: 'caption-segment',
    tests: '477622e',
    file: 'tests/prefetch.test.ts',
    pattern: 'moves a long sentence that does not fit',
    environment: 'jsdom',
    url: 'https://play.max.com/video/watch/episode-1',
  },
  {
    id: 'hbo-sentences',
    tests: '0e4aaaf',
    file: 'tests/hbo.test.ts',
    pattern: 'renders HBO multiline captions as timed sentences',
    environment: 'jsdom',
    url: 'https://play.hbomax.com/video/watch/episode-1',
  },
  {
    id: 'provider-json',
    tests: '7a41406',
    file: 'tests/api.test.ts',
    pattern: 'reads a GLM answer that follows the thinking block',
  },
];

function rateProbe(split) {
  return `import { expect, it, vi } from 'vitest';
import { TranslationQueue } from '../src/extension/queue';
import { DEFAULT_SETTINGS } from '../src/shared/settings';
it('counts physical HTTP attempts, including nested work', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const sends: number[] = [];
  const queue = new TranslationQueue();
  const settings = { ...DEFAULT_SETTINGS, baseUrl: 'https://provider.example/v1', apiKey: 'audit-placeholder', model: 'audit-model' };
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    sends.push(Date.now());
    ${
      split
        ? `const input = JSON.parse(init.body).messages.at(-1).content;
    const content = input.startsWith('[') ? '{"translations":[]}' : '译文';
    return Response.json({ choices: [{ message: { content } }] });`
        : `return new Response('', { status: 400 });`
    }
  }));
  const work = Array.from({ length: 3 }, (_, i) => queue.request(
    'consumer-' + i, settings,
    ${split ? `Array.from({ length: 4 }, (_, j) => String(i) + String(j) + 'a'.repeat(60)).join(', '), true` : `'Caption ' + i`}
  ).catch(() => undefined));
  try {
    await vi.advanceTimersByTimeAsync(0);
    expect(sends.length).toBeGreaterThan(0);
    expect(sends.every((time) => time === 0)).toBe(true);
    expect(sends.length).toBeLessThanOrEqual(3);
  } finally {
    queue.reset();
    await Promise.allSettled(work);
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});`;
}

const parserProbe = `import { expect, it, vi } from 'vitest';
import { translateCaptionBatch } from '../src/shared/api';
import { parseModelJson } from '../src/shared/subtitle-segmentation';
import { DEFAULT_SETTINGS } from '../src/shared/settings';
it('uses the same final payload for parsing and published translations', async () => {
  const draft = { results: [{ id: 0, parts: [{ translation: '草稿' }] }] };
  const final = { results: [{ id: 0, parts: [{ translation: '最终译文' }] }] };
  const content = JSON.stringify(draft) + '\\nFinal:\\n' + JSON.stringify(final);
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ choices: [{ message: { content } }] })));
  try {
    expect(parseModelJson(content)).toEqual(final);
    const seen: unknown[] = [];
    const result = await translateCaptionBatch(
      { ...DEFAULT_SETTINGS, baseUrl: 'https://provider.example/v1', apiKey: 'audit-placeholder', model: 'audit-parser' },
      [{ text: 'Source.', needsSplit: false }], undefined,
      (id, translation) => seen.push([id, translation]),
    );
    expect({ result, seen }).toEqual({ result: ['最终译文'], seen: [[0, '最终译文']] });
  } finally { vi.unstubAllGlobals(); }
});`;

const styleProbe = `import { expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, STORAGE_KEY } from '../src/shared/settings';
it('preserves an in-flight translation when only font size changes', async () => {
  vi.useFakeTimers();
  const saved = { ...DEFAULT_SETTINGS, baseUrl: 'https://provider.example/v1', apiKey: 'audit-placeholder', model: 'audit-style' };
  let listener: Function;
  let changed: Function;
  let activeSignal: AbortSignal;
  let finish: (response: Response) => void;
  vi.stubGlobal('chrome', {
    runtime: { id: 'extension-id', getURL: (path: string) => 'chrome-extension://extension-id/' + path,
      onMessage: { addListener: (fn: Function) => { listener = fn; } } },
    storage: { local: { setAccessLevel: async () => {}, get: async () => ({ [STORAGE_KEY]: saved }) },
      onChanged: { addListener: (fn: Function) => { changed = fn; } } },
    tabs: { query: async () => [], sendMessage: async () => {} },
  });
  const fetch = vi.fn((_url, init) => new Promise<Response>((resolve, reject) => {
    finish = resolve;
    activeSignal = init.signal;
    activeSignal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }));
  vi.stubGlobal('fetch', fetch);
  await import('../src/extension/background');
  const pending = new Promise((reply) => listener(
    { type: 'translate', text: 'Hello.' },
    { id: 'extension-id', url: 'https://www.youtube.com/watch?v=example', frameId: 0, tab: { id: 1 } }, reply,
  ));
  try {
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(activeSignal.aborted).toBe(false);
    changed({ [STORAGE_KEY]: { oldValue: saved, newValue: { ...saved, original: { ...saved.original, size: 36 } } } }, 'local');
    await vi.advanceTimersByTimeAsync(0);
    expect(activeSignal.aborted).toBe(false);
  } finally {
    finish(Response.json({ choices: [{ message: { content: JSON.stringify({ results: [{ id: 0, parts: [{ translation: '你好。' }] }] }) } }] }));
    await pending;
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});`;

try {
  for (const item of historical) {
    run({ ...item, source: `${item.tests}^`, expected: 'fail' });
    run({ ...item, source: item.tests, expected: 'pass' });
  }
  for (const [source, split] of [
    ['162b9bb', true],
    ['9477089', false],
    [baseline, false],
  ]) {
    run({
      id: 'physical-request-budget',
      source,
      file: 'tests/correct-probe.test.ts',
      probe: rateProbe(split),
      expected: 'fail',
    });
  }
  run({
    id: 'single-response-parser',
    source: baseline,
    file: 'tests/correct-probe.test.ts',
    probe: parserProbe,
    expected: 'fail',
  });
  run({
    id: 'style-invalidates-work',
    source: baseline,
    file: 'tests/correct-probe.test.ts',
    probe: styleProbe,
    expected: 'fail',
  });
  const boundaryProbes = [];
  const eslint = new ESLint({ cwd: repo });
  for (const [filePath, code, expectedErrors] of [
    [
      'src/core/audit-probe.ts',
      "import { createHboPlatform } from '../platforms/hbo/platform';\nvoid createHboPlatform;\n",
      1,
    ],
    [
      'src/core/audit-probe.ts',
      "export async function loadPlatform() { return import('../platforms/hbo/platform'); }\n",
      0,
    ],
    [
      'src/platforms/future/audit-probe.ts',
      "import { createHboPlatform } from '../hbo/platform';\nvoid createHboPlatform;\n",
      0,
    ],
  ]) {
    const [result] = await eslint.lintText(code, { filePath: join(repo, filePath) });
    boundaryProbes.push({
      filePath,
      code,
      errors: result.errorCount,
      expectedErrors,
      matched: result.errorCount === expectedErrors,
    });
  }
  process.stdout.write(
    JSON.stringify({ baseline, node: process.version, results, boundaryProbes }, null, 2) + '\n',
  );
  if ([...results, ...boundaryProbes].some((result) => !result.matched)) process.exitCode = 1;
} finally {
  rmSync(root, { recursive: true, force: true });
}

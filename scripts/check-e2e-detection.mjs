import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const broken = await mkdtemp(path.join(tmpdir(), 'subline-broken-'));
const output = path.resolve('.artifacts/e2e-detection');
try {
  await cp('dist', broken, { recursive: true });
  for (const platform of ['youtube', 'hbo'])
    await writeFile(path.join(broken, `${platform}-page.js`), '');
  await mkdir(output, { recursive: true });
  await rm(path.join(output, 'report.json'), { force: true });
  const result = spawnSync(
    process.execPath,
    ['node_modules/@playwright/test/cli.js', 'test', '--grep', 'packaged extension translates'],
    {
      encoding: 'utf8',
      timeout: 90_000,
      env: {
        ...process.env,
        SUBLINE_EXTENSION_PATH: broken,
        SUBLINE_E2E_OUTPUT_DIR: output,
      },
    },
  );
  await writeFile(path.join(output, 'output.log'), result.stdout + result.stderr);
  if (result.error) throw result.error;
  assert.equal(result.status, 1, 'Removing page scripts must fail the same browser tests');
  const report = JSON.parse(await readFile(path.join(output, 'report.json'), 'utf8'));
  const specs = report.suites.flatMap((suite) => suite.specs);
  assert.equal(specs.length, 2, 'Both platform smoke tests must run');
  assert.deepEqual(report.errors, [], 'Runner errors do not prove regression detection');
  for (const spec of specs) {
    assert.equal(spec.tests.length, 1);
    const test = spec.tests[0];
    assert.equal(test.status, 'unexpected');
    assert.equal(test.results.length, 1);
    const result = test.results[0];
    assert.equal(result.status, 'failed');
    assert.ok(
      result.errors.some(
        (error) =>
          error.message?.includes('Source timeline must reach the overlay') &&
          error.message?.includes('toHaveText'),
      ),
      `${spec.title} must fail its source subtitle assertion, not browser startup`,
    );
  }
  console.log(
    'Detection check passed: both platform tests reject missing page scripts at the source subtitle assertion.',
  );
} finally {
  await rm(broken, { recursive: true, force: true });
}

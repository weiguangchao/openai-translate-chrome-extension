import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { domTestProjects } from './test-projects.ts';

await mkdir('.artifacts', { recursive: true });
const experiment = await mkdtemp('.artifacts/discovery-');
try {
  await writeFile(
    path.join(experiment, 'outside.test.ts'),
    'throw new Error("Not a formal test");\n',
  );
  const formal = (await readdir('tests', { recursive: true }))
    .filter((file) => /\.(test|spec)\.([cm]?[jt]s|[jt]sx)$/.test(file))
    .map((file) => path.join('tests', file).split(path.sep).join('/'))
    .sort();
  assert.ok(formal.length, 'No formal tests found in tests/');
  const projects = new Map();
  for (const project of domTestProjects)
    for (const file of project.include) {
      assert.ok(formal.includes(file), `Configured test does not exist: ${file}`);
      assert.ok(!projects.has(file), `Test assigned to more than one environment: ${file}`);
      projects.set(file, project.name);
    }
  const collected = JSON.parse(
    execFileSync(
      process.execPath,
      ['node_modules/vitest/vitest.mjs', 'list', '--filesOnly', '--json'],
      {
        encoding: 'utf8',
      },
    ),
  ).map(({ file, projectName }) => ({
    file: path.relative(process.cwd(), file).split(path.sep).join('/'),
    projectName,
  }));
  assert.deepEqual(
    collected.map(({ file }) => file).sort(),
    formal,
    'Vitest must collect every formal test exactly once, and no experiment or E2E files',
  );
  for (const { file, projectName } of collected)
    assert.equal(projectName, projects.get(file) ?? 'node', `Wrong test environment: ${file}`);
  console.log(
    `Test discovery passed: ${formal.length} files, each in exactly one project; experiments excluded.`,
  );
} finally {
  await rm(experiment, { recursive: true, force: true });
}

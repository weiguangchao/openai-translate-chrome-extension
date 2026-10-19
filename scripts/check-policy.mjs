import { execFileSync } from 'node:child_process';

const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const show = (commit, file) => {
  try {
    return git('show', `${commit}:${file}`);
  } catch {
    return '';
  }
};

const declaredIn = (commit) => {
  try {
    return git('grep', '-h', '-E', '^(export )?const [A-Za-z_]\\w*', commit, '--', 'src');
  } catch {
    return '';
  }
};

const policies = [
  {
    what: 'tuning value',
    file: 'src/shared/tuning.ts',
    before: (commit) => declaredIn(`${commit}^`).matchAll(/^(?:export )?const (\w+)/gm),
    after: (commit) => show(commit, 'src/shared/tuning.ts').matchAll(/^export const (\w+)/gm),
  },
  {
    what: 'caption failure kind',
    file: 'src/shared/provider-error.ts',
    before: (commit) =>
      show(`${commit}^`, 'src/shared/provider-error.ts').matchAll(/kind: '([\w-]+)'/g),
    after: (commit) => show(commit, 'src/shared/provider-error.ts').matchAll(/kind: '([\w-]+)'/g),
  },
  {
    what: 'test runner setting',
    file: 'vite.config.ts',
    before: (commit) => runnerSettings(show(`${commit}^`, 'vite.config.ts')),
    after: (commit) => runnerSettings(show(commit, 'vite.config.ts')),
  },
];

function runnerSettings(text) {
  return text.matchAll(/^\s*((?:testTimeout|hookTimeout|maxWorkers)\s*:.*?),?$/gm);
}

function added(commit) {
  return policies.flatMap(({ what, file, before, after }) => {
    const known = new Set([...before(commit)].map(([, item]) => item));
    return [...new Set([...after(commit)].map(([, item]) => item))]
      .filter((item) => !known.has(item))
      .map((item) => `${what} ${item} in ${file}`);
  });
}

const base = process.argv[2] ?? git('merge-base', 'origin/main', 'HEAD');
const head = process.argv[3] ?? 'HEAD';
const commits = git('rev-list', '--no-merges', `${base}..${head}`).split('\n').filter(Boolean);
const unasked = commits.flatMap((commit) => {
  const additions = added(commit);
  if (!additions.length || /^Requested-by: .+/m.test(git('log', '-1', '--format=%B', commit)))
    return [];
  return [
    `${commit.slice(0, 7)} ${git('log', '-1', '--format=%s', commit)}: ${additions.join('; ')}`,
  ];
});
if (unasked.length) {
  for (const line of unasked) console.error(line);
  console.error(
    'A new tuning value, failure kind or test runner setting needs a "Requested-by: <who asked and where>" line in its commit message. If nobody asked for it, take it out and propose it instead.',
  );
  process.exit(1);
}
console.log(`Policy check passed: ${commits.length} commits since ${base.slice(0, 7)}.`);

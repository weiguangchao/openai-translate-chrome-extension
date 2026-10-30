import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const agents = readFileSync('AGENTS.md', 'utf8');
const documents = [agents, readFileSync('docs/internals/rules.md', 'utf8')].join('\n');
const problems = [];

const headings = new Set(
  [...agents.matchAll(/^#+\s+(.+)$/gm)].map(([, title]) => title.trim().toLowerCase()),
);
const skills = new Set(
  ['.agents/skills', '.claude/skills']
    .filter((folder) => existsSync(folder))
    .flatMap((folder) => readdirSync(folder)),
);
for (const [, name] of agents.matchAll(/\bper ([A-Z][\w ]+?)(?=[.,;)]|$)/gm))
  if (!headings.has(name.trim().toLowerCase()) && !skills.has(name.trim().toLowerCase()))
    problems.push(`"per ${name.trim()}" names no heading in AGENTS.md`);

function files(folder) {
  return readdirSync(folder).flatMap((name) => {
    const entry = path.join(folder, name);
    return statSync(entry).isDirectory() ? files(entry) : [entry];
  });
}
const code = ['src', 'scripts', 'tests', 'e2e', '.github']
  .flatMap(files)
  .concat(['eslint.config.mjs', 'package.json'])
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n');

for (const [, token] of documents.matchAll(/`([^`]+)`/g)) {
  if (/^(src|tests|e2e|scripts|docs|public|\.github|\.agents)\/[\w./-]+$/.test(token)) {
    if (!existsSync(token)) problems.push(`\`${token}\` does not exist`);
  } else if (/^local\/[\w-]+$/.test(token)) {
    if (!code.includes(`'${token.slice('local/'.length)}'`))
      problems.push(`ESLint rule \`${token}\` does not exist`);
  } else if (/^[a-z]+[A-Z]\w*$|^[A-Z][a-z]+[A-Z]\w*$|^[A-Z]+_[A-Z_]+$/.test(token)) {
    if (!new RegExp(`\\b${token}\\b`).test(code)) problems.push(`\`${token}\` is not in the code`);
  }
}

const glossary = agents.split(/^## Glossary\s*$/m)[1]?.split(/^## /m)[0] ?? '';
for (const line of glossary.split('\n'))
  if (/\d/.test(line.replace(/`[^`]*`/g, '')))
    problems.push(`The glossary copies a value; name the constant instead: ${line.trim()}`);

if (problems.length) {
  for (const problem of problems) console.error(problem);
  process.exit(1);
}
console.log(
  'Documentation check passed: project references resolve and the glossary names its constants.',
);

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

const chinese = /[㐀-鿿]/;

function copyIn(file, source) {
  const found = new Set();
  const visit = (node) => {
    const text =
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
        ? node.text
        : ts.isJsxText(node)
          ? node.text.replace(/\s+/g, ' ')
          : '';
    if (chinese.test(text)) found.add(text.trim());
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX));
  return found;
}

const root = process.argv[2] ?? 'src/ui';
const owners = new Map();
for (const file of await readdir(root, { recursive: true })) {
  if (!/\.tsx?$/.test(file) || file === 'copy.ts') continue;
  const where = path.join(root, file);
  for (const text of copyIn(where, await readFile(where, 'utf8')))
    owners.set(text, [...(owners.get(text) ?? []), where]);
}
const repeated = [...owners].filter(([, files]) => files.length > 1);
if (repeated.length) {
  for (const [text, files] of repeated) console.error(`"${text}" appears in ${files.join(', ')}`);
  console.error(
    'Text shown on more than one page belongs in src/ui/copy.ts, so a change reaches every page.',
  );
  process.exit(1);
}
console.log(`UI copy check passed: ${owners.size} strings, none repeated across files.`);

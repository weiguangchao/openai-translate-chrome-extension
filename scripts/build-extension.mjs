import { readFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { renderIcons, toAlphaSvg } from './build-icons.mjs';

const builtAt = new Date();
const buildDate = [
  builtAt.getFullYear(),
  String(builtAt.getMonth() + 1).padStart(2, '0'),
  String(builtAt.getDate()).padStart(2, '0'),
].join('');
const LOCAL_NAME = `Subline · ${buildDate}`;
const alpha = process.argv.includes('--alpha');

await build({
  entryPoints: ['src/extension/background.ts'],
  outfile: 'dist/background.js',
  bundle: true,
  format: 'esm',
  target: 'chrome120',
  minify: true,
});
for (const [entry, output] of [
  ['src/platforms/youtube/page.ts', 'youtube-page.js'],
  ['src/platforms/youtube/content.ts', 'youtube-content.js'],
  ['src/platforms/hbo/page.ts', 'hbo-page.js'],
  ['src/platforms/hbo/content.ts', 'hbo-content.js'],
  ['src/platforms/x/page.ts', 'x-page.js'],
  ['src/platforms/x/content.ts', 'x-content.js'],
])
  await build({
    entryPoints: [entry],
    outfile: `dist/${output}`,
    bundle: true,
    format: 'iife',
    loader: { '.svg': 'text' },
    target: 'chrome120',
    minify: true,
  });

if (alpha) {
  const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
  manifest.name = LOCAL_NAME;
  manifest.action.default_title = LOCAL_NAME;
  await writeFile('dist/manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile('dist/logo.svg', toAlphaSvg(await readFile('public/logo.svg', 'utf8')));
  await renderIcons('dist', toAlphaSvg);
}

console.log(`Chrome extension (${alpha ? LOCAL_NAME : 'store'}) built in dist/`);

import { readFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { renderIcons, toAlphaSvg } from './build-icons.mjs';

const ALPHA_NAME = 'Subline · Alpha';
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
  manifest.name = ALPHA_NAME;
  manifest.action.default_title = ALPHA_NAME;
  await writeFile('dist/manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile('dist/logo.svg', toAlphaSvg(await readFile('public/logo.svg', 'utf8')));
  await renderIcons('dist', toAlphaSvg);
}

console.log(`Chrome extension (${alpha ? ALPHA_NAME : 'store'}) built in dist/`);

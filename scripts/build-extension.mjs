import { build } from 'esbuild';

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
    target: 'chrome120',
    minify: true,
  });

console.log('Chrome extension built in dist/');

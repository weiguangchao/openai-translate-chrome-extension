import { readFile, writeFile } from 'node:fs/promises';
import { Resvg } from '@resvg/resvg-js';

const manifest = JSON.parse(await readFile('public/manifest.json', 'utf8'));

for (const [size, output] of Object.entries(manifest.icons)) {
  const svg = await readFile(`assets/icons/${size}.svg`, 'utf8');
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: Number(size) } }).render().asPng();
  await writeFile(`public/${output}`, png);
}

console.log('Chrome icons rendered from their size-specific SVG sources.');

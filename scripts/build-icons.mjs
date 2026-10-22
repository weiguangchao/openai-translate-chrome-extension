import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const ALPHA_COLORS = [
  ['#9382ED', '#F285B2'],
  ['#6554D9', '#DF528C'],
  ['#5747C4', '#C83E77'],
  ['#E9E4FF', '#FFE4EF'],
];

export function toAlphaSvg(svg) {
  return ALPHA_COLORS.reduce((text, [from, to]) => text.replaceAll(from, to), svg);
}

export async function renderIcons(targetDir = 'public', transform = (svg) => svg) {
  const manifest = JSON.parse(await readFile('public/manifest.json', 'utf8'));
  for (const [size, output] of Object.entries(manifest.icons)) {
    const svg = transform(await readFile(`assets/icons/${size}.svg`, 'utf8'));
    const png = new Resvg(svg, { fitTo: { mode: 'width', value: Number(size) } }).render().asPng();
    await writeFile(`${targetDir}/${output}`, png);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await renderIcons();
  console.log('Chrome icons rendered from their size-specific SVG sources.');
}

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
  const logo = await readFile('public/logo.svg', 'utf8');
  for (const [size, output] of Object.entries(manifest.icons)) {
    const source = size === '128' ? logo : await readFile(`assets/icons/${size}.svg`, 'utf8');
    const svg = transform(source);
    if (/crispEdges|optimizeSpeed/i.test(svg)) {
      throw new Error(`Icon ${size}px must use smooth curve rendering.`);
    }
    const png = new Resvg(svg, { fitTo: { mode: 'width', value: Number(size) } }).render().asPng();
    await writeFile(`${targetDir}/${output}`, png);
  }
  const uiLogo = logo
    .replace('id="letter-s"', 'id="letter-s" transform="translate(-10 0)"')
    .replace('id="letter-b"', 'id="letter-b" transform="translate(10 0)"')
    .replace('id="letter-dot"', 'id="letter-dot" transform="translate(10 0)"');
  await writeFile(`${targetDir}/logo-ui.svg`, transform(uiLogo));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await renderIcons();
  console.log('Chrome icons rendered from their size-specific SVG sources.');
}

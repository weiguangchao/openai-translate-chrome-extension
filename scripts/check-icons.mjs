import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { renderIcons } from './build-icons.mjs';

const output = await mkdtemp(join(tmpdir(), 'subline-icons-'));
try {
  await mkdir(join(output, 'icons'));
  await renderIcons(output);
  for (const size of [16, 32, 48, 128]) {
    const png = await readFile(join(output, 'icons', `${size}.png`));
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
  }
  const uiLogo = join(output, 'logo-ui.svg');
  for (const sample of [
    {
      source: 'assets/icons/16.svg',
      size: 16,
      maxInk: 0,
      gaps: [
        [5, 7, 13],
        [7, 9, 10],
        [8, 9, 10],
        [10, 7, 13],
        [4, 8, 9],
      ],
      cores: [
        [6, 9],
        [9, 9],
        [13, 4],
        [1, 8],
        [4, 10],
        [3, 11],
      ],
    },
    {
      source: uiLogo,
      size: 20,
      maxInk: 38,
      gaps: [
        [6, 8, 16],
        [12, 8, 16],
      ],
      cores: [],
    },
    {
      source: uiLogo,
      size: 24,
      maxInk: 38,
      gaps: [
        [7, 9, 19],
        [15, 9, 19],
      ],
      cores: [],
    },
    {
      source: uiLogo,
      size: 30,
      maxInk: 38,
      gaps: [
        [9, 12, 23],
        [19, 12, 23],
      ],
      cores: [],
    },
    {
      source: uiLogo,
      size: 40,
      maxInk: 38,
      gaps: [
        [12, 16, 31],
        [25, 16, 31],
      ],
      cores: [],
    },
  ]) {
    const svg = (await readFile(sample.source, 'utf8')).replace(/<rect\b[^>]*\/>/, '');
    const pixels = new Resvg(svg, { fitTo: { mode: 'width', value: sample.size } }).render().pixels;
    for (const [x, top, bottom] of sample.gaps) {
      for (let y = top; y < bottom; y++) {
        assert.ok(
          pixels[(y * sample.size + x) * 4 + 3] <= sample.maxInk,
          `${sample.size}px counters and gaps must stay open`,
        );
      }
    }
    for (const [x, y] of sample.cores) {
      assert.equal(
        pixels[(y * sample.size + x) * 4 + 3],
        255,
        `${sample.size}px letters and dot must have opaque cores`,
      );
    }
  }
  for (const mode of ['crispEdges', 'optimizeSpeed']) {
    for (const transform of [
      (svg) => svg.replace('<g ', `<g shape-rendering="${mode}" `),
      (svg) => svg.replace('<g ', `<g style="shape-rendering:${mode}" `),
      (svg) => svg.replace('</svg>', `<style>path{shape-rendering:${mode}}</style></svg>`),
    ]) {
      await assert.rejects(renderIcons(output, transform), /must use smooth curve rendering/);
    }
  }
} finally {
  await rm(output, { recursive: true, force: true });
}

console.log(
  'Icon check passed: dimensions, readable gaps, opaque cores and smooth rendering modes.',
);

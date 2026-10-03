import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

await build({
  entryPoints: ['src/extension/background.ts'],
  outfile: 'dist/background.js',
  bundle: true,
  format: 'esm',
  target: 'chrome120',
  minify: true,
});
await build({
  entryPoints: ['src/extension/youtube-page.ts'],
  outfile: 'dist/youtube-page.js',
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  minify: true,
});
await build({
  entryPoints: ['src/extension/hbo-page.ts'],
  outfile: 'dist/hbo-page.js',
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  minify: true,
});
await build({
  entryPoints: ['src/extension/content.ts'],
  outfile: 'dist/content.js',
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  minify: true,
});

// Package local PNG icons without a native image dependency.
function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ -1) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([size, name, data, crc]);
}
await mkdir('dist/icons', { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const nx = (x / size) * 40,
        ny = (y / size) * 40;
      const top = nx >= 10 && nx < 30 && ny >= 12 && ny < 19;
      const bottom = nx >= 10 && nx < 30 && ny >= 23 && ny < 28;
      const tail = nx >= 10 && nx < 16 && ny >= 19 && ny < 23 - ((nx - 10) * 2) / 3;
      const color = top || tail ? [255, 255, 255] : bottom ? [199, 191, 255] : [101, 84, 217];
      const cornerX = Math.max(0, 9 - nx, nx - 31),
        cornerY = Math.max(0, 9 - ny, ny - 31);
      const offset = y * (size * 4 + 1) + 1 + x * 4;
      raw.set([...color, cornerX * cornerX + cornerY * cornerY <= 81 ? 255 : 0], offset);
    }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  await writeFile(
    `dist/icons/${size}.png`,
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}
console.log('Chrome extension built in dist/');

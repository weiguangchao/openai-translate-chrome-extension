# Icon sources

Each SVG is drawn for its output size. The 16 px artwork uses pixel-aligned letter shapes and disables antialiasing on the letters. The larger sizes keep smooth curves, with letter height and spacing adjusted for their pixel grids.

Edit the matching SVG, then run `npm run build:icons` to regenerate `public/icons`. `npm run build` runs this step before Vite copies the public files into `dist`.

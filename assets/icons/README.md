# Icon sources

`public/logo.svg` keeps the approved D1 drawing and spacing. It is the source of the 128 px icon. The build derives `public/logo-ui.svg` from the same named letter paths, with extra spacing for the player, popup, settings and favicon. The 16, 32 and 48 px SVGs make optical adjustments for small raster icons. All outlines use smooth curves and normal antialiasing.

Edit the main logo or the matching small SVG, then run `npm run build:icons` to regenerate `public/icons` and `public/logo-ui.svg`. `npm run build` also renders the pink local outputs into `dist`. `npm run check` verifies output dimensions, miniature counters and stem cores, UI letter gaps, and rejection of hard-edge modes in attributes and CSS.

Review actual PNGs in both palettes at native resolution. A 16 CSS px toolbar uses the 16 px asset at DPR 1 and the 32 px asset at DPR 2. Capture each display density separately. Also review the UI SVG at 20, 24, 30 and 40 CSS px. Native 16 px counters and gaps retain clear background columns; UI gaps retain a column with at least 85% background coverage at those sampled sizes. Fractional player sizes still require visual review.

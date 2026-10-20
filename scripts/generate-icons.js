import sharp from 'sharp';
import { readFileSync } from 'fs';

// Home Screen / PWA-install icon only — NOT the in-app logo (navbar,
// browser-tab favicon). Those stay exactly as they were, driven by
// live-trak-icon.svg/live-trak-logo-full.svg directly; this script only
// ever writes icon-192.png/icon-512.png, referenced from manifest.json's
// `icons` and index.html's apple-touch-icon.
//
// Full-bleed, no rounding baked into the outer square — iOS applies its
// own corner mask over apple-touch-icon/manifest icons, so a self-rounded
// outer edge gets double-masked. The "floating" look instead comes from
// an inner card (the original blue/green/navy artwork, unchanged) sized
// down and centered with its own drop shadow, sitting on a plain flat
// background that fills the rest of the full-bleed square.
const innerSource = readFileSync('public/live-trak-icon-touch.svg', 'utf8');

const BG = '#15171f'; // mono dark — holds up in both light and dark Home Screen modes
const INNER_SCALE = 0.74; // how much of the square the floating card fills
const CORNER_PCT = 0.22; // card corner radius, as a fraction of its own size

async function buildIcon(canvas, outPath) {
  const k = canvas / 512; // scales every absolute pixel value below to this canvas size

  // Seam shadow (blue/green casting onto navy below it) + the two
  // seam-highlight lines stripped from the original artwork — at the
  // size this icon is actually seen, that thin semi-transparent stroke
  // reads as a stray hairline rather than a clean edge.
  let svg = innerSource
    .replace('<line x1="32" y1="0" x2="32" y2="32" stroke="#ffffff" stroke-width="0.6" opacity="0.35"/>', '')
    .replace('<line x1="0" y1="32" x2="56" y2="32" stroke="#ffffff" stroke-width="0.6" opacity="0.35"/>', '');
  const seamShadow = `
    <defs>
      <linearGradient id="seamShadow" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#000000" stop-opacity="0.2"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <rect x="0" y="32" width="56" height="5.5" fill="url(#seamShadow)"/>
  `;
  svg = svg.replace('<polyline points="5,18', seamShadow + '<polyline points="5,18');

  // Card artwork with the checkmark stripped out entirely — it's drawn
  // separately below, straight at final pixel scale, so its own drop
  // shadow is a real blurred raster shadow rather than baked into the
  // tiny 56-unit source (which would blur at the wrong scale).
  const cardOnlySvg = svg
    .replace('<polyline points="5,18 13,25 27,6" fill="none" stroke="#0b1120" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" opacity="0.45"/>', '')
    .replace('<polyline points="5,18 13,25 27,6" fill="none" stroke="url(#checkGrad)" stroke-width="4.6" stroke-linecap="round" stroke-linejoin="round"/>', '')
    .replace('<line x1="24" y1="9" x2="26" y2="7" stroke="#ffffff" stroke-width="1.1" stroke-linecap="round" opacity="0.85"/>', '');

  const sizePx = Math.round(canvas * INNER_SCALE);
  const r = Math.round(sizePx * CORNER_PCT);
  const left = Math.round((canvas - sizePx) / 2);
  const top = Math.round((canvas - sizePx) / 2);

  const cardRendered = await sharp(Buffer.from(cardOnlySvg)).resize(sizePx, sizePx).png().toBuffer();
  const mask = await sharp(Buffer.from(
    `<svg width="${sizePx}" height="${sizePx}"><rect width="${sizePx}" height="${sizePx}" rx="${r}" fill="#fff"/></svg>`
  )).png().toBuffer();
  const card = await sharp(cardRendered).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();

  // Card's own drop shadow onto the background (the "floating over the
  // background" effect).
  const blur = 14 * k, shadowOpacity = 0.35, offsetY = 10 * k;
  const pad = Math.round(blur * 3);
  const s = sizePx + pad * 2;
  const outerShadowSvg = `<svg width="${s}" height="${s}"><rect x="${pad}" y="${Math.round(pad + offsetY)}" width="${sizePx}" height="${sizePx}" rx="${r}" fill="#000" fill-opacity="${shadowOpacity}"/></svg>`;
  const outerShadow = await sharp(Buffer.from(outerShadowSvg)).blur(blur).png().toBuffer();
  const shadowLeft = Math.round((canvas - s) / 2);
  const shadowTop = Math.round((canvas - s) / 2);

  // Checkmark — scaled from its native 56-unit coordinates into this
  // canvas's pixel space (identical geometry to the original icon), with
  // its own tight, crisp drop shadow onto the blue card beneath it. No
  // dark rim/outline around the white stroke — the shadow alone reads
  // cleanly against the blue without one.
  const scale = sizePx / 56;
  const pts = [[5, 18], [13, 25], [27, 6]].map(([x, y]) => [left + x * scale, top + y * scale]);
  const ptsAttr = pts.map(p => p.join(',')).join(' ');
  const strokeW = 4.6 * scale;

  const checkShadowOffset = 6 * k;
  const checkShadowBlur = 2 * k;
  const shiftedPts = pts.map(([x, y]) => `${x},${y + checkShadowOffset}`).join(' ');
  const checkShadowSvg = `<svg width="${canvas}" height="${canvas}" xmlns="http://www.w3.org/2000/svg">
    <polyline points="${shiftedPts}" fill="none" stroke="#000000" stroke-width="${strokeW * 0.9}" stroke-linecap="round" stroke-linejoin="round" opacity="0.45"/>
  </svg>`;
  const checkShadow = await sharp(Buffer.from(checkShadowSvg)).blur(Math.max(checkShadowBlur, 0.3)).png().toBuffer();

  const checkSolidSvg = `<svg width="${canvas}" height="${canvas}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="g" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="#ffffff"/><stop offset="100%" stop-color="#d7dbea"/></linearGradient></defs>
    <polyline points="${ptsAttr}" fill="none" stroke="url(#g)" stroke-width="${strokeW}" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
  const checkSolid = await sharp(Buffer.from(checkSolidSvg)).png().toBuffer();

  await sharp({ create: { width: canvas, height: canvas, channels: 4, background: BG } })
    .composite([
      { input: outerShadow, left: shadowLeft, top: shadowTop },
      { input: card, left, top },
      { input: checkShadow, left: 0, top: 0 },
      { input: checkSolid, left: 0, top: 0 },
    ])
    .png().toFile(outPath);
}

await buildIcon(192, 'public/icon-192.png');
await buildIcon(512, 'public/icon-512.png');

console.log('Icons generated.');

import sharp from 'sharp';
import { readFileSync } from 'fs';

// Full-bleed, no rounded corners/border — iOS applies its own corner mask
// over apple-touch-icon/manifest icons, so a self-rounded or bordered
// source gets double-masked and crops unevenly. The favicon (live-trak-
// icon.svg, referenced directly in index.html) keeps its own rounding
// since browsers don't apply that kind of mask.
const svg = readFileSync('public/live-trak-icon-touch.svg');

await sharp(svg).resize(192, 192).png().toFile('public/icon-192.png');
await sharp(svg).resize(512, 512).png().toFile('public/icon-512.png');

console.log('Icons generated.');

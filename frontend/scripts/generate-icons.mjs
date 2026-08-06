// Rasterises the PWA PNG icons from public/icons/kiranaos-icon.svg so the
// bitmaps can never drift from the vector mark. Run `pnpm run icons` after
// changing the logo — the SVG is the single source of truth, and
// src/components/shared/BrandMark.tsx carries the same geometry on a 24 grid.
//
// The two "any" icons keep the rounded corners. The maskable icon must NOT:
// Android applies its own mask (circle, squircle, teardrop) and composites the
// icon edge to edge, so rounded corners would expose transparent pixels the
// launcher then fills with its own background. It gets a full-bleed square
// instead, which is exactly what the maskable contract asks for.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "public/icons/kiranaos-icon.svg");

const TARGETS = [
  { file: "public/icons/icon-192.png", size: 192, maskable: false },
  { file: "public/icons/icon-512.png", size: 512, maskable: false },
  { file: "public/icons/maskable-512.png", size: 512, maskable: true },
];

const svg = await readFile(source, "utf8");
const squared = svg.replace(/rx="\d+"/, 'rx="0"');

if (squared === svg) {
  throw new Error(`Expected a rounded-corner rx on the tile in ${source}; the maskable variant would be wrong.`);
}

for (const { file, size, maskable } of TARGETS) {
  const out = path.join(root, file);
  const buffer = await sharp(Buffer.from(maskable ? squared : svg, "utf8"), { density: 512 })
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(out, buffer);
  console.log(`${file}  ${size}x${size}  ${(buffer.length / 1024).toFixed(1)} kB${maskable ? "  (full-bleed square)" : ""}`);
}

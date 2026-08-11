import zlib from "node:zlib";
import { AppError } from "../../middleware/error.js";

/**
 * Razorpay hands back a hosted PNG of the dynamic UPI QR and never the raw
 * `upi://pay?...` string behind it, so a counter printer cannot re-encode the
 * payment itself. To put that exact provider-bound QR on paper we decode the
 * PNG here, recover the module grid, and hand the caller a scale-free matrix.
 * Re-rendering from modules (rather than resampling pixels) keeps every printed
 * module square and crisp at whatever dot pitch the thermal head runs at.
 *
 * Dependency-free on purpose: this runs in the payment path, and a QR that
 * misprints is a customer paying the wrong merchant.
 */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_IMAGE_DIMENSION = 4096;
const CHANNELS_BY_COLOR_TYPE = new Map([[0, 1], [2, 3], [3, 1], [4, 2], [6, 4]]);
const DARK_LUMINANCE_THRESHOLD = 128;
const FINDER_MODULES = 7;

function qrImageError(message) {
  return new AppError(message, 502, "RETAIL_QR_IMAGE_UNREADABLE");
}

/** QR versions 1..40 carry 21..177 modules per side, in steps of four. */
export function isQrModuleCount(value) {
  return Number.isInteger(value) && value >= 21 && value <= 177 && (value - 21) % 4 === 0;
}

function readChunks(buffer) {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) throw qrImageError("Provider QR image is not a PNG");
  let offset = 8;
  let header = null;
  let palette = null;
  const idat = [];
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const start = offset + 8;
    if (start + length > buffer.length) throw qrImageError("Provider QR image is truncated");
    const data = buffer.subarray(start, start + length);
    offset = start + length + 4; // skip the trailing CRC
    if (type === "IHDR") {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === "PLTE") palette = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
  }
  if (!header) throw qrImageError("Provider QR image has no header");
  if (header.interlace !== 0) throw qrImageError("Interlaced provider QR images are not supported");
  if (!CHANNELS_BY_COLOR_TYPE.has(header.colorType)) throw qrImageError("Provider QR image uses an unsupported colour type");
  if (![1, 2, 4, 8, 16].includes(header.bitDepth)) throw qrImageError("Provider QR image uses an unsupported bit depth");
  if (header.colorType === 3 && !palette) throw qrImageError("Provider QR image is missing its palette");
  if (header.width < 1 || header.height < 1 || header.width > MAX_IMAGE_DIMENSION || header.height > MAX_IMAGE_DIMENSION) {
    throw qrImageError("Provider QR image dimensions are out of range");
  }
  if (!idat.length) throw qrImageError("Provider QR image has no pixel data");
  return { header, palette, idat: Buffer.concat(idat) };
}

function paethPredictor(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const distanceLeft = Math.abs(estimate - left);
  const distanceAbove = Math.abs(estimate - above);
  const distanceUpperLeft = Math.abs(estimate - upperLeft);
  if (distanceLeft <= distanceAbove && distanceLeft <= distanceUpperLeft) return left;
  return distanceAbove <= distanceUpperLeft ? above : upperLeft;
}

/** Undo the per-scanline PNG filters in place, returning raw scanline rows. */
function defilter(raw, { width, height, bitDepth, colorType }) {
  const channels = CHANNELS_BY_COLOR_TYPE.get(colorType);
  const bitsPerPixel = channels * bitDepth;
  const bytesPerRow = Math.ceil((bitsPerPixel * width) / 8);
  // Filters operate on whole bytes; sub-byte pixels use a one byte stride.
  const stride = Math.max(1, Math.ceil(bitsPerPixel / 8));
  if (raw.length < (bytesPerRow + 1) * height) throw qrImageError("Provider QR image pixel data is incomplete");
  const rows = [];
  let previous = Buffer.alloc(bytesPerRow);
  for (let y = 0; y < height; y += 1) {
    const offset = y * (bytesPerRow + 1);
    const filter = raw[offset];
    const row = Buffer.from(raw.subarray(offset + 1, offset + 1 + bytesPerRow));
    for (let index = 0; index < bytesPerRow; index += 1) {
      const left = index >= stride ? row[index - stride] : 0;
      const above = previous[index];
      const upperLeft = index >= stride ? previous[index - stride] : 0;
      if (filter === 1) row[index] = (row[index] + left) & 0xff;
      else if (filter === 2) row[index] = (row[index] + above) & 0xff;
      else if (filter === 3) row[index] = (row[index] + ((left + above) >> 1)) & 0xff;
      else if (filter === 4) row[index] = (row[index] + paethPredictor(left, above, upperLeft)) & 0xff;
      else if (filter !== 0) throw qrImageError("Provider QR image uses an unknown scanline filter");
    }
    rows.push(row);
    previous = row;
  }
  return { rows, channels };
}

function sampleReader(row, { bitDepth, channels }) {
  const max = (1 << bitDepth) - 1;
  return (pixelIndex, channel) => {
    const sampleIndex = pixelIndex * channels + channel;
    if (bitDepth === 16) return row.readUInt16BE(sampleIndex * 2) >> 8;
    if (bitDepth === 8) return row[sampleIndex];
    const perByte = 8 / bitDepth;
    const byte = row[Math.floor(sampleIndex / perByte)];
    const shift = 8 - bitDepth * ((sampleIndex % perByte) + 1);
    const value = (byte >> shift) & max;
    return value;
  };
}

/** Composite over white and reduce to "is this pixel dark", the only question a QR asks. */
function darkPixelMatrix(buffer) {
  const { header, palette, idat } = readChunks(buffer);
  let inflated;
  try { inflated = zlib.inflateSync(idat); }
  catch { throw qrImageError("Provider QR image pixel data could not be decompressed"); }
  const { rows, channels } = defilter(inflated, header);
  const { width, height, bitDepth, colorType } = header;
  const max = (1 << bitDepth) - 1;
  const matrix = [];
  for (let y = 0; y < height; y += 1) {
    const read = sampleReader(rows[y], { bitDepth, channels });
    const line = new Uint8Array(width);
    for (let x = 0; x < width; x += 1) {
      let luminance;
      let alpha = 1;
      if (colorType === 3) {
        const index = read(x, 0);
        if ((index + 1) * 3 > palette.length) throw qrImageError("Provider QR image palette index is out of range");
        luminance = 0.299 * palette[index * 3] + 0.587 * palette[index * 3 + 1] + 0.114 * palette[index * 3 + 2];
      } else if (colorType === 0 || colorType === 4) {
        const scale = bitDepth === 16 ? 255 : max;
        luminance = (read(x, 0) / scale) * 255;
        if (colorType === 4) alpha = read(x, 1) / scale;
      } else {
        const scale = bitDepth === 16 ? 255 : max;
        luminance = 0.299 * ((read(x, 0) / scale) * 255) + 0.587 * ((read(x, 1) / scale) * 255) + 0.114 * ((read(x, 2) / scale) * 255);
        if (colorType === 6) alpha = read(x, 3) / scale;
      }
      const overWhite = luminance * alpha + 255 * (1 - alpha);
      line[x] = overWhite < DARK_LUMINANCE_THRESHOLD ? 1 : 0;
    }
    matrix.push(line);
  }
  return { matrix, width, height };
}

function trimQuietZone({ matrix, width, height }) {
  let top = 0, bottom = height - 1, left = 0, right = width - 1;
  const rowIsLight = (y) => !matrix[y].some((value) => value === 1);
  const columnIsLight = (x) => {
    for (let y = top; y <= bottom; y += 1) if (matrix[y][x] === 1) return false;
    return true;
  };
  while (top <= bottom && rowIsLight(top)) top += 1;
  while (bottom > top && rowIsLight(bottom)) bottom -= 1;
  while (left <= right && columnIsLight(left)) left += 1;
  while (right > left && columnIsLight(right)) right -= 1;
  if (top > bottom || left > right) throw qrImageError("Provider QR image is blank");
  return { top, left, size: { width: right - left + 1, height: bottom - top + 1 } };
}

/**
 * Recover the module grid without guessing. The trimmed image starts at the
 * top-left finder pattern, whose top edge is exactly seven dark modules wide,
 * so the first dark run divided by seven is the pixels-per-module scale.
 */
export function extractQrModules(pngBuffer) {
  const image = darkPixelMatrix(pngBuffer);
  const { top, left, size } = trimQuietZone(image);
  if (size.width !== size.height) throw qrImageError("Provider QR image is not square");

  let run = 0;
  while (left + run < image.width && image.matrix[top][left + run] === 1) run += 1;
  if (run < FINDER_MODULES || run % FINDER_MODULES !== 0) throw qrImageError("Provider QR finder pattern is not readable");
  const scale = run / FINDER_MODULES;
  if (size.width % scale !== 0) throw qrImageError("Provider QR modules are not evenly scaled");

  const moduleCount = size.width / scale;
  if (!isQrModuleCount(moduleCount)) throw qrImageError(`Provider QR resolves to ${moduleCount} modules, which is not a valid QR version`);

  const modules = [];
  for (let row = 0; row < moduleCount; row += 1) {
    const line = new Uint8Array(moduleCount);
    // Sample module centres so a stray edge pixel cannot flip a module.
    const y = top + Math.floor(row * scale + scale / 2);
    for (let column = 0; column < moduleCount; column += 1) {
      line[column] = image.matrix[y][left + Math.floor(column * scale + scale / 2)];
    }
    modules.push(line);
  }
  assertFinderPatterns(modules, moduleCount);
  return { moduleCount, modules };
}

/** All three finder patterns must be intact, or we decoded something that is not a QR. */
function assertFinderPatterns(modules, moduleCount) {
  const corners = [[0, 0], [0, moduleCount - FINDER_MODULES], [moduleCount - FINDER_MODULES, 0]];
  for (const [rowOffset, columnOffset] of corners) {
    for (let row = 0; row < FINDER_MODULES; row += 1) {
      for (let column = 0; column < FINDER_MODULES; column += 1) {
        const ring = Math.min(row, column, FINDER_MODULES - 1 - row, FINDER_MODULES - 1 - column);
        const expected = ring === 1 ? 0 : 1;
        if (modules[rowOffset + row][columnOffset + column] !== expected) {
          throw qrImageError("Provider QR finder pattern did not verify");
        }
      }
    }
  }
}

/** Pack the matrix row-major, MSB first — the same bit order an ESC/POS raster expects. */
export function packQrModules({ moduleCount, modules }) {
  const bytesPerRow = Math.ceil(moduleCount / 8);
  const packed = Buffer.alloc(bytesPerRow * moduleCount);
  for (let row = 0; row < moduleCount; row += 1) {
    for (let column = 0; column < moduleCount; column += 1) {
      if (!modules[row][column]) continue;
      packed[row * bytesPerRow + (column >> 3)] |= 0x80 >> (column & 7);
    }
  }
  return packed.toString("base64");
}

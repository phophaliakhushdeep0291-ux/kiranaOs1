import assert from "node:assert/strict";
import zlib from "node:zlib";
import { extractQrModules, isQrModuleCount, packQrModules } from "../src/modules/payment-provider/qr-image.js";

/**
 * Razorpay only ever hands us a rendered PNG, so the printed QR is only as good
 * as this decoder. These examples encode QR-shaped images the way real encoders
 * do — several colour types, bit depths and scanline filters — and prove the
 * exact module grid comes back out.
 */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Build a plausible version-1 QR: three real finder patterns plus arbitrary payload. */
function sampleQrModules(moduleCount = 21) {
  const modules = Array.from({ length: moduleCount }, () => new Uint8Array(moduleCount));
  const paintFinder = (rowOffset, columnOffset) => {
    for (let row = 0; row < 7; row += 1) {
      for (let column = 0; column < 7; column += 1) {
        const ring = Math.min(row, column, 6 - row, 6 - column);
        modules[rowOffset + row][columnOffset + column] = ring === 1 ? 0 : 1;
      }
    }
  };
  // A deterministic but irregular payload in the data region.
  for (let row = 0; row < moduleCount; row += 1) {
    for (let column = 0; column < moduleCount; column += 1) {
      modules[row][column] = (row * 7 + column * 13 + ((row * column) % 5)) % 3 === 0 ? 1 : 0;
    }
  }
  paintFinder(0, 0);
  paintFinder(0, moduleCount - 7);
  paintFinder(moduleCount - 7, 0);
  return { moduleCount, modules };
}

function renderPixels({ moduleCount, modules }, { scale, quietZone }) {
  const size = (moduleCount + quietZone * 2) * scale;
  const dark = Array.from({ length: size }, () => new Uint8Array(size));
  for (let row = 0; row < moduleCount; row += 1) {
    for (let column = 0; column < moduleCount; column += 1) {
      if (!modules[row][column]) continue;
      for (let y = 0; y < scale; y += 1) {
        for (let x = 0; x < scale; x += 1) {
          dark[(row + quietZone) * scale + y][(column + quietZone) * scale + x] = 1;
        }
      }
    }
  }
  return { dark, width: size, height: size };
}

function applyFilter(rows, stride, filter) {
  const filtered = [];
  let previous = Buffer.alloc(rows[0].length);
  for (const row of rows) {
    const out = Buffer.alloc(row.length);
    for (let index = 0; index < row.length; index += 1) {
      const left = index >= stride ? row[index - stride] : 0;
      const above = previous[index];
      const upperLeft = index >= stride ? previous[index - stride] : 0;
      if (filter === 1) out[index] = (row[index] - left) & 0xff;
      else if (filter === 2) out[index] = (row[index] - above) & 0xff;
      else if (filter === 3) out[index] = (row[index] - ((left + above) >> 1)) & 0xff;
      else if (filter === 4) {
        const estimate = left + above - upperLeft;
        const dl = Math.abs(estimate - left), da = Math.abs(estimate - above), du = Math.abs(estimate - upperLeft);
        const predictor = dl <= da && dl <= du ? left : da <= du ? above : upperLeft;
        out[index] = (row[index] - predictor) & 0xff;
      } else out[index] = row[index];
    }
    filtered.push(Buffer.concat([Buffer.from([filter]), out]));
    previous = row;
  }
  return Buffer.concat(filtered);
}

function encodePng({ dark, width, height }, { colorType = 0, bitDepth = 8, filter = 0 } = {}) {
  const size = width;
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    if (colorType === 3 || (colorType === 0 && bitDepth === 1)) {
      const row = Buffer.alloc(Math.ceil(size / 8));
      // Index 0 / value 0 is black, 1 is white, so a dark module clears the bit.
      for (let x = 0; x < size; x += 1) if (!dark[y][x]) row[x >> 3] |= 0x80 >> (x & 7);
      rows.push(row);
      continue;
    }
    const channels = colorType === 2 ? 3 : colorType === 6 ? 4 : colorType === 4 ? 2 : 1;
    const row = Buffer.alloc(size * channels);
    for (let x = 0; x < size; x += 1) {
      const value = dark[y][x] ? 0 : 255;
      for (let channel = 0; channel < channels; channel += 1) row[x * channels + channel] = value;
      if (colorType === 6) row[x * channels + 3] = 255;
      if (colorType === 4) row[x * channels + 1] = 255;
    }
    rows.push(row);
  }
  const channels = colorType === 2 ? 3 : colorType === 6 ? 4 : colorType === 4 ? 2 : 1;
  const stride = Math.max(1, Math.ceil((channels * bitDepth) / 8));
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = bitDepth;
  header[9] = colorType;
  const chunks = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header)];
  // A two-entry palette: black then white, matching the bit convention above.
  if (colorType === 3) chunks.push(chunk("PLTE", Buffer.from([0, 0, 0, 255, 255, 255])));
  chunks.push(chunk("IDAT", zlib.deflateSync(applyFilter(rows, stride, filter))));
  chunks.push(chunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(chunks);
}

function assertMatrixEqual(actual, expected, label) {
  assert.equal(actual.moduleCount, expected.moduleCount, `${label}: module count`);
  for (let row = 0; row < expected.moduleCount; row += 1) {
    assert.deepEqual(Array.from(actual.modules[row]), Array.from(expected.modules[row]), `${label}: row ${row}`);
  }
}

const source = sampleQrModules(21);

// Every colour type and bit depth a QR renderer realistically emits round-trips.
for (const [label, options] of [
  ["8-bit greyscale", { colorType: 0, bitDepth: 8 }],
  ["1-bit greyscale", { colorType: 0, bitDepth: 1 }],
  ["24-bit RGB", { colorType: 2, bitDepth: 8 }],
  ["greyscale + alpha", { colorType: 4, bitDepth: 8 }],
  ["32-bit RGBA", { colorType: 6, bitDepth: 8 }],
  ["palette", { colorType: 3, bitDepth: 1 }],
]) {
  const png = encodePng(renderPixels(source, { scale: 6, quietZone: 4 }), options);
  assertMatrixEqual(extractQrModules(png), source, label);
}

// Every PNG scanline filter defilters correctly.
for (const filter of [0, 1, 2, 3, 4]) {
  const png = encodePng(renderPixels(source, { scale: 5, quietZone: 4 }), { colorType: 2, bitDepth: 8, filter });
  assertMatrixEqual(extractQrModules(png), source, `filter ${filter}`);
}

// Scale and quiet-zone width are recovered rather than assumed.
for (const scale of [1, 3, 8, 12]) {
  for (const quietZone of [0, 2, 4, 9]) {
    const png = encodePng(renderPixels(source, { scale, quietZone }), { colorType: 0, bitDepth: 8 });
    assertMatrixEqual(extractQrModules(png), source, `scale ${scale} quiet ${quietZone}`);
  }
}

// A larger QR version resolves to its own module count, not a rescaled version 1.
const version7 = sampleQrModules(45);
assertMatrixEqual(extractQrModules(encodePng(renderPixels(version7, { scale: 4, quietZone: 4 }), { colorType: 0, bitDepth: 8 })), version7, "version 7");

// Anything that is not a readable QR fails closed rather than printing garbage.
const blank = { dark: Array.from({ length: 60 }, () => new Uint8Array(60)), width: 60, height: 60 };
assert.throws(() => extractQrModules(encodePng(blank, { colorType: 0, bitDepth: 8 })), /blank/i, "a blank image must not print");
assert.throws(() => extractQrModules(Buffer.from("not a png at all")), /not a PNG/i, "a non-PNG must not print");

const noFinder = renderPixels(source, { scale: 6, quietZone: 4 });
for (let y = 24; y < 66; y += 1) for (let x = 24; x < 66; x += 1) noFinder.dark[y][x] = 0;
assert.throws(() => extractQrModules(encodePng(noFinder, { colorType: 0, bitDepth: 8 })), /finder pattern/i, "a broken finder must not print");

// Losing only quiet zone is harmless — the grid is still recoverable.
const trimmedQuietZone = renderPixels(source, { scale: 6, quietZone: 4 });
assertMatrixEqual(
  extractQrModules(encodePng({ dark: trimmedQuietZone.dark.slice(0, trimmedQuietZone.height - 12), width: trimmedQuietZone.width, height: trimmedQuietZone.height - 12 }, { colorType: 0, bitDepth: 8 })),
  source,
  "partial quiet zone",
);

// Losing real modules is not. Cut past the 24px quiet zone into the QR itself.
const clipped = renderPixels(source, { scale: 6, quietZone: 4 });
assert.throws(
  () => extractQrModules(encodePng({ dark: clipped.dark.slice(0, clipped.height - 30), width: clipped.width, height: clipped.height - 30 }, { colorType: 0, bitDepth: 8 })),
  /square/i,
  "a clipped QR must not print",
);

// Module counts follow the QR version table; nothing else is accepted.
assert.equal(isQrModuleCount(21), true);
assert.equal(isQrModuleCount(25), true);
assert.equal(isQrModuleCount(177), true);
assert.equal(isQrModuleCount(24), false);
assert.equal(isQrModuleCount(181), false);

// Packing is MSB-first row-major so the bridge can hand bytes straight to the printer.
const packed = packQrModules({ moduleCount: 8, modules: [
  Uint8Array.from([1, 0, 0, 0, 0, 0, 0, 1]),
  ...Array.from({ length: 7 }, () => new Uint8Array(8)),
] });
assert.equal(Buffer.from(packed, "base64")[0], 0x81, "first row must pack to 0b10000001");
assert.equal(Buffer.from(packed, "base64").length, 8, "one byte per row at eight modules wide");

console.log("retail QR image decoding examples passed");

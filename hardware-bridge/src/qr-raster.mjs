import { formatInrFromPaise } from "./money.mjs";

/**
 * Render a provider-issued UPI QR as an ESC/POS raster.
 *
 * The browser sends a module matrix and an integer amount, never pixels, a URL,
 * or printable text. Every byte that reaches the printer is built here, so a
 * compromised or buggy tab cannot smuggle terminal control sequences onto the
 * counter printer — the same rule the customer display follows.
 */

const MAX_TOTAL_PAISE = 999_999_999_999;
const QUIET_ZONE_MODULES = 4;
// Phone cameras need roughly 0.33mm per module to lock on, which is three dots
// at the 203dpi every counter thermal head runs at. Below that the slip prints
// but nobody can pay from it, so refuse instead.
const MIN_MODULE_SCALE = 3;
const MAX_MODULE_SCALE = 12;
// Printable dots per paper width, matching the character widths in escpos.mjs.
const PAPER_DOTS = new Map([["58mm", 384], ["76mm", 480], ["80mm", 576]]);

function qrPrintError(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function isQrModuleCount(value) {
  return Number.isInteger(value) && value >= 21 && value <= 177 && (value - 21) % 4 === 0;
}

/** Unpack the MSB-first row-major bitset the backend produced from the provider PNG. */
export function decodeQrModules(encoded, moduleCount) {
  if (!isQrModuleCount(moduleCount)) throw qrPrintError("QR module count is not a valid QR version");
  if (typeof encoded !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw qrPrintError("QR modules must be base64");
  const bytesPerRow = Math.ceil(moduleCount / 8);
  const packed = Buffer.from(encoded, "base64");
  if (packed.length !== bytesPerRow * moduleCount) throw qrPrintError("QR module data does not match the declared size");
  const modules = [];
  for (let row = 0; row < moduleCount; row += 1) {
    const line = new Uint8Array(moduleCount);
    for (let column = 0; column < moduleCount; column += 1) {
      line[column] = (packed[row * bytesPerRow + (column >> 3)] >> (7 - (column & 7))) & 1;
    }
    modules.push(line);
  }
  return modules;
}

export function resolveModuleScale(moduleCount, paperSize) {
  const dots = PAPER_DOTS.get(paperSize) ?? PAPER_DOTS.get("80mm");
  const scale = Math.floor(dots / (moduleCount + QUIET_ZONE_MODULES * 2));
  if (scale < MIN_MODULE_SCALE) throw qrPrintError("This QR is too dense to print legibly on the configured paper width");
  return Math.min(MAX_MODULE_SCALE, scale);
}

/** GS v 0 — raster bit image, one bit per dot, MSB first, row major. */
function rasterCommand(modules, moduleCount, scale) {
  const side = (moduleCount + QUIET_ZONE_MODULES * 2) * scale;
  const bytesPerRow = Math.ceil(side / 8);
  const bitmap = Buffer.alloc(bytesPerRow * side);
  for (let row = 0; row < moduleCount; row += 1) {
    for (let column = 0; column < moduleCount; column += 1) {
      if (!modules[row][column]) continue;
      const originX = (column + QUIET_ZONE_MODULES) * scale;
      const originY = (row + QUIET_ZONE_MODULES) * scale;
      for (let y = 0; y < scale; y += 1) {
        const rowStart = (originY + y) * bytesPerRow;
        for (let x = 0; x < scale; x += 1) {
          const dotX = originX + x;
          bitmap[rowStart + (dotX >> 3)] |= 0x80 >> (dotX & 7);
        }
      }
    }
  }
  const header = Buffer.from([0x1d, 0x76, 0x30, 0x00, bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff, side & 0xff, (side >> 8) & 0xff]);
  return Buffer.concat([header, bitmap]);
}

export function buildQrPaymentSlip({ moduleCount, modules, amountPaise, paperSize = "80mm", reference = "" }) {
  const totalPaise = Number(amountPaise);
  if (!Number.isSafeInteger(totalPaise) || totalPaise <= 0 || totalPaise > MAX_TOTAL_PAISE) throw qrPrintError("QR slip amount is invalid");
  const grid = decodeQrModules(modules, moduleCount);
  const scale = resolveModuleScale(moduleCount, paperSize);
  // The reference is provider-issued and echoed only so a shopkeeper can match a
  // slip to an intent; anything outside a safe id charset is dropped, not printed.
  const safeReference = String(reference || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);

  return Buffer.concat([
    Buffer.from([0x1b, 0x40]),          // initialise
    Buffer.from([0x1b, 0x61, 0x01]),    // centre everything on this slip
    Buffer.from("SCAN TO PAY\n", "ascii"),
    Buffer.from(`${formatInrFromPaise(totalPaise)}\n\n`, "ascii"),
    rasterCommand(grid, moduleCount, scale),
    Buffer.from("\nScan with any UPI app\n", "ascii"),
    Buffer.from("Not a receipt - no sale recorded\n", "ascii"),
    ...(safeReference ? [Buffer.from(`Ref ${safeReference}\n`, "ascii")] : []),
    Buffer.from("\n\n\n", "ascii"),
    Buffer.from([0x1b, 0x61, 0x00]),    // restore left alignment for receipts
    Buffer.from([0x1d, 0x56, 0x00]),    // cut
  ]);
}

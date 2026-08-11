import test from "node:test";
import assert from "node:assert/strict";
import { buildQrPaymentSlip, decodeQrModules, resolveModuleScale } from "../src/qr-raster.mjs";

function packedSample(moduleCount = 21, fill = (row, column) => (row + column) % 2) {
  const bytesPerRow = Math.ceil(moduleCount / 8);
  const packed = Buffer.alloc(bytesPerRow * moduleCount);
  for (let row = 0; row < moduleCount; row += 1) {
    for (let column = 0; column < moduleCount; column += 1) {
      if (fill(row, column)) packed[row * bytesPerRow + (column >> 3)] |= 0x80 >> (column & 7);
    }
  }
  return packed.toString("base64");
}

test("module matrices round-trip through the packed wire format", () => {
  const modules = decodeQrModules(packedSample(21), 21);
  assert.equal(modules.length, 21);
  for (let row = 0; row < 21; row += 1) {
    for (let column = 0; column < 21; column += 1) {
      assert.equal(modules[row][column], (row + column) % 2, `module ${row},${column}`);
    }
  }
});

test("a payment QR is refused rather than printed wrong", () => {
  // Size, charset and length are all checked before a byte reaches the printer.
  assert.throws(() => decodeQrModules(packedSample(21), 24), /valid QR version/i);
  assert.throws(() => decodeQrModules("not*base64", 21), /base64/i);
  assert.throws(() => decodeQrModules(packedSample(25), 21), /does not match the declared size/i);
  assert.throws(() => buildQrPaymentSlip({ moduleCount: 21, modules: packedSample(21), amountPaise: 0 }), /amount/i);
  assert.throws(() => buildQrPaymentSlip({ moduleCount: 21, modules: packedSample(21), amountPaise: 12.5 }), /amount/i);
  assert.throws(() => buildQrPaymentSlip({ moduleCount: 21, modules: packedSample(21), amountPaise: -100 }), /amount/i);
  // The densest QR versions cannot reach a scannable dot pitch on 58mm paper.
  assert.throws(() => resolveModuleScale(177, "58mm"), /too dense/i);
  assert.equal(resolveModuleScale(177, "80mm"), 3, "the same QR still prints on a wide roll");
});

test("module scale fills the paper without overrunning it", () => {
  for (const [paperSize, dots] of [["58mm", 384], ["76mm", 480], ["80mm", 576]]) {
    for (const moduleCount of [21, 45, 77]) {
      const scale = resolveModuleScale(moduleCount, paperSize);
      assert.ok((moduleCount + 8) * scale <= dots, `${moduleCount} modules must fit ${paperSize}`);
      assert.ok(scale >= 3, `${moduleCount} modules on ${paperSize} must stay scannable`);
    }
  }
  // An unknown paper size falls back to the widest rather than overflowing a narrow roll.
  assert.equal(resolveModuleScale(21, "unknown"), resolveModuleScale(21, "80mm"));
});

test("the slip is a raster the printer can render, with a quiet zone", () => {
  const moduleCount = 21;
  const slip = buildQrPaymentSlip({ moduleCount, modules: packedSample(moduleCount), amountPaise: 12_345, paperSize: "80mm" });
  const scale = resolveModuleScale(moduleCount, "80mm");
  const side = (moduleCount + 8) * scale;
  const bytesPerRow = Math.ceil(side / 8);

  const rasterHeader = Buffer.from([0x1d, 0x76, 0x30, 0x00, bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff, side & 0xff, (side >> 8) & 0xff]);
  const start = slip.indexOf(rasterHeader);
  assert.ok(start >= 0, "slip must contain a GS v 0 raster with the computed dimensions");
  assert.equal(slip.length >= start + rasterHeader.length + bytesPerRow * side, true, "raster payload must be complete");

  // The four-module quiet zone must be blank or no scanner will find the QR.
  const bitmap = slip.subarray(start + rasterHeader.length);
  for (let y = 0; y < 4 * scale; y += 1) {
    for (let x = 0; x < bytesPerRow; x += 1) assert.equal(bitmap[y * bytesPerRow + x], 0, `quiet zone row ${y}`);
  }

  assert.ok(slip.includes(Buffer.from("SCAN TO PAY", "ascii")), "the customer must be told what to do");
  assert.ok(slip.includes(Buffer.from("INR 123.45", "ascii")), "the amount is rendered from integer paise");
  assert.ok(slip.includes(Buffer.from("Not a receipt - no sale recorded", "ascii")), "a payment slip must not read as a bill");
  assert.deepEqual(Array.from(slip.subarray(0, 2)), [0x1b, 0x40], "slip must initialise the printer");
  assert.deepEqual(Array.from(slip.subarray(slip.length - 3)), [0x1d, 0x56, 0x00], "slip must cut");
});

test("dark modules land where the matrix says, offset by the quiet zone", () => {
  // A single dark module at 0,0 must produce dots only in that module's square.
  const moduleCount = 21;
  const modules = packedSample(moduleCount, (row, column) => (row === 0 && column === 0 ? 1 : 0));
  const slip = buildQrPaymentSlip({ moduleCount, modules, amountPaise: 100, paperSize: "80mm" });
  const scale = resolveModuleScale(moduleCount, "80mm");
  const side = (moduleCount + 8) * scale;
  const bytesPerRow = Math.ceil(side / 8);
  const header = Buffer.from([0x1d, 0x76, 0x30, 0x00, bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff, side & 0xff, (side >> 8) & 0xff]);
  const bitmap = slip.subarray(slip.indexOf(header) + header.length);

  const isDark = (x, y) => (bitmap[y * bytesPerRow + (x >> 3)] >> (7 - (x & 7))) & 1;
  const originX = 4 * scale;
  const originY = 4 * scale;
  assert.equal(isDark(originX, originY), 1, "the module must start at the quiet-zone offset");
  assert.equal(isDark(originX + scale - 1, originY + scale - 1), 1, "the module must be scale dots wide");
  assert.equal(isDark(originX + scale, originY), 0, "the next module must stay light");
  assert.equal(isDark(originX - 1, originY), 0, "the quiet zone must stay light");
});

test("a provider reference is echoed only from a safe id charset", () => {
  const slip = buildQrPaymentSlip({ moduleCount: 21, modules: packedSample(21), amountPaise: 100, reference: "qr_ABC-123" });
  assert.ok(slip.includes(Buffer.from("Ref qr_ABC-123", "ascii")));

  // Anything a tab could use to steer the printer is stripped, not printed.
  const hostile = buildQrPaymentSlip({ moduleCount: 21, modules: packedSample(21), amountPaise: 100, reference: "|1C\nTOTAL PAID" });
  assert.equal(hostile.includes(Buffer.from("TOTAL PAID", "ascii")), false, "injected text must not reach the printer");
  assert.ok(slip.includes(Buffer.from("Ref ", "ascii")));
  assert.equal(hostile.includes(Buffer.from("|1C", "ascii")), false, "escape sequences must not survive");
});

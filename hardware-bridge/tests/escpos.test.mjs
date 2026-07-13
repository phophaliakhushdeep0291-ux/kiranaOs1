import test from "node:test";
import assert from "node:assert/strict";
import { buildDrawerPulse, buildEscPosJob, htmlToReceiptText } from "../src/escpos.mjs";

test("converts receipt HTML to bounded plain text without scripts", () => {
  const text = htmlToReceiptText("<style>.x{}</style><h1>Shop &amp; Sons</h1><p>Very long product description for wrapping safely</p><script>alert(1)</script>", 24);
  assert.match(text, /Shop & Sons/);
  assert.doesNotMatch(text, /alert|\.x/);
  assert.equal(text.split("\n").every((line) => line.length <= 24), true);
});

test("builds ESC/POS initialize, drawer, and cut commands", () => {
  const job = buildEscPosJob({ html: "<p>Receipt</p>", paperSize: "80mm", cashDrawer: true, autoCut: true });
  assert.deepEqual([...job.subarray(0, 2)], [0x1b, 0x40]);
  assert.equal(job.includes(Buffer.from([0x1b, 0x70, 0x00])), true);
  assert.deepEqual([...job.subarray(-3)], [0x1d, 0x56, 0x00]);
  assert.deepEqual([...buildDrawerPulse().subarray(-5)], [0x1b, 0x70, 0x00, 0x19, 0xfa]);
});

import test from "node:test";
import assert from "node:assert/strict";
import { buildDrawerPulse, buildEscPosJob, htmlToReceiptText } from "../src/escpos.mjs";
import { plainHardwareError } from "../src/plain-errors.mjs";

test("converts receipt HTML to bounded plain text without scripts", () => {
  const text = htmlToReceiptText("<style>.x{}</style><h1>Shop &amp; Sons</h1><p>Very long product description for wrapping safely</p><div class=\"actions\"><button>Print / Save PDF</button></div><script>alert(1)</script>", 24);
  assert.match(text, /Shop & Sons/);
  assert.doesNotMatch(text, /alert|\.x|Print \/ Save PDF/);
  assert.equal(text.split("\n").every((line) => line.length <= 24), true);
});

test("builds ESC/POS initialize, drawer, and cut commands", () => {
  const job = buildEscPosJob({ html: "<p>Receipt</p>", paperSize: "80mm", cashDrawer: true, autoCut: true });
  assert.deepEqual([...job.subarray(0, 2)], [0x1b, 0x40]);
  assert.equal(job.includes(Buffer.from([0x1b, 0x70, 0x00])), true);
  assert.deepEqual([...job.subarray(-3)], [0x1d, 0x56, 0x00]);
  assert.deepEqual([...buildDrawerPulse().subarray(-5)], [0x1b, 0x70, 0x00, 0x19, 0xfa]);
});

test("turns idempotency conflicts into safe operator instructions", () => {
  assert.match(plainHardwareError(new Error("Print job id was already used for a different receipt payload")), /inspect the printer/i);
  assert.match(plainHardwareError(new Error("Print job predates payload verification")), /older bridge version/i);
  assert.match(plainHardwareError(new Error("Too many unfinished print jobs")), /printing is paused/i);
});

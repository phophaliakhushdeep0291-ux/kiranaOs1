// Round-off (nearest-rupee) proof for the deterministic assurance rules.
//
// The counter can round a bill's grand total to the nearest rupee (the shop's
// Taxes -> "Round off" setting). The server folds that into its authoritative
// grandTotal so payments reconcile. This test guards the one rule that recomputes
// the total from line items — BILL_TOTAL_MISMATCH — so a legitimately rounded bill
// is NOT flagged as a critical reconciliation finding, while a real mismatch still is.
import assert from "node:assert/strict";
import { billingRules } from "../src/modules/assurance/rules/billing.rules.js";

function rule(code) {
  const found = billingRules.find((candidate) => candidate.ruleCode === code);
  assert.ok(found, `Missing assurance rule ${code}`);
  return found;
}

const totalMismatch = rule("BILL_TOTAL_MISMATCH");
const paidExceeds = rule("BILL_PAID_EXCEEDS_TOTAL");

// ── A ₹247.60 bill rounded up to ₹248 is legitimate, not a discrepancy ──
const roundedUp = {
  id: "bill-round-up",
  billType: "normal_sale",
  gstMode: "inclusive",
  items: [{ lineTotal: 247.6 }],
  discount: 0,
  loyaltyDiscount: 0,
  gst: 0,
  grandTotal: 248,
  paidAmount: 248,
  payments: [{ amount: 248, status: "confirmed" }],
};
assert.equal(
  totalMismatch.evaluate({ bill: roundedUp }),
  null,
  "a bill rounded to the nearest rupee must not trip BILL_TOTAL_MISMATCH",
);
assert.equal(
  paidExceeds.evaluate({ bill: roundedUp }),
  null,
  "a cash tender equal to the rounded total is not an overpayment",
);

// ── A ₹247.30 bill rounded down to ₹247 is equally legitimate ──
const roundedDown = { ...roundedUp, id: "bill-round-down", items: [{ lineTotal: 247.3 }], grandTotal: 247, paidAmount: 247, payments: [{ amount: 247, status: "confirmed" }] };
assert.equal(
  totalMismatch.evaluate({ bill: roundedDown }),
  null,
  "a bill rounded down to the nearest rupee must not trip BILL_TOTAL_MISMATCH",
);

// ── But a total off by more than the rounding band is still a real finding ──
const tampered = { ...roundedUp, id: "bill-tampered", grandTotal: 250 };
const verdict = totalMismatch.evaluate({ bill: tampered });
assert.equal(verdict?.triggered, true, "a grand total ₹2.40 above the line items must still be flagged");
assert.equal(verdict.details.storedGrandTotal, 250, "the finding must record the stored total");
assert.equal(verdict.details.expectedGrandTotal, 247.6, "the finding must record the recomputed total");

// ── The version bump is what forces prior findings to be re-evaluated ──
assert.equal(totalMismatch.version >= 3, true, "BILL_TOTAL_MISMATCH must be re-versioned so stale findings re-evaluate");

console.log("round-off.examples.js: all assertions passed");

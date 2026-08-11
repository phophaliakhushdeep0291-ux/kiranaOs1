import test from "node:test";
import assert from "node:assert/strict";
import { buildCustomerDisplayFrame, normalizeDisplayWidth } from "../src/customer-display.mjs";

test("customer display frames preserve integer paise and trusted text", () => {
  assert.deepEqual(buildCustomerDisplayFrame({ revision: 7, state: "sale", itemCount: 3, totalPaise: 12_345 }), {
    revision: 7,
    state: "sale",
    itemCount: 3,
    totalPaise: 12_345,
    width: 20,
    lines: ["3 ITEMS", "TOTAL INR 123.45"],
  });
  assert.deepEqual(buildCustomerDisplayFrame({ revision: 8, state: "paid", itemCount: 3, totalPaise: 12_345 }).lines, ["PAYMENT RECEIVED", "INR 123.45"]);
  assert.deepEqual(buildCustomerDisplayFrame({ revision: 9, state: "idle", itemCount: 0, totalPaise: 0 }).lines, ["WELCOME", "READY"]);
});

test("awaiting payment shows the customer what to scan and for how much", () => {
  assert.deepEqual(buildCustomerDisplayFrame({ revision: 11, state: "awaiting_payment", itemCount: 3, totalPaise: 12_345 }), {
    revision: 11,
    state: "awaiting_payment",
    itemCount: 3,
    totalPaise: 12_345,
    width: 20,
    lines: ["SCAN TO PAY", "INR 123.45"],
  });
  // The narrowest supported display still fits the prompt, unlike "PAYMENT RECEIVED".
  assert.deepEqual(
    buildCustomerDisplayFrame({ revision: 12, state: "awaiting_payment", itemCount: 1, totalPaise: 100 }, { width: 12 }).lines,
    ["SCAN TO PAY", "INR 1.00"],
  );
});

test("customer display rejects unsafe, ambiguous, or unrepresentable state", () => {
  assert.throws(() => buildCustomerDisplayFrame({ revision: -1, state: "sale", itemCount: 1, totalPaise: 100 }), /revision/i);
  assert.throws(() => buildCustomerDisplayFrame({ revision: 1, state: "sale", itemCount: 1.5, totalPaise: 100 }), /item count/i);
  assert.throws(() => buildCustomerDisplayFrame({ revision: 1, state: "sale", itemCount: 1, totalPaise: 10.5 }), /total/i);
  assert.throws(() => buildCustomerDisplayFrame({ revision: 1, state: "unknown", itemCount: 1, totalPaise: 100 }), /state/i);
  assert.throws(() => buildCustomerDisplayFrame({ revision: 1, state: "paid", itemCount: 1, totalPaise: 100 }, { width: 12 }), /exceeds/i);
  assert.equal(normalizeDisplayWidth(1), 12);
  assert.equal(normalizeDisplayWidth(500), 80);
});

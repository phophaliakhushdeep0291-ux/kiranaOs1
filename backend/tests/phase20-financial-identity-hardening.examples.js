import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { confirmBillSchema } from "../src/modules/bills/bills.schema.js";
import { createProductSchema } from "../src/modules/products/products.schema.js";
import { purchaseSchema, correctionSchema } from "../src/modules/inventory/inventory.schema.js";
import { udharPaymentSchema } from "../src/modules/customers/customers.schema.js";
import { manualPaymentSchema } from "../src/modules/payment-provider/paymentProvider.schemas.js";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const baseBill = {
  billType: "normal_sale",
  customerName: "Walk-in",
  items: [{ name: "Rice", quantity: 1, enteredUnit: "kg", ratePerRateUnit: 10, gstRate: 0 }],
  payments: [{ mode: "cash", amount: 10 }],
};

assert.equal(confirmBillSchema.safeParse(baseBill).success, true, "valid bill payload should parse");
assert.equal(
  confirmBillSchema.safeParse({ ...baseBill, payments: [{ mode: "cash", amount: 10.123 }] }).success,
  false,
  "bill payment money must reject more than 2 decimals"
);
assert.equal(
  confirmBillSchema.safeParse({ ...baseBill, items: [{ ...baseBill.items[0], ratePerRateUnit: Number.POSITIVE_INFINITY }] }).success,
  false,
  "bill item money must reject Infinity"
);
assert.equal(
  confirmBillSchema.safeParse({ ...baseBill, items: [{ ...baseBill.items[0], quantity: 1.1234 }] }).success,
  false,
  "bill quantity must reject excessive decimal precision"
);

assert.equal(
  createProductSchema.safeParse({ name: "Sugar", defaultPricePerRateUnit: 42.5, stockBaseQty: 10.25 }).success,
  true,
  "valid product money/quantity payload should parse"
);
assert.equal(
  createProductSchema.safeParse({ name: "Sugar", defaultPricePerRateUnit: 42.555 }).success,
  false,
  "product price must reject more than 2 decimals"
);
assert.equal(
  purchaseSchema.safeParse({ productId: "p1", quantity: 5, enteredUnit: "kg", billAmount: 999.999 }).success,
  false,
  "purchase bill amount must reject more than 2 decimals"
);
assert.equal(
  correctionSchema.safeParse({ productId: "p1", newStockBaseQty: 12.1234 }).success,
  false,
  "stock correction quantity must reject excessive precision"
);
assert.equal(
  udharPaymentSchema.safeParse({ amount: 100.12, mode: "upi" }).success,
  true,
  "valid udhar payment should parse"
);
assert.equal(
  udharPaymentSchema.safeParse({ amount: 100.123, mode: "upi" }).success,
  false,
  "udhar payment money must reject more than 2 decimals"
);
assert.equal(
  manualPaymentSchema.safeParse({ planCode: "growth", amountPaise: "49900" }).success,
  true,
  "manual payment paise input may be coerced to integer"
);
assert.equal(
  manualPaymentSchema.safeParse({ planCode: "growth", amountPaise: "499.50" }).success,
  false,
  "manual payment paise must be integer paise"
);

const validationSchemas = read("src/utils/validationSchemas.js");
for (const helper of ["moneyAmount", "percentageRate", "quantityAmount", "paiseAmount"]) {
  assert.match(validationSchemas, new RegExp(`export function ${helper}\\b`), `${helper} must be exported`);
}
assert.match(validationSchemas, /Money amount must have at most 2 decimal places/, "money validation must enforce paise precision");
assert.match(validationSchemas, /z\.number\(\)\.finite\(\)/, "validation helpers must reject NaN/Infinity");

const customersService = read("src/modules/customers/customers.service.js");
assert.match(
  customersService,
  /calculateCustomerUdharBalance\(tx, shopId, customerId\)/,
  "manual udhar payment must derive outstanding balance from ledger"
);
assert.match(
  customersService,
  /toPaise\(currentBalance\.balance\) < toPaise\(paymentAmount\)/,
  "manual udhar payment must reject payments above ledger-derived outstanding"
);
assert.match(customersService, /UDHAR_PAYMENT_EXCEEDS_OUTSTANDING/, "manual udhar payment overpay must have explicit error code");
assert.match(customersService, /idempotentReplay: true/, "manual udhar payment retry must replay existing ledger entry safely");
assert.match(customersService, /\$\{prefix\}:\$\{clientLedgerId\}/, "manual udhar payment must derive idempotency from client ledger id even without device id");
assert.match(customersService, /NOT: \{ id \}/, "customer update must reject duplicate active mobile except self");
assert.match(customersService, /data: \{ mobile: null \}/, "soft-deleted customer mobile should be cleared for reuse compatibility");

const syncService = read("src/modules/sync/sync.service.js");
assert.match(syncService, /function getUdharPaymentLocalReference/, "udhar payment sync must echo the local ledger identity for frontend reconciliation");
assert.match(syncService, /udhar-payment:\$\{clientLedgerId\}/, "udhar payment sync must derive a stable idempotency key from the client ledger id");
assert.match(syncService, /payload\.clientPaymentId/, "udhar payment sync must recognize legacy payment ids as identity fallbacks");

const productsService = read("src/modules/products/products.service.js");
assert.match(productsService, /assertNoActiveProductNameConflict\(shopId, data\.name\)/, "product create must check duplicate names");
assert.match(productsService, /assertNoActiveProductNameConflict\(shopId, data\.name, id\)/, "product update must check duplicate names except self");
assert.match(productsService, /PRODUCT_NAME_DUPLICATE/, "product duplicate guard must expose a clear error code");
assert.match(productsService, /normalizeProductName/, "product duplicate guard must normalize names");

const tasks = read("docs/PRODUCTION_HARDENING_TASKS.md");
for (const phase of ["Phase 20A", "Phase 20B", "Phase 20C"]) {
  assert.match(tasks, new RegExp(phase), `hardening task docs must include ${phase}`);
}

console.log("Phase 20 financial and identity hardening examples passed");

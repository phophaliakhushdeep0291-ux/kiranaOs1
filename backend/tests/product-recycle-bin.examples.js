import assert from "node:assert/strict";
import {
  getProductPermanentDeleteBlockReason,
  hasActiveDuplicateProductName,
  normalizeProductName,
} from "../src/utils/productRecycleRules.js";

assert.equal(normalizeProductName("  Sugar   Premium  "), "sugar premium");

assert.equal(
  hasActiveDuplicateProductName(
    { id: "deleted-1", name: "Sugar" },
    [
      { id: "active-1", name: "salt" },
      { id: "active-2", name: "  SUGAR  " },
    ]
  ),
  true,
  "restore should be blocked when an active product with the same name exists"
);

assert.equal(
  hasActiveDuplicateProductName(
    { id: "deleted-1", name: "Sugar" },
    [{ id: "active-1", name: "salt" }]
  ),
  false,
  "restore should be allowed when no active duplicate exists"
);

assert.equal(
  getProductPermanentDeleteBlockReason({ stockLedgerCount: 1, purchaseHistoryCount: 0 }),
  "Product has stock ledger history",
  "hard delete should be blocked when stock ledger history exists"
);

assert.equal(
  getProductPermanentDeleteBlockReason({ stockLedgerCount: 0, purchaseHistoryCount: 1 }),
  "Product has purchase history",
  "hard delete should be blocked when purchase history exists"
);

assert.equal(
  getProductPermanentDeleteBlockReason({ stockLedgerCount: 0, purchaseHistoryCount: 0 }),
  null,
  "hard delete should be allowed when no required audit/history relation exists"
);

console.log("Product recycle bin examples passed");

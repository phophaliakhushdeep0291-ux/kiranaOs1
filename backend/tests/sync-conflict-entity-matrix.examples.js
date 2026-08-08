import assert from "node:assert/strict";
import { conflictEntityFromEvent } from "../src/modules/sync/sync.service.js";

const cases = [
  ["UPDATE_PRODUCT", { productId: "product-1" }, "product", "product-1"],
  ["UPDATE_CUSTOMER", { customerId: "customer-1" }, "customer", "customer-1"],
  ["UPDATE_SUPPLIER", { supplierId: "supplier-1" }, "supplier", "supplier-1"],
  ["CREATE_BILL", { billId: "bill-1" }, "bill", "bill-1"],
  ["CANCEL_BILL", { localBillId: "bill-local" }, "bill", "bill-local"],
  ["UDHAR_PAYMENT", { customerId: "customer-2", paymentId: "payment-1" }, "udhar", "payment-1"],
  ["REVERSE_UDHAR_PAYMENT", { customerId: "customer-3", ledgerEntryId: "ledger-1" }, "udhar", "ledger-1"],
  ["CREATE_LEDGER_ADJUSTMENT", { customerId: "customer-4", ledgerEntryId: "ledger-2" }, "udhar", "ledger-2"],
  ["RECORD_SUPPLIER_PAYMENT", { paymentId: "supplier-payment-1", supplierId: "supplier-2" }, "payment", "supplier-payment-1"],
  ["STOCK_PURCHASE", { purchaseHistoryId: "purchase-1", productId: "product-2" }, "purchase", "purchase-1"],
  ["UPDATE_PURCHASE_BILL", { localPurchaseHistoryId: "purchase-local" }, "purchase", "purchase-local"],
  ["ADJUST_STOCK", { inventoryMovementId: "movement-1", productId: "product-3" }, "stock_ledger", "movement-1"],
];

for (const [type, payload, expectedType, expectedId] of cases) {
  assert.deepEqual(
    conflictEntityFromEvent({ type, payload }),
    { entityType: expectedType, entityId: expectedId },
    `${type} must have the correct conflict policy and record identity`,
  );
}

console.log("Sync conflict entity matrix examples passed");

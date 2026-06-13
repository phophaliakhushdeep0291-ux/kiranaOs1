import assert from "assert";
import fs from "fs";

function read(file) { return fs.readFileSync(file, "utf8"); }

const billsService = read("src/modules/bills/bills.service.js");
const inventoryService = read("src/modules/inventory/inventory.service.js");
const paymentService = read("src/modules/payment-provider/paymentProvider.service.js");
const subscriptionService = read("src/modules/subscription/subscription.service.js");
const tasks = read("docs/PRODUCTION_HARDENING_TASKS.md");

assert(billsService.includes("aggregateStockUpdates"), "bill confirmation must aggregate same-product line stock before decrement");
assert(billsService.includes("stockBaseQty: { gte: qtyInBase }"), "bill stock decrement must be conditional on enough remaining stock");
assert(billsService.includes("stockBaseQty: { decrement: qtyInBase }"), "bill stock decrement must use atomic decrement");
assert(billsService.includes("INSUFFICIENT_STOCK_CONCURRENT_MODIFICATION"), "concurrent stock failure must have explicit error code");
assert(billsService.includes("RESTORE_INSUFFICIENT_STOCK_CONCURRENT_MODIFICATION"), "bill restore must also be concurrency-safe");
assert(billsService.includes("syncCustomerUdharBalance(tx, shopId, customerId"), "credit bill udhar update must derive balance from ledger");
assert(billsService.includes("syncCustomerUdharBalance(tx, shopId, bill.customerId"), "bill cancellation udhar reversal must derive balance from ledger");

assert(inventoryService.includes("CONCURRENT_STOCK_MODIFICATION_RETRY"), "purchase/correction must fail safely on concurrent stock writes");
assert(inventoryService.includes("stockBaseQty: oldStock"), "purchase must use optimistic stock guard");
assert(inventoryService.includes("stockBaseQty: product.stockBaseQty"), "manual correction must use optimistic stock guard");
assert(inventoryService.includes("stockBaseQty: { decrement: qtyInBase }"), "damage must use atomic conditional decrement");
assert(inventoryService.includes("stockBaseQty: { increment: qtyInBase }"), "purchase must use atomic increment");

assert(paymentService.includes("reconcileSubscriptionAfterRefund"), "refund webhook must reconcile subscription entitlement");
assert(paymentService.includes("PAYMENT_REFUNDED"), "refund webhook must audit refunded payments");
assert(paymentService.includes("subscriptionChanged"), "refund webhook must report whether entitlement changed");
assert(subscriptionService.includes("SUBSCRIPTION_REFUND_RECONCILED"), "subscription refund reconciliation must create audit log");
assert(subscriptionService.includes('status: "cancelled"'), "refunded active subscription must be blocked/cancelled");
assert(subscriptionService.includes("graceEndsAt: now"), "refund should not leave paid grace entitlement active");

assert(tasks.includes("Phase 19A"), "hardening task docs must include next small task prompts");
assert(tasks.includes("atomic conditional update"), "task docs must mention atomic stock update approach");
assert(tasks.includes("refund entitlement reconciliation"), "task docs must mention refund entitlement reconciliation");

console.log("Phase 19 production correctness examples passed");

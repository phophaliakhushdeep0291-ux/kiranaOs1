import assert from "node:assert/strict";
import db from "../src/db.js";
import { seedEvalShop } from "./helpers/agent-eval-shop.js";
import { getTool, toolsFor } from "../src/modules/ai/agent/tool-registry.js";
import { runAgentTurn, executeApprovedPlan, getPlanExecution } from "../src/modules/ai/agent/agent.service.js";
import { validateArgs } from "../src/modules/ai/agent/argument-validation.js";
import { ACTION_LABELS } from "../src/modules/ai/agent/workflow-directory.js";
import { renderToolEvidence } from "../src/modules/ai/agent/evidence-reply.js";
import { resolveOperationalLocation } from "../src/modules/stores/location-context.service.js";
import { getLocationInventory, receiveTransfer } from "../src/modules/stores/stores.service.js";
import { recordSupplierPayment } from "../src/modules/suppliers/supplierPayments.service.js";
import "../src/modules/ai/agent/register-core.js";
function provider(name, args) {
  let index = 0;
  return { provider: "fixture", model: "logistics", client: { chat: { completions: { create: async () => ({ choices: [{ message: index++ === 0
    ? { role: "assistant", tool_calls: [{ id: "one", type: "function", function: { name, arguments: JSON.stringify(args) } }] }
    : { role: "assistant", content: "Everything is completed" } }] }) } } } };
}
const fixture = await seedEvalShop(), { shopId } = fixture;
try {
  const branch = await resolveOperationalLocation(shopId);
  const owner = await db.user.create({ data: { shopId, name: "Test owner", role: "owner", passwordHash: "test-only" } });
  const ctx = { ...fixture.ctx, userId: owner.id, deviceId: "counter-test", locationId: branch.id };
  const other = await db.storeLocation.create({ data: { shopId, name: "East", code: "EAST" } });
  const dest = { ...ctx, locationId: other.id };
  const supplier = await db.supplier.create({ data: { shopId, name: "North Supplier" } });
  const purchase = await db.purchaseHistory.create({ data: { shopId, locationId: branch.id, productId: fixture.refs["product.sugar"], supplierId: supplier.id, supplierName: supplier.name,
    qtyBase: 10, pricePerRateUnit: 38, totalCost: 380, billAmount: 380, purchasePaidAmount: 80, purchaseDueAmount: 300, purchasePaymentStatus: "partial", invoiceNumber: "INV-1" } });
  const propose = (name, args, context = ctx) => runAgentTurn(context, { message: "supplier payment stock transfer task", language: "en" }, { provider: provider(name, args) });
  const execute = (turn, context = ctx) => executeApprovedPlan(context, { planId: turn.planId, ownerPinVerified: true });
  const pay = getTool("record_supplier_payment"), dispatch = getTool("dispatch_stock_transfer"), receive = getTool("receive_stock_transfer"), cancel = getTool("cancel_stock_transfer");
  const paymentArgs = { purchaseHistoryId: purchase.id, amount: 100.25, paidOn: "2026-10-01", mode: "bank", alreadyPaid: true, reference: "BANK-1" };
  const transferArgs = { toLocationId: other.id, items: [{ productId: fixture.refs["product.sugar"], quantityBaseQty: 5, baseUnit: "kg" }] };
  for (const tool of [pay, dispatch, receive, cancel]) {
    assert.ok(ACTION_LABELS[tool.name], "executable actions need a visible capability label");
    for (const role of ["staff", "viewer"]) assert.ok(!toolsFor({ ...ctx, role, features: { has: () => true } }).includes(tool));
    assert.ok(!toolsFor({ ...ctx, features: { has: () => false } }).includes(tool));
  }
  for (const field of pay.parameters.required) { const missing = { ...paymentArgs }; delete missing[field]; assert.ok(validateArgs(pay, missing).length); }
  for (const key of ["shopId", "userId", "locationId", "url", "approval", "ownerPin"]) assert.ok(validateArgs(pay, { ...paymentArgs, [key]: "injected" }).length);
  assert.ok(validateArgs(pay, { ...paymentArgs, alreadyPaid: false }).length);
  await assert.rejects(pay.prepare({ ...paymentArgs, paidOn: "2026-02-30" }, ctx), { code: "INVALID_PAYMENT_DATE" });
  await assert.rejects(pay.prepare({ ...paymentArgs, paidOn: "2099-01-01" }, ctx), { code: "INVALID_PAYMENT_DATE" });
  await assert.rejects(pay.prepare({ ...paymentArgs, amount: 0.001 }, ctx), { code: "TASK_PRECISION_INVALID" });
  await assert.rejects(pay.prepare({ ...paymentArgs, amount: 301 }, ctx), { code: "PAYMENT_EXCEEDS_DUE" });
  await assert.rejects(pay.prepare({ ...paymentArgs, purchaseHistoryId: "foreign-purchase" }, ctx), { code: "PURCHASE_NOT_FOUND" });
  await assert.rejects(pay.prepare(paymentArgs, dest), { code: "LOCATION_ACCESS_DENIED" });
  const dues = await getTool("list_supplier_dues").handler({ supplierId: supplier.id }, ctx);
  assert.match(renderToolEvidence({ tool: "list_supplier_dues", result: dues }, "en"), /North Supplier.*INV-1.*paid 80.*due 300/);
  const payment = await propose(pay.name, paymentArgs);
  assert.equal(payment.plan.length, 1, JSON.stringify(payment));
  assert.match(payment.plan[0].summary, /ALREADY PAID 100.25.*Due 300 → 199.75.*no money is sent/);
  assert.equal(await db.financialLedger.count({ where: { shopId } }), 0, "preview never records payment");
  await assert.rejects(executeApprovedPlan(ctx, { planId: payment.planId }), { code: "OWNER_PIN_REQUIRED" });
  assert.equal((await execute(payment)).allSucceeded, true);
  const paid = await db.purchaseHistory.findUnique({ where: { id: purchase.id } });
  assert.equal(paid.purchasePaidAmount, 180.25); assert.equal(paid.purchaseDueAmount, 199.75);
  assert.equal(paid.purchaseDueAmountPaise, 19975n);
  assert.equal(await db.financialLedger.count({ where: { shopId, sourceType: "supplier_payment" } }), 1);
  assert.match((await getPlanExecution(ctx, { planId: payment.planId })).results[0].output.receipt, /199.75/);
  await assert.rejects(execute(payment), { code: "AI_PLAN_ALREADY_RESOLVED" });
  for (const field of ["supplier_payment_details", "supplier_purchase_row", "transfer_destination", "transfer_lines", "transfer_receipt", "transfer_return"]) {
    const clarification = await propose("request_clarification", { field });
    assert.equal(clarification.planId, null);
    assert.match(clarification.reply, /\?/);
    assert.equal(await db.financialLedger.count({ where: { shopId, sourceType: "supplier_payment" } }), 1, "clarifying never changes balances");
  }
  const stalePay = await propose(pay.name, { ...paymentArgs, amount: 50 });
  const manualData = { purchaseHistoryId: purchase.id, amount: 20, mode: "cash", paymentId: "offline-payment", idempotencyKey: "supplier-payment:offline-event" };
  await recordSupplierPayment(shopId, manualData, ctx);
  assert.equal((await recordSupplierPayment(shopId, manualData, ctx)).idempotentReplay, true);
  await assert.rejects(recordSupplierPayment(shopId, { ...manualData, amount: 21 }, ctx), { code: "IDEMPOTENCY_KEY_REUSED" });
  await assert.rejects(recordSupplierPayment(shopId, { ...manualData, reference: "different-bank-reference" }, ctx), { code: "IDEMPOTENCY_KEY_REUSED" });
  await assert.rejects(recordSupplierPayment(shopId, { ...manualData, paidAt: "2026-10-01T00:00:00.000Z" }, ctx), { code: "IDEMPOTENCY_KEY_REUSED" });
  assert.equal((await execute(stalePay)).allSucceeded, false);
  assert.equal((await db.purchaseHistory.findUnique({ where: { id: purchase.id } })).purchaseDueAmount, 179.75);
  const deletedSupplierPlan = await propose(pay.name, { ...paymentArgs, amount: 10 });
  await db.supplier.update({ where: { id: supplier.id }, data: { deletedAt: new Date() } });
  assert.equal((await execute(deletedSupplierPlan)).allSucceeded, false);
  await db.supplier.update({ where: { id: supplier.id }, data: { deletedAt: null } });
  await assert.rejects(dispatch.prepare({ ...transferArgs, toLocationId: branch.id }, ctx), { code: "SAME_TRANSFER_LOCATION" });
  await assert.rejects(dispatch.prepare({ ...transferArgs, toLocationId: "foreign-location" }, ctx), { code: "STORE_LOCATION_NOT_FOUND" });
  await assert.rejects(dispatch.prepare({ ...transferArgs, items: [{ ...transferArgs.items[0], quantityBaseQty: 13 }] }, ctx), { code: "INSUFFICIENT_LOCATION_STOCK" });
  await assert.rejects(dispatch.prepare({ ...transferArgs, items: [{ ...transferArgs.items[0], baseUnit: "gram" }] }, ctx), { code: "TRANSFER_UNIT_MISMATCH" });
  await assert.rejects(dispatch.prepare({ ...transferArgs, items: [...transferArgs.items, ...transferArgs.items] }, ctx), { code: "TRANSFER_DUPLICATE_LINE" });
  await db.product.update({ where: { id: transferArgs.items[0].productId }, data: { batchTrackingEnabled: true } });
  await assert.rejects(dispatch.prepare(transferArgs, ctx), { code: "TRANSFER_MANUAL_REVIEW_REQUIRED" });
  await db.product.update({ where: { id: transferArgs.items[0].productId }, data: { batchTrackingEnabled: false } });
  await db.userLocationAccess.create({ data: { shopId, userId: owner.id, locationId: branch.id, canTransfer: false, canPurchase: false } });
  await assert.rejects(dispatch.prepare(transferArgs, { ...ctx, role: "admin" }), { code: "LOCATION_ACCESS_DENIED" });
  await assert.rejects(pay.prepare(paymentArgs, { ...ctx, role: "admin" }), { code: "LOCATION_ACCESS_DENIED" });
  const movement = await propose(dispatch.name, transferArgs);
  assert.equal(movement.plan.length, 1, JSON.stringify(movement));
  assert.match(movement.plan[0].summary, /Sugar.*5.*kg.*East.*IN TRANSIT/);
  assert.equal(await db.stockTransfer.count({ where: { shopId } }), 0);
  await assert.rejects(executeApprovedPlan(ctx, { planId: movement.planId }), { code: "OWNER_PIN_REQUIRED" });
  const races = await Promise.allSettled([execute(movement), execute(movement)]);
  assert.equal(races.filter(row => row.status === "fulfilled" && row.value.allSucceeded).length, 1, JSON.stringify(races));
  const shipment = await db.stockTransfer.findFirst({ where: { shopId }, include: { items: true } });
  assert.equal(shipment.status, "in_transit");
  const stock = async locationId => (await getLocationInventory(shopId, locationId)).products.find(row => row.id === transferArgs.items[0].productId).stockBaseQty;
  assert.equal(await stock(branch.id), 7); assert.equal(await stock(other.id), 0);
  assert.equal((await db.product.findUnique({ where: { id: transferArgs.items[0].productId } })).stockBaseQty, 12);
  const receiptArgs = { transferId: shipment.id, items: [{ transferItemId: shipment.items[0].id, quantityBaseQty: 2, baseUnit: "kg" }] };
  await assert.rejects(receive.prepare(receiptArgs, ctx), { code: "LOCATION_ACCESS_DENIED" });
  await assert.rejects(receive.prepare({ ...receiptArgs, items: [{ ...receiptArgs.items[0], quantityBaseQty: 6 }] }, dest), { code: "TRANSFER_RECEIPT_EXCEEDS_REMAINING" });
  const arrival = await propose(receive.name, receiptArgs, dest);
  assert.equal((await execute(arrival, dest)).allSucceeded, true);
  assert.equal(await stock(branch.id), 7); assert.equal(await stock(other.id), 2);
  const detail = await getTool("get_stock_transfer").handler({ transferId: shipment.id }, dest);
  assert.match(renderToolEvidence({ tool: "get_stock_transfer", result: detail }, "en"), /sent 5; received 2; remaining 3/);
  const cancelArgs = { transferId: shipment.id, reason: "Carrier returned undelivered goods", goodsBackAtSource: true };
  assert.ok(validateArgs(cancel, { ...cancelArgs, goodsBackAtSource: false }).length);
  const staleCancel = await propose(cancel.name, cancelArgs);
  await receiveTransfer(shopId, shipment.id, { items: [{ transferItemId: shipment.items[0].id, quantityBaseQty: 1 }] }, owner.id, "owner");
  assert.equal((await execute(staleCancel)).allSucceeded, false, "a later manual arrival invalidates cancellation approval");
  assert.equal(await stock(branch.id), 7); assert.equal(await stock(other.id), 3);
  const cancellation = await propose(cancel.name, cancelArgs);
  assert.match(cancellation.plan[0].summary, /Sugar.*2.*kg.*Goods confirmed back/);
  assert.equal((await execute(cancellation)).allSucceeded, true);
  assert.equal(await stock(branch.id), 9); assert.equal(await stock(other.id), 3);
  assert.equal((await db.stockTransfer.findUnique({ where: { id: shipment.id } })).status, "cancelled");
  assert.equal((await db.product.findUnique({ where: { id: transferArgs.items[0].productId } })).stockBaseQty, 12);
  await assert.rejects(receive.prepare(receiptArgs, dest), { code: "TRANSFER_NOT_OPEN" });
  const staleDispatch = await propose(dispatch.name, transferArgs);
  await db.product.update({ where: { id: transferArgs.items[0].productId }, data: { stockBaseQty: 11 } });
  assert.equal((await execute(staleDispatch)).allSucceeded, false, "stock changing after review blocks dispatch");
  assert.equal(await db.stockTransfer.count({ where: { shopId } }), 1);
  for (const [name, args] of [["list_store_locations", {}], ["get_transfer_stock", { productIds: [transferArgs.items[0].productId] }], ["list_stock_transfers", {}]]) {
    const result = await getTool(name).handler(args, ctx);
    assert.ok(renderToolEvidence({ tool: name, result }, "en"), `${name} must show actual tool evidence`);
    assert.ok(renderToolEvidence({ tool: name, result }, "hi"));
  }
  console.log("Settlement/transfer autopilot passed: exact balances, no planning writes, PIN, roles, scope, duplicate protection, stale approval, dispatch/partial receipt/return stock conservation, recovery and grounded evidence.");
} finally {
  for (const [model, where] of [
    ["stockTransferItem", { transfer: { shopId } }], ["stockTransfer", { shopId }], ["stockLedger", { shopId }],
    ["purchaseHistory", { shopId }], ["financialLedger", { shopId }], ["auditLog", { shopId }], ["supplier", { shopId }],
    ["udharLedger", { shopId }], ["customer", { shopId }], ["locationStock", { shopId }], ["product", { shopId }],
    ["aiActionLog", { shopId }], ["subscription", { shopId }], ["userLocationAccess", { shopId }], ["user", { shopId }], ["storeLocation", { shopId }], ["changeLog", { shopId }],
  ]) await db[model].deleteMany({ where });
  await db.shop.delete({ where: { id: shopId } });
}

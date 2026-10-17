import { discoverScriptedTools } from "./helpers/agent-tool-discovery.js";
import assert from "node:assert/strict";
import db from "../src/db.js";
import { seedEvalShop } from "./helpers/agent-eval-shop.js";
import { getTool, toolsFor } from "../src/modules/ai/agent/tool-registry.js";
import { runAgentTurn, executeApprovedPlan, getPlanExecution, rejectPlan } from "../src/modules/ai/agent/agent.service.js";
import { validateArgs } from "../src/modules/ai/agent/argument-validation.js";
import { renderToolEvidence } from "../src/modules/ai/agent/evidence-reply.js";
import { resolveOperationalLocation } from "../src/modules/stores/location-context.service.js";
import "../src/modules/ai/agent/register-core.js";
import { executionStatus } from "../src/modules/ai/agent/agent.controller.js";
function provider(calls) {
  let index = 0;
  return { provider: "fixture", model: "purchasing", client: { chat: { completions: { create: async body => discoverScriptedTools(body, calls.map(([name]) => name)) ?? ({ choices: [{ message: index++ === 0
    ? { role: "assistant", tool_calls: calls.map(([name, args], i) => ({ id: String(i), type: "function", function: { name, arguments: JSON.stringify(args) } })) }
    : { role: "assistant", content: "I have done everything" } }] }) } } } };
}
const fixture = await seedEvalShop();
const { shopId } = fixture;
try {
  const branch = await resolveOperationalLocation(shopId);
  const owner = await db.user.create({ data: { shopId, name: "Test owner", role: "owner", passwordHash: "not-a-real-login" } });
  const ctx = { ...fixture.ctx, userId: owner.id, deviceId: "validated-counter-A", locationId: branch.id };
  const supplier = await db.supplier.create({ data: { shopId, name: "North Foods" } });
  const args = { supplierId: supplier.id, items: [{ productId: fixture.refs["product.sugar"], orderedBaseQty: 10, expectedRate: 38, baseUnit: "kg", rateUnit: "kg" }] };
  const propose = (name, input) => runAgentTurn(ctx, { message: "purchase order task", language: "en" }, { provider: provider([[name, input]]) });
  const draftTool = getTool("create_purchase_order");
  for (const field of draftTool.parameters.required) { const missing = { ...args }; delete missing[field]; assert.ok(validateArgs(draftTool, missing).length); }
  for (const key of ["shopId", "userId", "locationId", "url", "approval"]) assert.ok(validateArgs(draftTool, { ...args, [key]: "injected" }).length);
  for (const role of ["viewer", "staff", "cashier"]) assert.ok(!toolsFor({ ...ctx, role, features: { has: () => true } }).some(tool => tool.name === "create_purchase_order"));
  assert.ok(!toolsFor({ ...ctx, features: { has: () => false } }).some(tool => tool.name === "receive_purchase_order"));
  await assert.rejects(draftTool.prepare({ ...args, expectedOn: "2026-02-30" }, ctx), { code: "INVALID_DATE" });
  await assert.rejects(draftTool.prepare({ ...args, items: [{ ...args.items[0], baseUnit: "gram" }] }, ctx), { code: "PURCHASE_UNIT_MISMATCH" });
  await assert.rejects(draftTool.prepare({ ...args, items: [{ ...args.items[0], orderedBaseQty: 1.001 }] }, ctx), { code: "PURCHASE_PRECISION_INVALID" });
  await assert.rejects(draftTool.prepare({ ...args, supplierId: "foreign-supplier" }, ctx), { code: "SUPPLIER_NOT_FOUND" });
  const turn = await propose("create_purchase_order", args);
  assert.equal(turn.plan.length, 1, JSON.stringify(turn));
  assert.match(turn.plan[0].summary, /North Foods.*Sugar.*10 kg at 38\/kg = 380.*total 380/);
  assert.equal(await db.purchaseOrder.count({ where: { shopId } }), 0, "planning never places an order");
  await assert.rejects(executeApprovedPlan({ ...ctx, deviceId: "different" }, { planId: turn.planId }), { code: "AI_PLAN_SCOPE_CHANGED" });
  await assert.rejects(rejectPlan({ ...ctx, locationId: "different" }, { planId: turn.planId }), { code: "AI_PLAN_SCOPE_CHANGED" });
  const execution = await executeApprovedPlan(ctx, { planId: turn.planId });
  assert.equal(execution.allSucceeded, true, JSON.stringify(execution));
  const order = await db.purchaseOrder.findFirst({ where: { shopId }, include: { items: true } });
  assert.equal(order.expectedTotal, 380); assert.equal(order.status, "draft");
  const saved = await getPlanExecution(ctx, { planId: turn.planId });
  assert.equal(saved.status, "executed"); assert.equal(saved.results[0].target, "server");
  assert.equal(saved.clientActions, undefined);
  let recoveredOverHttp;
  await executionStatus({ shopId, user: { userId: owner.id, role: "owner", deviceId: "stale-token-device" }, device: { deviceId: ctx.deviceId }, headers: { "x-location-id": branch.id }, body: { planId: turn.planId } },
    { json: value => { recoveredOverHttp = value; } }, error => { throw error; });
  assert.equal(recoveredOverHttp.data.status, "executed", "HTTP context uses the validated device middleware result");
  await assert.rejects(getPlanExecution({ ...ctx, userId: "other" }, { planId: turn.planId }), { code: "AI_PLAN_SCOPE_CHANGED" });
  await assert.rejects(getPlanExecution({ ...ctx, shopId: "other" }, { planId: turn.planId }), { code: "AI_PLAN_NOT_FOUND" });
  await assert.rejects(executeApprovedPlan(ctx, { planId: turn.planId }), { code: "AI_PLAN_ALREADY_RESOLVED" });
  assert.equal(await db.purchaseOrder.count({ where: { shopId } }), 1);
  const sent = await propose("mark_purchase_order_sent", { orderId: order.id });
  await assert.rejects(executeApprovedPlan(ctx, { planId: sent.planId }), { code: "OWNER_PIN_REQUIRED" });
  assert.match(sent.plan[0].summary, /no message is sent/);
  assert.equal((await executeApprovedPlan(ctx, { planId: sent.planId, ownerPinVerified: true })).allSucceeded, true);
  const receiptArgs = { orderId: order.id, paidAmount: 50, paymentMode: "cash", updateCost: false, items: [{ purchaseOrderItemId: order.items[0].id, quantityBaseQty: 4, actualRate: 38, baseUnit: "kg", rateUnit: "kg" }] };
  const receiveTool = getTool("receive_purchase_order");
  for (const field of ["paidAmount", "updateCost", "items"]) { const missing = { ...receiptArgs }; delete missing[field]; assert.ok(validateArgs(receiveTool, missing).length); }
  await assert.rejects(receiveTool.prepare({ ...receiptArgs, paidAmount: 200 }, ctx), { code: "PURCHASE_RECEIPT_PAYMENT_INVALID" });
  await assert.rejects(receiveTool.prepare({ ...receiptArgs, items: [{ ...receiptArgs.items[0], quantityBaseQty: 11 }] }, ctx), { code: "PURCHASE_ORDER_OVER_RECEIPT" });
  const variance = { ...receiptArgs, supplierInvoiceNumber: "INV-8", supplierInvoiceAmount: 160, items: [{ ...receiptArgs.items[0], actualRate: 40 }] };
  await assert.rejects(receiveTool.prepare(variance, ctx), { code: "PURCHASE_VARIANCE_REASON_REQUIRED" });
  assert.match((await receiveTool.prepare({ ...variance, varianceReason: "Supplier price increased" }, ctx)).summary, /Total 160.*Supplier price increased/);
  await db.product.update({ where: { id: args.items[0].productId }, data: { batchTrackingEnabled: true } });
  await assert.rejects(receiveTool.prepare(receiptArgs, ctx), { code: "PURCHASE_BATCH_REQUIRED" });
  await db.product.update({ where: { id: args.items[0].productId }, data: { batchTrackingEnabled: false } });
  const receive = await propose("receive_purchase_order", receiptArgs);
  assert.match(receive.plan[0].summary, /Total 152; recorded paid 50 via cash; due 102/);
  assert.match(receive.plan[0].summary, /Keep existing cost/);
  const races = await Promise.allSettled([executeApprovedPlan(ctx, { planId: receive.planId, ownerPinVerified: true }), executeApprovedPlan(ctx, { planId: receive.planId, ownerPinVerified: true })]);
  assert.equal(races.filter(row => row.status === "fulfilled" && row.value.allSucceeded).length, 1, JSON.stringify(races));
  assert.equal(await db.purchaseReceipt.count({ where: { shopId } }), 1);
  const receipt = await db.purchaseReceipt.findFirst({ where: { shopId } });
  assert.equal(receipt.totalAmount, 152); assert.equal(receipt.paidAmount, 50); assert.equal(receipt.dueAmount, 102);
  assert.equal((await db.product.findUnique({ where: { id: args.items[0].productId } })).stockBaseQty, 16);
  assert.ok(await db.financialLedger.count({ where: { shopId } }));
  assert.equal((await db.purchaseOrder.findUnique({ where: { id: order.id } })).status, "partially_received");
  const lookup = await getTool("get_purchase_order").handler({ orderId: order.id }, ctx);
  assert.match(renderToolEvidence({ tool: "get_purchase_order", result: lookup }, "en"), /received 4 kg/);
  const otherBranch = await db.storeLocation.create({ data: { shopId, name: "Branch Two", code: "B2" } });
  await assert.rejects(getTool("get_purchase_order").handler({ orderId: order.id }, { ...ctx, locationId: otherBranch.id }), { code: "LOCATION_ACCESS_DENIED" });
  await db.userLocationAccess.create({ data: { shopId, userId: owner.id, locationId: branch.id, canPurchase: false, canManageInventory: false } });
  await assert.rejects(draftTool.prepare(args, { ...ctx, role: "admin" }), { code: "LOCATION_ACCESS_DENIED" });
  await assert.rejects(getTool("correct_stock").handler({ productId: args.items[0].productId, newStock: 7 }, { ...ctx, role: "admin" }), { code: "LOCATION_ACCESS_DENIED" });
  const stockPlan = await runAgentTurn({ ...ctx, locationId: otherBranch.id }, { message: "correct counted stock", language: "en" }, { provider: provider([["correct_stock", { productId: args.items[0].productId, newStock: 3 }]]) });
  assert.equal((await executeApprovedPlan({ ...ctx, locationId: otherBranch.id }, { planId: stockPlan.planId, ownerPinVerified: true })).allSucceeded, true);
  assert.equal((await db.locationStock.findFirst({ where: { shopId, locationId: otherBranch.id, productId: args.items[0].productId } })).stockBaseQty, 3);
  assert.equal((await db.product.findUnique({ where: { id: args.items[0].productId } })).stockBaseQty, 19, "primary's 16 remain while branch gets 3");
  const expired = await propose("create_purchase_order", args);
  await db.aiActionLog.update({ where: { id: expired.planId }, data: { createdAt: new Date(Date.now() - 31 * 60000) } });
  await assert.rejects(executeApprovedPlan(ctx, { planId: expired.planId }), { code: "AI_PLAN_EXPIRED" });
  const incomplete = await runAgentTurn(ctx, { message: "purchase and customer", language: "en" }, { provider: provider([["create_customer", { name: "Incomplete" }], ["receive_purchase_order", { orderId: order.id }]]) });
  assert.equal(incomplete.planId, null, "an incomplete multi-step request must not offer partial execution");
  const mixedTargets = await runAgentTurn(ctx, { message: "create supplier and draft order", language: "en" }, { provider: provider([["create_supplier", { name: "New local supplier" }], ["create_purchase_order", args]]) });
  assert.equal(mixedTargets.planId, null, "server writes cannot leap ahead of unacknowledged device writes");
  assert.match(mixedTargets.reply, /Which part should I finish first/);
  const cancel = await runAgentTurn(ctx, { message: "cancel purchase and add customer", language: "en" }, { provider: provider([
    ["cancel_purchase_order", { orderId: order.id, reason: "Supplier short delivery" }], ["create_customer", { name: "Must not be created", mobile: "9898989898" }],
  ]) });
  assert.equal(cancel.plan.length, 2);
  await db.purchaseOrder.update({ where: { id: order.id }, data: { note: "Changed after preview" } });
  const blocked = await executeApprovedPlan(ctx, { planId: cancel.planId, ownerPinVerified: true });
  assert.equal(blocked.allSucceeded, false); assert.equal(blocked.results[1].skipped, true);
  assert.equal(await db.customer.count({ where: { shopId, name: "Must not be created" } }), 0);
  const finalCancel = await propose("cancel_purchase_order", { orderId: order.id, reason: "Supplier short delivery" });
  assert.equal((await executeApprovedPlan(ctx, { planId: finalCancel.planId, ownerPinVerified: true })).allSucceeded, true);
  assert.equal((await db.purchaseOrder.findUnique({ where: { id: order.id } })).status, "cancelled");
  assert.equal(await db.purchaseReceipt.count({ where: { shopId } }), 1);
  console.log("Purchasing autopilot passed: preview, branch/role/PIN, units/totals, partial receipt, accounting, single use, stale approval, stop-on-failure, recovery.");
} finally {
  for (const [model, where] of [
    ["purchaseReceiptItem", { receipt: { shopId } }], ["inventoryLot", { shopId }], ["purchaseReceipt", { shopId }],
    ["purchaseOrderItem", { purchaseOrder: { shopId } }], ["purchaseOrder", { shopId }], ["stockLedger", { shopId }],
    ["purchaseHistory", { shopId }], ["locationStock", { shopId }], ["productSellingUnit", { shopId }],
    ["product", { shopId }], ["financialLedger", { shopId }], ["auditLog", { shopId }], ["supplier", { shopId }],
    ["udharLedger", { shopId }], ["customer", { shopId }], ["subscription", { shopId }], ["aiActionLog", { shopId }],
    ["userLocationAccess", { shopId }], ["user", { shopId }], ["storeLocation", { shopId }], ["changeLog", { shopId }],
  ]) await db[model].deleteMany({ where });
  await db.shop.delete({ where: { id: shopId } });
}

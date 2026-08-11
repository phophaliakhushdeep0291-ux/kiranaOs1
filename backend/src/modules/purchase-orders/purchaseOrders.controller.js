import * as service from "./purchaseOrders.service.js";
import { requestLocationId } from "../stores/location-context.service.js";
import { publishIntegrationEvent } from "../integrations/integrations.service.js";
import { assertLocationCapability } from "../stores/location-access.service.js";
import { scheduleAuditEvaluation } from "../assurance/assurance.hooks.js";
import { ENTITY_TYPES } from "../assurance/assurance.constants.js";

const actor = (req) => ({ userId: req.user?.userId ?? null, deviceId: req.user?.deviceId ?? undefined, req });

async function assertOrderAccess(req, capability) {
  const order = await service.getPurchaseOrder(req.shopId, req.params.id);
  await assertLocationCapability({
    shopId: req.shopId,
    userId: req.user?.userId,
    role: req.user?.role,
    locationId: order.locationId,
    capability,
  });
  return order;
}

export async function list(req, res, next) {
  try { res.json({ success: true, data: await service.listPurchaseOrders(req.shopId, { ...req.query, locationId: requestLocationId(req) }) }); } catch (error) { next(error); }
}
export async function get(req, res, next) {
  try { res.json({ success: true, data: await assertOrderAccess(req, "view") }); } catch (error) { next(error); }
}
export async function suggestions(req, res, next) {
  try { res.json({ success: true, data: await service.getReorderSuggestions(req.shopId, requestLocationId(req)) }); } catch (error) { next(error); }
}
export async function create(req, res, next) {
  try {
    const data = await service.createPurchaseOrder(req.shopId, { ...req.body, locationId: requestLocationId(req) }, actor(req));
    await publishIntegrationEvent(req.shopId, "purchase_order.created", { id: data.id, orderNumber: data.orderNumber, supplierName: data.supplierName, expectedTotal: data.expectedTotal, locationId: data.locationId, status: data.status }).catch(() => []);
    res.status(201).json({ success: true, data });
  } catch (error) { next(error); }
}
export async function send(req, res, next) {
  try {
    await assertOrderAccess(req, "purchase");
    const data = await service.sendPurchaseOrder(req.shopId, req.params.id, actor(req));
    res.json({ success: true, data });
  } catch (error) { next(error); }
}
export async function receive(req, res, next) {
  try {
    await assertOrderAccess(req, "purchase");
    const data = await service.receivePurchaseOrder(req.shopId, req.params.id, req.body, actor(req));
    if (!data.idempotentReplay) {
      await publishIntegrationEvent(req.shopId, "purchase_order.received", { id: data.purchaseOrder.id, orderNumber: data.purchaseOrder.orderNumber, receiptId: data.receipt.id, totalAmount: data.receipt.totalAmount, locationId: data.purchaseOrder.locationId, status: data.purchaseOrder.status }).catch(() => []);
    }
    res.status(data.idempotentReplay ? 200 : 201).json({ success: true, data });
    if (!data.idempotentReplay && data.receipt?.id) {
      scheduleAuditEvaluation(req.shopId, ENTITY_TYPES.PURCHASE, data.receipt.id, { userId: req.user?.userId });
    }
  } catch (error) { next(error); }
}
export async function reconcileReceipt(req, res, next) {
  try {
    await assertOrderAccess(req, "purchase");
    const data = await service.reconcilePurchaseReceipt(req.shopId, req.params.id, req.params.receiptId, req.body, actor(req));
    const receipt = data.receipts.find((row) => row.id === req.params.receiptId);
    await publishIntegrationEvent(req.shopId, "purchase_receipt.reconciled", {
      purchaseOrderId: data.id,
      receiptId: req.params.receiptId,
      locationId: data.locationId,
      matchStatus: receipt?.matchStatus,
    }).catch(() => []);
    res.json({ success: true, data });
    scheduleAuditEvaluation(req.shopId, ENTITY_TYPES.PURCHASE, req.params.receiptId, { userId: req.user?.userId });
  } catch (error) { next(error); }
}
export async function cancel(req, res, next) {
  try {
    await assertOrderAccess(req, "purchase");
    const data = await service.cancelPurchaseOrder(req.shopId, req.params.id, req.body.reason, actor(req));
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

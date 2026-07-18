import * as service from "./purchaseOrders.service.js";
import { requestLocationId } from "../stores/location-context.service.js";
import { createAuditLog } from "../audit/audit.service.js";
import { publishIntegrationEvent } from "../integrations/integrations.service.js";
import { assertLocationCapability } from "../stores/location-access.service.js";

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
    const data = await service.createPurchaseOrder(req.shopId, { ...req.body, locationId: requestLocationId(req) }, req.user?.userId);
    await createAuditLog({ shopId: req.shopId, userId: req.user?.userId, action: "PURCHASE_ORDER_CREATED", entityType: "PurchaseOrder", entityId: data.id, after: { orderNumber: data.orderNumber, supplierName: data.supplierName, expectedTotal: data.expectedTotal, locationId: data.locationId }, req });
    await publishIntegrationEvent(req.shopId, "purchase_order.created", { id: data.id, orderNumber: data.orderNumber, supplierName: data.supplierName, expectedTotal: data.expectedTotal, locationId: data.locationId, status: data.status }).catch(() => []);
    res.status(201).json({ success: true, data });
  } catch (error) { next(error); }
}
export async function send(req, res, next) {
  try {
    await assertOrderAccess(req, "purchase");
    const data = await service.sendPurchaseOrder(req.shopId, req.params.id);
    await createAuditLog({ shopId: req.shopId, userId: req.user?.userId, action: "PURCHASE_ORDER_SENT", entityType: "PurchaseOrder", entityId: data.id, after: { status: data.status, sentAt: data.sentAt }, req });
    res.json({ success: true, data });
  } catch (error) { next(error); }
}
export async function receive(req, res, next) {
  try {
    await assertOrderAccess(req, "purchase");
    const data = await service.receivePurchaseOrder(req.shopId, req.params.id, req.body, req.user?.userId);
    if (!data.idempotentReplay) {
      await createAuditLog({ shopId: req.shopId, userId: req.user?.userId, action: "PURCHASE_ORDER_RECEIVED", entityType: "PurchaseOrder", entityId: data.purchaseOrder.id, after: { status: data.purchaseOrder.status, receiptId: data.receipt.id, totalAmount: data.receipt.totalAmount }, req });
      await publishIntegrationEvent(req.shopId, "purchase_order.received", { id: data.purchaseOrder.id, orderNumber: data.purchaseOrder.orderNumber, receiptId: data.receipt.id, totalAmount: data.receipt.totalAmount, locationId: data.purchaseOrder.locationId, status: data.purchaseOrder.status }).catch(() => []);
    }
    res.status(data.idempotentReplay ? 200 : 201).json({ success: true, data });
  } catch (error) { next(error); }
}
export async function cancel(req, res, next) {
  try {
    await assertOrderAccess(req, "purchase");
    const data = await service.cancelPurchaseOrder(req.shopId, req.params.id, req.body.reason);
    await createAuditLog({ shopId: req.shopId, userId: req.user?.userId, action: "PURCHASE_ORDER_CANCELLED", entityType: "PurchaseOrder", entityId: data.id, after: { status: data.status, cancelledAt: data.cancelledAt }, metadata: { reason: req.body.reason }, req });
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

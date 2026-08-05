import * as svc from "./orders.service.js";
import { createAuditLog } from "../../../modules/audit/audit.service.js";

/** What an audit entry keeps of an order — money and dates, never the address. */
function auditSnapshot(order) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    customerName: order.customerName,
    grandTotal: order.grandTotal,
    paidTotal: order.paidTotal,
    promisedOn: order.promisedOnKey,
    items: order.items?.length ?? 0,
  };
}

export async function list(req, res, next) {
  try {
    const data = await svc.listOrders(req.shopId, {
      status: req.query.status,
      search: req.query.search ? String(req.query.search).trim() : undefined,
      from: req.query.from,
      to: req.query.to,
      overdueOnly: String(req.query.overdueOnly ?? "") === "true",
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function summary(req, res, next) {
  try { res.json({ success: true, data: await svc.getOrderSummary(req.shopId) }); }
  catch (err) { next(err); }
}

/**
 * How much of each product is promised to someone. Returned as a plain object
 * because a Map does not survive JSON.
 */
export async function reservations(req, res, next) {
  try {
    const held = await svc.getReservations(req.shopId);
    res.json({ success: true, data: Object.fromEntries(held) });
  } catch (err) { next(err); }
}

export async function forProduct(req, res, next) {
  try { res.json({ success: true, data: await svc.getOrdersForProduct(req.shopId, String(req.params.productId)) }); }
  catch (err) { next(err); }
}

export async function detail(req, res, next) {
  try { res.json({ success: true, data: await svc.getOrder(req.shopId, req.params.id) }); }
  catch (err) { next(err); }
}

export async function create(req, res, next) {
  try {
    const order = await svc.createOrder(req.shopId, req.body, { userId: req.user?.userId });
    await createAuditLog({
      shopId: req.shopId, userId: req.user?.userId, action: "FURNITURE_ORDER_CREATED",
      entityType: "FurnitureOrder", entityId: order.id, after: auditSnapshot(order), req,
    });
    res.status(201).json({ success: true, message: `${order.orderNumber} created`, data: order });
  } catch (err) { next(err); }
}

export async function update(req, res, next) {
  try {
    // Read first so the audit log shows what the order said before. An order is
    // a promise, and quietly changing the price on one is the dispute this makes
    // traceable.
    const before = await svc.getOrder(req.shopId, req.params.id);
    const order = await svc.updateOrder(req.shopId, req.params.id, req.body);
    await createAuditLog({
      shopId: req.shopId, userId: req.user?.userId, action: "FURNITURE_ORDER_UPDATED",
      entityType: "FurnitureOrder", entityId: order.id,
      before: auditSnapshot(before), after: auditSnapshot(order), req,
    });
    res.json({ success: true, data: order });
  } catch (err) { next(err); }
}

export async function setStatus(req, res, next) {
  try {
    const { status, ...rest } = req.body ?? {};
    const order = await svc.setOrderStatus(req.shopId, req.params.id, status, rest);
    await createAuditLog({
      shopId: req.shopId, userId: req.user?.userId, action: "FURNITURE_ORDER_STATUS_CHANGED",
      entityType: "FurnitureOrder", entityId: order.id, after: auditSnapshot(order), req,
    });
    res.json({ success: true, message: `Marked ${order.statusLabel.toLowerCase()}`, data: order });
  } catch (err) { next(err); }
}

export async function cancel(req, res, next) {
  try {
    const order = await svc.cancelOrder(req.shopId, req.params.id, req.body ?? {});
    await createAuditLog({
      shopId: req.shopId, userId: req.user?.userId, action: "FURNITURE_ORDER_CANCELLED",
      entityType: "FurnitureOrder", entityId: order.id, after: auditSnapshot(order), req,
    });
    res.json({ success: true, message: "Order cancelled", data: order });
  } catch (err) { next(err); }
}

export async function addPayment(req, res, next) {
  try {
    const order = await svc.addPayment(req.shopId, req.params.id, req.body, { userId: req.user?.userId });
    await createAuditLog({
      shopId: req.shopId, userId: req.user?.userId, action: "FURNITURE_ORDER_PAYMENT_ADDED",
      entityType: "FurnitureOrder", entityId: order.id,
      after: { ...auditSnapshot(order), amount: req.body?.amount, mode: req.body?.mode }, req,
    });
    res.status(201).json({
      success: true,
      message: order.isPaidUp ? "Paid in full" : `₹${order.balanceDue} still to collect`,
      data: order,
    });
  } catch (err) { next(err); }
}

export async function removePayment(req, res, next) {
  try {
    const order = await svc.removePayment(req.shopId, req.params.id, req.params.paymentId);
    await createAuditLog({
      shopId: req.shopId, userId: req.user?.userId, action: "FURNITURE_ORDER_PAYMENT_REMOVED",
      entityType: "FurnitureOrder", entityId: order.id,
      after: { ...auditSnapshot(order), removedPaymentId: req.params.paymentId }, req,
    });
    res.json({ success: true, message: "Payment removed", data: order });
  } catch (err) { next(err); }
}

export async function remove(req, res, next) {
  try {
    const order = await svc.softDeleteOrder(req.shopId, req.params.id);
    await createAuditLog({
      shopId: req.shopId, userId: req.user?.userId, action: "FURNITURE_ORDER_DELETED",
      entityType: "FurnitureOrder", entityId: order.id,
      after: auditSnapshot(order), metadata: { softDelete: true }, req,
    });
    res.json({ success: true, message: "Order moved to recycle bin", data: order });
  } catch (err) { next(err); }
}

export async function restore(req, res, next) {
  try { res.json({ success: true, message: "Order restored", data: await svc.restoreOrder(req.shopId, req.params.id) }); }
  catch (err) { next(err); }
}

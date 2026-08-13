import * as svc from "./bills.service.js";
import { createAuditLog } from "../audit/audit.service.js";
import { scheduleAuditEvaluation } from "../assurance/assurance.hooks.js";
import { ENTITY_TYPES } from "../assurance/assurance.constants.js";
import { requestLocationId } from "../stores/location-context.service.js";
import { assertLocationCapability } from "../stores/location-access.service.js";
import { deliverBillWhatsapp } from "./bill-whatsapp.service.js";

export async function list(req, res, next) {
  try {
    const data = await svc.listBills(req.shopId, { ...req.query, locationId: requestLocationId(req) });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function get(req, res, next) {
  try {
    const data = await svc.getBill(req.shopId, req.params.id);
    await assertLocationCapability({ shopId: req.shopId, userId: req.user?.userId, role: req.user?.role, locationId: data.locationId, capability: "view" });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function emailReceipt(req, res, next) {
  try {
    const bill = await svc.getBill(req.shopId, req.params.id);
    await assertLocationCapability({ shopId: req.shopId, userId: req.user?.userId, role: req.user?.role, locationId: bill.locationId, capability: "view" });
    const delivery = await svc.emailBillReceipt(req.shopId, req.params.id, req.body.email);
    await createAuditLog({ shopId: req.shopId, userId: req.user?.userId, action: "BILL_RECEIPT_EMAILED", entityType: "Bill", entityId: bill.id, metadata: { provider: delivery.provider, recipientDomain: req.body.email.split("@")[1] }, req });
    res.json({ success: true, data: delivery });
  } catch (err) { next(err); }
}

export async function whatsappReceipt(req, res, next) {
  try {
    const bill = await svc.getBill(req.shopId, req.params.id);
    await assertLocationCapability({ shopId: req.shopId, userId: req.user?.userId, role: req.user?.role, locationId: bill.locationId, capability: "view" });
    const delivery = await deliverBillWhatsapp(req.shopId, bill.id, req.body);
    res.json({ success: true, data: delivery });
  } catch (err) { next(err); }
}

export async function confirm(req, res, next) {
  try {
    const data = await svc.confirmBill(req.shopId, req.body, {
      userId: req.user?.userId ?? null,
      deviceId: req.headers?.["x-device-id"] ? String(req.headers["x-device-id"]) : null,
      locationId: requestLocationId(req),
      allowStockShortfall: true,
      ownerPinVerified: req.ownerPinVerified === true,
      sensitiveBillActions: req.sensitiveBillActions,
      req,
    });
    res.status(201).json({ success: true, data });
    // Post-commit, post-response: the assurance engine evaluates this sale
    // without adding latency to billing and can never fail the bill.
    scheduleAuditEvaluation(req.shopId, ENTITY_TYPES.BILL, data.id, { userId: req.user?.userId });
    if (data.customerId) scheduleAuditEvaluation(req.shopId, ENTITY_TYPES.CUSTOMER, data.customerId, { userId: req.user?.userId });
  } catch (err) { next(err); }
}

export async function saleReturn(req, res, next) {
  try {
    const data = await svc.createSaleReturn(req.shopId, { ...req.body, locationId: requestLocationId(req) }, {
      userId: req.user?.userId ?? null,
      deviceId: req.headers?.["x-device-id"] ? String(req.headers["x-device-id"]) : null,
      locationId: requestLocationId(req),
      req,
    });
    res.status(201).json({ success: true, data });
    scheduleAuditEvaluation(req.shopId, ENTITY_TYPES.BILL, data.id, { userId: req.user?.userId });
    if (data.returnOfBillId) scheduleAuditEvaluation(req.shopId, ENTITY_TYPES.BILL, data.returnOfBillId, { userId: req.user?.userId });
  } catch (err) { next(err); }
}

export async function cancel(req, res, next) {
  try {
    const existing = await svc.getBill(req.shopId, req.params.id);
    await assertLocationCapability({ shopId: req.shopId, userId: req.user?.userId, role: req.user?.role, locationId: existing.locationId, capability: "sell" });
    const data = await svc.cancelBill(req.shopId, req.params.id, req.body, {
      userId: req.user?.userId ?? null,
      deviceId: req.headers?.["x-device-id"] ? String(req.headers["x-device-id"]) : null,
      req,
    });
    res.json({ success: true, data });
    // A cancellation must reverse ledger, stock and udhar effects; re-evaluate
    // the bill (and the customer) so any incomplete reversal surfaces.
    scheduleAuditEvaluation(req.shopId, ENTITY_TYPES.BILL, data.id, { userId: req.user?.userId });
    if (data.customerId) scheduleAuditEvaluation(req.shopId, ENTITY_TYPES.CUSTOMER, data.customerId, { userId: req.user?.userId });
  } catch (err) { next(err); }
}

export async function remove(req, res, next) {
  try {
    const data = await svc.softDeleteBill(req.shopId, req.params.id, req.body, {
      userId: req.user?.userId ?? null,
      deviceId: req.headers?.["x-device-id"] ? String(req.headers["x-device-id"]) : null,
      req,
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function restore(req, res, next) {
  try {
    const data = await svc.restoreDeletedBill(req.shopId, req.params.id, {
      userId: req.user?.userId ?? null,
      deviceId: req.headers?.["x-device-id"] ? String(req.headers["x-device-id"]) : null,
      reason: req.body?.reason ?? null,
      req,
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

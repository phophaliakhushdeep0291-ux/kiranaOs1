import * as svc from "./bills.service.js";
import { createAuditLog } from "../audit/audit.service.js";
import { scheduleAuditEvaluation } from "../assurance/assurance.hooks.js";
import { ENTITY_TYPES } from "../assurance/assurance.constants.js";
import { publishIntegrationEvent } from "../integrations/integrations.service.js";
import { requestLocationId } from "../stores/location-context.service.js";
import { assertLocationCapability } from "../stores/location-access.service.js";

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

export async function confirm(req, res, next) {
  try {
    const data = await svc.confirmBill(req.shopId, req.body, {
      userId: req.user?.userId ?? null,
      deviceId: req.headers?.["x-device-id"] ? String(req.headers["x-device-id"]) : null,
      locationId: requestLocationId(req),
      allowStockShortfall: true,
    });
    await publishIntegrationEvent(req.shopId, "bill.created", {
      id: data.id,
      billNo: data.billNo,
      billType: data.billType,
      status: data.status,
      customerId: data.customerId,
      customerName: data.customerName,
      grandTotal: data.grandTotal,
      paidAmount: data.paidAmount,
      creditAmount: data.creditAmount,
      offerId: data.offerId,
      offerCode: data.offerCode,
      offerDiscount: data.offerDiscount,
      createdAt: data.createdAt,
      locationId: data.locationId,
    }).catch(() => []);
    if (data.offerId && Number(data.offerDiscount || 0) > 0 && data.billType !== "estimate") {
      await createAuditLog({
        shopId: req.shopId,
        userId: req.user?.userId,
        action: "OFFER_REDEEMED",
        entityType: "Bill",
        entityId: data.id,
        metadata: {
          billNo: data.billNo,
          offerId: data.offerId,
          offerCode: data.offerCode,
          discount: data.offerDiscount,
          locationId: data.locationId,
        },
        req,
      }).catch(() => null);
    }
    if (Number(data.loyaltyPointsRedeemed || 0) > 0) {
      await createAuditLog({
        shopId: req.shopId,
        userId: req.user?.userId,
        action: "LOYALTY_POINTS_REDEEMED",
        entityType: "Bill",
        entityId: data.id,
        metadata: {
          billNo: data.billNo,
          customerId: data.customerId,
          points: data.loyaltyPointsRedeemed,
          discount: data.loyaltyDiscount,
          locationId: data.locationId,
        },
        req,
      }).catch(() => null);
    }
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
    });
    await createAuditLog({
      shopId: req.shopId,
      userId: req.user?.userId,
      action: "SALE_RETURN_CREATED",
      entityType: "Bill",
      entityId: data.id,
      after: { billNo: data.billNo, grandTotal: data.grandTotal, refundMode: data.refundMode },
      metadata: {
        returnOfBillId: data.returnOfBillId ?? null,
        locationId: data.locationId,
        giftCardIssued: Boolean(data.issuedGiftCard),
        reason: req.body?.reason ?? null,
      },
      req,
    });
    await publishIntegrationEvent(req.shopId, "sale.return_created", {
      id: data.id,
      billNo: data.billNo,
      returnOfBillId: data.returnOfBillId,
      grandTotal: data.grandTotal,
      refundMode: data.refundMode,
      locationId: data.locationId,
    }).catch(() => []);
    res.status(201).json({ success: true, data });
    scheduleAuditEvaluation(req.shopId, ENTITY_TYPES.BILL, data.id, { userId: req.user?.userId });
    if (data.returnOfBillId) scheduleAuditEvaluation(req.shopId, ENTITY_TYPES.BILL, data.returnOfBillId, { userId: req.user?.userId });
  } catch (err) { next(err); }
}

export async function cancel(req, res, next) {
  try {
    const existing = await svc.getBill(req.shopId, req.params.id);
    await assertLocationCapability({ shopId: req.shopId, userId: req.user?.userId, role: req.user?.role, locationId: existing.locationId, capability: "sell" });
    const data = await svc.cancelBill(req.shopId, req.params.id, req.body);
    await createAuditLog({
      shopId: req.shopId,
      userId: req.user?.userId,
      action: "BILL_CANCELLED",
      entityType: "Bill",
      entityId: data.id,
      after: { status: data.status, cancelledAt: data.cancelledAt, cancelledReason: data.cancelledReason },
      metadata: { reason: req.body?.reason ?? null, billNo: data.billNo },
      req,
    });
    res.json({ success: true, data });
    // A cancellation must reverse ledger, stock and udhar effects; re-evaluate
    // the bill (and the customer) so any incomplete reversal surfaces.
    scheduleAuditEvaluation(req.shopId, ENTITY_TYPES.BILL, data.id, { userId: req.user?.userId });
    if (data.customerId) scheduleAuditEvaluation(req.shopId, ENTITY_TYPES.CUSTOMER, data.customerId, { userId: req.user?.userId });
  } catch (err) { next(err); }
}

import * as svc from "./bills.service.js";
import { createAuditLog } from "../audit/audit.service.js";
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
      createdAt: data.createdAt,
      locationId: data.locationId,
    }).catch(() => []);
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
  } catch (err) { next(err); }
}

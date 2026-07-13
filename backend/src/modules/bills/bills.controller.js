import * as svc from "./bills.service.js";
import { createAuditLog } from "../audit/audit.service.js";
import { publishIntegrationEvent } from "../integrations/integrations.service.js";
import { recordBillLoyalty, reverseBillLoyalty } from "../loyalty/loyalty.service.js";

export async function list(req, res, next) {
  try {
    const data = await svc.listBills(req.shopId, req.query);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function get(req, res, next) {
  try {
    const data = await svc.getBill(req.shopId, req.params.id);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function confirm(req, res, next) {
  try {
    const data = await svc.confirmBill(req.shopId, req.body, {
      userId: req.user?.userId ?? null,
      deviceId: req.headers?.["x-device-id"] ? String(req.headers["x-device-id"]) : null,
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
    }).catch(() => []);
    await recordBillLoyalty(req.shopId, data).catch(() => null);
    res.status(201).json({ success: true, data });
  } catch (err) { next(err); }
}

export async function cancel(req, res, next) {
  try {
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
    await reverseBillLoyalty(req.shopId, data.id).catch(() => null);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

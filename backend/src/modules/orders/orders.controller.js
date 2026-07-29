import * as svc from "./orders.service.js";
import { createAuditLog } from "../audit/audit.service.js";
import { publishIntegrationEvent } from "../integrations/integrations.service.js";

export async function list(req, res, next) {
  try {
    const data = await svc.listCustomerOrders(req.shopId, {
      status: req.query.status,
      sourceChannel: req.query.sourceChannel,
      paymentStatus: req.query.paymentStatus,
      cursor: req.query.cursor,
      limit: req.query.limit,
      locationId: req.operationalLocation?.id,
    });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function updateStatus(req, res, next) {
  try {
    const data = await svc.updateCustomerOrderStatus(req.shopId, req.params.id, {
      status: req.body?.status,
      paymentStatus: req.body?.paymentStatus,
      billId: req.body?.billId,
      locationId: req.operationalLocation?.id,
    });
    await createAuditLog({
      shopId: req.shopId,
      userId: req.user?.userId,
      action: "CUSTOMER_ORDER_STATUS_UPDATED",
      entityType: "CustomerOrder",
      entityId: data.id,
      metadata: { status: data.status, paymentStatus: data.paymentStatus, fulfillmentStatus: data.fulfillmentStatus, billId: data.billId, locationId: data.locationId },
      req,
    });
    await publishIntegrationEvent(req.shopId, "customer_order.updated", {
      id: data.id,
      locationId: data.locationId,
      fulfillmentType: data.fulfillmentType,
      status: data.status,
      sourceChannel: data.sourceChannel,
      paymentStatus: data.paymentStatus,
      fulfillmentStatus: data.fulfillmentStatus,
      billId: data.billId,
      updatedAt: data.updatedAt,
    });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

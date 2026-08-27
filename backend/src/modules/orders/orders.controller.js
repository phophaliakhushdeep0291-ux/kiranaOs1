import * as svc from "./orders.service.js";

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
      acceptanceKey: req.body?.acceptanceKey,
      locationId: req.operationalLocation?.id,
      actor: {
        userId: req.user?.userId ?? null,
        deviceId: req.headers?.["x-device-id"] ? String(req.headers["x-device-id"]) : undefined,
        req,
      },
    });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

import * as svc from "./orders.service.js";

export async function list(req, res, next) {
  try {
    const data = await svc.listCustomerOrders(req.shopId, { status: req.query.status });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function updateStatus(req, res, next) {
  try {
    const data = await svc.updateCustomerOrderStatus(req.shopId, req.params.id, {
      status: req.body?.status,
      billId: req.body?.billId,
    });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

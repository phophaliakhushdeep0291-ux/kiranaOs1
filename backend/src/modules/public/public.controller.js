import * as svc from "./public.service.js";

export async function catalog(req, res, next) {
  try {
    const data = await svc.getPublicCatalog(req.params.shopId);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function submitOrder(req, res, next) {
  try {
    const data = await svc.createPublicOrder(req.params.shopId, req.body, {
      idempotencyKey: req.get("Idempotency-Key") || req.get("X-Idempotency-Key"),
    });
    res.status(201).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

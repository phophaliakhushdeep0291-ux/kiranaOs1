import * as svc from "./public.service.js";
import { publishIntegrationEvent } from "../integrations/integrations.service.js";

export async function catalog(req, res, next) {
  try {
    const data = await svc.getPublicCatalog(req.params.shopId, req.query.locationId);
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
    if (!data.duplicate) {
      await publishIntegrationEvent(req.params.shopId, "customer_order.created", {
        id: data.orderId,
        locationId: data.locationId,
        fulfillmentType: data.fulfillmentType,
        status: data.status,
        itemCount: data.itemCount,
        estimatedTotal: data.estimatedTotal,
      });
    }
    res.status(201).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function orderStatus(req, res, next) {
  try {
    const data = await svc.getPublicOrderStatus(req.params.shopId, req.params.orderId);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

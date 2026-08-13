import * as svc from "./public.service.js";
import { activityBatchSchema } from "../activity/activity.schema.js";
import { recordOnlineActivity } from "../activity/online-activity.service.js";

export async function catalog(req, res, next) {
  try {
    // `table` is what a QR sticker on a restaurant table carries. Unknown codes
    // are not an error here: the menu still opens, and the page says the table
    // was not recognised rather than refusing to show anything.
    const data = await svc.getPublicCatalog(req.params.shopId, req.query.locationId, {
      tableCode: req.query.table ? String(req.query.table) : null,
    });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function submitOrder(req, res, next) {
  try {
    const data = await svc.createPublicOrder(req.params.shopId, req.body, {
      idempotencyKey: req.get("Idempotency-Key") || req.get("X-Idempotency-Key"),
      actor: { req },
    });
    res.status(201).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

/**
 * Online-session activity from the storefront. Validated here rather than by the
 * `validate` middleware because a malformed telemetry batch should be dropped
 * quietly, not turned into a 400 the shopper sees while trying to order.
 */
export async function onlineActivity(req, res, next) {
  try {
    const parsed = activityBatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(202).json({ success: true, data: { accepted: 0, duplicates: 0, rejected: 0, aggregated: 0 } });
    }
    const data = await recordOnlineActivity(req.params.shopId, parsed.data.events);
    res.status(202).json({ success: true, data });
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

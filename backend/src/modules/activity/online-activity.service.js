import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { isCustomerOrderingEnabled } from "../public/public.service.js";
import { isOnlineEventType } from "./activity.events.js";
import { recordActivityBatch } from "./activity.service.js";

/**
 * Online-session activity ingest (§13's online events) for the QR self-order
 * page, which is a public storefront with no login.
 *
 * An unauthenticated write endpoint is a liability unless it is boxed in, so
 * this one is:
 *
 *  - **Type-restricted.** Only ONLINE_* events are accepted. A caller cannot
 *    forge a LOGIN or a BILL_CREATED into a shop's history and skew its audit or
 *    analytics.
 *  - **Opt-in.** The shop must have customer ordering enabled, and the same
 *    single 404 as the catalog is returned for both "no such shop" and "not
 *    enabled", so this cannot be used to enumerate shop ids.
 *  - **Attribution-free.** No userId is ever recorded. A shopper is not a staff
 *    member, and their browsing must never feed a staff member's personal
 *    suggestions.
 *  - **Silent.** It answers 202 regardless, so a storefront never shows an error
 *    because analytics were unavailable.
 *
 * It also rides the global /api rate limiter, like every other public route.
 */

const MAX_ONLINE_BATCH = 50;

export async function recordOnlineActivity(shopId, events) {
  const shop = await db.shop.findUnique({ where: { id: shopId }, select: { id: true, settingsJson: true } });
  if (!shop || !isCustomerOrderingEnabled(shop.settingsJson)) {
    throw new AppError("This shop is not accepting online orders.", 404);
  }

  const list = Array.isArray(events) ? events.slice(0, MAX_ONLINE_BATCH) : [];
  const allowed = list.filter((event) => isOnlineEventType(event?.eventType));
  const rejectedTypes = list.length - allowed.length;

  const result = await recordActivityBatch(allowed, {
    shopId: shop.id,
    userId: null,
    orgId: null,
    deviceId: null,
    source: "online",
  });
  return { ...result, rejected: result.rejected + rejectedTypes };
}

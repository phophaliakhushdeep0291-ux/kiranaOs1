import assert from "node:assert/strict";
import db from "../src/db.js";
import "../src/verticals/restaurant/storefront/dine-in.storefront.js";
import { cancelPublicOrder, getPublicOrderStatus } from "../src/modules/public/public.service.js";

async function rejectedWith(promise, code) {
  const error = await promise.then(() => null, (caught) => caught);
  assert.ok(error, `expected ${code}`);
  assert.equal(error.code, code);
}

const settingsJson = JSON.stringify({
  customerOrdering: { enabled: true },
  businessProfile: { businessType: "restaurant" },
  restaurant: { dineIn: { guestOrders: true, cancellationWindowMinutes: 5 } },
});

const shop = await db.shop.create({ data: { name: `Cancellation ${Date.now()}`, ownerName: "Owner", city: "City", address: "Address", settingsJson } });
const fresh = await db.customerOrder.create({
    data: { shopId: shop.id, customerName: "T5", customerMobile: "", fulfillmentType: "dine_in", itemsJson: "[]", status: "new" },
  });
  const before = await getPublicOrderStatus(shop.id, fresh.id);
  assert.equal(before.cancellation.windowMinutes, 5);
  assert.equal(before.cancellation.allowed, true);

  const cancelled = await cancelPublicOrder(shop.id, fresh.id);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.cancellation.allowed, false);
  assert.equal((await cancelPublicOrder(shop.id, fresh.id)).status, "cancelled", "repeating cancellation is idempotent");

  const accepted = await db.customerOrder.create({
    data: { shopId: shop.id, customerName: "T6", customerMobile: "", fulfillmentType: "dine_in", itemsJson: "[]", status: "accepted" },
  });
  await rejectedWith(cancelPublicOrder(shop.id, accepted.id), "ORDER_ALREADY_ACCEPTED");

  const expired = await db.customerOrder.create({
    data: { shopId: shop.id, customerName: "T7", customerMobile: "", fulfillmentType: "dine_in", itemsJson: "[]", status: "new", createdAt: new Date(Date.now() - 6 * 60_000) },
  });
  await rejectedWith(cancelPublicOrder(shop.id, expired.id), "ORDER_CANCELLATION_WINDOW_ENDED");

  const audit = await db.auditLog.findFirst({ where: { shopId: shop.id, entityId: fresh.id, action: "CUSTOMER_ORDER_CANCELLED_BY_GUEST" } });
  assert.ok(audit, "guest cancellation must leave an audit record");
console.log("guest-order-cancellation.examples.js OK");

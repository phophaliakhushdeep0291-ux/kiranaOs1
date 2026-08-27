import assert from "node:assert/strict";
import db from "../src/db.js";
import "../src/verticals/restaurant/storefront/dine-in.storefront.js";
import { createPublicGuestRequest, createPublicOrder, submitPublicOrderFeedback, getPublicOrderStatus } from "../src/modules/public/public.service.js";
import { listGuestRequests, setGuestRequestStatus } from "../src/verticals/restaurant/service-ops/guest-requests.service.js";

async function withFailedAudit(action, operation) {
  const trigger = `force_guest_request_audit_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  await db.$executeRawUnsafe(`
    CREATE TRIGGER ${trigger}
    BEFORE INSERT ON AuditLog
    WHEN NEW.action = '${action}'
    BEGIN
      SELECT RAISE(ABORT, 'forced guest request audit failure');
    END
  `);
  try {
    await operation();
    assert.fail("guest request operation should fail closed when its audit write fails");
  } catch (error) {
    assert.ok(["ORDER_AUDIT_UNAVAILABLE", "GUEST_REQUEST_AUDIT_WRITE_FAILED"].includes(error?.code), error?.message);
  } finally {
    await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${trigger}`);
  }
}

const settingsJson = JSON.stringify({
  customerOrdering: { enabled: true },
  businessProfile: { businessType: "restaurant" },
  restaurant: { dineIn: { guestOrders: true, cancellationWindowMinutes: 5 } },
});
const shop = await db.shop.create({ data: { name: `Guest experience ${Date.now()}`, ownerName: "Owner", city: "City", address: "Address", settingsJson } });
const table = await db.restaurantTable.create({ data: { shopId: shop.id, code: "t5", name: "T5" } });
const order = await db.customerOrder.create({ data: {
  shopId: shop.id, customerName: "T5", customerMobile: "", fulfillmentType: "dine_in",
  tableId: table.id, tableName: table.name, itemsJson: JSON.stringify([{ productId: "dish-test", name: "Dish", qty: 1, price: 100, variation: { unitCode: "large", name: "Large" } }]), status: "fulfilled", fulfillmentStatus: "fulfilled",
} });

await assert.rejects(
  createPublicOrder(shop.id, { tableCode: table.code, items: [{ productId: "dish-test", qty: 100 }] }),
  (error) => error?.code === "ORDER_QUANTITY_LIMIT",
  "a table QR must not create an unbounded kitchen quantity",
);

const tracked = await getPublicOrderStatus(shop.id, order.id);
assert.equal(tracked.tableCode, "t5", "tracker returns the QR code, not the display name");
assert.equal(tracked.items[0].productId, "dish-test", "reorder needs the original product id");
assert.equal(tracked.items[0].variation.unitCode, "large");

const feedback = await submitPublicOrderFeedback(shop.id, order.id, { rating: 5, comment: "Excellent" });
assert.equal(feedback.rating, 5);
assert.equal((await submitPublicOrderFeedback(shop.id, order.id, { rating: 1 })).duplicate, true, "feedback is write-once");

const request = await createPublicGuestRequest(shop.id, table.id, { type: "waiter", orderId: order.id, reason: "Water" });
assert.equal(request.type, "waiter");
assert.equal((await createPublicGuestRequest(shop.id, table.id, { type: "waiter", orderId: order.id })).duplicate, true, "rapid duplicate requests are collapsed");
assert.equal((await listGuestRequests(shop.id, { status: "pending" })).length, 1);

await withFailedAudit("GUEST_BILL_REQUESTED", () => createPublicGuestRequest(shop.id, table.id, { type: "bill", orderId: order.id }));
assert.equal(await db.restaurantGuestRequest.count({ where: { shopId: shop.id, type: "bill" } }), 0, "public request creation and audit must commit together");

await withFailedAudit("RESTAURANT_GUEST_REQUEST_UPDATED", () => setGuestRequestStatus(shop.id, request.id, "acknowledged", null));
assert.equal((await db.restaurantGuestRequest.findUnique({ where: { id: request.id } })).status, "pending", "status change must roll back with its audit");
assert.equal((await setGuestRequestStatus(shop.id, request.id, "acknowledged", null)).status, "acknowledged");
assert.equal((await setGuestRequestStatus(shop.id, request.id, "completed", null)).status, "completed");
assert.equal((await setGuestRequestStatus(shop.id, request.id, "completed", null)).status, "completed", "same-status retry is idempotent");
await assert.rejects(
  setGuestRequestStatus(shop.id, request.id, "cancelled", null),
  (error) => error?.code === "GUEST_REQUEST_INVALID_TRANSITION",
);

console.log("restaurant-guest-experience.examples.js OK");

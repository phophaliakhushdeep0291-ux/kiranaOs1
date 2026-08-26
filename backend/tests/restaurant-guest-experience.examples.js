import assert from "node:assert/strict";
import db from "../src/db.js";
import "../src/verticals/restaurant/storefront/dine-in.storefront.js";
import { createPublicGuestRequest, submitPublicOrderFeedback } from "../src/modules/public/public.service.js";
import { listGuestRequests, setGuestRequestStatus } from "../src/verticals/restaurant/service-ops/guest-requests.service.js";

const settingsJson = JSON.stringify({
  customerOrdering: { enabled: true },
  businessProfile: { businessType: "restaurant" },
  restaurant: { dineIn: { guestOrders: true, cancellationWindowMinutes: 5 } },
});
const shop = await db.shop.create({ data: { name: `Guest experience ${Date.now()}`, ownerName: "Owner", city: "City", address: "Address", settingsJson } });
const table = await db.restaurantTable.create({ data: { shopId: shop.id, code: "t5", name: "T5" } });
const order = await db.customerOrder.create({ data: {
  shopId: shop.id, customerName: "T5", customerMobile: "", fulfillmentType: "dine_in",
  tableId: table.id, tableName: table.name, itemsJson: "[]", status: "fulfilled", fulfillmentStatus: "fulfilled",
} });

const feedback = await submitPublicOrderFeedback(shop.id, order.id, { rating: 5, comment: "Excellent" });
assert.equal(feedback.rating, 5);
assert.equal((await submitPublicOrderFeedback(shop.id, order.id, { rating: 1 })).duplicate, true, "feedback is write-once");

const request = await createPublicGuestRequest(shop.id, table.id, { type: "waiter", orderId: order.id, reason: "Water" });
assert.equal(request.type, "waiter");
assert.equal((await createPublicGuestRequest(shop.id, table.id, { type: "waiter", orderId: order.id })).duplicate, true, "rapid duplicate requests are collapsed");
assert.equal((await listGuestRequests(shop.id, { status: "pending" })).length, 1);
assert.equal((await setGuestRequestStatus(shop.id, request.id, "acknowledged", null)).status, "acknowledged");
assert.equal((await setGuestRequestStatus(shop.id, request.id, "completed", null)).status, "completed");

console.log("restaurant-guest-experience.examples.js OK");

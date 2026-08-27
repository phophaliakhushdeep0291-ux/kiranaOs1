import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import db from "../src/db.js";
import "../src/verticals/restaurant/storefront/dine-in.storefront.js";
import { updateCustomerOrderStatus, listCustomerOrders } from "../src/modules/orders/orders.service.js";
import { cancelPublicOrder } from "../src/modules/public/public.service.js";

const shop = await db.shop.create({ data: {
  name: "Acceptance regression", ownerName: "Owner", city: "City", address: "Address",
  settingsJson: JSON.stringify({ customerOrdering: { enabled: true }, businessProfile: { businessType: "restaurant" }, restaurant: { dineIn: { cancellationWindowMinutes: 5 } } }),
} });
const fresh = () => db.customerOrder.create({ data: { shopId: shop.id, customerName: "T1", customerMobile: "", fulfillmentType: "dine_in" } });
const accept = (order, key) => updateCustomerOrderStatus(shop.id, order.id, { status: "accepted", acceptanceKey: key });
const first = await fresh();
const key = randomUUID();
assert.equal((await accept(first, key)).status, "accepted");
assert.equal((await accept(first, key)).status, "accepted", "retry after a lost response is safe");
await assert.rejects(accept(first, randomUUID()), { code: "ORDER_ALREADY_CLAIMED" });
await assert.rejects(cancelPublicOrder(shop.id, first.id), { code: "ORDER_ALREADY_ACCEPTED" });
assert.equal((await listCustomerOrders(shop.id)).orders[0].acceptanceKey, undefined, "claims are not disclosed to another till");
const cancelled = await fresh();
await cancelPublicOrder(shop.id, cancelled.id);
await assert.rejects(accept(cancelled, randomUUID()), { code: "ORDER_ALREADY_CLAIMED" });

const race = await fresh();
const outcomes = await Promise.allSettled([accept(race, randomUUID()), cancelPublicOrder(shop.id, race.id)]);
assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1, "only acceptance OR cancellation may win");
const tills = await fresh();
const claims = await Promise.allSettled([accept(tills, randomUUID()), accept(tills, randomUUID())]);
assert.equal(claims.filter((result) => result.status === "fulfilled").length, 1, "only one till may claim an order");
await assert.rejects(updateCustomerOrderStatus("other-shop", first.id, { status: "accepted", acceptanceKey: key }), { statusCode: 404 });
console.log("guest-order-acceptance.examples.js OK");

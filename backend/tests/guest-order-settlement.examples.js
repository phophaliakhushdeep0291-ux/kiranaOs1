import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import db from "../src/db.js";
import "../src/verticals/restaurant/menu/addons.guard.js";
import "../src/verticals/restaurant/storefront/dine-in.storefront.js";
import { productData } from "./integration/factories.js";
import { resolveOperationalLocation } from "../src/modules/stores/location-context.service.js";
import { fireTicket, setTicketStatus } from "../src/verticals/restaurant/kot/kot.service.js";
import { confirmBill, cancelBill } from "../src/modules/bills/bills.service.js";
import { getPublicOrderStatus, submitPublicOrderFeedback } from "../src/modules/public/public.service.js";
import { retryStoredSyncConflicts } from "../src/modules/sync/sync.service.js";

const shop = await db.shop.create({ data: { name: "Settlement test", ownerName: "Owner", city: "City", address: "Address",
  settingsJson: JSON.stringify({ customerOrdering: { enabled: true }, businessProfile: { businessType: "restaurant" } }),
} });
const location = await resolveOperationalLocation(shop.id);
const table = await db.restaurantTable.create({ data: { shopId: shop.id, code: "t1", name: "T1" } });
const product = await db.product.create({ data: productData(shop.id, { name: "Dosa", defaultPricePerRateUnit: 100, stockBaseQty: 20 }) });
await db.productSellingUnit.create({ data: {
  shopId: shop.id, productId: product.id, name: "piece", unitType: "piece", unitCode: "piece-1-piece",
  conversionToBase: 1, defaultPrice: 100, isDefault: true,
} });
const makeOrder = () => db.customerOrder.create({ data: { shopId: shop.id, locationId: location.id, customerName: "T1", customerMobile: "", tableId: table.id, tableName: "T1", fulfillmentType: "dine_in", status: "accepted", fulfillmentStatus: "preparing",
  estimatedTotal: 100, itemsJson: JSON.stringify([{ productId: product.id, name: "Dosa", price: 100, qty: 1, unit: "piece", note: "No chilli" }]),
} });
const first = await makeOrder();
const second = await makeOrder();
const kot = await fireTicket(shop.id, { tableId: table.id, tableName: "T1", billId: "held-test", idempotencyKey: randomUUID(),
  lines: [first, second].map((order) => ({ key: order.id, name: "Dosa", qty: 1, unit: "piece", note: "No chilli", guestOrderId: order.id, guestOrderLineId: `${order.id}-0` })),
});
await setTicketStatus(shop.id, kot.ticket.id, "ready");
assert.equal((await getPublicOrderStatus(shop.id, first.id)).status, "ready");
await setTicketStatus(shop.id, kot.ticket.id, "served");
assert.equal((await getPublicOrderStatus(shop.id, second.id)).status, "fulfilled");
const secondServedAt = (await db.customerOrder.findUniqueOrThrow({ where: { id: second.id } })).fulfilledAt;
assert.ok(secondServedAt, "the kitchen stamped it when the plate went out");
await submitPublicOrderFeedback(shop.id, first.id, { rating: 5 });

const billBody = { clientBillId: randomUUID(), billType: "normal_sale", gstMode: "none", customerName: "T1", discount: 0, locationId: location.id,
  items: [first, second].map((order) => ({ productId: product.id, guestOrderId: order.id, guestOrderLineId: `${order.id}-0`, name: "Dosa", quantity: 1, enteredUnit: "piece", ratePerRateUnit: 100, gstRate: 0, lineDiscount: 0 })),
  payments: [{ mode: "cash", amount: 200 }],
};
const settle = (body) => confirmBill(shop.id, body, { deviceId: "test-till" });
await settle(billBody);
const savedFirst = await db.customerOrder.findUniqueOrThrow({ where: { id: first.id } });
const savedSecond = await db.customerOrder.findUniqueOrThrow({ where: { id: second.id } });
assert.ok(savedFirst.billId);
assert.equal(savedFirst.billId, savedSecond.billId, "multiple rounds settle on one bill");
assert.equal(savedFirst.paymentStatus, "paid");
assert.equal((await getPublicOrderStatus(shop.id, first.id)).paymentStatus, "paid");

// Settling the table ends the sitting. Progress through accepted -> ready ->
// fulfilled belongs to the kitchen ticket while the food is being cooked, but
// nothing downstream of the kitchen was closing the order afterwards: `first`
// stayed at "ready" for good, so the guest's own tracking page showed the food
// still coming AND "Payment received", and the order read as open to the shop.
assert.equal(savedFirst.status, "fulfilled", "a settled table closes its orders");
assert.equal(savedFirst.fulfillmentStatus, "fulfilled");
assert.ok(savedFirst.fulfilledAt, "and stamps when the sitting ended");
assert.equal((await getPublicOrderStatus(shop.id, first.id)).status, "fulfilled", "which is what the guest sees");
// An order the kitchen already finished keeps the moment it was served; the
// bill is not allowed to rewrite that to whenever somebody got round to paying.
assert.equal(
  savedSecond.fulfilledAt.getTime(), secondServedAt.getTime(),
  "an already-served order keeps its own served time",
);
await settle(billBody); // durable bill retry must not double-charge
await assert.rejects(settle({ ...billBody, clientBillId: randomUUID() }), { code: "GUEST_ORDER_BILL_MISMATCH" });

// A legacy till could lose both guest identifiers from one sibling line while
// retaining them on another. The server may recover that line only from an
// exact, unambiguous match against the accepted server snapshot.
const legacyOrder = await db.customerOrder.create({ data: { shopId: shop.id, locationId: location.id, customerName: "T1", customerMobile: "", tableId: table.id, tableName: "T1", fulfillmentType: "dine_in", status: "accepted", fulfillmentStatus: "preparing",
  estimatedTotal: 300, itemsJson: JSON.stringify([
    { productId: product.id, name: "Dosa", price: 100, qty: 1, unit: "piece" },
    { productId: product.id, name: "Dosa", price: 100, qty: 2, unit: "piece" },
  ]),
} });
const recoveredBill = await settle({ clientBillId: randomUUID(), billType: "normal_sale", gstMode: "none", customerName: "T1", discount: 0, locationId: location.id,
  items: [
    { productId: product.id, guestOrderId: legacyOrder.id, guestOrderLineId: `${legacyOrder.id}-0`, name: "Dosa", quantity: 1, enteredUnit: "piece", ratePerRateUnit: 100, gstRate: 0, lineDiscount: 0 },
    // The POS persists its default inventory-unit code even though the public
    // menu snapshot correctly has no restaurant variation code. That extra
    // representation must not prevent an otherwise exact legacy recovery.
    { productId: product.id, sellingUnitCode: "piece-1-piece", sellingUnitLabel: "piece", name: "Dosa", quantity: 2, enteredUnit: "piece-1-piece", ratePerRateUnit: 100, gstRate: 0, lineDiscount: 0 },
  ],
  payments: [{ mode: "cash", amount: 300 }],
});
assert.equal((await db.customerOrder.findUniqueOrThrow({ where: { id: legacyOrder.id } })).billId, recoveredBill.id, "an exact legacy sibling line is repaired and linked");

// A historical server conflict no longer has a client outbox row to requeue.
// The explicit retry endpoint must replay that protected snapshot with a fresh
// event id, retain the financial idempotency key, and close the old review only
// after the bill actually succeeds.
const retryOrder = await db.customerOrder.create({ data: { shopId: shop.id, locationId: location.id, customerName: "T1", customerMobile: "", tableId: table.id, tableName: "T1", fulfillmentType: "dine_in", status: "accepted", fulfillmentStatus: "preparing",
  estimatedTotal: 300, itemsJson: JSON.stringify([
    { productId: product.id, name: "Dosa", price: 100, qty: 1, unit: "piece" },
    { productId: product.id, name: "Dosa", price: 100, qty: 2, unit: "piece" },
  ]),
} });
const retryClientBillId = randomUUID();
const retrySourceEventId = `legacy-guest-bill-${randomUUID()}`;
const retryEvent = {
  eventId: retrySourceEventId,
  clientEventId: retrySourceEventId,
  type: "CREATE_BILL",
  payload: {
    clientBillId: retryClientBillId,
    idempotencyKey: retryClientBillId,
    billType: "normal_sale",
    gstMode: "none",
    customerName: "T1",
    discount: 0,
    locationId: location.id,
    items: [
      { productId: product.id, guestOrderId: retryOrder.id, guestOrderLineId: `${retryOrder.id}-0`, name: "Dosa", quantity: 1, enteredUnit: "piece", ratePerRateUnit: 100, gstRate: 0, lineDiscount: 0 },
      { productId: product.id, sellingUnitCode: "piece-1-piece", sellingUnitLabel: "piece", name: "Dosa", quantity: 2, enteredUnit: "piece-1-piece", ratePerRateUnit: 100, gstRate: 0, lineDiscount: 0 },
    ],
    payments: [{ mode: "cash", amount: 300 }],
  },
};
await db.offlineSyncEvent.create({ data: { shopId: shop.id, eventId: retrySourceEventId, type: "CREATE_BILL", status: "conflict", attempts: 1, requestJson: JSON.stringify(retryEvent), error: "Include every guest order line before settling the table." } });
const storedConflict = await db.syncConflict.create({ data: { shopId: shop.id, sourceEventId: retrySourceEventId, entityType: "bill", entityId: retryClientBillId, reasonCode: "CONFLICT", message: "Include every guest order line before settling the table.", localSnapshotJson: JSON.stringify(retryEvent.payload) } });
const replayed = await retryStoredSyncConflicts(shop.id, [retrySourceEventId], { deviceId: "test-till" });
assert.equal(replayed.replayed, 1, "the explicit retry replays the stored legacy bill");
assert.equal(replayed.results[0].status, "replayed", "the endpoint reports the exact recovery outcome");
assert.ok((await db.customerOrder.findUniqueOrThrow({ where: { id: retryOrder.id } })).billId, "the replay settles the guest order");
assert.equal((await db.offlineSyncEvent.findUniqueOrThrow({ where: { shopId_eventId: { shopId: shop.id, eventId: retrySourceEventId } } })).status, "synced", "the old event is closed only after replay success");
assert.equal((await db.syncConflict.findUniqueOrThrow({ where: { id: storedConflict.id } })).resolution, "replayed_after_validation_fix", "the old review records the successful replay");
const replayedAgain = await retryStoredSyncConflicts(shop.id, [retrySourceEventId], { deviceId: "test-till" });
assert.equal(replayedAgain.alreadyRecovered, 1, "repeating a successful recovery is an idempotent acknowledgement");
const skippedReplay = await retryStoredSyncConflicts(shop.id, ["missing-source-event"], { deviceId: "test-till" });
assert.equal(skippedReplay.results[0].code, "SOURCE_EVENT_NOT_FOUND", "the endpoint explains why a requested recovery was skipped");

const ambiguousOrder = await db.customerOrder.create({ data: { shopId: shop.id, locationId: location.id, customerName: "T1", customerMobile: "", tableId: table.id, tableName: "T1", fulfillmentType: "dine_in", status: "accepted", fulfillmentStatus: "preparing",
  estimatedTotal: 200, itemsJson: JSON.stringify([
    { productId: product.id, name: "Dosa", price: 100, qty: 1, unit: "piece" },
    { productId: product.id, name: "Dosa", price: 100, qty: 1, unit: "piece" },
  ]),
} });
await assert.rejects(settle({ clientBillId: randomUUID(), billType: "normal_sale", gstMode: "none", customerName: "T1", discount: 0, locationId: location.id,
  items: [
    { productId: product.id, guestOrderId: ambiguousOrder.id, guestOrderLineId: `${ambiguousOrder.id}-0`, name: "Dosa", quantity: 1, enteredUnit: "piece", ratePerRateUnit: 100, gstRate: 0, lineDiscount: 0 },
    { productId: product.id, name: "Dosa", quantity: 1, enteredUnit: "piece", ratePerRateUnit: 100, gstRate: 0, lineDiscount: 0 },
    { productId: product.id, name: "Dosa", quantity: 1, enteredUnit: "piece", ratePerRateUnit: 100, gstRate: 0, lineDiscount: 0 },
  ], payments: [{ mode: "cash", amount: 300 }],
}), { code: "GUEST_ORDER_BILL_MISMATCH" });
assert.equal((await db.customerOrder.findUniqueOrThrow({ where: { id: ambiguousOrder.id } })).billId, null, "ambiguous legacy lines remain blocked");

await assert.rejects(settle({ clientBillId: randomUUID(), billType: "normal_sale", gstMode: "none", customerName: "T1", discount: 0, locationId: location.id,
  items: [{ productId: product.id, guestOrderLineId: "orphan-order-0", name: "Dosa", quantity: 1, enteredUnit: "piece", ratePerRateUnit: 100, gstRate: 0, lineDiscount: 0 }],
  payments: [{ mode: "cash", amount: 100 }],
}), { code: "GUEST_ORDER_BILL_MISMATCH" });

const third = await makeOrder();
await assert.rejects(settle({ ...billBody, clientBillId: randomUUID(), items: [{ ...billBody.items[0], guestOrderId: third.id, guestOrderLineId: `${third.id}-0`, quantity: 2 }] }), { code: "GUEST_ORDER_BILL_MISMATCH" });
assert.equal((await db.customerOrder.findUniqueOrThrow({ where: { id: third.id } })).billId, null);
const halfTicket = async () => (await fireTicket(shop.id, { tableId: table.id, tableName: "T1", billId: "held-third", idempotencyKey: randomUUID(),
  lines: [{ key: "third", name: "Dosa", qty: 0.5, unit: "piece", guestOrderId: third.id, guestOrderLineId: `${third.id}-0` }],
})).ticket;
const halfA = await halfTicket();
await setTicketStatus(shop.id, halfA.id, "ready");
assert.equal((await getPublicOrderStatus(shop.id, third.id)).status, "accepted", "half an order is not ready");
const halfB = await halfTicket();
await setTicketStatus(shop.id, halfB.id, "ready");
assert.equal((await getPublicOrderStatus(shop.id, third.id)).status, "ready");
await setTicketStatus(shop.id, halfA.id, "served");
assert.equal((await getPublicOrderStatus(shop.id, third.id)).status, "ready", "half served must not unlock feedback");
await setTicketStatus(shop.id, halfB.id, "served");
assert.equal((await getPublicOrderStatus(shop.id, third.id)).status, "fulfilled");
await cancelBill(shop.id, savedFirst.billId, { reason: "Correct receipt" });
assert.equal((await getPublicOrderStatus(shop.id, first.id)).paymentStatus, "unpaid", "a cancelled receipt must not display as paid");
await settle({ ...billBody, clientBillId: randomUUID() });
assert.notEqual((await db.customerOrder.findUniqueOrThrow({ where: { id: first.id } })).billId, savedFirst.billId, "replacement receipt may link after cancellation");
console.log("guest-order-settlement.examples.js OK");

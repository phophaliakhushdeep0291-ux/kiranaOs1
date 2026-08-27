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

const shop = await db.shop.create({ data: { name: "Settlement test", ownerName: "Owner", city: "City", address: "Address",
  settingsJson: JSON.stringify({ customerOrdering: { enabled: true }, businessProfile: { businessType: "restaurant" } }),
} });
const location = await resolveOperationalLocation(shop.id);
const table = await db.restaurantTable.create({ data: { shopId: shop.id, code: "t1", name: "T1" } });
const product = await db.product.create({ data: productData(shop.id, { name: "Dosa", defaultPricePerRateUnit: 100, stockBaseQty: 20 }) });
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
    { productId: product.id, name: "Dosa", quantity: 2, enteredUnit: "piece", ratePerRateUnit: 100, gstRate: 0, lineDiscount: 0 },
  ],
  payments: [{ mode: "cash", amount: 300 }],
});
assert.equal((await db.customerOrder.findUniqueOrThrow({ where: { id: legacyOrder.id } })).billId, recoveredBill.id, "an exact legacy sibling line is repaired and linked");

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

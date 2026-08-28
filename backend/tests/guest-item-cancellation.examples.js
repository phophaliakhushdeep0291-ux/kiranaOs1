import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import db from "../src/db.js";
import "../src/verticals/restaurant/menu/addons.guard.js";
import "../src/verticals/restaurant/storefront/dine-in.storefront.js";
import { productData } from "./integration/factories.js";
import { resolveOperationalLocation } from "../src/modules/stores/location-context.service.js";
import { cancelPublicOrder, getPublicOrderStatus, getPublicTableBill } from "../src/modules/public/public.service.js";
import { updateCustomerOrderStatus, listCustomerOrders } from "../src/modules/orders/orders.service.js";
import { fireTicket, setTicketStatus } from "../src/verticals/restaurant/kot/kot.service.js";
import { confirmBill } from "../src/modules/bills/bills.service.js";

const settings = (minutes) => JSON.stringify({ customerOrdering: { enabled: true }, businessProfile: { businessType: "restaurant" }, restaurant: { dineIn: { guestOrders: true, cancellationWindowMinutes: minutes } } });
const shop = await db.shop.create({ data: { name: "Item cancellation", ownerName: "Owner", city: "City", address: "Address", settingsJson: settings(5) } });
const location = await resolveOperationalLocation(shop.id);
const table = await db.restaurantTable.create({ data: { shopId: shop.id, code: "t1", name: "T1" } });
const product = await db.product.create({ data: productData(shop.id, { name: "Dosa", defaultPricePerRateUnit: 200, stockBaseQty: 100 }) });
const snapshots = [
  { productId: product.id, name: "Plain dosa", price: 110, qty: 1, unit: "piece", note: "No chilli" },
  { productId: product.id, name: "Cheese dosa", price: 125.5, basePrice: 100, qty: 3, unit: "piece", addons: [{ optionId: "cheese", name: "Cheese", groupName: "Extras", price: 25.5, quantity: 1 }] },
  { productId: product.id, name: "Mini dosa", price: 75, qty: 1, unit: "piece" },
];
const makeOrder = (extra = {}) => db.customerOrder.create({ data: { shopId: shop.id, locationId: location.id, customerName: "T1", customerMobile: "", tableId: table.id, tableName: "T1", fulfillmentType: "dine_in", status: "new", itemCount: 3, estimatedTotal: 561.5, itemsJson: JSON.stringify(snapshots), ...extra } });
const cancel = (order, items) => cancelPublicOrder(shop.id, order.id, { selection: { items } });
const target = (order, index, quantity) => ({ lineId: `${order.id}-${index}`, cancelledQuantity: quantity });
const errorCode = async (promise, code) => assert.rejects(promise, { code });

const order = await makeOrder();
const single = await cancel(order, [target(order, 1, 1)]);
assert.equal(single.status, "new");
assert.equal(single.estimatedTotal, 436);
assert.equal(single.itemCount, 3);
assert.equal(single.items[1].qty, 2);
assert.equal(single.items[1].price, 125.5, "the original portion and add-on quote is retained");
assert.equal(single.cancelledItems[0].qty, 1);
assert.ok(single.cancellation.itemSelectionAllowed);
assert.deepEqual(await cancel(order, [target(order, 1, 1)]), single, "a repeated target cannot cancel another serving");
assert.equal(await db.auditLog.count({ where: { entityId: order.id, action: "CUSTOMER_ORDER_ITEMS_CANCELLED_BY_GUEST" } }), 1);

for (const selection of [null, [], { items: [] }, { items: null }, { items: [{ lineId: `${order.id}-1`, cancelledQuantity: 0 }] }, { items: [{ lineId: `${order.id}-1`, cancelledQuantity: 1.5 }] }, { items: [{ lineId: `${order.id}-1`, cancelledQuantity: "1" }] }, { itemIds: [`${order.id}-1`] }]) {
  await errorCode(cancelPublicOrder(shop.id, order.id, { selection }), "INVALID_CANCELLATION_SELECTION");
}
await errorCode(cancel(order, [target(order, 0, 1), target(order, 1, 4)]), "INVALID_CANCELLATION_SELECTION");
await errorCode(cancel(order, [target(order, 1, 2), target(order, 1, 2)]), "INVALID_CANCELLATION_SELECTION");
await errorCode(cancel(order, [{ lineId: "another-order-1", cancelledQuantity: 1 }]), "INVALID_CANCELLATION_SELECTION");
assert.equal((await getPublicOrderStatus(shop.id, order.id)).estimatedTotal, 436, "invalid batches do not partially apply");

const reduced = await cancel(order, [target(order, 1, 3)]);
assert.deepEqual(reduced.items.map((line) => line.lineId), [`${order.id}-0`, `${order.id}-2`], "removed middle line never renumbers later lines");
assert.equal(reduced.estimatedTotal, 185);
assert.equal(reduced.itemCount, 2);
assert.equal(JSON.parse((await db.customerOrder.findUniqueOrThrow({ where: { id: order.id } })).itemsJson)[1].qty, 3, "original quantities remain auditable");
assert.equal((await getPublicTableBill(shop.id, table.id)).estimatedTotal, 185);
assert.equal((await listCustomerOrders(shop.id)).orders.find((row) => row.id === order.id).items.length, 2);

const accepted = await updateCustomerOrderStatus(shop.id, order.id, { status: "accepted", acceptanceKey: randomUUID() });
assert.deepEqual(accepted.items.map((line) => line.lineId), [`${order.id}-0`, `${order.id}-2`]);
await errorCode(cancel(order, [target(order, 0, 1)]), "ORDER_ALREADY_ACCEPTED");
await cancel(order, [target(order, 1, 3)]); // lost-reply replay after acceptance is harmless
await errorCode(fireTicket(shop.id, { tableId: table.id, tableName: "T1", billId: "held-partial", idempotencyKey: randomUUID(), lines: [{ key: "removed", name: "Cheese dosa", qty: 1, guestOrderId: order.id, guestOrderLineId: `${order.id}-1` }] }), "GUEST_KOT_LINE_MISMATCH");
const ticket = await fireTicket(shop.id, { tableId: table.id, tableName: "T1", billId: "held-partial", idempotencyKey: randomUUID(), lines: accepted.items.map((line) => ({ key: line.lineId, name: line.name, qty: line.qty, unit: line.unit, guestOrderId: order.id, guestOrderLineId: line.lineId })) });
await setTicketStatus(shop.id, ticket.ticket.id, "ready");
assert.equal((await getPublicOrderStatus(shop.id, order.id)).status, "ready", "kitchen completion only requires remaining dishes");
await setTicketStatus(shop.id, ticket.ticket.id, "served");
const bill = { clientBillId: randomUUID(), billType: "normal_sale", gstMode: "none", customerName: "T1", discount: 0, locationId: location.id, items: accepted.items.map((line) => ({ productId: product.id, guestOrderId: order.id, guestOrderLineId: line.lineId, name: line.name, quantity: line.qty, enteredUnit: "piece", ratePerRateUnit: line.price, gstRate: 0, lineDiscount: 0 })), payments: [{ mode: "cash", amount: 185 }] };
bill.reason = "Preserve the guest's original quote after menu repricing";
await errorCode(confirmBill(shop.id, { ...bill, items: [...bill.items, { ...bill.items[0], guestOrderLineId: `${order.id}-1` }] }, { ownerPinVerified: true }), "GUEST_ORDER_BILL_MISMATCH");
await confirmBill(shop.id, bill, { deviceId: "test-cancellation", ownerPinVerified: true });
assert.equal((await getPublicOrderStatus(shop.id, order.id)).paymentStatus, "paid");
assert.equal((await getPublicTableBill(shop.id, table.id)).estimatedTotal, 0);

const full = await makeOrder();
await cancel(full, [target(full, 1, 1)]);
const all = await cancelPublicOrder(shop.id, full.id);
assert.equal(all.status, "cancelled");
assert.equal(all.estimatedTotal, 0);
assert.equal(all.items.length, 0);
assert.equal(all.cancelledItems.length, 3);
assert.equal((await cancelPublicOrder(shop.id, full.id)).status, "cancelled");

const expired = await makeOrder({ createdAt: new Date(Date.now() - 5 * 60_000 - 100) });
await errorCode(cancel(expired, [target(expired, 0, 1)]), "ORDER_CANCELLATION_WINDOW_ENDED");
await db.shop.update({ where: { id: shop.id }, data: { settingsJson: settings(10) } });
await cancel(expired, [target(expired, 0, 1)]);
await db.customerOrder.update({ where: { id: expired.id }, data: { createdAt: new Date(Date.now() - 11 * 60_000) } });
await cancel(expired, [target(expired, 0, 1)]);
await errorCode(cancel(expired, [target(expired, 2, 1)]), "ORDER_CANCELLATION_WINDOW_ENDED");
for (const paymentStatus of ["paid", "partially_paid", "refunded"]) {
  const paid = await makeOrder({ paymentStatus });
  assert.equal((await getPublicOrderStatus(shop.id, paid.id)).cancellation.allowed, false);
  await errorCode(cancel(paid, [target(paid, 0, 1)]), "ORDER_PAYMENT_LOCKED");
}
const billed = await makeOrder({ billId: "already-billed" });
await errorCode(cancel(billed, [target(billed, 0, 1)]), "ORDER_PAYMENT_LOCKED");
const auditFailure = await makeOrder();
await db.$executeRawUnsafe("CREATE TRIGGER fail_item_cancellation_audit BEFORE INSERT ON AuditLog WHEN NEW.action = 'CUSTOMER_ORDER_ITEMS_CANCELLED_BY_GUEST' BEGIN SELECT RAISE(ABORT, 'forced audit failure'); END");
try {
  await errorCode(cancel(auditFailure, [target(auditFailure, 0, 1)]), "ORDER_AUDIT_UNAVAILABLE");
  assert.equal((await getPublicOrderStatus(shop.id, auditFailure.id)).estimatedTotal, 561.5, "an audit failure rolls back item changes and totals");
} finally {
  await db.$executeRawUnsafe("DROP TRIGGER fail_item_cancellation_audit");
}
const raced = await makeOrder();
const acceptanceKey = randomUUID();
const results = await Promise.allSettled([
  cancel(raced, [target(raced, 1, 1)]),
  updateCustomerOrderStatus(shop.id, raced.id, { status: "accepted", acceptanceKey }),
]);
const afterRace = await getPublicOrderStatus(shop.id, raced.id);
assert.ok([561.5, 436].includes(afterRace.estimatedTotal));
if (results[0].status === "fulfilled") assert.equal(afterRace.estimatedTotal, 436);
if (results[1].status === "fulfilled") {
  assert.deepEqual(results[1].value.items.map((line) => line.qty), afterRace.items.map((line) => line.qty), "acceptance must return the winning snapshot");
}
await updateCustomerOrderStatus(shop.id, raced.id, { status: "accepted", acceptanceKey });
await errorCode(cancel(raced, [target(raced, 1, 3)]), "ORDER_ALREADY_ACCEPTED");
await assert.rejects(cancelPublicOrder("different-shop", order.id, { selection: { items: [target(order, 0, 1)] } }), { statusCode: 404 });
await db.shop.update({ where: { id: shop.id }, data: { settingsJson: settings(0) } });
const disabled = await makeOrder();
await errorCode(cancel(disabled, [target(disabled, 0, 1)]), "ORDER_CANCELLATION_DISABLED");
console.log("guest-item-cancellation.examples.js OK: selective quantities, retries, policy, payment locks, kitchen and settlement");

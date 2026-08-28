import assert from "node:assert/strict";
import db from "../src/db.js";
import "../src/verticals/restaurant/storefront/dine-in.storefront.js";
import { getPublicTableBill } from "../src/modules/public/public.service.js";

/**
 * What a table owes, across every round it has ordered.
 *
 * A dine-in table orders more than once and settles once. Before this endpoint
 * the public API could only answer for a single order, so a guest asking for
 * the bill after a second round was shown that round alone and believed it was
 * the bill — then met a larger number at the counter.
 *
 * The cases below are the ones where getting it wrong costs somebody money:
 * food billed twice, food not billed at all, and a table inheriting the
 * previous party's meal.
 */

const settingsJson = JSON.stringify({
  customerOrdering: { enabled: true },
  businessProfile: { businessType: "restaurant" },
  restaurant: { dineIn: { guestOrders: true, cancellationWindowMinutes: 5 } },
});

const shop = await db.shop.create({ data: { name: `Table bill ${Date.now()}`, ownerName: "Owner", city: "City", address: "Address", settingsJson } });
const table = await db.restaurantTable.create({ data: { shopId: shop.id, code: "t9", name: "T9" } });
const other = await db.restaurantTable.create({ data: { shopId: shop.id, code: "t10", name: "T10" } });

let ordered = 0;
async function round(overrides = {}, { name = "Dosa", qty = 1, price = 120 } = {}) {
  ordered += 1;
  return db.customerOrder.create({ data: {
    shopId: shop.id, customerName: "Guest", customerMobile: "", fulfillmentType: "dine_in",
    tableId: table.id, tableName: table.name,
    itemsJson: JSON.stringify([{ productId: `dish-${ordered}`, name, qty, price }]),
    itemCount: qty, estimatedTotal: qty * price,
    // Ordered a second apart so "oldest first" is deterministic rather than
    // whatever order the database happens to return rows in.
    createdAt: new Date(Date.now() + ordered * 1000),
    ...overrides,
  } });
}

/* ------------------------------------------------------- every round on it */

const first = await round();
const second = await round({}, { name: "Filter coffee", qty: 2, price: 60 });

let bill = await getPublicTableBill(shop.id, table.id);
assert.deepEqual(bill.orderIds, [first.id, second.id], "both rounds belong to the table's bill");
assert.deepEqual(bill.items.map((line) => `${line.name} x${line.qty}`), ["Dosa x1", "Filter coffee x2"], "every dish, in the order it was ordered");
assert.equal(bill.itemCount, 3);
assert.equal(bill.estimatedTotal, 240, "120 + 120, not one round of it");
assert.equal(bill.settled, false);
assert.equal(bill.tableCode, "t9");

/* --------------------------------------------- asking again changes nothing */

const again = await getPublicTableBill(shop.id, table.id);
assert.deepEqual(again.orderIds, bill.orderIds, "a guest tapping twice does not double the table's food");
assert.equal(again.estimatedTotal, bill.estimatedTotal);

/* ------------------------------------------------ nobody cooked that food */

const cancelled = await round({ status: "cancelled" }, { name: "Cancelled dish", price: 999 });
const rejected = await round({ status: "rejected" }, { name: "Rejected dish", price: 999 });
bill = await getPublicTableBill(shop.id, table.id);
assert.ok(!bill.orderIds.includes(cancelled.id), "a cancelled round is not owed for");
assert.ok(!bill.orderIds.includes(rejected.id), "a rejected round is not owed for");
assert.equal(bill.estimatedTotal, 240, "and neither reaches the total");

/* ------------------------------------------------------------- turnover */

await db.customerOrder.update({ where: { id: first.id }, data: { paymentStatus: "paid" } });
bill = await getPublicTableBill(shop.id, table.id);
assert.deepEqual(bill.orderIds, [second.id], "a round that has been paid for leaves the table");
assert.equal(bill.estimatedTotal, 120, "so the next party does not inherit it");

/* ------------------------------------ settled through a bill, not a column */

const paidBill = await db.bill.create({ data: {
  shopId: shop.id, billNo: `TB-${Date.now()}`, customerName: "Guest",
  subtotal: 120, grandTotal: 120, paidAmount: 120, creditAmount: 0, status: "active",
} });
await db.customerOrder.update({ where: { id: second.id }, data: { billId: paidBill.id } });
bill = await getPublicTableBill(shop.id, table.id);
assert.deepEqual(bill.orderIds, [], "an order settled through its bill is settled");
assert.equal(bill.settled, true, "and the table says so rather than erroring");
assert.equal(bill.estimatedTotal, 0);

/* ------------------------------- a voided bill collected nothing */

await db.bill.update({ where: { id: paidBill.id }, data: { status: "cancelled" } });
bill = await getPublicTableBill(shop.id, table.id);
assert.deepEqual(bill.orderIds, [second.id], "a cancelled bill means the food is still owed for");

await db.bill.update({ where: { id: paidBill.id }, data: { status: "active", creditAmount: 60, paidAmount: 60 } });
bill = await getPublicTableBill(shop.id, table.id);
assert.deepEqual(bill.orderIds, [second.id], "a part-paid bill is still outstanding");

/* --------------------------------------------------- one table, not the room */

await db.customerOrder.create({ data: {
  shopId: shop.id, customerName: "Guest", customerMobile: "", fulfillmentType: "dine_in",
  tableId: other.id, tableName: other.name,
  itemsJson: JSON.stringify([{ productId: "dish-other", name: "Someone else's dinner", qty: 1, price: 500 }]),
  itemCount: 1, estimatedTotal: 500,
} });
bill = await getPublicTableBill(shop.id, table.id);
assert.ok(!bill.items.some((line) => line.name === "Someone else's dinner"), "another table's food never reaches this bill");
assert.equal(bill.estimatedTotal, 120);

/* ------------------------------------------------------------ bad input */

await assert.rejects(getPublicTableBill(shop.id, "no-such-table"), (error) => error?.statusCode === 404, "an unknown table is a flat 404");
await assert.rejects(getPublicTableBill("no-such-shop", table.id), (error) => error?.statusCode === 404, "so is an unknown shop");

console.log("restaurant-table-bill: ok");

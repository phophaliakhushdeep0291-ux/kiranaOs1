import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import db from "../src/db.js";
import "../src/verticals/restaurant/menu/addons.guard.js";
import "../src/verticals/restaurant/storefront/dine-in.storefront.js";
import { productData, createCustomer } from "./integration/factories.js";
import { resolveOperationalLocation } from "../src/modules/stores/location-context.service.js";
import { confirmBill } from "../src/modules/bills/bills.service.js";
import { confirmBillSchema } from "../src/modules/bills/bills.schema.js";
import { pushOfflineActions } from "../src/modules/sync/sync.service.js";

// Run only via run-db-example-tests.js: every row below belongs to its isolated
// test database, never to a restaurant's real table or failed historical bill.
const shop = await db.shop.create({ data: {
  name: "Normal billing regression", ownerName: "Test owner", city: "Test", address: "Test",
  settingsJson: JSON.stringify({ customerOrdering: { enabled: true }, businessProfile: { businessType: "restaurant" } }),
} });
const location = await resolveOperationalLocation(shop.id);
const table = await db.restaurantTable.create({ data: { shopId: shop.id, code: "qa", name: "QA table" } });
const products = await Promise.all([
  db.product.create({ data: productData(shop.id, { name: "Coffee", defaultPricePerRateUnit: 45, stockBaseQty: 20 }) }),
  db.product.create({ data: productData(shop.id, { name: "Dal", defaultPricePerRateUnit: 155, stockBaseQty: 20 }) }),
]);
const units = await Promise.all(products.map((product) => db.productSellingUnit.create({ data: {
  shopId: shop.id, productId: product.id, name: "piece", unitType: "piece", unitCode: "piece-1-piece",
  conversionToBase: 1, defaultPrice: product.defaultPricePerRateUnit, isDefault: true,
} })));
const order = await db.customerOrder.create({ data: {
  shopId: shop.id, locationId: location.id, customerName: table.name, customerMobile: "",
  tableId: table.id, tableName: table.name, fulfillmentType: "dine_in", status: "accepted", fulfillmentStatus: "preparing",
  estimatedTotal: 200, itemsJson: JSON.stringify(products.map((product) => ({
    productId: product.id, name: product.name, price: product.defaultPricePerRateUnit, qty: 1, unit: "piece",
  }))),
} });
const lines = products.map((product, index) => ({
  productId: product.id, sellingUnitId: units[index].id, sellingUnitCode: units[index].unitCode,
  sellingUnitLabel: "piece", conversionToBase: 1, name: product.name, quantity: 1,
  enteredUnit: "piece", ratePerRateUnit: product.defaultPricePerRateUnit,
  baseRatePerRateUnit: product.defaultPricePerRateUnit, gstRate: 0, lineDiscount: 0,
}));
const actor = { deviceId: "normal-billing-test", role: "owner" };
const guestBody = {
  clientBillId: randomUUID(), locationId: location.id, billType: "normal_sale", gstMode: "inclusive",
  customerName: table.name, discount: 0, actualAmount: 200, buyerPaidAmount: 200, roundOff: true,
  items: lines.map((line, index) => ({ ...line, guestOrderId: order.id, guestOrderLineId: `${order.id}-${index}`, wasPriceOverridden: true })),
  payments: [{ mode: "cash", amount: 200 }],
};

// A validation rejection must leave everything open and unwritten. Correcting
// that request uses the SAME identity; the rejection must not poison the retry.
await assert.rejects(confirmBill(shop.id, { ...guestBody, items: [guestBody.items[0]] }, actor), { code: "GUEST_ORDER_BILL_MISMATCH" });
assert.equal(await db.bill.count({ where: { shopId: shop.id } }), 0);
assert.equal((await db.customerOrder.findUniqueOrThrow({ where: { id: order.id } })).billId, null);

const guestBill = await confirmBill(shop.id, confirmBillSchema.parse(guestBody), actor);
assert.equal(guestBill.grandTotal, 200);
assert.equal(guestBill.items.length, 2);
const settled = await db.customerOrder.findUniqueOrThrow({ where: { id: order.id } });
assert.equal(settled.billId, guestBill.id);
assert.equal(settled.paymentStatus, "paid");
// Simulate receiving no acknowledgement, then pressing Save again.
assert.equal((await confirmBill(shop.id, confirmBillSchema.parse(guestBody), actor)).id, guestBill.id);
assert.equal(await db.payment.count({ where: { billId: guestBill.id } }), 1);
assert.equal(await db.stockLedger.count({ where: { billId: guestBill.id, action: "sale" } }), 2);

// Pickup/delivery orders use a generic editable cart, but their final bill,
// payment status and fulfilment must still commit together. A PENDING local id
// followed by a best-effort status request used to leave paid orders as unpaid.
const pickupOrder = await db.customerOrder.create({ data: {
  shopId: shop.id, locationId: location.id, customerName: "Pickup guest", customerMobile: "9999999999",
  fulfillmentType: "pickup", status: "accepted", fulfillmentStatus: "preparing",
  estimatedTotal: 50, itemsJson: JSON.stringify([{ productId: products[0].id, name: "Coffee", price: 50, qty: 1, unit: "piece" }]),
} });
const pickupBill = await confirmBill(shop.id, confirmBillSchema.parse({
  clientBillId: randomUUID(), sourceOrderId: pickupOrder.id, locationId: location.id,
  billType: "normal_sale", gstMode: "inclusive", customerName: pickupOrder.customerName,
  items: [{ name: "Pickup charge", quantity: 1, enteredUnit: "piece", ratePerRateUnit: 50, gstRate: 0 }],
  discount: 0, actualAmount: 50, buyerPaidAmount: 50, payments: [{ mode: "cash", amount: 50 }],
}), actor);
const fulfilledPickup = await db.customerOrder.findUniqueOrThrow({ where: { id: pickupOrder.id } });
assert.equal(fulfilledPickup.billId, pickupBill.id);
assert.equal(fulfilledPickup.status, "fulfilled");
assert.equal(fulfilledPickup.paymentStatus, "paid");

// Ordinary local-first counter sale: the open-draft identity is deliberately
// different from its local database row id, as it is in the actual frontend.
const customer = await createCustomer(db, shop.id);
const clientBillId = `open-${randomUUID()}`;
const localBillId = `bill_${randomUUID()}`;
const idempotencyKey = `create-bill:${shop.id}:${shop.id}:${actor.deviceId}:${clientBillId}`;
const event = {
  eventId: randomUUID(), type: "CREATE_BILL", entity_id: localBillId, device_id: actor.deviceId,
  payload: {
    clientBillId, localBillId, idempotencyKey, locationId: location.id,
    customerId: customer.id, customerName: customer.name, billType: "normal_sale", gstMode: "inclusive",
    items: lines, discount: 0, actualAmount: 200, buyerPaidAmount: 140, creditAmount: 60,
    payments: [{ mode: "cash", amount: 100, clientPaymentId: randomUUID() }, { mode: "upi", amount: 40, clientPaymentId: randomUUID() }],
  },
};
const pushed = await pushOfflineActions(shop.id, [event], actor);
assert.equal(pushed.failed, 0, JSON.stringify(pushed.results));
const normalBill = await db.bill.findFirstOrThrow({ where: { shopId: shop.id, clientBillId } });
assert.equal(normalBill.paidAmount, 140);
assert.equal(normalBill.creditAmount, 60);
assert.equal(pushed.results[0].result.localBillId, localBillId);
assert.equal(pushed.results[0].result.clientBillId, clientBillId);
// Both transport retries and a rebuilt outbox event must converge to one sale.
assert.equal((await pushOfflineActions(shop.id, [event], actor)).failed, 0);
assert.equal((await pushOfflineActions(shop.id, [{ ...event, eventId: randomUUID() }], actor)).failed, 0);
assert.equal(await db.bill.count({ where: { shopId: shop.id, clientBillId } }), 1);
assert.equal(await db.payment.count({ where: { billId: normalBill.id } }), 2);
assert.equal(await db.udharLedger.count({ where: { billId: normalBill.id, type: "debit" } }), 1);
assert.equal(await db.stockLedger.count({ where: { billId: normalBill.id, action: "sale" } }), 2);
for (const product of products) {
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: product.id } })).stockBaseQty, 18);
}
console.log("normal-billing-flow.examples.js OK — guest and counter bills commit once; stock, tender and credit reconcile");
await db.$disconnect();

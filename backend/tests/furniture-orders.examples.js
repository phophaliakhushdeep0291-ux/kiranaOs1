import assert from "assert";
import {
  OPEN_STATUSES,
  RESERVING_STATUSES,
  serializeOrder,
  totalsFor,
} from "../src/verticals/furniture-home/orders/orders.service.js";
import {
  addPaymentSchema,
  createOrderSchema,
} from "../src/verticals/furniture-home/orders/orders.schema.js";

// Furniture sales orders. Every other trade sells across a counter; this one
// quotes on Monday, takes a third as an advance, and delivers a month later. For
// that whole stretch the money and the goods are in different places, so what
// has to be right is the arithmetic an advance is taken against and the reading
// of where the order has got to.

/** A stored row as Prisma would hand it back. */
function order(overrides = {}) {
  return {
    id: "o_1",
    orderNumber: "SO-000001",
    status: "confirmed",
    customerName: "Ramesh Kumar",
    grandTotal: 67300,
    quotedOn: new Date(),
    promisedOn: null,
    deliveredAt: null,
    installedAt: null,
    payments: [],
    items: [],
    ...overrides,
  };
}

const daysFromNow = (days) => new Date(Date.now() + days * 86_400_000);

/* ── The arithmetic an advance is taken against ────────────────────────────── */

const totals = totalsFor({
  items: [{ amount: 42000 }, { amount: 28000 }],
  discount: 5000,
  deliveryCharge: 1500,
  installCharge: 800,
});
assert.equal(totals.itemsTotal, 70000, "line amounts add up");
assert.equal(totals.grandTotal, 67300, "discount comes off, charges go on");

// A discount larger than the order is a typo, not money the shop owes.
assert.equal(totalsFor({ items: [{ amount: 100 }], discount: 500 }).grandTotal, 0, "a total never goes negative");
assert.equal(totalsFor({}).grandTotal, 0, "an empty order totals nothing");
assert.equal(totalsFor({ items: [{ amount: 100 }] }).grandTotal, 100, "no charges means the lines alone");
// Delivery and installation are charged separately from the goods, which is how
// this trade quotes and how a customer expects to see it.
assert.equal(totalsFor({ items: [], deliveryCharge: 1500 }).grandTotal, 1500, "delivery alone is a valid order");

/* ── What is still owed ────────────────────────────────────────────────────── */

const unpaid = serializeOrder(order());
assert.equal(unpaid.paidTotal, 0);
assert.equal(unpaid.balanceDue, 67300);
assert.equal(unpaid.isPaidUp, false);
assert.equal(unpaid.advancePercent, 0);

// Several advances are normal: a booking amount, an instalment, the balance.
const partPaid = serializeOrder(order({ payments: [{ amount: 20000 }, { amount: 25000 }] }));
assert.equal(partPaid.paidTotal, 45000, "advances add up");
assert.equal(partPaid.balanceDue, 22300);
assert.equal(partPaid.advancePercent, 67, "the percentage taken is rounded for display");
assert.equal(partPaid.isPaidUp, false);

const settled = serializeOrder(order({ payments: [{ amount: 67300 }] }));
assert.equal(settled.isPaidUp, true, "nothing left to collect");
assert.equal(settled.balanceDue, 0);

// Floating-point addition of rupee amounts should not leave an order a hundredth
// of a rupee short of paid.
const nearlyExact = serializeOrder(order({ grandTotal: 0.3, payments: [{ amount: 0.1 }, { amount: 0.2 }] }));
assert.equal(nearlyExact.isPaidUp, true, "a rounding crumb does not keep an order open");

// Taking more than the order is worth is a refund waiting to happen, so it is
// surfaced rather than silently clamped away.
const overpaid = serializeOrder(order({ payments: [{ amount: 80000 }] }));
assert.equal(overpaid.isOverpaid, true);
assert.equal(overpaid.balanceDue, 0, "the balance still does not go negative");
assert.equal(settled.isOverpaid, false, "paying exactly is not overpaying");

/* ── Where the order has got to ────────────────────────────────────────────── */

for (const status of OPEN_STATUSES) {
  assert.equal(serializeOrder(order({ status })).isOpen, true, `${status} is still owed to the customer`);
}
for (const status of ["delivered", "installed", "cancelled"]) {
  assert.equal(serializeOrder(order({ status })).isOpen, false, `${status} is closed`);
}

// A quote holds nothing — nobody has committed — and a delivered piece has
// physically gone. Only the middle holds stock off the floor.
assert.deepEqual(RESERVING_STATUSES, ["confirmed", "in_production", "ready"]);
assert.ok(!RESERVING_STATUSES.includes("quote"), "a quotation does not hold the floor");
assert.ok(!RESERVING_STATUSES.includes("delivered"), "a delivered piece is gone, not held");

/* ── Overdue is what gets chased ───────────────────────────────────────────── */

const late = serializeOrder(order({ status: "confirmed", promisedOn: daysFromNow(-3) }));
assert.equal(late.isOverdue, true, "a promise three days past is overdue");
assert.equal(late.daysToPromised, -3);
assert.equal(late.isDueSoon, false, "already late is not 'due soon'");

const tomorrow = serializeOrder(order({ status: "ready", promisedOn: daysFromNow(1) }));
assert.equal(tomorrow.isDueSoon, true, "tomorrow is what the van is loaded from");
assert.equal(tomorrow.isOverdue, false);

const today = serializeOrder(order({ status: "ready", promisedOn: daysFromNow(0) }));
assert.equal(today.isDueSoon, true, "today is due soon, not yet overdue");
assert.equal(today.isOverdue, false, "a promise for today is kept until the day is out");

const nextMonth = serializeOrder(order({ status: "confirmed", promisedOn: daysFromNow(30) }));
assert.equal(nextMonth.isDueSoon, false);
assert.equal(nextMonth.isOverdue, false);

// A delivered order is history, however late it was — leaving it flagged would
// keep it on a chase list forever.
const lateButDelivered = serializeOrder(order({ status: "delivered", promisedOn: daysFromNow(-30) }));
assert.equal(lateButDelivered.isOverdue, false, "a closed order is never overdue");

// An order with no promised date cannot be late against a promise never made.
const noPromise = serializeOrder(order({ status: "confirmed", promisedOn: null }));
assert.equal(noPromise.isOverdue, false);
assert.equal(noPromise.daysToPromised, null);

/* ── What may follow what ──────────────────────────────────────────────────── */

// The path is not a straight line: a piece sold off the floor skips production,
// and a showroom that does not install stops at delivered.
assert.deepEqual(serializeOrder(order({ status: "quote" })).nextStatuses, ["confirmed", "cancelled"]);
assert.deepEqual(serializeOrder(order({ status: "confirmed" })).nextStatuses, ["in_production", "ready", "cancelled"]);
assert.deepEqual(serializeOrder(order({ status: "ready" })).nextStatuses, ["delivered", "cancelled"]);
assert.deepEqual(serializeOrder(order({ status: "delivered" })).nextStatuses, ["installed"],
  "a delivered order cannot be cancelled — the goods are with the customer");
assert.deepEqual(serializeOrder(order({ status: "installed" })).nextStatuses, [], "installed is the end");
assert.deepEqual(serializeOrder(order({ status: "cancelled" })).nextStatuses, [], "cancelled is the end");

assert.equal(serializeOrder(order({ status: "quote" })).canCancel, true);
assert.equal(serializeOrder(order({ status: "installed" })).canCancel, false);

assert.equal(serializeOrder(order({ status: "in_production" })).statusLabel, "Being made");
assert.equal(serializeOrder(null), null, "a missing row serialises to nothing, not a crash");

/* ── What the order book will accept ───────────────────────────────────────── */

const minimal = { customerName: "Ramesh Kumar", items: [{ name: "Teak Sofa", qty: 1, rate: 42000 }] };

const parsed = createOrderSchema.parse(minimal);
assert.equal(parsed.status, "quote", "a quotation is the usual starting point");
assert.equal(parsed.isCustom, false);
assert.equal(parsed.items[0].reserveStock, true, "a line holds the floor unless said otherwise");

// A piece sold off the floor for delivery next week is confirmed from the moment
// it is written, but an order cannot be created already delivered.
assert.doesNotThrow(() => createOrderSchema.parse({ ...minimal, status: "confirmed" }));
assert.throws(() => createOrderSchema.parse({ ...minimal, status: "delivered" }));

// Most of what this trade sells to order is not in the catalogue at all.
assert.doesNotThrow(() => createOrderSchema.parse({
  ...minimal,
  items: [{ name: "Custom wardrobe, teak, 8ft", qty: 1, rate: 55000 }],
}), "a made-to-order piece needs no product");

assert.throws(() => createOrderSchema.parse({ ...minimal, items: [] }), /at least one item/i);
assert.throws(() => createOrderSchema.parse({ ...minimal, customerName: "" }), /customer's name/i);
assert.throws(() => createOrderSchema.parse({ ...minimal, items: [{ name: "Sofa", qty: 0, rate: 1 }] }), /more than 0/i);
assert.throws(() => createOrderSchema.parse({ ...minimal, promisedOn: "next Tuesday" }), /YYYY-MM-DD/i);
assert.throws(() => createOrderSchema.parse({ ...minimal, discount: -100 }));

// An advance of nothing is not an advance.
assert.throws(() => addPaymentSchema.parse({ amount: 0 }), /how much was paid/i);
assert.throws(() => addPaymentSchema.parse({ amount: -500 }));
assert.equal(addPaymentSchema.parse({ amount: 20000 }).mode, "cash", "cash unless said otherwise");
assert.doesNotThrow(() => addPaymentSchema.parse({ amount: 20000, mode: "upi", reference: "UPI-8891" }));
assert.throws(() => addPaymentSchema.parse({ amount: 100, mode: "barter" }));
// Backdating catches up an advance taken and not entered at the time.
assert.doesNotThrow(() => addPaymentSchema.parse({ amount: 100, paidOn: "2026-08-01" }));

console.log("furniture-orders: all checks passed");

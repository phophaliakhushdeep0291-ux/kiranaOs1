import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import db from "../src/db.js";
import { pullSince } from "../src/modules/sync/sync.service.js";

/**
 * A cashier's sync must not consume history it is not allowed to receive.
 *
 * Sync pull always fetched suppliers, purchase history and expenses, then replaced
 * them with [] on the way out for a cashier device. The rows never left the server,
 * which was the point — but the CURSOR advanced off them anyway.
 *
 * Cursors are keyed `entity:<name>` against tenant/store/device, not against the
 * user (frontend: sync-pull.ts cursorRowId). So a cashier syncing on the counter
 * machine moved the suppliers cursor past the shop's entire supplier history, and
 * when the owner signed in on that same machine the next pull started AFTER it.
 * Those rows were never delivered again: nothing re-requests them, because
 * clearSyncCursors() only runs inside forceCloudSnapshotImport(), which has no
 * callers. The device would show an empty supplier list and no expense history for
 * good, while sync reported it was up to date.
 *
 * Not querying at all fixes the waste and the loss together: no work done, and the
 * cursor stays where it is for whoever signs in next with the role to see it.
 */

const shop = await db.shop.create({
  data: { name: "Sync role cursor proof", ownerName: "Owner", city: "Indore", address: "1 Test Road" },
});
await db.user.create({
  data: {
    shopId: shop.id, name: "Owner", mobile: "9000000901", role: "owner",
    passwordHash: await bcrypt.hash("password", 10), pinHash: await bcrypt.hash("4242", 10),
  },
});

const product = await db.product.create({
  data: {
    shopId: shop.id, name: "Synced Biscuit", category: "Biscuits",
    displayUnit: "piece", baseUnit: "piece", rateUnit: "piece",
    stockBaseQty: 10, costPerRateUnit: 6, minPricePerRateUnit: 8, defaultPricePerRateUnit: 10,
  },
});
await db.supplier.createMany({ data: [
  { shopId: shop.id, name: "Sharma Traders", mobile: "9822200001" },
  { shopId: shop.id, name: "Verma Agencies", mobile: "9822200002" },
] });
await db.expense.createMany({ data: [
  { shopId: shop.id, title: "Shop rent", amount: 12000, category: "rent", paymentMode: "cash", status: "paid" },
] });
await db.purchaseHistory.createMany({ data: [
  { shopId: shop.id, productId: product.id, supplierName: "Sharma Traders", qtyBase: 100, pricePerRateUnit: 6, totalCost: 600, billAmount: 600, note: "" },
] });

const EPOCH = "1970-01-01T00:00:00.000Z";
const OWNER_ONLY = ["suppliers", "purchaseHistory", "expenses"];

/* --------------------- the owner receives them and moves on ---------------- */

const ownerPull = await pullSince(shop.id, EPOCH, { limit: 500, role: "owner" });
assert.equal(ownerPull.suppliers.length, 2, "the owner gets the suppliers");
assert.equal(ownerPull.expenses.length, 1, "and the expenses");
assert.equal(ownerPull.purchaseHistory.length, 1, "and the purchase history");
for (const entity of OWNER_ONLY) {
  assert.ok(ownerPull.sync.entityCursors[entity], `${entity} cursor advances for a role that received the rows`);
}

/* ------------- the cashier receives none, and consumes none ---------------- */

const staffPull = await pullSince(shop.id, EPOCH, { limit: 500, role: "staff" });
for (const entity of OWNER_ONLY) {
  assert.equal(staffPull[entity].length, 0, `a cashier must not receive ${entity}`);
  assert.equal(
    staffPull.sync.entityCursors[entity], null,
    `${entity} cursor must stay put — advancing it spends history the device never got`,
  );
  assert.equal(staffPull.sync.hasMoreByEntity[entity], false, `and ${entity} must not ask for another page forever`);
}

// What the cashier IS entitled to still syncs normally, or the device would stall.
assert.equal(staffPull.products.length, 1, "the catalogue still arrives");
assert.ok(staffPull.sync.entityCursors.products, "and its cursor still advances");

/* ---------------- the bug itself: the same device, the owner next ---------- */

// The counter machine holds whatever the cashier's pull left behind. An owner
// signing in there resumes from exactly those cursors.
const ownerAfterStaff = await pullSince(shop.id, EPOCH, {
  limit: 500, role: "owner", cursors: staffPull.sync.entityCursors,
});
assert.equal(ownerAfterStaff.suppliers.length, 2, "the owner must still get every supplier the cashier could not see");
assert.equal(ownerAfterStaff.expenses.length, 1, "and every expense");
assert.equal(ownerAfterStaff.purchaseHistory.length, 1, "and every purchase");

// And the same resumption with the cursors an OWNER pull produced returns nothing
// new, which is what an advanced cursor is supposed to mean.
const ownerAgain = await pullSince(shop.id, EPOCH, {
  limit: 500, role: "owner", cursors: ownerPull.sync.entityCursors,
});
for (const entity of OWNER_ONLY) {
  assert.equal(ownerAgain[entity].length, 0, `${entity} already delivered must not be sent twice`);
}

/* ----------------------- and the work is not done either ------------------- */

let queries = 0;
const countingMiddleware = async (params, next) => { queries += 1; return next(params); };
db.$use(countingMiddleware);
queries = 0;
await pullSince(shop.id, EPOCH, { limit: 500, role: "owner" });
const ownerQueries = queries;
queries = 0;
await pullSince(shop.id, EPOCH, { limit: 500, role: "staff" });
const staffQueries = queries;

assert.ok(
  staffQueries < ownerQueries,
  `a cashier pull must not run the three queries it throws away (owner ${ownerQueries}, cashier ${staffQueries})`,
);
assert.equal(ownerQueries - staffQueries, 4, "suppliers, purchaseHistory, expenses, and the supplier-payment attach");

console.log(`Sync pull role cursor examples passed (owner ${ownerQueries} queries, cashier ${staffQueries})`);

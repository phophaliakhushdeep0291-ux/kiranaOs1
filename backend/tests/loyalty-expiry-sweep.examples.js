/**
 * Which loyalty points expire, and what the ledger says about it.
 *
 * A shopkeeper's customer walks in with a card and asks what their points are
 * worth. If the sweep zeroes an account it should not have, that customer is
 * told they have nothing; if it writes an `expire` row for points that are still
 * there, the ledger no longer adds up to the balance. Both are arguments at a
 * counter, so both are asserted here.
 *
 * The sweep was rewritten from one transaction per account into one transaction
 * for the batch. It had no behavioural test at the time — only a grep for the
 * string "expire" in the source — so these assertions exist to say the rules
 * below are the same ones as before.
 */
import assert from "node:assert/strict";
import db from "../src/db.js";
import { listAccounts } from "../src/modules/loyalty/loyalty.service.js";

const ok = (label) => console.log(`  ok ${label}`);
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000);

const shop = await db.shop.create({ data: { name: "Loyalty expiry test", ownerName: "T", city: "T", address: "T" } });
try {
  await db.loyaltyProgram.create({ data: { shopId: shop.id, active: true, pointsExpireDays: 365 } });

  let seq = 0;
  const account = async (label, pointsBalance, lastEarnedAt) => {
    const customer = await db.customer.create({ data: { shopId: shop.id, name: label, mobile: `90000000${String(++seq).padStart(2, "0")}` } });
    return db.loyaltyAccount.create({ data: { shopId: shop.id, customerId: customer.id, pointsBalance, lifetimeEarned: pointsBalance, lastEarnedAt } });
  };

  const lapsed = await account("Lapsed", 400, daysAgo(400));
  const alsoLapsed = await account("Also lapsed", 150, daysAgo(900));
  const active = await account("Active", 300, daysAgo(10));
  const exactlyOnTheLine = await account("Recent enough", 200, daysAgo(364));
  // Nothing to take away. It must not collect an `expire` row for zero points.
  const empty = await account("Empty", 0, daysAgo(900));
  // An account that has never earned has no dormancy clock to run down.
  const neverEarned = await account("Never earned", 50, null);

  await listAccounts(shop.id);

  const balances = Object.fromEntries(
    (await db.loyaltyAccount.findMany({ where: { shopId: shop.id }, select: { id: true, pointsBalance: true } }))
      .map((row) => [row.id, row.pointsBalance]),
  );

  assert.equal(balances[lapsed.id], 0, "an account dormant past the window loses its points");
  assert.equal(balances[alsoLapsed.id], 0, "every dormant account in the batch is swept, not just the first");
  ok("points dormant past the window are expired");

  assert.equal(balances[active.id], 300, "a customer who earned this month keeps their points");
  assert.equal(balances[exactlyOnTheLine.id], 200, "a customer one day inside the window keeps their points");
  assert.equal(balances[neverEarned.id], 50, "an account that never earned has no dormancy clock to run down");
  ok("points inside the window, and points with no earning history, are left alone");

  const rows = await db.loyaltyTransaction.findMany({ where: { shopId: shop.id, type: "expire" }, select: { accountId: true, points: true, source: true } });
  assert.deepEqual(
    Object.fromEntries(rows.map((row) => [row.accountId, row.points])),
    { [lapsed.id]: -400, [alsoLapsed.id]: -150 },
    "the ledger records exactly the points removed, from exactly the accounts they left",
  );
  assert.ok(rows.every((row) => row.source === "system"), "an automatic sweep is attributed to the system, not to a cashier");
  assert.ok(!rows.some((row) => row.accountId === empty.id), "an account with nothing to lose collects no ledger row");
  ok("the ledger matches the points actually removed, and nothing else");

  /* ------------------------------------------------- the sweep is idempotent */
  await listAccounts(shop.id);
  const afterSecondPass = await db.loyaltyTransaction.count({ where: { shopId: shop.id, type: "expire" } });
  assert.equal(afterSecondPass, 2, "a second sweep finds nothing left to expire and writes nothing");
  ok("running the sweep again does not expire the same points twice");

  /* ------------------------------------------- expiry can be switched off */
  const offShop = await db.shop.create({ data: { name: "No expiry", ownerName: "T", city: "T", address: "T" } });
  try {
    await db.loyaltyProgram.create({ data: { shopId: offShop.id, active: true, pointsExpireDays: 0 } });
    const offCustomer = await db.customer.create({ data: { shopId: offShop.id, name: "Forever", mobile: "9111111111" } });
    const forever = await db.loyaltyAccount.create({ data: { shopId: offShop.id, customerId: offCustomer.id, pointsBalance: 999, lifetimeEarned: 999, lastEarnedAt: daysAgo(5000) } });
    await listAccounts(offShop.id);
    const kept = await db.loyaltyAccount.findUnique({ where: { id: forever.id }, select: { pointsBalance: true } });
    assert.equal(kept.pointsBalance, 999, "a shop that turned expiry off keeps every point however old");
    assert.equal(await db.loyaltyTransaction.count({ where: { shopId: offShop.id } }), 0);
    ok("a shop with expiry switched off never loses a point");
  } finally {
    await db.loyaltyTransaction.deleteMany({ where: { shopId: offShop.id } });
    await db.loyaltyAccount.deleteMany({ where: { shopId: offShop.id } });
    await db.customer.deleteMany({ where: { shopId: offShop.id } });
    await db.loyaltyProgram.deleteMany({ where: { shopId: offShop.id } });
    await db.shop.deleteMany({ where: { id: offShop.id } });
  }

  console.log("Loyalty expiry sweep examples passed");
} finally {
  await db.loyaltyTransaction.deleteMany({ where: { shopId: shop.id } });
  await db.loyaltyAccount.deleteMany({ where: { shopId: shop.id } });
  await db.customer.deleteMany({ where: { shopId: shop.id } });
  await db.loyaltyProgram.deleteMany({ where: { shopId: shop.id } });
  await db.shop.deleteMany({ where: { id: shop.id } });
}

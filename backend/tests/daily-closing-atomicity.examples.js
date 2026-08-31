import assert from "node:assert/strict";
import db from "../src/db.js";
import {
  generateDailyClosingSnapshot,
  lockDailyClosingSnapshot,
  overrideRefreshDailyClosingSnapshot,
  recordDailyClosingDrawerCount,
  unlockDailyClosingSnapshot,
} from "../src/modules/reports/dailyClosingSnapshot.service.js";

async function expectFailure(promise, code, message) {
  const error = await promise.then(() => null, (caught) => caught);
  assert.ok(error, `${message} — expected a rejection`);
  assert.equal(error.code, code, `${message} — got ${error.code}: ${error.message}`);
}

const shop = await db.shop.create({
  data: { name: `Closing atomicity ${Date.now()}`, ownerName: "Owner", city: "Pune", address: "Test" },
});

try {
  const location = await db.storeLocation.create({
    data: { shopId: shop.id, code: "MAIN", name: "Main", isPrimary: true },
  });
  const date = "2026-08-20";

  const created = await generateDailyClosingSnapshot(shop.id, date, { storeId: location.id, source: "test" });
  assert.equal(created.snapshot.created, true);
  assert.equal(await db.auditLog.count({ where: { shopId: shop.id, action: "DAILY_CLOSING_SNAPSHOT_CREATED" } }), 1);

  // Locking a day now requires the drawer to have been counted first, so that a
  // sealed day always carries the shopkeeper's own declaration of the cash. Prove
  // the gate, then satisfy it - the rest of this file is about whether the lock,
  // override and unlock are atomic, which only starts once a lock is possible.
  await expectFailure(
    lockDailyClosingSnapshot(shop.id, date, null, location.id),
    "DRAWER_COUNT_REQUIRED_BEFORE_LOCK",
    "a day cannot be sealed before the cash in the drawer has been counted",
  );
  await recordDailyClosingDrawerCount(shop.id, date, {
    storeId: location.id,
    countedCashPaise: 0,
    countedAt: new Date(`${date}T18:30:00.000Z`).toISOString(),
  }, { userId: null });

  const locked = await lockDailyClosingSnapshot(shop.id, date, null, location.id);
  assert.ok(locked.snapshot.lockedAt);
  assert.equal(await db.auditLog.count({ where: { shopId: shop.id, action: "DAILY_CLOSING_SNAPSHOT_LOCKED" } }), 1);

  const beforeOverride = await db.dailyClosingSnapshot.findUnique({
    where: { shopId_storeId_date: { shopId: shop.id, storeId: location.id, date: new Date(`${date}T00:00:00.000Z`) } },
  });
  await db.$executeRawUnsafe(`
    CREATE TRIGGER fail_daily_closing_override_audit
    BEFORE INSERT ON AuditLog
    WHEN NEW.action = 'DAILY_CLOSING_SNAPSHOT_OVERRIDE_REFRESHED'
    BEGIN
      SELECT RAISE(ABORT, 'forced daily closing override audit failure');
    END
  `);
  await expectFailure(
    overrideRefreshDailyClosingSnapshot(shop.id, date, {
      storeId: location.id, source: "test", reason: "Owner corrected the closing",
    }),
    "DAILY_CLOSING_AUDIT_WRITE_FAILED",
    "an unaudited closing override must roll back",
  );
  await db.$executeRawUnsafe("DROP TRIGGER fail_daily_closing_override_audit");
  const afterOverrideFailure = await db.dailyClosingSnapshot.findUnique({ where: { id: beforeOverride.id } });
  assert.equal(afterOverrideFailure.generatedAt.toISOString(), beforeOverride.generatedAt.toISOString());
  assert.equal(afterOverrideFailure.lockedAt.toISOString(), beforeOverride.lockedAt.toISOString());

  await db.$executeRawUnsafe(`
    CREATE TRIGGER fail_daily_closing_unlock_audit
    BEFORE INSERT ON AuditLog
    WHEN NEW.action = 'DAILY_CLOSING_SNAPSHOT_UNLOCKED'
    BEGIN
      SELECT RAISE(ABORT, 'forced daily closing unlock audit failure');
    END
  `);
  await expectFailure(
    unlockDailyClosingSnapshot(shop.id, date, null, location.id),
    "DAILY_CLOSING_AUDIT_WRITE_FAILED",
    "an unaudited unlock must roll back",
  );
  await db.$executeRawUnsafe("DROP TRIGGER fail_daily_closing_unlock_audit");
  assert.ok((await db.dailyClosingSnapshot.findUnique({ where: { id: beforeOverride.id } })).lockedAt);

  const unlocked = await unlockDailyClosingSnapshot(shop.id, date, null, location.id);
  assert.equal(unlocked.snapshot.lockedAt, null);
  assert.equal(await db.auditLog.count({ where: { shopId: shop.id, action: "DAILY_CLOSING_SNAPSHOT_UNLOCKED" } }), 1);

  console.log("daily-closing-atomicity.examples.js OK");
} finally {
  await db.$executeRawUnsafe("DROP TRIGGER IF EXISTS fail_daily_closing_override_audit");
  await db.$executeRawUnsafe("DROP TRIGGER IF EXISTS fail_daily_closing_unlock_audit");
  await db.auditLog.deleteMany({ where: { shopId: shop.id } });
  await db.dailyClosingSnapshot.deleteMany({ where: { shopId: shop.id } });
  await db.storeLocation.deleteMany({ where: { shopId: shop.id } });
  await db.shop.delete({ where: { id: shop.id } });
  await db.$disconnect();
}

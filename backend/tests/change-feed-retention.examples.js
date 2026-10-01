/**
 * What the change-feed sweep is allowed to delete.
 *
 * ChangeLog is how a device FINDS OUT. `/sync/pull` is `seq > cursor` against
 * it, so a row removed while some device's cursor still sits below it is not
 * slow sync — it is a bill that device never hears about, on a feed that reports
 * itself clean. These are the rules that make that impossible, pinned against a
 * real database because the watermark is a property of rows, not of a function.
 */
import assert from "node:assert/strict";
import db from "../src/db.js";
import { runChangeFeedRetention } from "../src/workers/syncCleanup.worker.js";

const DAY = 24 * 60 * 60 * 1000;
const suffix = `feed-retention-${Date.now()}`;
const ancient = new Date(Date.now() - 200 * DAY);
const yesterday = new Date(Date.now() - 1 * DAY);

const shops = [];

async function makeShop(name) {
  const shop = await db.shop.create({
    data: { name: `${suffix}-${name}`, ownerName: "QA", city: "Jaipur", address: "Isolated test" },
  });
  shops.push(shop);
  // Trigger-written rows from shop creation would muddy every count below.
  await db.changeLog.deleteMany({ where: { shopId: shop.id } });
  return shop;
}

async function appendFeed(shopId, count, createdAt) {
  const seqs = [];
  for (let i = 0; i < count; i += 1) {
    const row = await db.changeLog.create({
      data: { shopId, entityType: "bill", entityId: `bill-${i}`, operation: "update", createdAt },
      select: { seq: true },
    });
    seqs.push(row.seq);
  }
  return seqs;
}

async function makeDevice(shopId, deviceId, { appliedSeq, heardFrom, status = "active" }) {
  return db.device.create({
    data: {
      shopId,
      deviceId,
      status,
      dataEpoch: 0,
      lastAppliedServerSeq: appliedSeq,
      lastSyncAckAt: heardFrom,
      lastSeenAt: heardFrom,
    },
  });
}

const apply = { dryRun: false, confirm: true };

try {
  // ── A device that has never acknowledged pins the feed ────────────────────
  {
    const shop = await makeShop("never-acked");
    await appendFeed(shop.id, 5, ancient);
    await makeDevice(shop.id, "till-silent", { appliedSeq: null, heardFrom: new Date() });

    const result = await runChangeFeedRetention({ ...apply, shopId: shop.id });
    assert.equal(result.deletedChangeLogRows, 0, "a device that has read nothing must block every deletion");
    assert.equal(result.shops[0].blocked_by, "device_has_never_acknowledged");
    assert.equal(await db.changeLog.count({ where: { shopId: shop.id } }), 5);
  }

  // ── Nothing above the slowest device's position is touched ────────────────
  {
    const shop = await makeShop("watermark");
    const seqs = await appendFeed(shop.id, 10, ancient);
    const slowest = seqs[3];
    await makeDevice(shop.id, "till-fast", { appliedSeq: seqs[9], heardFrom: new Date() });
    await makeDevice(shop.id, "till-slow", { appliedSeq: slowest, heardFrom: new Date() });

    const result = await runChangeFeedRetention({ ...apply, shopId: shop.id });
    assert.equal(result.deletedChangeLogRows, 4, "exactly the rows at or below the slowest position go");

    const survivors = await db.changeLog.findMany({ where: { shopId: shop.id }, select: { seq: true } });
    assert.equal(survivors.length, 6);
    assert.ok(
      survivors.every((row) => row.seq > slowest),
      "the slowest device's unread rows must all survive",
    );
  }

  // ── The age floor outranks the watermark ──────────────────────────────────
  {
    const shop = await makeShop("age-floor");
    const seqs = await appendFeed(shop.id, 6, yesterday);
    await makeDevice(shop.id, "till-current", { appliedSeq: seqs[5], heardFrom: new Date() });

    const result = await runChangeFeedRetention({ ...apply, shopId: shop.id });
    assert.equal(
      result.deletedChangeLogRows,
      0,
      "rows younger than the retention floor survive even when every device has read them",
    );
    assert.equal(await db.changeLog.count({ where: { shopId: shop.id } }), 6);
  }

  // ── A signed-out till still holds its position ────────────────────────────
  {
    // Logout clears the in-memory instant cache and nothing else: the Dexie
    // tables and the sync_cursor row survive it, scoped by tenant/store. A sweep
    // that only counted `status: "active"` devices would prune the feed out from
    // under a till that is merely closed for the night.
    const shop = await makeShop("signed-out");
    const seqs = await appendFeed(shop.id, 8, ancient);
    await makeDevice(shop.id, "till-open", { appliedSeq: seqs[7], heardFrom: new Date() });
    await makeDevice(shop.id, "till-closed-for-the-night", {
      appliedSeq: seqs[1],
      heardFrom: new Date(),
      status: "logged_out",
    });

    const result = await runChangeFeedRetention({ ...apply, shopId: shop.id });
    assert.equal(result.deletedChangeLogRows, 2, "the signed-out till's position must bound the cut");
    assert.equal(
      await db.changeLog.count({ where: { shopId: shop.id, seq: { gt: seqs[1] } } }),
      6,
      "everything the signed-out till has not read must survive",
    );
  }

  // ── A device left behind is told to rebuild, and told first ───────────────
  {
    const shop = await makeShop("stranded");
    const seqs = await appendFeed(shop.id, 6, ancient);
    await makeDevice(shop.id, "till-here", { appliedSeq: seqs[5], heardFrom: new Date() });
    const abandoned = await makeDevice(shop.id, "till-gone-since-diwali", {
      appliedSeq: seqs[0],
      heardFrom: new Date(Date.now() - 200 * DAY),
    });
    const caughtUp = await makeDevice(shop.id, "till-gone-but-current", {
      appliedSeq: seqs[5],
      heardFrom: new Date(Date.now() - 200 * DAY),
    });

    const result = await runChangeFeedRetention({ ...apply, shopId: shop.id });
    assert.equal(result.devicesMarkedForRebuild, 1, "only the absentee that is actually behind loses anything");
    assert.ok(result.deletedChangeLogRows > 0, "an absentee must not be able to pin the feed forever");

    const shopEpoch = (await db.shop.findUniqueOrThrow({ where: { id: shop.id }, select: { dataEpoch: true } })).dataEpoch;
    const marked = await db.device.findUniqueOrThrow({ where: { id: abandoned.id }, select: { dataEpoch: true } });
    const untouched = await db.device.findUniqueOrThrow({ where: { id: caughtUp.id }, select: { dataEpoch: true } });
    assert.notEqual(
      marked.dataEpoch,
      shopEpoch,
      "a stranded device must fail the epoch check and be forced to rebuild on its next request",
    );
    assert.equal(
      untouched.dataEpoch,
      shopEpoch,
      "an absent device that had already read everything keeps its local copy and its session",
    );
  }

  // ── Deleting requires saying so twice ─────────────────────────────────────
  {
    const shop = await makeShop("dry-run");
    const seqs = await appendFeed(shop.id, 4, ancient);
    await makeDevice(shop.id, "till-current", { appliedSeq: seqs[3], heardFrom: new Date() });

    const preview = await runChangeFeedRetention({ shopId: shop.id });
    assert.equal(preview.status, "DRY_RUN", "the sweep must not delete on an unconfirmed payload");
    assert.equal(preview.deletedChangeLogRows, 0);
    assert.ok(preview.eligibleChangeLogRows > 0, "…while still reporting what it would have removed");
    assert.equal(await db.changeLog.count({ where: { shopId: shop.id } }), 4);

    const halfConfirmed = await runChangeFeedRetention({ shopId: shop.id, dryRun: false });
    assert.equal(halfConfirmed.status, "DRY_RUN", "dryRun:false alone must not be enough");
    assert.equal(await db.changeLog.count({ where: { shopId: shop.id } }), 4);
  }

  console.log("change-feed-retention.examples.js OK");
} finally {
  for (const shop of shops) {
    await db.changeLog.deleteMany({ where: { shopId: shop.id } }).catch(() => {});
    await db.device.deleteMany({ where: { shopId: shop.id } }).catch(() => {});
    await db.shop.delete({ where: { id: shop.id } }).catch(() => {});
  }
  await db.$disconnect().catch(() => {});
}

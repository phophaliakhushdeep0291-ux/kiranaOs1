import db from "../db.js";
import { env } from "../config/env.js";
import { JOB_NAMES } from "./queueNames.js";

export async function handleSyncCleanupJob(job) {
  switch (job.name) {
    case JOB_NAMES.CLEANUP_SYNC_EVENTS:
      return runSyncRetentionCleanup(job.data);
    case JOB_NAMES.PRUNE_CHANGE_FEED:
      return runChangeFeedRetention(job.data);
    case JOB_NAMES.ARCHIVE_OLD_SYNC_EVENTS:
      return archiveOldSyncEvents(job.data, { dryRun: true });
    case JOB_NAMES.WORKER_HEALTHCHECK:
      return { status: "ok", jobName: JOB_NAMES.WORKER_HEALTHCHECK, time: new Date().toISOString() };
    default: {
      const error = new Error(`Unknown sync cleanup job: ${job.name}`);
      error.code = "UNKNOWN_SYNC_CLEANUP_JOB";
      throw error;
    }
  }
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

export async function runSyncRetentionCleanup(payload = {}) {
  // A short idempotency window can duplicate real financial actions after an old
  // device reconnects. Never accept less than 90 days even if a generic worker
  // retention setting is configured lower.
  const retentionDays = boundedInteger(payload.retentionDays ?? env.JOB_RETENTION_DAYS, 90, 90, 3650);
  const limit = boundedInteger(payload.limit, 500, 1, 5000);
  const now = new Date();
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  const writeEnabled = payload.dryRun === false && payload.confirm === true;

  const [eventCandidates, conflictCandidates] = await Promise.all([
    db.offlineSyncEvent.findMany({
      where: {
        createdAt: { lt: cutoff },
        status: "synced",
        // Failed, processing, and conflict rows remain recoverable indefinitely.
      },
      select: { id: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: limit,
    }),
    db.syncConflict.findMany({
      where: {
        status: { in: ["resolved", "dismissed"] },
        expiresAt: { lte: now },
        // Open conflict snapshots are never removed by retention.
      },
      select: { id: true },
      orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
      take: limit,
    }),
  ]);

  let deletedOfflineSyncEvents = 0;
  let deletedSyncConflicts = 0;
  if (writeEnabled && (eventCandidates.length > 0 || conflictCandidates.length > 0)) {
    const [events, conflicts] = await db.$transaction([
      db.offlineSyncEvent.deleteMany({
        where: { id: { in: eventCandidates.map((row) => row.id) }, status: "synced", createdAt: { lt: cutoff } },
      }),
      db.syncConflict.deleteMany({
        where: {
          id: { in: conflictCandidates.map((row) => row.id) },
          status: { in: ["resolved", "dismissed"] },
          expiresAt: { lte: now },
        },
      }),
    ]);
    deletedOfflineSyncEvents = events.count;
    deletedSyncConflicts = conflicts.count;
  }

  return {
    status: writeEnabled ? "APPLIED" : "DRY_RUN",
    retentionDays,
    limit,
    cutoff: cutoff.toISOString(),
    eligibleOfflineSyncEvents: eventCandidates.length,
    eligibleSyncConflicts: conflictCandidates.length,
    deletedOfflineSyncEvents,
    deletedSyncConflicts,
    hasMore: eventCandidates.length === limit || conflictCandidates.length === limit,
    safety: {
      explicitConfirmationRequired: true,
      preservesStatuses: ["processing", "failed", "conflict", "open"],
    },
  };
}

async function archiveOldSyncEvents(payload = {}, { dryRun = true } = {}) {
  const result = await runSyncRetentionCleanup({ ...payload, dryRun: true, confirm: false });
  return { ...result, archive: true, status: dryRun ? "DRY_RUN" : "ARCHIVE_DESTINATION_REQUIRED" };
}

/**
 * ChangeLog is the only table that grows strictly faster than the business.
 *
 * It is written by database triggers on eleven tables, and the child triggers
 * roll up: one twelve-line bill appends fourteen rows. Nothing has ever removed
 * one. `backup-policy.js` lists the table only to keep it OUT of backups, which
 * is the closest thing to a retention decision the feed has had.
 *
 * Pruning it is not like pruning OfflineSyncEvent above. That table is a record
 * of what devices sent; this one is how devices FIND OUT. `/sync/pull` is
 * `seq > cursor` against it, so a row deleted while some device's cursor still
 * sits below it is not slow sync — it is a bill that device never hears about,
 * on a feed that reports itself clean. Everything here exists to make that
 * impossible.
 */
const FEED_RETENTION_FLOOR_DAYS = 7;
const FEED_ABSENT_FLOOR_DAYS = 7;

/**
 * A device still entitled to the feed.
 *
 * "Active" is not enough on its own: an active device nobody has switched on
 * since Diwali would pin the watermark at its ancient position and the feed
 * would grow forever for a terminal that is never coming back. So entitlement
 * is recency, and a device that falls out of it is not quietly abandoned — it is
 * marked to rebuild (see `forceFeedRebuild`), which is the honest version of
 * "your position no longer exists".
 *
 * `lastSyncAckAt` is the real signal. `lastSeenAt` and `createdAt` back it up so
 * a device that registered minutes ago and has not finished its first pull is
 * never mistaken for an absentee.
 */
function lastHeardFrom(device) {
  return device.lastSyncAckAt ?? device.lastSeenAt ?? device.createdAt ?? null;
}

/**
 * How far into the feed every entitled device has already read.
 *
 * `null` means "prune nothing", and it is returned generously: a device that has
 * never acknowledged anything has read nothing, so there is no safe watermark
 * for that shop at all until it reports a position. A shop whose devices are all
 * absent has no entitled reader and returns the current tip — every absentee is
 * marked to rebuild before anything is deleted, so there is nobody left to
 * strand.
 */
function entitledWatermark(holders, currentSeq) {
  if (holders.length === 0) return currentSeq;
  let lowest = null;
  for (const device of holders) {
    if (device.lastAppliedServerSeq === null || device.lastAppliedServerSeq === undefined) return null;
    const applied = BigInt(device.lastAppliedServerSeq);
    if (lowest === null || applied < lowest) lowest = applied;
  }
  return lowest;
}

function databaseSeq(value) {
  return env.DATABASE_URL.startsWith("file:") ? Number(value) : BigInt(value);
}

/**
 * Tell a device its local copy is no longer reconstructible from the feed.
 *
 * Reuses the epoch mismatch that a backup restore already uses:
 * `assertRequestDevice` compares `Device.dataEpoch` against `Shop.dataEpoch` on
 * every device-gated request — `/sync/pull` included, through
 * `requireDeviceAllowedForSync` — and answers 409 DEVICE_REBOOTSTRAP_REQUIRED
 * when they differ. The frontend already handles that code end to end
 * (`http.ts` → `notifyDeviceSessionRevoked` → AuthContext), and re-activation
 * writes the shop's epoch back.
 *
 * So this needs no new protocol, no new client code, and no new column. What it
 * must never do is run AFTER the delete — see the ordering note in the sweep.
 */
async function forceFeedRebuild(client, deviceRecordIds) {
  if (deviceRecordIds.length === 0) return 0;
  const { count } = await client.device.updateMany({
    where: { id: { in: deviceRecordIds } },
    data: { dataEpoch: { decrement: 1 } },
  });
  return count;
}

async function pruneShopChangeFeed(shop, { feedCutoff, absentCutoff, limit, writeEnabled }) {
  // Every device row, whatever its status — deliberately not `status: "active"`.
  //
  // A logged-out device keeps its IndexedDB tables and its `sync_cursor` row:
  // logout clears the in-memory instant cache and nothing else, and the cursor is
  // scoped by tenant/store, so the same shop reads it straight back. Filtering to
  // active devices would let the feed be pruned out from under a till that is
  // merely signed out for the night.
  //
  // Recency, not status, is what decides. A device heard from inside the window
  // holds the watermark whether or not anyone is signed in on it.
  const devices = await db.device.findMany({
    where: { shopId: shop.id },
    select: {
      id: true,
      deviceId: true,
      lastAppliedServerSeq: true,
      lastSyncAckAt: true,
      lastSeenAt: true,
      createdAt: true,
    },
  });

  const holders = [];
  const absentees = [];
  for (const device of devices) {
    const heard = lastHeardFrom(device);
    if (heard && heard.getTime() >= absentCutoff.getTime()) holders.push(device);
    else absentees.push(device);
  }

  const tip = await db.changeLog.aggregate({ where: { shopId: shop.id }, _max: { seq: true } });
  const currentSeq = BigInt(tip._max.seq ?? 0);
  const watermark = entitledWatermark(holders, currentSeq);
  if (watermark === null || watermark === 0n) {
    return {
      shop_id: shop.id,
      watermark: null,
      eligible: 0,
      deleted: 0,
      rebuilt_devices: 0,
      blocked_by:
        watermark === null
          ? "device_has_never_acknowledged"
          : holders.length === 0
            ? "no_feed_rows"
            : "device_still_at_feed_start",
    };
  }

  // Only an absentee that is actually behind the cut loses anything. One that is
  // switched off but fully caught up keeps its local copy and its session.
  const stranded = absentees.filter((device) => BigInt(device.lastAppliedServerSeq ?? 0) < watermark);

  const candidates = await db.changeLog.findMany({
    where: { shopId: shop.id, seq: { lte: databaseSeq(watermark) }, createdAt: { lt: feedCutoff } },
    select: { seq: true },
    orderBy: { seq: "asc" },
    take: limit,
  });

  if (!writeEnabled || candidates.length === 0) {
    return {
      shop_id: shop.id,
      watermark: String(watermark),
      eligible: candidates.length,
      deleted: 0,
      rebuilt_devices: 0,
      would_rebuild_devices: stranded.map((device) => device.deviceId),
    };
  }

  // Order matters and only in this direction. Marking first and failing to
  // delete costs a device an unnecessary re-hydration — expensive, correct.
  // Deleting first and failing to mark leaves a device reading a feed whose
  // start it has already fallen behind, and nothing anywhere says so.
  let rebuilt = 0;
  let deleted = 0;
  await db.$transaction(async (tx) => {
    rebuilt = await forceFeedRebuild(tx, stranded.map((device) => device.id));
    const result = await tx.changeLog.deleteMany({
      where: {
        shopId: shop.id,
        seq: { in: candidates.map((row) => row.seq) },
        // Re-stated inside the transaction: the watermark was computed from a
        // read taken before it, and a device may not go backwards, but the
        // cutoff is the cheap half of the guarantee to hold twice.
        createdAt: { lt: feedCutoff },
      },
    });
    deleted = result.count;
  });

  return {
    shop_id: shop.id,
    watermark: String(watermark),
    eligible: candidates.length,
    deleted,
    rebuilt_devices: rebuilt,
    rebuilt_device_ids: stranded.map((device) => device.deviceId),
  };
}

/**
 * Prune the change feed for every shop that has one, oldest position first.
 *
 * Dry run unless `dryRun: false` AND `confirm: true`, matching
 * `runSyncRetentionCleanup` — a sweep that can cost a terminal its history is
 * not something a mistyped payload should be able to start.
 */
export async function runChangeFeedRetention(payload = {}) {
  const feedRetentionDays = boundedInteger(payload.feedRetentionDays, 30, FEED_RETENTION_FLOOR_DAYS, 3650);
  const absentDays = boundedInteger(payload.absentDays, 30, FEED_ABSENT_FLOOR_DAYS, 3650);
  const limit = boundedInteger(payload.limit, 1000, 1, 10000);
  const shopLimit = boundedInteger(payload.shopLimit, 50, 1, 1000);
  const writeEnabled = payload.dryRun === false && payload.confirm === true;

  const now = new Date();
  const feedCutoff = new Date(now.getTime() - feedRetentionDays * 24 * 60 * 60 * 1000);
  const absentCutoff = new Date(now.getTime() - absentDays * 24 * 60 * 60 * 1000);

  const shops = payload.shopId
    ? await db.shop.findMany({ where: { id: String(payload.shopId) }, select: { id: true } })
    : await db.shop.findMany({ select: { id: true }, orderBy: { id: "asc" }, take: shopLimit });

  const results = [];
  for (const shop of shops) {
    results.push(await pruneShopChangeFeed(shop, { feedCutoff, absentCutoff, limit, writeEnabled }));
  }

  const total = (key) => results.reduce((sum, row) => sum + (row[key] ?? 0), 0);
  return {
    status: writeEnabled ? "APPLIED" : "DRY_RUN",
    feedRetentionDays,
    absentDays,
    limit,
    feedCutoff: feedCutoff.toISOString(),
    absentCutoff: absentCutoff.toISOString(),
    shopsInspected: results.length,
    eligibleChangeLogRows: total("eligible"),
    deletedChangeLogRows: total("deleted"),
    devicesMarkedForRebuild: total("rebuilt_devices"),
    hasMore: results.some((row) => row.eligible === limit),
    shops: results,
    safety: {
      explicitConfirmationRequired: true,
      neverPrunesAbove: "the lowest position any recently-heard-from active device has acknowledged",
      strandedDevicesAre: "marked DEVICE_REBOOTSTRAP_REQUIRED before any row is deleted",
    },
  };
}

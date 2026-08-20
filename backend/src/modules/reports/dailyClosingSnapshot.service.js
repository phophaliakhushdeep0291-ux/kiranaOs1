import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { getDailyClosing } from "./reports.service.js";
import { dateRangeForDateOnly } from "../../utils/dates.js";
import { env } from "../../config/env.js";
import { resolveOperationalLocation } from "../stores/location-context.service.js";
import { createAuditLog } from "../audit/audit.service.js";

async function writeRequiredDailyClosingAudit(entry, client) {
  const audit = await createAuditLog({ ...entry, client });
  if (!audit) {
    throw new AppError(
      "Daily closing change was not saved because its audit record could not be stored",
      503,
      "DAILY_CLOSING_AUDIT_WRITE_FAILED",
    );
  }
  return audit;
}

function normalizeDateInput(date) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
    const err = new AppError("date must be YYYY-MM-DD", 400);
    err.code = "INVALID_REPORT_DATE";
    throw err;
  }
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    const err = new AppError("Invalid report date", 400);
    err.code = "INVALID_REPORT_DATE";
    throw err;
  }
  return parsed;
}

function dateKey(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function parseJsonArray(raw) {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function snapshotToDailyClosing(snapshot, extra = {}) {
  if (!snapshot) return null;
  return {
    date: dateKey(snapshot.date),
    totalSalesPaise: snapshot.totalSalesPaise,
    cashReceivedPaise: snapshot.cashReceivedPaise,
    upiReceivedPaise: snapshot.upiReceivedPaise,
    bankReceivedPaise: snapshot.bankReceivedPaise ?? 0,
    udharGivenPaise: snapshot.udharGivenPaise,
    oldUdharRecoveredPaise: snapshot.oldUdharRecoveredPaise,
    expectedCashPaise: snapshot.expectedCashPaise,
    totalBills: snapshot.totalBills,
    cancelledBills: snapshot.cancelledBills,
    roughBills: snapshot.roughBills,
    topProducts: parseJsonArray(snapshot.topProductsJson),
    lowStock: parseJsonArray(snapshot.lowStockJson),
    pendingSyncCount: snapshot.pendingSyncCount,
    localEstimate: false,
    generatedAt: snapshot.generatedAt.toISOString(),
    snapshot: {
      id: snapshot.id,
      source: snapshot.source,
      storeId: snapshot.storeId ?? null,
      lockedAt: snapshot.lockedAt?.toISOString?.() ?? null,
      lockedByUserId: snapshot.lockedByUserId ?? null,
      generatedByUserId: snapshot.generatedByUserId ?? null,
      persisted: true,
      ...extra,
    },
  };
}

function dailyClosingToSnapshotData(shopId, day, dailyClosing, options = {}) {
  return {
    shopId,
    storeId: options.storeId ?? null,
    date: day,
    totalSalesPaise: dailyClosing.totalSalesPaise ?? 0,
    cashReceivedPaise: dailyClosing.cashReceivedPaise ?? 0,
    upiReceivedPaise: dailyClosing.upiReceivedPaise ?? 0,
    bankReceivedPaise: dailyClosing.bankReceivedPaise ?? 0,
    udharGivenPaise: dailyClosing.udharGivenPaise ?? 0,
    oldUdharRecoveredPaise: dailyClosing.oldUdharRecoveredPaise ?? 0,
    expectedCashPaise: dailyClosing.expectedCashPaise ?? 0,
    totalBills: dailyClosing.totalBills ?? 0,
    cancelledBills: dailyClosing.cancelledBills ?? 0,
    roughBills: dailyClosing.roughBills ?? 0,
    pendingSyncCount: dailyClosing.pendingSyncCount ?? 0,
    topProductsJson: JSON.stringify(dailyClosing.topProducts ?? []),
    lowStockJson: JSON.stringify(dailyClosing.lowStock ?? []),
    generatedByUserId: options.userId ?? null,
    generatedAt: new Date(),
    source: options.source ?? "manual",
  };
}

export async function getDailyClosingSnapshot(shopId, date, requestedStoreId = null) {
  const day = normalizeDateInput(date);
  const location = await resolveOperationalLocation(shopId, requestedStoreId, db, { allowInactive: true });
  const snapshot = await db.dailyClosingSnapshot.findUnique({
    where: { shopId_storeId_date: { shopId, storeId: location.id, date: day } },
  });
  if (!snapshot) return null;
  const staleness = await getSnapshotStaleness(shopId, dateKey(day), snapshot, location.id);
  return snapshotToDailyClosing(snapshot, { staleness });
}

export async function getSnapshotStaleness(shopId, date, snapshot, locationId = snapshot?.storeId ?? null) {
  if (!snapshot?.generatedAt) return { stale: false, reason: null, latestChangeAt: null };
  normalizeDateInput(date); // validates YYYY-MM-DD shape (throws a 400 with a stable code)
  // Use the SAME shop-timezone day window the snapshot was generated with (getDailyClosing →
  // startOfZonedDay/endOfZonedDay). A server-local setHours() window would be shifted by the UTC
  // offset (5.5h for IST), querying the wrong rows — missing real early-morning changes and
  // falsely flagging others near the day boundary.
  const { start, end } = dateRangeForDateOnly(date, env.DAILY_CLOSING_TIMEZONE);
  const generatedAt = new Date(snapshot.generatedAt);

  const [billChange, udharChange, stockChange] = await Promise.all([
    db.bill.findFirst({
      where: { shopId, ...(locationId && { locationId }), businessDate: { gte: start, lte: end }, updatedAt: { gt: generatedAt } },
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    }),
    db.udharLedger.findFirst({
      where: { shopId, ...(locationId && { locationId }), businessDate: { gte: start, lte: end }, updatedAt: { gt: generatedAt } },
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    }),
    db.stockLedger.findFirst({
      where: { shopId, ...(locationId && { locationId }), createdAt: { gte: start, lte: end }, updatedAt: { gt: generatedAt } },
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    }),
  ]);

  const latest = [billChange?.updatedAt, udharChange?.updatedAt, stockChange?.updatedAt]
    .filter(Boolean)
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];

  if (!latest) return { stale: false, reason: null, latestChangeAt: null };

  // DAILY_CLOSING_SNAPSHOT_STALE_DETECTED is intentionally not audit-logged on
  // every read to avoid noisy audit rows; the warning is returned in metadata.
  return {
    stale: true,
    reason: "Records changed after snapshot generation",
    latestChangeAt: new Date(latest).toISOString(),
  };
}

export async function generateDailyClosingSnapshot(shopId, date, options = {}) {
  const day = normalizeDateInput(date);
  const location = await resolveOperationalLocation(shopId, options.storeId ?? null, db, { allowInactive: true });
  const existing = await db.dailyClosingSnapshot.findUnique({
    where: { shopId_storeId_date: { shopId, storeId: location.id, date: day } },
  });

  if (existing?.lockedAt && !options.allowLockedOverride) {
    return snapshotToDailyClosing(existing, { locked: true, skipped: true, reason: "SNAPSHOT_LOCKED" });
  }

  const live = await getDailyClosing(shopId, { date: dateKey(day), locationId: location.id });
  const data = dailyClosingToSnapshotData(shopId, day, live, { ...options, storeId: location.id });

  const outcome = await db.$transaction(async (tx) => {
    const current = await tx.dailyClosingSnapshot.findUnique({
      where: { shopId_storeId_date: { shopId, storeId: location.id, date: day } },
    });
    if (current?.lockedAt && !options.allowLockedOverride) {
      return { snapshot: current, created: false, skipped: true };
    }

    const snapshot = await tx.dailyClosingSnapshot.upsert({
      where: { shopId_storeId_date: { shopId, storeId: location.id, date: day } },
      create: data,
      update: {
        ...data,
        lockedAt: current?.lockedAt ?? null,
        lockedByUserId: current?.lockedByUserId ?? null,
      },
    });
    const action = options.auditAction
      ?? (current ? "DAILY_CLOSING_SNAPSHOT_REFRESHED" : "DAILY_CLOSING_SNAPSHOT_CREATED");
    await writeRequiredDailyClosingAudit({
      shopId,
      userId: options.userId ?? null,
      action,
      entityType: "DailyClosingSnapshot",
      entityId: snapshot.id,
      before: current ?? undefined,
      after: snapshot,
      metadata: {
        date: dateKey(day),
        storeId: location.id,
        source: options.source ?? "manual",
        reason: options.reason ? String(options.reason).slice(0, 500) : null,
      },
    }, tx);
    return { snapshot, created: !current, skipped: false };
  });

  if (outcome.skipped) {
    return snapshotToDailyClosing(outcome.snapshot, { locked: true, skipped: true, reason: "SNAPSHOT_LOCKED" });
  }
  return snapshotToDailyClosing(outcome.snapshot, { created: outcome.created, refreshed: !outcome.created });
}

export async function refreshDailyClosingSnapshot(shopId, date, options = {}) {
  return generateDailyClosingSnapshot(shopId, date, { ...options, source: options.source ?? "manual" });
}

export async function lockDailyClosingSnapshot(shopId, date, userId, requestedStoreId = null) {
  const day = normalizeDateInput(date);
  const location = await resolveOperationalLocation(shopId, requestedStoreId, db, { allowInactive: true });
  let snapshot = await db.dailyClosingSnapshot.findUnique({
    where: { shopId_storeId_date: { shopId, storeId: location.id, date: day } },
  });

  if (!snapshot) {
    const generated = await generateDailyClosingSnapshot(shopId, date, { source: "manual", userId, storeId: location.id });
    snapshot = await db.dailyClosingSnapshot.findUnique({
      where: { shopId_storeId_date: { shopId, storeId: location.id, date: day } },
    });
    if (!snapshot) return generated;
  }

  snapshot = await db.$transaction(async (tx) => {
    const current = await tx.dailyClosingSnapshot.findUnique({
      where: { shopId_storeId_date: { shopId, storeId: location.id, date: day } },
    });
    if (!current) throw new AppError("Daily closing snapshot not found", 404, "DAILY_CLOSING_SNAPSHOT_NOT_FOUND");
    if (current.lockedAt) return current;
    const locked = await tx.dailyClosingSnapshot.update({
      where: { shopId_storeId_date: { shopId, storeId: location.id, date: day } },
      data: { lockedAt: new Date(), lockedByUserId: userId ?? null },
    });
    await writeRequiredDailyClosingAudit({
      shopId, userId, action: "DAILY_CLOSING_SNAPSHOT_LOCKED",
      entityType: "DailyClosingSnapshot", entityId: locked.id,
      before: current, after: locked, metadata: { date: dateKey(day), storeId: location.id },
    }, tx);
    return locked;
  }, { isolationLevel: "Serializable" });

  return snapshotToDailyClosing(snapshot, { locked: true });
}

export async function overrideRefreshDailyClosingSnapshot(shopId, date, options = {}) {
  if (!options.reason || String(options.reason).trim().length < 5) {
    const err = new AppError("Override refresh reason is required", 400);
    err.code = "SNAPSHOT_OVERRIDE_REASON_REQUIRED";
    throw err;
  }
  const day = normalizeDateInput(date);
  const location = await resolveOperationalLocation(shopId, options.storeId ?? null, db, { allowInactive: true });
  const existing = await db.dailyClosingSnapshot.findUnique({
    where: { shopId_storeId_date: { shopId, storeId: location.id, date: day } },
  });
  const refreshed = await generateDailyClosingSnapshot(shopId, dateKey(day), {
    ...options,
    source: options.source ?? "manual",
    allowLockedOverride: true,
    auditAction: "DAILY_CLOSING_SNAPSHOT_OVERRIDE_REFRESHED",
    storeId: location.id,
  });
  return {
    ...refreshed,
    snapshot: {
      ...refreshed.snapshot,
      overrideRefreshed: true,
      reason: options.reason,
      previousLockedAt: existing?.lockedAt?.toISOString?.() ?? null,
      previousLockedByUserId: existing?.lockedByUserId ?? null,
    },
  };
}

export async function unlockDailyClosingSnapshot(shopId, date, userId, requestedStoreId = null) {
  const day = normalizeDateInput(date);
  const location = await resolveOperationalLocation(shopId, requestedStoreId, db, { allowInactive: true });
  const snapshot = await db.$transaction(async (tx) => {
    const current = await tx.dailyClosingSnapshot.findUnique({
      where: { shopId_storeId_date: { shopId, storeId: location.id, date: day } },
    });
    if (!current) throw new AppError("Daily closing snapshot not found", 404, "DAILY_CLOSING_SNAPSHOT_NOT_FOUND");
    if (!current.lockedAt) return current;
    const unlocked = await tx.dailyClosingSnapshot.update({
      where: { shopId_storeId_date: { shopId, storeId: location.id, date: day } },
      data: { lockedAt: null, lockedByUserId: null, generatedByUserId: userId ?? null },
    });
    await writeRequiredDailyClosingAudit({
      shopId, userId, action: "DAILY_CLOSING_SNAPSHOT_UNLOCKED",
      entityType: "DailyClosingSnapshot", entityId: unlocked.id,
      before: current, after: unlocked, metadata: { date: dateKey(day), storeId: location.id },
    }, tx);
    return unlocked;
  });
  return snapshotToDailyClosing(snapshot, { locked: false });
}

export const __dailyClosingSnapshotInternals = {
  normalizeDateInput,
  snapshotToDailyClosing,
  getSnapshotStaleness,
};

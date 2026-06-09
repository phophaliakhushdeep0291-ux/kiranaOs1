import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { getDailyClosing } from "./reports.service.js";

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

function startOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function endOfDay(date) {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
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

export async function getDailyClosingSnapshot(shopId, date) {
  const day = normalizeDateInput(date);
  const snapshot = await db.dailyClosingSnapshot.findUnique({
    where: { shopId_date: { shopId, date: day } },
  });
  if (!snapshot) return null;
  const staleness = await getSnapshotStaleness(shopId, dateKey(day), snapshot);
  return snapshotToDailyClosing(snapshot, { staleness });
}

export async function getSnapshotStaleness(shopId, date, snapshot) {
  if (!snapshot?.generatedAt) return { stale: false, reason: null, latestChangeAt: null };
  const day = normalizeDateInput(date);
  const start = startOfDay(day);
  const end = endOfDay(day);
  const generatedAt = new Date(snapshot.generatedAt);

  const [billChange, udharChange, stockChange] = await Promise.all([
    db.bill.findFirst({
      where: { shopId, createdAt: { gte: start, lte: end }, updatedAt: { gt: generatedAt } },
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    }),
    db.udharLedger.findFirst({
      where: { shopId, createdAt: { gte: start, lte: end }, updatedAt: { gt: generatedAt } },
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    }),
    db.stockLedger.findFirst({
      where: { shopId, createdAt: { gte: start, lte: end }, updatedAt: { gt: generatedAt } },
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
  const existing = await db.dailyClosingSnapshot.findUnique({
    where: { shopId_date: { shopId, date: day } },
  });

  if (existing?.lockedAt && !options.allowLockedOverride) {
    return snapshotToDailyClosing(existing, { locked: true, skipped: true, reason: "SNAPSHOT_LOCKED" });
  }

  const live = await getDailyClosing(shopId, { date: dateKey(day) });
  const data = dailyClosingToSnapshotData(shopId, day, live, options);

  const snapshot = await db.dailyClosingSnapshot.upsert({
    where: { shopId_date: { shopId, date: day } },
    create: data,
    update: {
      ...data,
      // Preserve explicit locking metadata unless caller has a future override policy.
      lockedAt: existing?.lockedAt ?? null,
      lockedByUserId: existing?.lockedByUserId ?? null,
    },
  });

  return snapshotToDailyClosing(snapshot, { created: !existing, refreshed: Boolean(existing) });
}

export async function refreshDailyClosingSnapshot(shopId, date, options = {}) {
  return generateDailyClosingSnapshot(shopId, date, { ...options, source: options.source ?? "manual" });
}

export async function lockDailyClosingSnapshot(shopId, date, userId) {
  const day = normalizeDateInput(date);
  let snapshot = await db.dailyClosingSnapshot.findUnique({
    where: { shopId_date: { shopId, date: day } },
  });

  if (!snapshot) {
    const generated = await generateDailyClosingSnapshot(shopId, date, { source: "manual", userId });
    snapshot = await db.dailyClosingSnapshot.findUnique({
      where: { shopId_date: { shopId, date: day } },
    });
    if (!snapshot) return generated;
  }

  if (!snapshot.lockedAt) {
    snapshot = await db.dailyClosingSnapshot.update({
      where: { shopId_date: { shopId, date: day } },
      data: { lockedAt: new Date(), lockedByUserId: userId ?? null },
    });
  }

  return snapshotToDailyClosing(snapshot, { locked: true });
}

export async function overrideRefreshDailyClosingSnapshot(shopId, date, options = {}) {
  if (!options.reason || String(options.reason).trim().length < 5) {
    const err = new AppError("Override refresh reason is required", 400);
    err.code = "SNAPSHOT_OVERRIDE_REASON_REQUIRED";
    throw err;
  }
  const day = normalizeDateInput(date);
  const existing = await db.dailyClosingSnapshot.findUnique({
    where: { shopId_date: { shopId, date: day } },
  });
  const refreshed = await generateDailyClosingSnapshot(shopId, dateKey(day), {
    ...options,
    source: options.source ?? "manual",
    allowLockedOverride: true,
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

export async function unlockDailyClosingSnapshot(shopId, date, userId) {
  const day = normalizeDateInput(date);
  const snapshot = await db.dailyClosingSnapshot.update({
    where: { shopId_date: { shopId, date: day } },
    data: { lockedAt: null, lockedByUserId: null, generatedByUserId: userId ?? null },
  });
  return snapshotToDailyClosing(snapshot, { locked: false });
}

export const __dailyClosingSnapshotInternals = {
  normalizeDateInput,
  snapshotToDailyClosing,
  getSnapshotStaleness,
};

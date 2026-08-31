import { getDailyClosingDrawerCounts, type ServerDrawerCount } from "@/features/core/reports/api";
import { buildOutboxOperation, createOutboxId } from "@/features/core/sync/outbox";
import { getActiveLocationId } from "@/features/core/stores/location-context";
import { offlineDB, type PendingSyncEvent } from "@/lib/offline/db";
import { roundMoney } from "@/lib/money";

/**
 * End-of-day drawer evidence. The local row makes counting instant offline; the
 * matching outbox operation is written in the same IndexedDB transaction and
 * persists the declaration in DailyClosingSnapshot after reconnecting.
 */
export interface DrawerCount {
  /** Closing date, yyyy-mm-dd. One entry per date (latest count wins locally). */
  date: string;
  expectedCash: number;
  countedCash: number;
  /** counted − expected: positive = over, negative = short. */
  variance: number;
  countedAt: string;
  openingCash?: number;
  cashIn?: number;
  cashOut?: number;
  /** Optimistic server revision. Older v1 local rows naturally start at zero. */
  revision?: number;
  countedByUserId?: string | null;
  countedByDeviceId?: string | null;
}

export interface DrawerCountAdjustments {
  openingCash?: number;
  cashIn?: number;
  cashOut?: number;
}

const STORE_KEY = "kirana:drawer-counts:v1";
const MAX_ENTRIES = 90;

function toPaise(value: number): number {
  return Math.round(roundMoney(value) * 100);
}

/** Pure upsert: replaces the same-date entry, newest date first, capped. */
export function upsertDrawerCount(list: DrawerCount[], entry: DrawerCount, cap = MAX_ENTRIES): DrawerCount[] {
  return [entry, ...list.filter((row) => row.date !== entry.date)]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, cap);
}

export function buildDrawerCount(date: string, expectedCash: number, countedCash: number): DrawerCount {
  const expected = roundMoney(expectedCash);
  const counted = roundMoney(countedCash);
  return {
    date,
    expectedCash: expected,
    countedCash: counted,
    variance: roundMoney(counted - expected),
    countedAt: new Date().toISOString(),
  };
}

export async function loadDrawerCounts(): Promise<DrawerCount[]> {
  const stored = await offlineDB.getSetting<DrawerCount[]>(STORE_KEY).catch(() => null);
  return Array.isArray(stored) ? stored : [];
}

function fromServerCount(row: ServerDrawerCount): DrawerCount {
  return {
    date: row.date,
    openingCash: roundMoney(row.openingCashPaise / 100),
    cashIn: roundMoney(row.manualCashInPaise / 100),
    cashOut: roundMoney(row.manualCashOutPaise / 100),
    expectedCash: roundMoney(row.expectedCashPaise / 100),
    countedCash: roundMoney(row.countedCashPaise / 100),
    variance: roundMoney(row.variancePaise / 100),
    countedAt: row.countedAt,
    revision: row.revision,
    countedByUserId: row.countedByUserId,
    countedByDeviceId: row.countedByDeviceId,
  };
}

export function mergeDrawerCounts(
  local: DrawerCount[],
  server: ServerDrawerCount[],
  pendingDates: ReadonlySet<string> = new Set(),
): DrawerCount[] {
  let merged = local;
  for (const remote of server) {
    if (pendingDates.has(remote.date)) continue;
    merged = upsertDrawerCount(merged, fromServerCount(remote));
  }
  return merged.slice(0, MAX_ENTRIES);
}

/** Pull server evidence without making offline page rendering depend on it. */
export async function refreshDrawerCountsFromCloud(): Promise<DrawerCount[]> {
  const [local, server, outbox] = await Promise.all([
    loadDrawerCounts(),
    getDailyClosingDrawerCounts(),
    offlineDB.getAll<PendingSyncEvent>("sync_outbox").catch(() => []),
  ]);
  const pendingDates = new Set(
    outbox
      .filter((row) => row.operation_type === "RECORD_DRAWER_COUNT" && row.status !== "SYNCED")
      .map((row) => String(row.payload.date ?? ""))
      .filter(Boolean),
  );
  const merged = mergeDrawerCounts(local, server, pendingDates);
  await offlineDB.setSetting(STORE_KEY, merged);
  return merged;
}

export async function saveDrawerCount(
  entry: DrawerCount,
  adjustments: DrawerCountAdjustments = {},
): Promise<DrawerCount[]> {
  const existing = await loadDrawerCounts();
  const current = existing.find((row) => row.date === entry.date);
  const baseRevision = Math.max(0, Math.trunc(Number(current?.revision ?? 0)));
  const saved: DrawerCount = {
    ...entry,
    openingCash: roundMoney(adjustments.openingCash ?? 0),
    cashIn: roundMoney(adjustments.cashIn ?? 0),
    cashOut: roundMoney(adjustments.cashOut ?? 0),
    revision: baseRevision + 1,
  };
  const next = upsertDrawerCount(existing, saved);
  const eventId = createOutboxId("drawer_count");
  const outbox = buildOutboxOperation({
    op_id: eventId,
    idempotency_key: eventId,
    entity_type: "daily_closing",
    entity_id: `drawer-count:${entry.date}`,
    operation_type: "RECORD_DRAWER_COUNT",
    payload: {
      date: entry.date,
      openingCashPaise: toPaise(saved.openingCash ?? 0),
      manualCashInPaise: toPaise(saved.cashIn ?? 0),
      manualCashOutPaise: toPaise(saved.cashOut ?? 0),
      countedCashPaise: toPaise(saved.countedCash),
      clientExpectedCashPaise: toPaise(saved.expectedCash),
      baseRevision,
      countedAt: saved.countedAt,
      storeId: getActiveLocationId() ?? undefined,
    },
  });

  await offlineDB.transaction(["settings", "sync_outbox"], async (tx) => {
    await tx.setSetting(STORE_KEY, next);
    await tx.enqueueOutboxOperation(outbox);
  });
  return next;
}

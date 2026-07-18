import { offlineDB } from "@/lib/offline/db";

/**
 * End-of-day drawer counts — the shopkeeper types what cash is actually in
 * the drawer; we keep a per-date over/short history so recurring shrinkage
 * shows up as a pattern instead of a one-night surprise. Stored offline in
 * the settings blob (per device/shop scope, no server round-trip needed).
 */

export interface DrawerCount {
  /** Closing date, yyyy-mm-dd. One entry per date (latest count wins). */
  date: string;
  expectedCash: number;
  countedCash: number;
  /** counted − expected: positive = over, negative = short. */
  variance: number;
  countedAt: string;
}

const STORE_KEY = "kirana:drawer-counts:v1";
const MAX_ENTRIES = 90;

function round2(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

/** Pure upsert: replaces the same-date entry, newest date first, capped. */
export function upsertDrawerCount(list: DrawerCount[], entry: DrawerCount, cap = MAX_ENTRIES): DrawerCount[] {
  return [entry, ...list.filter((row) => row.date !== entry.date)]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, cap);
}

export function buildDrawerCount(date: string, expectedCash: number, countedCash: number): DrawerCount {
  const expected = round2(expectedCash);
  const counted = round2(countedCash);
  return {
    date,
    expectedCash: expected,
    countedCash: counted,
    variance: round2(counted - expected),
    countedAt: new Date().toISOString(),
  };
}

export async function loadDrawerCounts(): Promise<DrawerCount[]> {
  const stored = await offlineDB.getSetting<DrawerCount[]>(STORE_KEY).catch(() => null);
  return Array.isArray(stored) ? stored : [];
}

export async function saveDrawerCount(entry: DrawerCount): Promise<DrawerCount[]> {
  const next = upsertDrawerCount(await loadDrawerCounts(), entry);
  await offlineDB.setSetting(STORE_KEY, next);
  return next;
}

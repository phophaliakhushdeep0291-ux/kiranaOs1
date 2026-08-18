import { offlineDB } from "@/lib/offline/db";
import { getOfflineScope } from "@/lib/offline/context";

const CACHE_PREFIX = "kirana-os:instant-cache:";
export const RECENT_CACHE_DAYS = 30;

const memoryCache = new Map<string, unknown>();

/**
 * When each key was last written, so a reader can say how old its data is.
 *
 * Seeding a react-query `initialData` without also passing `initialDataUpdatedAt`
 * tells the library the value is fresh AS OF NOW. Under any staleTime that means
 * no fetch happens at all, and the screen is pinned to whatever the cache held
 * until something evicts it — for a memory cache, a manual page reload. The
 * cached rows are for painting instantly, never for standing in for the server,
 * so every reader must be able to date them. See `instantCacheUpdatedAt`.
 */
const writtenAt = new Map<string, number>();

// Instant-cache keys are scoped to the active shop so one shop's cached products/bills/customers
// can never be read by another shop on the same device. The DB layer is already scope-filtered;
// this in-memory layer must match (it otherwise survives logout→login and leaks the prior shop's
// data). store_id comes from the auth session, falling back to a per-device default when logged out.
function memKey(key: string): string {
  return `${getOfflineScope().store_id}::${key}`;
}

/** Wipe the in-memory instant cache — called on logout so the next user can't read it. */
export function clearInstantMemoryCache(): void {
  memoryCache.clear();
  writtenAt.clear();
}

/**
 * When this key was cached, for react-query's `initialDataUpdatedAt`.
 *
 * 0 for anything this process did not write itself — a value hydrated from
 * IndexedDB is of unknown age, and dating it "now" is the exact mistake this
 * exists to prevent. 0 reads as "older than any staleTime", so the cached rows
 * still paint on the first frame and a background refetch starts immediately.
 */
export function instantCacheUpdatedAt(key: string): number {
  return writtenAt.get(memKey(key)) ?? 0;
}

export const LOCAL_DATA_CHANGE_CHANNEL = "kirana:local-data-events";

export interface LocalDataChangeMessage {
  source: "kirana-local-data";
  detail?: Record<string, unknown>;
  emittedAt: number;
}

function postLocalDataChangeToOtherTabs(detail?: Record<string, unknown>) {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return;
  try {
    const channel = new BroadcastChannel(LOCAL_DATA_CHANGE_CHANNEL);
    channel.postMessage({
      source: "kirana-local-data",
      detail,
      emittedAt: Date.now(),
    } satisfies LocalDataChangeMessage);
    channel.close();
  } catch {
    // Cross-tab refresh is best effort. The current tab still receives the event.
  }
}

function canUseLegacyLocalStorage() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function readLegacyLocalStorage<T>(key: string): T | null {
  if (!canUseLegacyLocalStorage()) return null;
  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}${memKey(key)}`);
    return raw ? JSON.parse(raw) as T : null;
  } catch {
    return null;
  }
}

export function isWithinRecentWindow(dateLike: unknown, days = RECENT_CACHE_DAYS) {
  if (!dateLike) return true;
  const time = new Date(String(dateLike)).getTime();
  if (!Number.isFinite(time)) return true;
  return time >= Date.now() - days * 24 * 60 * 60 * 1000;
}

/**
 * Pass as `days` for master data — a catalogue, a customer list — that is not a
 * feed of recent activity. A product the shop has not edited in a year is still
 * on the shelf, and pruning it here deletes it from the screen that sells it.
 */
export const KEEP_EVERY_ROW = Number.POSITIVE_INFINITY;

export function pruneRecentRows<T>(rows: T[], days = RECENT_CACHE_DAYS): T[] {
  if (days === KEEP_EVERY_ROW) return rows;
  return rows.filter((row) => {
    const value = row as { createdAt?: unknown; updatedAt?: unknown; created_at?: unknown; updated_at?: unknown };
    return isWithinRecentWindow(value.createdAt ?? value.updatedAt ?? value.created_at ?? value.updated_at, days);
  });
}

export function readInstantCache<T>(key: string, fallback: T): T {
  const scoped = memKey(key);
  return memoryCache.has(scoped) ? memoryCache.get(scoped) as T : fallback;
}

export function normaliseInstantCacheValue<T>(value: T, days = RECENT_CACHE_DAYS): T {
  return (Array.isArray(value) ? pruneRecentRows(value, days) : value) as T;
}

export function writeInstantMemoryCache<T>(key: string, value: T, days = RECENT_CACHE_DAYS): void {
  memoryCache.set(memKey(key), normaliseInstantCacheValue(value, days));
  writtenAt.set(memKey(key), Date.now());
}

export function writeInstantCache<T>(key: string, value: T, days = RECENT_CACHE_DAYS): void {
  const valueForCache = normaliseInstantCacheValue(value, days);
  memoryCache.set(memKey(key), valueForCache);
  writtenAt.set(memKey(key), Date.now());
  void offlineDB.putRecentCache(key, valueForCache, days).catch(() => {
    // IndexedDB can be unavailable in private mode; in-memory cache still prevents UI crashes.
  });
}

export async function readIndexedRecentCache<T>(key: string, fallback: T): Promise<T> {
  try {
    const value = await offlineDB.getRecentCache<T>(key, fallback);
    memoryCache.set(memKey(key), value);
    return value;
  } catch {
    return readInstantCache<T>(key, fallback);
  }
}

export async function hydrateInstantCacheFromIndexedDB(keys: string[]): Promise<void> {
  await Promise.all(keys.map(async (key) => {
    const value = await offlineDB.getRecentCache<unknown>(key, undefined).catch(() => undefined);
    if (value !== undefined) memoryCache.set(memKey(key), value);
  }));
}

export async function migrateLegacyInstantCache(keys: string[], days = RECENT_CACHE_DAYS): Promise<void> {
  await Promise.all(keys.map(async (key) => {
    const existing = await offlineDB.getRecentCache<unknown>(key, undefined).catch(() => undefined);
    if (existing !== undefined) {
      memoryCache.set(memKey(key), existing);
      return;
    }
    const legacy = readLegacyLocalStorage<unknown>(key);
    if (legacy === null) return;
    const valueForCache = Array.isArray(legacy) ? pruneRecentRows(legacy, days) : legacy;
    memoryCache.set(memKey(key), valueForCache);
    await offlineDB.putRecentCache(key, valueForCache, days).catch(() => undefined);
  }));
}

export function prependCachedListItem<T extends { id: string }>(key: string, item: T, maxItems = 300): T[] {
  const current = readInstantCache<T[]>(key, []);
  const next = pruneRecentRows([item, ...current.filter((row) => row.id !== item.id)].slice(0, maxItems));
  writeInstantCache(key, next);
  return next;
}

export function upsertCachedListItem<T extends { id: string }>(key: string, item: T, maxItems = 500): T[] {
  const current = readInstantCache<T[]>(key, []);
  const exists = current.some((row) => row.id === item.id);
  const next = pruneRecentRows((exists ? current.map((row) => row.id === item.id ? item : row) : [item, ...current]).slice(0, maxItems));
  writeInstantCache(key, next);
  return next;
}

export function removeCachedListItem<T extends { id: string }>(key: string, id: string): T[] {
  const next = readInstantCache<T[]>(key, []).filter((row) => row.id !== id);
  writeInstantCache(key, next);
  return next;
}

export function createLocalId(prefix: string) {
  const randomId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${randomId}`;
}

export function emitLocalDataChanged(detail?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("kirana:local-data-changed", { detail }));
  postLocalDataChangeToOtherTabs(detail);
}

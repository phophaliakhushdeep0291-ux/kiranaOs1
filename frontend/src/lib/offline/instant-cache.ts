import { offlineDB } from "@/lib/offline/db";

const CACHE_PREFIX = "kirana-os:instant-cache:";
export const RECENT_CACHE_DAYS = 30;

const memoryCache = new Map<string, unknown>();

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
    const raw = localStorage.getItem(`${CACHE_PREFIX}${key}`);
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

export function pruneRecentRows<T>(rows: T[], days = RECENT_CACHE_DAYS): T[] {
  return rows.filter((row) => {
    const value = row as { createdAt?: unknown; updatedAt?: unknown; created_at?: unknown; updated_at?: unknown };
    return isWithinRecentWindow(value.createdAt ?? value.updatedAt ?? value.created_at ?? value.updated_at, days);
  });
}

export function readInstantCache<T>(key: string, fallback: T): T {
  return memoryCache.has(key) ? memoryCache.get(key) as T : fallback;
}

export function normaliseInstantCacheValue<T>(value: T, days = RECENT_CACHE_DAYS): T {
  return (Array.isArray(value) ? pruneRecentRows(value, days) : value) as T;
}

export function writeInstantMemoryCache<T>(key: string, value: T, days = RECENT_CACHE_DAYS): void {
  memoryCache.set(key, normaliseInstantCacheValue(value, days));
}

export function writeInstantCache<T>(key: string, value: T, days = RECENT_CACHE_DAYS): void {
  const valueForCache = normaliseInstantCacheValue(value, days);
  memoryCache.set(key, valueForCache);
  void offlineDB.putRecentCache(key, valueForCache, days).catch(() => {
    // IndexedDB can be unavailable in private mode; in-memory cache still prevents UI crashes.
  });
}

export async function readIndexedRecentCache<T>(key: string, fallback: T): Promise<T> {
  try {
    const value = await offlineDB.getRecentCache<T>(key, fallback);
    memoryCache.set(key, value);
    return value;
  } catch {
    return readInstantCache<T>(key, fallback);
  }
}

export async function hydrateInstantCacheFromIndexedDB(keys: string[]): Promise<void> {
  await Promise.all(keys.map(async (key) => {
    const value = await offlineDB.getRecentCache<unknown>(key, undefined).catch(() => undefined);
    if (value !== undefined) memoryCache.set(key, value);
  }));
}

export async function migrateLegacyInstantCache(keys: string[], days = RECENT_CACHE_DAYS): Promise<void> {
  await Promise.all(keys.map(async (key) => {
    const existing = await offlineDB.getRecentCache<unknown>(key, undefined).catch(() => undefined);
    if (existing !== undefined) {
      memoryCache.set(key, existing);
      return;
    }
    const legacy = readLegacyLocalStorage<unknown>(key);
    if (legacy === null) return;
    const valueForCache = Array.isArray(legacy) ? pruneRecentRows(legacy, days) : legacy;
    memoryCache.set(key, valueForCache);
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

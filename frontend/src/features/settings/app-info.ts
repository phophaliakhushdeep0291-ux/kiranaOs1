import { dexieDB, offlineDB } from "@/lib/offline/db";

/**
 * The facts the Advanced -> Diagnostics card and the Settings footer report.
 * Everything here is read from the real runtime — build stamp, storage quota,
 * IndexedDB schema version, outbox depth — so support never chases a number
 * that was typed into the page.
 */

declare const __KIRANA_BUILD_ID__: string;

/** Injected by vite.config.ts at build time (commit sha or a UTC timestamp). */
export function buildId(): string {
  try {
    return typeof __KIRANA_BUILD_ID__ === "string" ? __KIRANA_BUILD_ID__ : "dev";
  } catch {
    return "dev";
  }
}

/**
 * Single source of truth for the support address customers/shopkeepers see.
 * It was hardcoded in three places under two different domains
 * (support@kiranaos.app in Settings, support@kiranaos.in in the order portal),
 * so support requests landed in inconsistent, off-brand inboxes.
 * ── Set this to the real monitored Artha support inbox before going live. ──
 */
export const SUPPORT_EMAIL = "support@kiranaos.app";

/** Marketing-facing app version. Derived from the build stamp so it can't drift. */
export function appVersion(): string {
  const id = buildId();
  return /^\d{8}/.test(id) ? `${id.slice(0, 4)}.${id.slice(4, 6)}.${id.slice(6, 8)}` : id.slice(0, 12);
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export interface StorageSlice {
  label: string;
  rows: number;
  tone: string;
}

export interface StorageReport {
  /** Bytes this origin is actually using, from the Storage API. */
  usageBytes: number | null;
  /** Bytes the browser is willing to give this origin. */
  quotaBytes: number | null;
  /** Whether the browser answered at all (Safari/older engines may not). */
  measured: boolean;
  /** Row counts per area — the honest stand-in for a per-table byte split. */
  slices: StorageSlice[];
  totalRows: number;
  /** Cache Storage entries backing the installed app shell. */
  cacheNames: number;
}

const STORAGE_GROUPS: { label: string; tables: string[]; tone: string }[] = [
  { label: "Catalogue", tables: ["products", "suppliers"], tone: "bg-[var(--brand)]" },
  { label: "Sales", tables: ["bills", "bill_items", "payments"], tone: "bg-violet-500" },
  { label: "Customers", tables: ["customers", "customer_ledger"], tone: "bg-emerald-500" },
  { label: "Stock", tables: ["inventory_movements"], tone: "bg-amber-500" },
  { label: "Sync queue", tables: ["sync_outbox", "sync_conflicts"], tone: "bg-rose-500" },
];

async function countRows(table: string): Promise<number> {
  try {
    const rows = await offlineDB.getAll<Record<string, unknown>>(table);
    return rows.length;
  } catch {
    return 0;
  }
}

export async function measureStorage(): Promise<StorageReport> {
  let usageBytes: number | null = null;
  let quotaBytes: number | null = null;
  let measured = false;
  try {
    if (navigator.storage?.estimate) {
      const estimate = await navigator.storage.estimate();
      usageBytes = typeof estimate.usage === "number" ? estimate.usage : null;
      quotaBytes = typeof estimate.quota === "number" ? estimate.quota : null;
      measured = usageBytes !== null;
    }
  } catch {
    measured = false;
  }

  const slices: StorageSlice[] = [];
  for (const group of STORAGE_GROUPS) {
    const counts = await Promise.all(group.tables.map(countRows));
    slices.push({ label: group.label, rows: counts.reduce((sum, n) => sum + n, 0), tone: group.tone });
  }

  let cacheNames = 0;
  try {
    if ("caches" in window) cacheNames = (await caches.keys()).length;
  } catch {
    cacheNames = 0;
  }

  return {
    usageBytes,
    quotaBytes,
    measured,
    slices,
    totalRows: slices.reduce((sum, slice) => sum + slice.rows, 0),
    cacheNames,
  };
}

/** Dexie's live schema version — what a support engineer actually needs. */
export function databaseVersion(): string {
  const version = dexieDB.verno;
  return typeof version === "number" && version > 0 ? `v${version}` : "not opened";
}

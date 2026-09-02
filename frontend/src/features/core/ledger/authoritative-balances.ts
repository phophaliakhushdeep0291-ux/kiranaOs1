import { getUdharSummary } from "@/features/core/ledger/api";
import { isBrowserOnline } from "@/lib/api/http";
import { readIndexedRecentCache, readInstantCache, writeInstantCache } from "@/lib/offline/instant-cache";
import type { UdharSummary } from "@/types/api";
import { dedupeLedgerEntries, getLedgerCustomerId, ledgerSignedAmount, roundMoney, type CustomerLedgerEntry } from "@/features/core/ledger/accounting";

/**
 * The server's `/udhar/summary` is the ONLY authoritative udhar balance: it is
 * derived from the shop's udhar ledger inside the same transaction that writes
 * bills and payments. The device ledger is a replica that can drift (a dropped
 * pull, a dedupe that collapsed a real row, an old bug that zeroed balances),
 * and once it drifts nothing repairs it — every later read stays wrong.
 *
 * This module keeps the last summary the device saw so the SAME number survives
 * going offline. Without it the udhar page silently switches data sources when
 * the network drops: online it shows the server balance, offline it shows the
 * raw local ledger sum, and the two disagree (the live report: ₹300 online,
 * −₹330 offline).
 */
export const AUTHORITATIVE_UDHAR_SUMMARY_CACHE_KEY = "udhar_authoritative_summary";

/** Long TTL on purpose: a stale server balance still beats a drifted local sum. */
const CACHE_DAYS = 365;

export interface CachedAuthoritativeSummary {
  summary: UdharSummary;
  capturedAt: string;
}

export type AuthoritativeSummarySource = "server" | "cache" | "none";

export interface ResolvedAuthoritativeSummary {
  summary: UdharSummary | null;
  source: AuthoritativeSummarySource;
  /** When the summary was fetched from the server, for "as of" labelling. */
  capturedAt: string | null;
}

function isCachedSummary(value: unknown): value is CachedAuthoritativeSummary {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<CachedAuthoritativeSummary>;
  return Boolean(row.summary && Array.isArray(row.summary.customers));
}

/** Synchronous read (memory cache only) — safe for React `initialData`. */
export function readCachedAuthoritativeSummary(): CachedAuthoritativeSummary | null {
  const cached = readInstantCache<CachedAuthoritativeSummary | null>(AUTHORITATIVE_UDHAR_SUMMARY_CACHE_KEY, null);
  return isCachedSummary(cached) ? cached : null;
}

/** Falls back to IndexedDB, so a cold start while offline still has the balances. */
export async function loadCachedAuthoritativeSummary(): Promise<CachedAuthoritativeSummary | null> {
  const inMemory = readCachedAuthoritativeSummary();
  if (inMemory) return inMemory;
  const stored = await readIndexedRecentCache<CachedAuthoritativeSummary | null>(
    AUTHORITATIVE_UDHAR_SUMMARY_CACHE_KEY,
    null,
  ).catch(() => null);
  return isCachedSummary(stored) ? stored : null;
}

export function cacheAuthoritativeSummary(summary: UdharSummary): CachedAuthoritativeSummary {
  const row: CachedAuthoritativeSummary = { summary, capturedAt: new Date().toISOString() };
  writeInstantCache(AUTHORITATIVE_UDHAR_SUMMARY_CACHE_KEY, row, CACHE_DAYS);
  return row;
}

/**
 * The server balance when it is reachable, otherwise the last one this device
 * saw. Use this everywhere a udhar balance is displayed or validated so the
 * number never changes just because the connection did.
 */
export async function resolveAuthoritativeUdharSummary(): Promise<ResolvedAuthoritativeSummary> {
  if (isBrowserOnline()) {
    try {
      const summary = await getUdharSummary();
      const cached = cacheAuthoritativeSummary(summary);
      return { summary, source: "server", capturedAt: cached.capturedAt };
    } catch {
      // Fall through to the cached snapshot: a failed refresh must not downgrade
      // the page to the drifted local ledger.
    }
  }
  const cached = await loadCachedAuthoritativeSummary();
  if (!cached) return { summary: null, source: "none", capturedAt: null };
  return { summary: cached.summary, source: "cache", capturedAt: cached.capturedAt };
}

/** Outstanding for one customer from a summary, keyed by any of its known ids. */
export function authoritativeOutstandingFor(
  summary: UdharSummary | null | undefined,
  customerIds: Array<string | null | undefined>,
): number | null {
  if (!summary) return null;
  const ids = new Set(customerIds.filter((id): id is string => typeof id === "string" && id.length > 0));
  if (ids.size === 0) return null;
  const row = summary.customers.find((customer) => ids.has(customer.customerId));
  // A customer missing from the summary is settled (the endpoint only returns
  // customers with a balance), which is still an authoritative answer of zero.
  return row ? Math.max(0, Number(row.outstanding ?? 0)) : 0;
}

/** One balance rule for all local financial mutations, including corrections. */
export function authoritativeOutstandingWithPendingLedger(
  summary: UdharSummary,
  customerIds: string[],
  entries: CustomerLedgerEntry[],
): number | null {
  const base = authoritativeOutstandingFor(summary, customerIds);
  if (base === null) return null;
  const ids = new Set(customerIds);
  const pending = new Set(["pending_sync", "syncing", "failed", "local_only"]);
  let balance = base;
  for (const entry of dedupeLedgerEntries(entries)) {
    const id = getLedgerCustomerId(entry);
    // Conflicts were rejected by the server and must not change its balance.
    if (!id || !ids.has(id) || !pending.has(String(entry.sync_status ?? "").toLowerCase())) continue;
    balance = roundMoney(balance + ledgerSignedAmount(entry));
  }
  return roundMoney(Math.max(0, balance));
}

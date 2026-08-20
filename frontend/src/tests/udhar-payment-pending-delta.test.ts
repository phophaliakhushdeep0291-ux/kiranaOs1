import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A second udhar collection taken before the first one has synced must not
 * resurrect debt the customer has already paid.
 *
 * Live repro (kirana shop, 2026-08-20): customer owes ₹200 and is fully synced.
 * Collect ₹120 → device correctly shows ₹80. Collect ₹80 with no sync in
 * between → the device stored a balance of ₹120 even though the ledger rows
 * (debit 200, payment 120, payment 80) net to zero, and the UI then invited the
 * shopkeeper to collect that ₹120 again. The server refused the extra payment
 * (`UDHAR_PAYMENT_EXCEEDS_OUTSTANDING`), so the cash the customer handed over
 * was recorded nowhere.
 *
 * The cause is that the cached authoritative balance is re-captured after every
 * local payment, so `capturedAt` moves PAST a payment that is still
 * `pending_sync`. Whether the server's number includes a local entry is decided
 * by that entry's sync status, never by its timestamp.
 */

const dbState = vi.hoisted(() => ({
  scope: {
    tenant_id: "tenant_pending_delta",
    store_id: "store_pending_delta",
    device_id: "device_pending_delta",
  },
  committed: {} as Record<string, Array<Record<string, unknown>>>,
  idCounter: 0,
}));

const cacheState = vi.hoisted(() => ({ instant: new Map<string, unknown>() }));

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function tableRows(table: string) {
  dbState.committed[table] ??= [];
  return dbState.committed[table];
}

function scopedRows(table: string) {
  return tableRows(table).filter(
    (row) => row.tenant_id === dbState.scope.tenant_id && row.store_id === dbState.scope.store_id,
  );
}

function primaryKey(table: string) {
  if (table === "settings") return "key";
  if (table === "sync_outbox") return "clientEventId";
  return "id";
}

function putInto(table: string, value: Record<string, unknown>, target = dbState.committed) {
  target[table] ??= [];
  const row = clone(value);
  const keyField = primaryKey(table);
  const key = row[keyField];
  if (typeof key !== "string") throw new Error(`Missing primary key ${keyField} for ${table}`);
  const rows = target[table];
  const index = rows.findIndex((existing) => existing[keyField] === key);
  if (index >= 0) rows[index] = row;
  else rows.push(row);
}

vi.mock("@/lib/offline/context", () => ({
  getOfflineScope: () => dbState.scope,
  nowIso: () => "2026-08-20T10:40:00.000Z",
}));

vi.mock("@/lib/offline/db", () => ({
  offlineDB: {
    getAll: vi.fn(async (table: string) => clone(scopedRows(table))),
    put: vi.fn(async (table: string, value: Record<string, unknown>) => putInto(table, value)),
    delete: vi.fn(async (table: string, id: string) => {
      const keyField = primaryKey(table);
      dbState.committed[table] = tableRows(table).filter((row) => row[keyField] !== id);
    }),
    enqueueOutboxOperation: vi.fn(async (event: Record<string, unknown>) => putInto("sync_outbox", event)),
    transaction: vi.fn(async (_tables: string[], callback: (tx: {
      put: (table: string, value: Record<string, unknown>) => Promise<void>;
      putMany: (table: string, values: Array<Record<string, unknown>>) => Promise<void>;
      enqueueOutboxOperation: (event: Record<string, unknown>) => Promise<void>;
      setSetting: (key: string, value: unknown, expiresAt?: number | null) => Promise<void>;
    }) => Promise<unknown>) => {
      const staged = clone(dbState.committed);
      const tx = {
        put: vi.fn(async (table: string, value: Record<string, unknown>) => putInto(table, value, staged)),
        putMany: vi.fn(async (table: string, values: Array<Record<string, unknown>>) => {
          for (const value of values) putInto(table, value, staged);
        }),
        enqueueOutboxOperation: vi.fn(async (event: Record<string, unknown>) =>
          putInto("sync_outbox", event, staged),
        ),
        setSetting: vi.fn(async () => undefined),
      };
      await callback(tx);
      dbState.committed = staged;
    }),
  },
}));

vi.mock("@/lib/offline/instant-cache", () => ({
  createLocalId: vi.fn((prefix: string) => `${prefix}_${++dbState.idCounter}`),
  emitLocalDataChanged: vi.fn(),
  normaliseInstantCacheValue: vi.fn((value: unknown) => value),
  readIndexedRecentCache: vi.fn(async (key: string, fallback: unknown) =>
    cacheState.instant.has(key) ? cacheState.instant.get(key) : fallback,
  ),
  readInstantCache: vi.fn((key: string, fallback: unknown) =>
    cacheState.instant.has(key) ? cacheState.instant.get(key) : fallback,
  ),
  upsertCachedListItem: vi.fn(),
  writeInstantCache: vi.fn((key: string, value: unknown) => cacheState.instant.set(key, value)),
  writeInstantMemoryCache: vi.fn((key: string, value: unknown) => cacheState.instant.set(key, value)),
}));

import { AUTHORITATIVE_UDHAR_SUMMARY_CACHE_KEY } from "@/features/core/ledger/authoritative-balances";
import { recordPaymentLocalFirst } from "@/features/core/payments/local-actions";

/** The bill was raised, and synced, before any of this. */
const BILL_AT = "2026-08-20T10:00:00.000Z";
/** The first collection — written locally, still waiting to be pushed. */
const FIRST_PAYMENT_AT = "2026-08-20T10:30:00.000Z";
/**
 * The page refetches /udhar/summary right after recording a payment, so the
 * snapshot is captured AFTER the pending payment exists. The server number is
 * still ₹200 because it has not received that payment yet.
 */
const SUMMARY_CAPTURED_AT = "2026-08-20T10:31:00.000Z";

function seedShopThatOwes200() {
  dbState.idCounter = 0;
  dbState.committed = {
    customers: [],
    payments: [],
    customer_ledger: [],
    local_audit_logs: [],
    sync_outbox: [],
    settings: [],
    id_mappings: [],
  };
  cacheState.instant.clear();

  putInto("customers", {
    id: "customer_1",
    local_id: "customer_1",
    server_id: "customer_1",
    tenant_id: dbState.scope.tenant_id,
    store_id: dbState.scope.store_id,
    device_id: dbState.scope.device_id,
    name: "Suresh Patel",
    type: "udhar",
    udharAmount: 80,
    totalUdhar: 80,
    sync_status: "synced",
    deleted_at: null,
  });

  putInto("customer_ledger", {
    id: "ledger_bill_1",
    tenant_id: dbState.scope.tenant_id,
    store_id: dbState.scope.store_id,
    customerId: "customer_1",
    type: "BILL",
    amount: 200,
    balance_after: 200,
    created_at: BILL_AT,
    business_date: BILL_AT,
    sync_status: "synced",
    deleted_at: null,
  });

  putInto("customer_ledger", {
    id: "ledger_payment_1",
    tenant_id: dbState.scope.tenant_id,
    store_id: dbState.scope.store_id,
    customerId: "customer_1",
    type: "PAYMENT",
    amount: 120,
    balance_after: 80,
    created_at: FIRST_PAYMENT_AT,
    business_date: FIRST_PAYMENT_AT,
    sync_status: "pending_sync",
    deleted_at: null,
  });

  cacheState.instant.set(AUTHORITATIVE_UDHAR_SUMMARY_CACHE_KEY, {
    capturedAt: SUMMARY_CAPTURED_AT,
    summary: {
      totalOutstanding: 200,
      customers: [
        {
          customerId: "customer_1",
          customerName: "Suresh Patel",
          mobile: "9876500022",
          amount: 200,
          outstanding: 200,
        },
      ],
    },
  });
}

describe("udhar payment with an unsynced earlier payment", () => {
  beforeEach(() => {
    seedShopThatOwes200();
  });

  it("settles the account instead of resurrecting the already-paid ₹120", async () => {
    const result = await recordPaymentLocalFirst("customer_1", { amount: 80, mode: "cash" });

    expect(result).toEqual(expect.objectContaining({ success: true, amount: 80 }));

    // debit 200 − payment 120 − payment 80 = 0. Anything else means the unsynced
    // ₹120 was dropped and the customer is being asked for it twice.
    const settlement = scopedRows("customer_ledger").find((row) => row.id === "ledger_2");
    expect(settlement).toEqual(expect.objectContaining({ type: "PAYMENT", amount: 80, balance_after: 0 }));
    expect(scopedRows("customers").find((row) => row.id === "customer_1")).toEqual(
      expect.objectContaining({ udharAmount: 0, totalUdhar: 0 }),
    );
  });

  it("refuses a further collection once the account is settled", async () => {
    await recordPaymentLocalFirst("customer_1", { amount: 80, mode: "cash" });

    // This is the phantom collection the live bug allowed: the shop took ₹120 the
    // customer did not owe, and the server then rejected it as a conflict.
    await expect(
      recordPaymentLocalFirst("customer_1", { amount: 120, mode: "cash" }),
    ).rejects.toThrow(/exceeds outstanding udhar ₹0/);
  });

  it("still trusts the server balance when the device has nothing pending", async () => {
    // Same snapshot, but the earlier payment has been acknowledged. The server's
    // ₹200 is then the honest number and a ₹200 collection must be allowed.
    const ledger = tableRows("customer_ledger");
    const pending = ledger.find((row) => row.id === "ledger_payment_1");
    if (pending) pending.deleted_at = FIRST_PAYMENT_AT;

    const result = await recordPaymentLocalFirst("customer_1", { amount: 200, mode: "cash" });
    expect(result).toEqual(expect.objectContaining({ success: true, amount: 200 }));
    expect(scopedRows("customers").find((row) => row.id === "customer_1")).toEqual(
      expect.objectContaining({ udharAmount: 0 }),
    );
  });
});

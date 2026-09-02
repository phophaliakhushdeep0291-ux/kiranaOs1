import { beforeEach, describe, expect, it, vi } from "vitest";

const dbState = vi.hoisted(() => ({
  committed: {} as Record<string, unknown[]>,
  failOnTable: null as string | null,
  idCounter: 0,
}));

function cloneRows(rows: unknown[]) {
  return rows.map((row) => ({ ...(row as Record<string, unknown>) }));
}

function tableRows(table: string) {
  return (dbState.committed[table] ?? []) as Array<Record<string, unknown>>;
}

vi.mock("@/lib/offline/db", () => ({
  offlineDB: {
    getAll: vi.fn(async (table: string) => cloneRows(dbState.committed[table] ?? [])),
    put: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    transaction: vi.fn(async (_tables: string[], callback: (tx: {
      put: (table: string, value: unknown) => Promise<void>;
      putMany: (table: string, values: unknown[]) => Promise<void>;
      enqueueOutboxOperation: (event: unknown) => Promise<void>;
      setSetting: (key: string, value: unknown, expiresAt?: number | null) => Promise<void>;
    }) => Promise<unknown>) => {
      const staged = Object.fromEntries(Object.entries(dbState.committed).map(([table, rows]) => [table, cloneRows(rows)])) as Record<string, unknown[]>;
      const ensure = (table: string) => {
        staged[table] ??= [];
        return staged[table];
      };
      const maybeFail = (table: string) => {
        if (dbState.failOnTable === table) throw new Error(`Injected ${table} write failure`);
      };

      const tx = {
        put: vi.fn(async (table: string, value: unknown) => {
          maybeFail(table);
          const row = { ...(value as Record<string, unknown>) };
          const key = table === "settings" ? row.key : row.id;
          const rows = ensure(table);
          const index = rows.findIndex((existing) => (existing as Record<string, unknown>)[table === "settings" ? "key" : "id"] === key);
          if (index >= 0) rows[index] = row;
          else rows.push(row);
        }),
        putMany: vi.fn(async (table: string, values: unknown[]) => {
          maybeFail(table);
          for (const value of values) await tx.put(table, value);
        }),
        enqueueOutboxOperation: vi.fn(async (event: unknown) => {
          maybeFail("sync_outbox");
          ensure("sync_outbox").push({ ...(event as Record<string, unknown>) });
        }),
        setSetting: vi.fn(async (key: string, value: unknown, expiresAt?: number | null) => {
          maybeFail("settings");
          await tx.put("settings", { key, value, expires_at: expiresAt ?? null });
        }),
      };

      await callback(tx);
      dbState.committed = staged;
    }),
  },
}));

vi.mock("@/lib/offline/instant-cache", () => ({
  createLocalId: vi.fn((prefix: string) => `${prefix}_${++dbState.idCounter}`),
  emitLocalDataChanged: vi.fn(),
  readIndexedRecentCache: vi.fn(async (_key: string, fallback: unknown) => fallback),
  readInstantCache: vi.fn((_key: string, fallback: unknown) => fallback),
  upsertCachedListItem: vi.fn(),
  writeInstantCache: vi.fn(),
}));

import { offlineDB } from "@/lib/offline/db";
import { readInstantCache, upsertCachedListItem } from "@/lib/offline/instant-cache";
import { AUTHORITATIVE_UDHAR_SUMMARY_CACHE_KEY } from "@/features/core/ledger/authoritative-balances";
import { getLocalUdharSummary, recordPaymentLocalFirst, recordSplitPaymentLocalFirst } from "@/features/core/payments/local-actions";

const mockedOfflineDB = vi.mocked(offlineDB);
const mockedReadInstantCache = vi.mocked(readInstantCache);
const mockedUpsertCachedListItem = vi.mocked(upsertCachedListItem);

describe("payment recording transaction safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedReadInstantCache.mockImplementation((_key: string, fallback: unknown) => fallback);
    dbState.idCounter = 0;
    dbState.failOnTable = null;
    dbState.committed = {
      customers: [{ id: "customer_1", name: "Ramesh", type: "udhar", udharAmount: 500, totalUdhar: 500, trustScore: 70 }],
      customer_ledger: [{ id: "ledger_bill_1", customerId: "customer_1", customer_id: "customer_1", type: "BILL", source_type: "bill", amount: 500, balance_after: 500, created_at: "2026-06-01T10:00:00.000Z", entry_at: "2026-06-01T10:00:00.000Z" }],
      payments: [],
      local_audit_logs: [],
      sync_outbox: [],
    };
  });

  it("decreases customer balance and writes all payment records in one transaction", async () => {
    const result = await recordPaymentLocalFirst("customer_1", { amount: 200, mode: "cash", note: "Partial payment" });

    expect(result).toEqual({ success: true, paymentId: "payment_1", customerId: "customer_1", amount: 200, nextBalance: 300, pendingSync: true });
    expect(mockedOfflineDB.transaction).toHaveBeenCalledWith(
      expect.arrayContaining(["payments", "customer_ledger", "customers", "local_audit_logs", "sync_outbox"]),
      expect.any(Function),
    );

    expect(tableRows("payments")).toHaveLength(1);
    expect(tableRows("payments")[0]).toEqual(expect.objectContaining({ id: "payment_1", customer_id: "customer_1", amount: 200, mode: "cash", status: "active" }));
    // The cached balance is derived from the ledger entry, not an independent
    // customer edit, so the row keeps its sync status instead of being pinned to
    // "pending_sync" forever (nothing queues a CUSTOMER op to clear it).
    expect(tableRows("customers")[0]).toEqual(expect.objectContaining({
      id: "customer_1",
      udharAmount: 300,
      totalUdhar: 300,
      sync_status: "synced",
      balance_derived_from_local_ledger: true,
    }));
  });

  it("rejects udhar overpayment before writing local rows", async () => {
    await expect(recordPaymentLocalFirst("customer_1", { amount: 600, mode: "cash" }))
      .rejects.toMatchObject({ code: "UDHAR_PAYMENT_EXCEEDS_OUTSTANDING" });

    expect(mockedOfflineDB.transaction).not.toHaveBeenCalled();
    expect(tableRows("payments")).toHaveLength(0);
    expect(tableRows("customer_ledger").filter((row) => row.type === "PAYMENT")).toHaveLength(0);
    expect(tableRows("customers")[0]).toEqual(expect.objectContaining({ udharAmount: 500, totalUdhar: 500 }));
    expect(tableRows("sync_outbox")).toHaveLength(0);
  });

  it("uses cached server udhar summary when the local ledger is stale at zero", async () => {
    dbState.committed.customers = [
      { id: "customer_1", name: "Ramesh", type: "udhar", udharAmount: 0, totalUdhar: 0, trustScore: 70, sync_status: "synced" },
    ];
    dbState.committed.customer_ledger = [];
    mockedReadInstantCache.mockImplementation((key: string, fallback: unknown) => {
      if (key === AUTHORITATIVE_UDHAR_SUMMARY_CACHE_KEY) {
        return {
          capturedAt: "2026-01-01T00:00:00.000Z",
          summary: {
            totalOutstanding: 300,
            customers: [
              { customerId: "customer_1", customerName: "Ramesh", amount: 300, outstanding: 300 },
            ],
          },
        };
      }
      return fallback;
    });

    const result = await recordPaymentLocalFirst("customer_1", { amount: 150, mode: "cash" });

    expect(result).toEqual(expect.objectContaining({ success: true, amount: 150 }));
    expect(tableRows("customer_ledger").find((row) => row.type === "PAYMENT")).toEqual(
      expect.objectContaining({ amount: 150, balance_after: 150 }),
    );
    expect(tableRows("customers")[0]).toEqual(expect.objectContaining({ udharAmount: 150, totalUdhar: 150 }));
  });

  it("subtracts pending local payments from the cached server balance before validating again", async () => {
    dbState.committed.customers = [
      { id: "customer_1", name: "Ramesh", type: "udhar", udharAmount: 0, totalUdhar: 0, trustScore: 70, sync_status: "synced" },
    ];
    dbState.committed.customer_ledger = [];
    mockedReadInstantCache.mockImplementation((key: string, fallback: unknown) => {
      if (key === AUTHORITATIVE_UDHAR_SUMMARY_CACHE_KEY) {
        return {
          capturedAt: "2026-01-01T00:00:00.000Z",
          summary: {
            totalOutstanding: 300,
            customers: [
              { customerId: "customer_1", customerName: "Ramesh", amount: 300, outstanding: 300 },
            ],
          },
        };
      }
      return fallback;
    });

    await recordPaymentLocalFirst("customer_1", { amount: 150, mode: "cash" });

    await expect(recordPaymentLocalFirst("customer_1", { amount: 200, mode: "cash" }))
      .rejects.toMatchObject({ code: "UDHAR_PAYMENT_EXCEEDS_OUTSTANDING" });
  });

  it("does not resurrect a drifted local ledger when a server-backed payment is pending", async () => {
    dbState.committed.customers = [
      { id: "customer_1", name: "Ramesh", type: "udhar", udharAmount: 900, totalUdhar: 900, sync_status: "synced" },
    ];
    dbState.committed.customer_ledger = [
      { id: "stale_bill", customerId: "customer_1", type: "BILL", amount: 1000, sync_status: "synced", entry_at: "2026-01-01T00:00:00.000Z" },
      { id: "pending_payment", customerId: "customer_1", type: "PAYMENT", amount: 100, sync_status: "pending_sync", entry_at: "2026-01-02T00:00:00.000Z" },
    ];
    mockedReadInstantCache.mockImplementation((key: string, fallback: unknown) => {
      if (key === AUTHORITATIVE_UDHAR_SUMMARY_CACHE_KEY) {
        return {
          capturedAt: "2026-01-01T00:00:00.000Z",
          summary: {
            totalOutstanding: 300,
            customers: [{ customerId: "customer_1", customerName: "Ramesh", amount: 300, outstanding: 300 }],
          },
        };
      }
      return fallback;
    });

    const result = await recordPaymentLocalFirst("customer_1", { amount: 200, mode: "cash" });

    expect(result.nextBalance).toBe(0);
    expect(tableRows("customers")[0]).toEqual(expect.objectContaining({ udharAmount: 0, totalUdhar: 0 }));
    expect(tableRows("customer_ledger").find((row) => row.id === "ledger_2")).toEqual(
      expect.objectContaining({ amount: 200, balance_after: 0 }),
    );
  });

  it("allows two same-amount payments that exactly clear the balance", async () => {
    dbState.committed.customers = [{ id: "customer_1", name: "Ramesh", type: "udhar", udharAmount: 200, totalUdhar: 200, trustScore: 70 }];
    dbState.committed.customer_ledger = [
      {
        id: "ledger_bill_1",
        customerId: "customer_1",
        customer_id: "customer_1",
        type: "BILL",
        source_type: "bill",
        amount: 200,
        balance_after: 200,
        created_at: "2026-06-01T10:00:00.000Z",
        entry_at: "2026-06-01T10:00:00.000Z",
      },
    ];

    await recordPaymentLocalFirst("customer_1", { amount: 100, mode: "cash" });
    await recordPaymentLocalFirst("customer_1", { amount: 100, mode: "cash" });

    expect(tableRows("payments")).toHaveLength(2);
    expect(tableRows("customer_ledger").filter((row) => row.type === "PAYMENT")).toHaveLength(2);
    expect(tableRows("customers")[0]).toEqual(expect.objectContaining({ udharAmount: 0, totalUdhar: 0 }));
    expect(tableRows("sync_outbox").filter((row) => row.operation_type === "RECORD_PAYMENT")).toHaveLength(2);
  });

  it("commits a cash and UPI split as one customer-financial transaction", async () => {
    const results = await recordSplitPaymentLocalFirst("customer_1", [
      { amount: 200, mode: "cash", note: "split cash" },
      { amount: 125, mode: "upi", note: "split UPI" },
    ]);

    expect(results.map((result) => result.nextBalance)).toEqual([300, 175]);
    expect(tableRows("payments").map((row) => row.mode)).toEqual(["cash", "upi"]);
    expect(tableRows("customer_ledger").filter((row) => row.type === "PAYMENT")).toHaveLength(2);
    expect(tableRows("customers")[0]).toEqual(expect.objectContaining({ udharAmount: 175, totalUdhar: 175 }));
    expect(tableRows("sync_outbox").filter((row) => row.operation_type === "RECORD_PAYMENT")).toHaveLength(2);
  });

  it("rolls back the entire split if any shared financial write fails", async () => {
    dbState.failOnTable = "local_audit_logs";

    await expect(recordSplitPaymentLocalFirst("customer_1", [
      { amount: 200, mode: "cash" },
      { amount: 125, mode: "upi" },
    ])).rejects.toThrow(/local_audit_logs write failure/i);

    expect(tableRows("payments")).toHaveLength(0);
    expect(tableRows("customer_ledger").filter((row) => row.type === "PAYMENT")).toHaveLength(0);
    expect(tableRows("customers")[0]).toEqual(expect.objectContaining({ udharAmount: 500, totalUdhar: 500 }));
    expect(tableRows("sync_outbox")).toHaveLength(0);
  });

  it("allows a rupee and paise split that exactly clears the balance", async () => {
    dbState.committed.customers = [{ id: "customer_1", name: "Ramesh", type: "udhar", udharAmount: 121.5, totalUdhar: 121.5, trustScore: 70 }];
    dbState.committed.customer_ledger = [
      {
        id: "ledger_bill_1",
        customerId: "customer_1",
        customer_id: "customer_1",
        type: "BILL",
        source_type: "bill",
        amount: 121.5,
        balance_after: 121.5,
        created_at: "2026-06-01T10:00:00.000Z",
        entry_at: "2026-06-01T10:00:00.000Z",
      },
    ];

    await recordPaymentLocalFirst("customer_1", { amount: 49, mode: "cash" });
    await recordPaymentLocalFirst("customer_1", { amount: 72.5, mode: "upi" });

    expect(tableRows("payments").map((row) => row.amount)).toEqual([49, 72.5]);
    expect(tableRows("customers")[0]).toEqual(expect.objectContaining({ udharAmount: 0, totalUdhar: 0 }));
  });

  it("creates a payment ledger entry", async () => {
    await recordPaymentLocalFirst("customer_1", { amount: 125, mode: "upi" });

    const paymentLedger = tableRows("customer_ledger").find((row) => row.type === "PAYMENT");
    expect(paymentLedger).toEqual(expect.objectContaining({
      id: "ledger_2",
      customer_id: "customer_1",
      source_type: "payment",
      source_id: "payment_1",
      payment_id: "payment_1",
      local_ledger_entry_id: "ledger_2",
      client_ledger_id: "ledger_2",
      idempotency_key: "record-payment:customer_1:payment_1",
      mode: "upi",
      payment_mode: "upi",
      amount: 125,
      balance_after: 375,
      sync_status: "pending_sync",
    }));
  });

  it("rolls back when any transactional write fails and leaves no partial payment", async () => {
    dbState.failOnTable = "local_audit_logs";

    await expect(recordPaymentLocalFirst("customer_1", { amount: 200, mode: "cash" })).rejects.toThrow(/local_audit_logs write failure/i);

    expect(tableRows("payments")).toHaveLength(0);
    expect(tableRows("customer_ledger").filter((row) => row.type === "PAYMENT")).toHaveLength(0);
    expect(tableRows("customers")[0]).toEqual(expect.objectContaining({ udharAmount: 500, totalUdhar: 500 }));
    expect(tableRows("local_audit_logs")).toHaveLength(0);
    expect(tableRows("sync_outbox")).toHaveLength(0);
    expect(mockedUpsertCachedListItem).not.toHaveBeenCalled();
  });

  it("creates a RECORD_PAYMENT sync outbox operation", async () => {
    await recordPaymentLocalFirst("customer_1", { amount: 200, mode: "upi" });

    expect(tableRows("sync_outbox")).toEqual(expect.arrayContaining([
      expect.objectContaining({
        operation_type: "RECORD_PAYMENT",
        entity_type: "payment",
        entity_id: "payment_1",
        idempotency_key: "record-payment:customer_1:payment_1",
        payload: expect.objectContaining({
          paymentId: "payment_1",
          customerId: "customer_1",
          localLedgerEntryId: "ledger_2",
          clientLedgerId: "ledger_2",
          idempotencyKey: "record-payment:customer_1:payment_1",
          payment: expect.objectContaining({
            localLedgerEntryId: "ledger_2",
            clientLedgerId: "ledger_2",
            idempotencyKey: "record-payment:customer_1:payment_1",
          }),
        }),
      }),
    ]));
  });

  it("uses append-only ledger balance for local udhar summary even when customer cache is stale", () => {
    mockedReadInstantCache.mockImplementation((key: string, fallback: unknown) => {
      if (key === "customers") {
        return [{ id: "customer_1", name: "Ramesh", type: "udhar", udharAmount: 500, totalUdhar: 500 }];
      }
      if (key === "customer_ledger") {
        return [
          { id: "ledger_bill_1", customerId: "customer_1", type: "BILL", amount: 500, entry_at: "2026-06-01T10:00:00.000Z" },
          { id: "ledger_payment_1", customerId: "customer_1", type: "PAYMENT", source_type: "payment", amount: 500, entry_at: "2026-06-01T10:05:00.000Z" },
        ];
      }
      return fallback;
    });

    expect(getLocalUdharSummary()).toEqual({ totalOutstanding: 0, customers: [] });
  });

  it("creates an audit log for the payment", async () => {
    await recordPaymentLocalFirst("customer_1", { amount: 75, mode: "cash" });

    expect(tableRows("local_audit_logs")).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "payment_recorded",
        entity_type: "payment",
        entity_id: "payment_1",
        entity_label: "Ramesh",
        summary: "Payment ₹75 recorded from Ramesh",
        sync_status: "pending_sync",
      }),
    ]));
    expect(tableRows("sync_outbox").some((row) => row.operation_type === "AUDIT_LOG_APPEND" && row.entity_type === "audit_log")).toBe(true);
  });
});

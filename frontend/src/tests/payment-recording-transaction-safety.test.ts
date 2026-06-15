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
  readInstantCache: vi.fn((_key: string, fallback: unknown) => fallback),
  upsertCachedListItem: vi.fn(),
}));

import { offlineDB } from "@/lib/offline/db";
import { upsertCachedListItem } from "@/lib/offline/instant-cache";
import { recordPaymentLocalFirst } from "@/features/payments/local-actions";

const mockedOfflineDB = vi.mocked(offlineDB);
const mockedUpsertCachedListItem = vi.mocked(upsertCachedListItem);

describe("payment recording transaction safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    expect(result).toEqual({ success: true, paymentId: "payment_1", customerId: "customer_1", amount: 200, pendingSync: true });
    expect(mockedOfflineDB.transaction).toHaveBeenCalledWith(
      expect.arrayContaining(["payments", "customer_ledger", "customers", "local_audit_logs", "sync_outbox"]),
      expect.any(Function),
    );

    expect(tableRows("payments")).toHaveLength(1);
    expect(tableRows("payments")[0]).toEqual(expect.objectContaining({ id: "payment_1", customer_id: "customer_1", amount: 200, mode: "cash", status: "active" }));
    expect(tableRows("customers")[0]).toEqual(expect.objectContaining({ id: "customer_1", udharAmount: 300, totalUdhar: 300, sync_status: "pending_sync" }));
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

  it("creates a payment ledger entry", async () => {
    await recordPaymentLocalFirst("customer_1", { amount: 125, mode: "upi" });

    const paymentLedger = tableRows("customer_ledger").find((row) => row.type === "PAYMENT");
    expect(paymentLedger).toEqual(expect.objectContaining({
      id: "ledger_2",
      customer_id: "customer_1",
      source_type: "payment",
      source_id: "payment_1",
      payment_id: "payment_1",
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
        payload: expect.objectContaining({ paymentId: "payment_1", customerId: "customer_1" }),
      }),
    ]));
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

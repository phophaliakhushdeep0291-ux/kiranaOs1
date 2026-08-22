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
    getAll: vi.fn(async (table: string) =>
      cloneRows(dbState.committed[table] ?? []),
    ),
    put: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    transaction: vi.fn(
      async (
        _tables: string[],
        callback: (tx: {
          put: (table: string, value: unknown) => Promise<void>;
          putMany: (table: string, values: unknown[]) => Promise<void>;
          enqueueOutboxOperation: (event: unknown) => Promise<void>;
          setSetting: (
            key: string,
            value: unknown,
            expiresAt?: number | null,
          ) => Promise<void>;
        }) => Promise<unknown>,
      ) => {
        const staged = Object.fromEntries(
          Object.entries(dbState.committed).map(([table, rows]) => [
            table,
            cloneRows(rows),
          ]),
        ) as Record<string, unknown[]>;
        const ensure = (table: string) => {
          staged[table] ??= [];
          return staged[table];
        };
        const maybeFail = (table: string) => {
          if (dbState.failOnTable === table)
            throw new Error(`Injected ${table} write failure`);
        };

        const tx = {
          put: vi.fn(async (table: string, value: unknown) => {
            maybeFail(table);
            const row = { ...(value as Record<string, unknown>) };
            const key = table === "settings" ? row.key : row.id;
            const rows = ensure(table);
            const index = rows.findIndex(
              (existing) =>
                (existing as Record<string, unknown>)[
                  table === "settings" ? "key" : "id"
                ] === key,
            );
            if (index >= 0) rows[index] = row;
            else rows.push(row);
          }),
          putMany: vi.fn(async (table: string, values: unknown[]) => {
            maybeFail(table);
            for (const value of values) await tx.put(table, value);
          }),
          enqueueOutboxOperation: vi.fn(async (event: unknown) => {
            maybeFail("sync_outbox");
            ensure("sync_outbox").push({
              ...(event as Record<string, unknown>),
            });
          }),
          setSetting: vi.fn(
            async (key: string, value: unknown, expiresAt?: number | null) => {
              maybeFail("settings");
              await tx.put("settings", {
                key,
                value,
                expires_at: expiresAt ?? null,
              });
            },
          ),
        };

        await callback(tx);
        dbState.committed = staged;
      },
    ),
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
import { upsertCachedListItem } from "@/lib/offline/instant-cache";
import { reversePaymentWithOwnerPinLocalFirst } from "@/features/core/payments/local-actions";

const mockedOfflineDB = vi.mocked(offlineDB);
const mockedUpsertCachedListItem = vi.mocked(upsertCachedListItem);

describe("payment reversal transaction safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbState.idCounter = 0;
    dbState.failOnTable = null;
    dbState.committed = {
      customers: [
        {
          id: "customer_1",
          name: "Ramesh",
          type: "udhar",
          udharAmount: 250,
          totalUdhar: 250,
          trustScore: 70,
        },
      ],
      payments: [
        {
          id: "payment_local_1",
          local_id: "payment_local_1",
          customerId: "customer_1",
          customer_id: "customer_1",
          amount: 250,
          mode: "cash",
          status: "active",
          created_at: "2026-06-05T10:00:00.000Z",
          sync_status: "pending_sync",
        },
      ],
      customer_ledger: [
        {
          id: "ledger_bill_1",
          customerId: "customer_1",
          customer_id: "customer_1",
          type: "BILL",
          source_type: "bill",
          amount: 500,
          balance_after: 500,
          entry_at: "2026-06-05T09:00:00.000Z",
          created_at: "2026-06-05T09:00:00.000Z",
        },
        {
          id: "ledger_payment_1",
          customerId: "customer_1",
          customer_id: "customer_1",
          type: "PAYMENT",
          source_type: "payment",
          source_id: "payment_local_1",
          paymentId: "payment_local_1",
          payment_id: "payment_local_1",
          amount: 250,
          balance_after: 250,
          entry_at: "2026-06-05T10:00:00.000Z",
          created_at: "2026-06-05T10:00:00.000Z",
        },
      ],
      local_audit_logs: [],
      sync_outbox: [],
    };
  });

  it("reverses a payment atomically, keeps the original payment row marked reversed, adjusts balance, appends correction, audit, and outbox", async () => {
    const result = await reversePaymentWithOwnerPinLocalFirst({
      paymentId: "payment_local_1",
      ownerPin: "1234",
      reason: "Duplicate payment",
    });

    expect(result).toEqual({
      success: true,
      paymentId: "payment_local_1",
      correctionId: "ledger_1",
      pendingSync: true,
    });
    expect(mockedOfflineDB.delete).not.toHaveBeenCalled();
    expect(mockedOfflineDB.transaction).toHaveBeenCalledWith(
      expect.arrayContaining([
        "payments",
        "customer_ledger",
        "customers",
        "local_audit_logs",
        "sync_outbox",
      ]),
      expect.any(Function),
    );

    expect(tableRows("payments")).toHaveLength(1);
    expect(tableRows("payments")[0]).toEqual(
      expect.objectContaining({
        id: "payment_local_1",
        status: "reversed",
        reversedAt: expect.any(String),
        reversed_at: expect.any(String),
        reverseReason: "Duplicate payment",
        sync_status: "pending_sync",
      }),
    );

    expect(tableRows("customer_ledger")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "ledger_1",
          customer_id: "customer_1",
          type: "CORRECTION",
          source_type: "payment_reversal",
          source_id: "payment_local_1",
          payment_id: "payment_local_1",
          amount: 250,
          balance_after: 500,
          note: "Duplicate payment",
          sync_status: "pending_sync",
        }),
      ]),
    );

    expect(tableRows("customers")[0]).toEqual(
      expect.objectContaining({
        id: "customer_1",
        udharAmount: 500,
        totalUdhar: 500,
        // Derived from the correction entry, not an independent customer edit.
        sync_status: "synced",
        balance_derived_from_local_ledger: true,
      }),
    );

    expect(tableRows("local_audit_logs")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "payment_reversed",
          entity_type: "payment",
          entity_id: "payment_local_1",
          entity_label: "Ramesh",
          reason: "Duplicate payment",
          owner_pin_provided: true,
          summary: "Payment reversal ₹250",
          sync_status: "pending_sync",
        }),
      ]),
    );

    expect(tableRows("sync_outbox")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation_type: "REVERSE_PAYMENT",
          entity_type: "payment",
          entity_id: "payment_local_1",
          idempotency_key: "reverse-payment:payment_local_1",
          payload: expect.objectContaining({
            paymentId: "payment_local_1",
            customerId: "customer_1",
            correctionId: "ledger_1",
            amount: 250,
            reason: "Duplicate payment",
          }),
        }),
        expect.objectContaining({
          operation_type: "AUDIT_LOG_APPEND",
          entity_type: "audit_log",
        }),
      ]),
    );
  });

  it("serializes concurrent reversal attempts and appends exactly one correction", async () => {
    const attempts = await Promise.allSettled([
      reversePaymentWithOwnerPinLocalFirst({
        paymentId: "payment_local_1",
        ownerPin: "1234",
        reason: "Duplicate payment",
      }),
      reversePaymentWithOwnerPinLocalFirst({
        paymentId: "payment_local_1",
        ownerPin: "1234",
        reason: "Duplicate payment",
      }),
    ]);

    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);
    expect(tableRows("customer_ledger").filter((row) => row.type === "CORRECTION")).toHaveLength(1);
    expect(tableRows("local_audit_logs").filter((row) => row.action === "payment_reversed")).toHaveLength(1);
    expect(tableRows("sync_outbox").filter((row) => row.operation_type === "REVERSE_PAYMENT")).toHaveLength(1);
    expect(tableRows("customers")[0]).toEqual(
      expect.objectContaining({ udharAmount: 500, totalUdhar: 500 }),
    );
  });

  it("rolls back the whole reversal when any transactional write fails", async () => {
    dbState.failOnTable = "sync_outbox";

    await expect(
      reversePaymentWithOwnerPinLocalFirst({
        paymentId: "payment_local_1",
        ownerPin: "1234",
        reason: "Wrong entry",
      }),
    ).rejects.toThrow(/sync_outbox write failure/i);

    expect(tableRows("payments")).toHaveLength(1);
    expect(tableRows("payments")[0]).toEqual(
      expect.objectContaining({ id: "payment_local_1", status: "active" }),
    );
    expect(tableRows("payments")[0].reversed_at).toBeUndefined();
    expect(
      tableRows("customer_ledger").filter((row) => row.type === "CORRECTION"),
    ).toHaveLength(0);
    expect(tableRows("customers")[0]).toEqual(
      expect.objectContaining({ udharAmount: 250, totalUdhar: 250 }),
    );
    expect(tableRows("local_audit_logs")).toHaveLength(0);
    expect(tableRows("sync_outbox")).toHaveLength(0);
    expect(mockedUpsertCachedListItem).not.toHaveBeenCalled();
  });
});

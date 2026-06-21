import { beforeEach, describe, expect, it, vi } from "vitest";
import { BillInputBillType, BillPaymentMode, type BillInput } from "@/types/api";

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
  normaliseInstantCacheValue: vi.fn((value: unknown) => value),
  readInstantCache: vi.fn((_key: string, fallback: unknown) => fallback),
  upsertCachedListItem: vi.fn(),
  writeInstantMemoryCache: vi.fn(),
}));

import { offlineDB } from "@/lib/offline/db";
import { writeInstantMemoryCache } from "@/lib/offline/instant-cache";
import { createBillLocalFirst } from "@/features/billing/local-actions";

const mockedOfflineDB = vi.mocked(offlineDB);
const mockedWriteInstantMemoryCache = vi.mocked(writeInstantMemoryCache);

function baseInput(overrides: Partial<BillInput> = {}): BillInput {
  return {
    billType: BillInputBillType.normal_sale,
    customerId: "customer_1",
    customerName: "Ramesh",
    items: [
      { productId: "product_1", name: "Sugar", quantity: 2, enteredUnit: "kg", ratePerRateUnit: 50, gstRate: 0 },
    ],
    discount: 0,
    actualAmount: 100,
    buyerPaidAmount: 100,
    payments: [{ mode: BillPaymentMode.cash, amount: 100 }],
    ...overrides,
  };
}

describe("bill creation transaction safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbState.idCounter = 0;
    dbState.failOnTable = null;
    dbState.committed = {
      customers: [{ id: "customer_1", name: "Ramesh", type: "regular", udharAmount: 25, totalUdhar: 25 }],
    };
  });

  it("successfully creates bill and all related records in one transaction", async () => {
    const bill = await createBillLocalFirst(baseInput({
      buyerPaidAmount: 40,
      payments: [
        { mode: BillPaymentMode.cash, amount: 40 },
        { mode: BillPaymentMode.credit, amount: 60 },
      ],
    }));

    expect(bill.id).toMatch(/^bill_/);
    expect(mockedOfflineDB.transaction).toHaveBeenCalledWith(
      expect.arrayContaining(["bills", "bill_items", "payments", "customer_ledger", "inventory_movements", "local_audit_logs", "sync_outbox", "settings"]),
      expect.any(Function),
    );
    expect(tableRows("bills")).toHaveLength(1);
    expect(tableRows("bill_items")).toHaveLength(1);
    expect(tableRows("payments")).toHaveLength(1);
    expect(tableRows("customer_ledger")).toHaveLength(1);
    expect(tableRows("inventory_movements")).toHaveLength(1);
    expect(tableRows("local_audit_logs")).toHaveLength(1);
    const outboxRows = tableRows("sync_outbox");
    const createBillOps = outboxRows.filter((row) => row.operation_type === "CREATE_BILL" && row.entity_id === bill.id);
    expect(createBillOps).toHaveLength(1);
    expect(outboxRows.some((row) => row.operation_type === "UPDATE_CUSTOMER")).toBe(false);
    expect(createBillOps[0]?.payload).toEqual(expect.objectContaining({
      payments: [expect.objectContaining({ mode: BillPaymentMode.cash, amount: 40, clientPaymentId: expect.any(String) })],
      paymentBreakdown: [expect.objectContaining({ mode: BillPaymentMode.cash, amount: 40 })],
      paidAmount: 40,
      creditAmount: 60,
      dueAmount: 60,
      ledgerEntries: [expect.objectContaining({ type: "BILL", amount: 60, customerId: "customer_1" })],
    }));
    expect(tableRows("customer_ledger")[0]).toEqual(expect.objectContaining({ bill_id: bill.id, customer_id: "customer_1", amount: 60, balance_after: 85 }));
    expect(tableRows("payments")[0]).toEqual(expect.objectContaining({ bill_id: bill.id, mode: BillPaymentMode.cash, amount: 40 }));
    expect(tableRows("settings").some((row) => row.key === "cache:bills")).toBe(true);
  });

  it("rolls back every bill table when any transactional write fails", async () => {
    dbState.failOnTable = "payments";

    await expect(createBillLocalFirst(baseInput())).rejects.toThrow(/payments write failure/i);

    expect(tableRows("bills")).toHaveLength(0);
    expect(tableRows("bill_items")).toHaveLength(0);
    expect(tableRows("payments")).toHaveLength(0);
    expect(tableRows("customer_ledger")).toHaveLength(0);
    expect(tableRows("inventory_movements")).toHaveLength(0);
    expect(tableRows("local_audit_logs")).toHaveLength(0);
    expect(tableRows("sync_outbox")).toHaveLength(0);
    expect(mockedWriteInstantMemoryCache).not.toHaveBeenCalled();
  });

  it("blocks paid amount above total unless advance is enabled", async () => {
    await expect(createBillLocalFirst(baseInput({ buyerPaidAmount: 120, payments: [{ mode: BillPaymentMode.cash, amount: 120 }] }))).rejects.toThrow(/paid amount cannot exceed/i);
    expect(mockedOfflineDB.transaction).not.toHaveBeenCalled();
  });

  it("requires a customer for udhar bills", async () => {
    await expect(createBillLocalFirst(baseInput({
      billType: BillInputBillType.udhar_entry,
      customerId: undefined,
      customerName: "Walk-in",
      buyerPaidAmount: 0,
      payments: [{ mode: BillPaymentMode.credit, amount: 100 }],
    }))).rejects.toThrow(/customer is required/i);
    expect(mockedOfflineDB.transaction).not.toHaveBeenCalled();
  });

  it("blocks discount above subtotal", async () => {
    await expect(createBillLocalFirst(baseInput({
      items: [{ productId: "product_1", name: "Sugar", quantity: 1, enteredUnit: "kg", ratePerRateUnit: 100, gstRate: 18 }],
      discount: 110,
      actualAmount: 8,
      buyerPaidAmount: 8,
      payments: [{ mode: BillPaymentMode.cash, amount: 8 }],
    }))).rejects.toThrow(/discount cannot exceed bill total/i);
    expect(mockedOfflineDB.transaction).not.toHaveBeenCalled();
  });

  it("blocks split cash plus UPI above total even when advance is enabled", async () => {
    await expect(createBillLocalFirst(baseInput({
      allowAdvancePayment: true,
      buyerPaidAmount: 110,
      payments: [
        { mode: BillPaymentMode.cash, amount: 70 },
        { mode: BillPaymentMode.upi, amount: 40 },
      ],
    }))).rejects.toThrow(/split cash and upi payments cannot exceed/i);
    expect(mockedOfflineDB.transaction).not.toHaveBeenCalled();
  });
});

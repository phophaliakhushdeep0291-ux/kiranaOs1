import { beforeEach, describe, expect, it, vi } from "vitest";
import { BillInputBillType, BillPaymentMode, type BillInput } from "@/types/api";

const dbState = vi.hoisted(() => ({
  committed: {} as Record<string, unknown[]>,
  failOnTable: null as string | null,
  idCounter: 0,
  transactions: Promise.resolve() as Promise<unknown>,
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
    transaction: vi.fn((_tables: string[], callback: (tx: {
      put: (table: string, value: unknown) => Promise<void>;
      putMany: (table: string, values: unknown[]) => Promise<void>;
      enqueueOutboxOperation: (event: unknown) => Promise<void>;
      setSetting: (key: string, value: unknown, expiresAt?: number | null) => Promise<void>;
    }) => Promise<unknown>) => {
      const operation = dbState.transactions.then(async () => {
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

      const result = await callback(tx);
      dbState.committed = staged;
      return result;
      });
      dbState.transactions = operation.catch(() => undefined);
      return operation;
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
import { readInstantCache, writeInstantMemoryCache } from "@/lib/offline/instant-cache";
import { createBillLocalFirst } from "@/features/core/billing/local-actions";

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
    dbState.transactions = Promise.resolve();
    vi.mocked(writeInstantMemoryCache).mockReset();
    vi.mocked(readInstantCache).mockImplementation((_key, fallback) => fallback);
    dbState.committed = {
      customers: [{ id: "customer_1", name: "Ramesh", type: "regular", udharAmount: 25, totalUdhar: 25 }],
      products: [{ id: "product_1", name: "Sugar", baseUnit: "kg", stockBaseQty: 20, defaultPricePerRateUnit: 50 }],
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

  it("repeated and simultaneous Save attempts create one bill, tender, stock movement and debt", async () => {
    const input = baseInput({ clientBillId: "open-table-2", buyerPaidAmount: 40,
      payments: [{ mode: BillPaymentMode.cash, amount: 40 }, { mode: BillPaymentMode.credit, amount: 60 }] });
    const [first, second] = await Promise.all([createBillLocalFirst(input), createBillLocalFirst(input)]);
    const third = await createBillLocalFirst(input);
    expect(second.id).toBe(first.id);
    expect(third.id).toBe(first.id);
    expect(tableRows("bills")).toHaveLength(1);
    expect(tableRows("payments")).toHaveLength(1);
    expect(tableRows("customer_ledger")).toHaveLength(1);
    expect(tableRows("inventory_movements")).toHaveLength(1);
    expect(tableRows("customers")[0].udharAmount).toBe(85);
    expect(tableRows("products")[0].stockBaseQty).toBe(18);
    const operations = tableRows("sync_outbox").filter((row) => row.operation_type === "CREATE_BILL");
    expect(operations).toHaveLength(1);
    expect(operations[0].payload).toMatchObject({ clientBillId: "open-table-2", localBillId: first.id });
  });

  it("reads current stock and customer balance inside the transaction, not a stale screen cache", async () => {
    const staleProducts = structuredClone(tableRows("products"));
    const staleCustomers = structuredClone(tableRows("customers"));
    vi.mocked(readInstantCache).mockImplementation((key, fallback) =>
      (key === "products" ? staleProducts : key === "customers" ? staleCustomers : fallback) as typeof fallback);
    const credit = baseInput({ buyerPaidAmount: 40,
      payments: [{ mode: BillPaymentMode.cash, amount: 40 }, { mode: BillPaymentMode.credit, amount: 60 }] });
    await Promise.all([
      createBillLocalFirst({ ...credit, clientBillId: "sale-a" }),
      createBillLocalFirst({ ...credit, clientBillId: "sale-b" }),
    ]);
    expect(tableRows("bills")).toHaveLength(2);
    expect(tableRows("products")[0].stockBaseQty).toBe(16);
    expect(tableRows("customers")[0].udharAmount).toBe(145);
    expect(tableRows("customer_ledger").map((row) => row.balance_after)).toEqual([85, 145]);
  });

  it("retries a failed atomic save with the same open-bill identity without leftover children", async () => {
    const input = baseInput({ clientBillId: "storage-retry" });
    dbState.failOnTable = "sync_outbox";
    await expect(createBillLocalFirst(input)).rejects.toThrow("write failure");
    expect(tableRows("bills")).toHaveLength(0);
    expect(tableRows("products")[0].stockBaseQty).toBe(20);
    dbState.failOnTable = null;
    await createBillLocalFirst(input);
    await createBillLocalFirst(input);
    expect(tableRows("bills")).toHaveLength(1);
    expect(tableRows("payments")).toHaveLength(1);
    expect(tableRows("products")[0].stockBaseQty).toBe(18);
  });

  it("does not report a committed sale as failed when updating the display cache throws", async () => {
    vi.mocked(writeInstantMemoryCache).mockImplementationOnce(() => { throw new Error("Cache unavailable"); });
    const input = baseInput({ clientBillId: "cache-retry" });
    const saved = await createBillLocalFirst(input);
    expect((await createBillLocalFirst(input)).id).toBe(saved.id);
    expect(tableRows("bills")).toHaveLength(1);
  });

  it("does not silently reuse a receipt after the amount or tender was changed", async () => {
    await createBillLocalFirst(baseInput({ clientBillId: "already-saved" }));
    await expect(createBillLocalFirst(baseInput({ clientBillId: "already-saved", payments: [{ mode: BillPaymentMode.upi, amount: 100 }] })))
      .rejects.toThrow("already saved with different details");
    expect(tableRows("payments")).toHaveLength(1);
    expect(tableRows("payments")[0].mode).toBe("cash");
  });

  it("returns the synced receipt if the draft survived a reload after saving", async () => {
    const input = baseInput({ clientBillId: "restored-draft" });
    await createBillLocalFirst(input);
    Object.assign(tableRows("bills")[0], { id: "server-bill", server_id: "server-bill", isSynced: true, sync_status: "synced" });
    expect((await createBillLocalFirst(input)).id).toBe("server-bill");
    expect(tableRows("bills")).toHaveLength(1);
    expect(tableRows("payments")).toHaveLength(1);
  });

  it("never saves approval credentials in the retry fingerprint", async () => {
    await createBillLocalFirst(baseInput({ clientBillId: "approval-safe", ownerPin: "9381", reason: "owner-approved" }));
    const fingerprint = String(tableRows("bills")[0].checkoutFingerprint);
    expect(fingerprint).not.toContain("ownerPin");
    expect(fingerprint).not.toContain("9381");
    expect(fingerprint).not.toContain("owner-approved");
  });

  it("refuses to announce a cancelled receipt as a newly saved sale", async () => {
    const input = baseInput({ clientBillId: "cancelled-draft" });
    await createBillLocalFirst(input);
    Object.assign(tableRows("bills")[0], { status: "cancelled" });
    await expect(createBillLocalFirst(input)).rejects.toThrow("cancelled or removed");
    expect(tableRows("payments")).toHaveLength(1);
  });

  it("does not hide a failed durable read by taking possibly stale cached stock", async () => {
    mockedOfflineDB.getAll.mockRejectedValueOnce(new Error("Storage unavailable"));
    await expect(createBillLocalFirst(baseInput({ clientBillId: "failed-read" }))).rejects.toThrow("Storage unavailable");
    expect(tableRows("bills")).toHaveLength(0);
    expect(tableRows("products")[0].stockBaseQty).toBe(20);
  });
});

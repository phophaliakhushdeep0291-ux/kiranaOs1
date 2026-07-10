import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Product } from "@/types/api";

const dbState = vi.hoisted(() => ({
  committed: {} as Record<string, Array<Record<string, unknown>>>,
  instant: {} as Record<string, unknown[]>,
  idCounter: 0,
}));

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function replaceRow(table: string, value: Record<string, unknown>, target = dbState.committed) {
  target[table] ??= [];
  const index = target[table].findIndex((row) => row.id === value.id);
  if (index >= 0) target[table][index] = clone(value);
  else target[table].push(clone(value));
}

vi.mock("@/lib/offline/db", () => ({
  filterRowsForCurrentScope: vi.fn((input: unknown[]) => input),
  offlineDB: {
    getAll: vi.fn(async (table: string) => clone(dbState.committed[table] ?? [])),
    put: vi.fn(async (table: string, value: unknown) => replaceRow(table, value as Record<string, unknown>)),
    transaction: vi.fn(async (_tables: string[], callback: (tx: {
      put: (table: string, value: unknown) => Promise<void>;
      putMany: (table: string, values: unknown[]) => Promise<void>;
      enqueueOutboxOperation: (event: unknown) => Promise<void>;
    }) => Promise<unknown>) => {
      const staged = clone(dbState.committed);
      const tx = {
        put: vi.fn(async (table: string, value: unknown) => replaceRow(table, value as Record<string, unknown>, staged)),
        putMany: vi.fn(async (table: string, values: unknown[]) => {
          for (const value of values) await tx.put(table, value);
        }),
        enqueueOutboxOperation: vi.fn(async (event: unknown) => {
          staged.sync_outbox ??= [];
          staged.sync_outbox.push(clone(event as Record<string, unknown>));
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
  readInstantCache: vi.fn((key: string, fallback: unknown) => clone((dbState.instant[key] as unknown[]) ?? fallback)),
  upsertCachedListItem: vi.fn((key: string, item: Record<string, unknown>, maxItems = 500) => {
    const current = (dbState.instant[key] ?? []) as Array<Record<string, unknown>>;
    dbState.instant[key] = [clone(item), ...current.filter((row) => row.id !== item.id)].slice(0, maxItems);
  }),
}));

import { createSaleReturnLocalFirst } from "@/features/returns/local-actions";

function rows(table: string) {
  return (dbState.committed[table] ?? []) as Array<Record<string, unknown>>;
}

function seed() {
  const product: Product & Record<string, unknown> = {
    id: "product_sugar",
    name: "Sugar",
    category: "Grocery",
    unit: "piece",
    displayUnit: "piece",
    baseUnit: "piece",
    rateUnit: "piece",
    stockBaseQty: 10,
    costPerRateUnit: 18,
    averageCostPrice: 18,
    defaultPricePerRateUnit: 25,
    gstRate: 0,
    status: "active",
  };
  const customer = { id: "customer_ramesh", name: "Ramesh", mobile: "9876543210", type: "udhar", udharAmount: 200, totalUdhar: 200 };
  dbState.committed = { bills: [], bill_items: [], payments: [], customer_ledger: [], inventory_movements: [], customers: [customer], local_audit_logs: [], sync_outbox: [] };
  dbState.instant = { products: [product], customers: [customer] };
}

describe("sale return local-first", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbState.idCounter = 0;
    seed();
  });

  it("cash refund: negative sales_return bill, restock movement, negative payment, CREATE_SALE_RETURN op", async () => {
    const ret = await createSaleReturnLocalFirst({
      items: [{ productId: "product_sugar", name: "Sugar", quantity: 2, enteredUnit: "piece", ratePerRateUnit: 25, gstRate: 0 }],
      refundMode: "cash",
      ownerPin: "4321",
      originalBillId: "bill_original_1",
    });

    expect(ret.billType).toBe("sales_return");
    expect(rows("bills")[0]).toEqual(expect.objectContaining({
      billType: "sales_return",
      grandTotal: -50,
      grossProfit: -14, // (25-18) * 2
      paidAmount: -50,
      returnOfBillId: "bill_original_1",
    }));
    expect(rows("bill_items")[0]).toEqual(expect.objectContaining({ quantity: -2, lineTotal: -50 }));
    expect(rows("payments")[0]).toEqual(expect.objectContaining({ mode: "cash", amount: -50 }));
    expect(rows("inventory_movements")[0]).toEqual(expect.objectContaining({ action: "return", quantity_delta: 2 }));
    const op = rows("sync_outbox").find((row) => row.operation_type === "CREATE_SALE_RETURN");
    expect(op).toBeTruthy();
    expect((op?.payload as Record<string, unknown>)?.refundMode).toBe("cash");
    expect(((op?.payload as Record<string, unknown>)?.items as unknown[]).length).toBe(1);
    // Push-safety regression: the payload must NOT carry a standalone "device_…" id.
    // collectUnmappedLocalIds treats "device_" as a local-id prefix and would block the
    // push forever as an unresolved dependency. The device id rides on the outbox event.
    expect(op?.payload as Record<string, unknown>).not.toHaveProperty("sourceDeviceId");
    const payloadJson = JSON.stringify(op?.payload ?? {});
    expect(/":\s*"device_/.test(payloadJson)).toBe(false);
  });

  it("bank refund: negative bank payment row, tender refund like cash/upi", async () => {
    const ret = await createSaleReturnLocalFirst({
      items: [{ productId: "product_sugar", name: "Sugar", quantity: 2, enteredUnit: "piece", ratePerRateUnit: 25, gstRate: 0 }],
      refundMode: "bank",
      ownerPin: "4321",
    });
    expect(ret.billType).toBe("sales_return");
    expect(rows("bills")[0]).toEqual(expect.objectContaining({ grandTotal: -50, paidAmount: -50, refundMode: "bank" }));
    expect(rows("payments")[0]).toEqual(expect.objectContaining({ mode: "bank", amount: -50 }));
    const op = rows("sync_outbox").find((row) => row.operation_type === "CREATE_SALE_RETURN");
    expect((op?.payload as Record<string, unknown>)?.refundMode).toBe("bank");
  });

  it("damaged refund: no restock, damage movement recorded", async () => {
    await createSaleReturnLocalFirst({
      items: [{ productId: "product_sugar", name: "Sugar", quantity: 1, enteredUnit: "piece", ratePerRateUnit: 25, gstRate: 0, damaged: true }],
      refundMode: "cash",
      ownerPin: "4321",
    });
    expect(rows("inventory_movements")[0]).toEqual(expect.objectContaining({ action: "damage", quantity_delta: 0 }));
  });

  it("udhar refund: reduces customer balance and posts a ledger entry", async () => {
    await createSaleReturnLocalFirst({
      items: [{ productId: "product_sugar", name: "Sugar", quantity: 2, enteredUnit: "piece", ratePerRateUnit: 25, gstRate: 0 }],
      refundMode: "udhar",
      customerId: "customer_ramesh",
      ownerPin: "4321",
    });
    expect(rows("customers")[0]).toEqual(expect.objectContaining({ id: "customer_ramesh", udharAmount: 150 })); // 200 - 50
    expect(rows("customer_ledger")[0]).toEqual(expect.objectContaining({ type: "PAYMENT", amount: 50, balance_after: 150 }));
    expect(rows("payments")).toHaveLength(0); // no cash/upi payment for udhar refund
  });

  it("requires a 4-digit owner PIN", async () => {
    await expect(createSaleReturnLocalFirst({
      items: [{ productId: "product_sugar", name: "Sugar", quantity: 1, enteredUnit: "piece", ratePerRateUnit: 25 }],
      refundMode: "cash",
      ownerPin: "",
    })).rejects.toMatchObject({ code: "OWNER_PIN_REQUIRED" });
  });
});

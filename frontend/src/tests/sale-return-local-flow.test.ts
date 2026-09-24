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

import { calculateLedgerBalance, type CustomerLedgerEntry } from "@/features/core/ledger/accounting";
import { createSaleReturnLocalFirst } from "@/features/core/returns/local-actions";

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

  it("refunds an untracked dish without projecting a stock return", async () => {
    dbState.instant.products = [{ id: "dish", name: "Dal Fry", stockBaseQty: -12, stockTrackingEnabled: false, defaultPricePerRateUnit: 100 }];
    const returned = await createSaleReturnLocalFirst({
      items: [{ productId: "dish", name: "Dal Fry", quantity: 1, enteredUnit: "piece", ratePerRateUnit: 100 }],
      refundMode: "cash", ownerPin: "4321",
    });
    expect(returned.grandTotal).toBe(-100);
    expect(rows("payments")[0]).toMatchObject({ amount: -100 });
    expect(rows("inventory_movements")).toEqual([]);
    expect(rows("sync_outbox").some((row) => row.operation_type === "CREATE_SALE_RETURN")).toBe(true);
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

  it("serializes competing udhar returns before checking the remaining balance", async () => {
    const input = {
      customerId: "customer_ramesh",
      items: [{ productId: "product_sugar", name: "Sugar", quantity: 6, enteredUnit: "piece", ratePerRateUnit: 25 }],
      refundMode: "udhar" as const,
      ownerPin: "4321",
    };
    const results = await Promise.allSettled([
      createSaleReturnLocalFirst(input),
      createSaleReturnLocalFirst(input),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(rows("customers")[0].udharAmount).toBe(50);
    expect(rows("bills")).toHaveLength(1);
    expect(rows("customer_ledger")).toHaveLength(1);
    expect(rows("sync_outbox").filter((row) => row.operation_type === "CREATE_SALE_RETURN")).toHaveLength(1);
  });

  it("linked partial returns immediately reverse invoice discount and exact stored GST", async () => {
    dbState.committed.bills = [{
      id: "bill_discounted_gst",
      billType: "gst_invoice",
      status: "active",
      subtotal: 200,
      discount: 20,
      gst: 32.4,
      gstMode: "exclusive",
      grandTotal: 212.4,
    }];
    dbState.committed.bill_items = [{
      id: "bill_item_discounted_gst",
      bill_id: "bill_discounted_gst",
      productId: "product_sugar",
      name: "Sugar",
      quantity: 2,
      enteredUnit: "piece",
      ratePerRateUnit: 100,
      lineTotal: 200,
      lineDiscount: 0,
      lineCost: 120,
      gstRate: 18,
    }];

    const input = {
      items: [{
        originalBillItemId: "bill_item_discounted_gst",
        productId: "product_sugar",
        name: "Sugar",
        quantity: 1,
        enteredUnit: "piece",
        ratePerRateUnit: 100,
        gstRate: 18,
      }],
      refundMode: "cash" as const,
      ownerPin: "4321",
      originalBillId: "bill_discounted_gst",
    };

    const first = await createSaleReturnLocalFirst(input);
    expect(first).toEqual(expect.objectContaining({ subtotal: -90, gst: -16.2, grandTotal: -106.2 }));
    expect(rows("bill_items").find((row) => row.billId === first.id)).toEqual(expect.objectContaining({
      lineTotal: -90,
      lineDiscount: -10,
      lineGst: -16.2,
    }));

    const second = await createSaleReturnLocalFirst(input);
    expect(second).toEqual(expect.objectContaining({ subtotal: -90, gst: -16.2, grandTotal: -106.2 }));
    const returns = rows("bills").filter((row) => row.billType === "sales_return");
    expect(returns.reduce((sum, row) => sum + Number(row.grandTotal), 0)).toBe(-212.4);
  });

  it("damaged refund: no restock, damage movement recorded", async () => {
    await createSaleReturnLocalFirst({
      items: [{ productId: "product_sugar", name: "Sugar", quantity: 1, enteredUnit: "piece", ratePerRateUnit: 25, gstRate: 0, damaged: true }],
      refundMode: "cash",
      ownerPin: "4321",
    });
    expect(rows("inventory_movements")[0]).toEqual(expect.objectContaining({ action: "damage", quantity_delta: 0 }));
  });

  it("counts a backed-up return once when its deleted local twin remains on the device", async () => {
    const original = { id: "original", billType: "normal_sale", status: "active", subtotal: 50, grandTotal: 50, gstMode: "none" };
    const returned = { id: "return_server", local_id: "return_local", billType: "sales_return", returnOfBillId: "original", status: "active", subtotal: -25, grandTotal: -25, sync_status: "synced" };
    const returnItem = { id: "return_item_server", local_id: "return_item_local", billId: "return_server", originalBillItemId: "original_item", productId: "product_sugar", name: "Sugar", quantity: -1, lineTotal: -25, ratePerRateUnit: 25 };
    dbState.committed.bills = [original, returned, { ...returned, id: "return_local", merged_into_id: "return_server", deleted_at: "2026-09-17T00:00:00Z" }];
    dbState.committed.bill_items = [
      { id: "original_item", billId: "original", productId: "product_sugar", name: "Sugar", quantity: 2, lineTotal: 50, ratePerRateUnit: 25 },
      returnItem,
      { ...returnItem, id: "return_item_local", deleted_at: "2026-09-17T00:00:00Z" },
    ];
    const result = await createSaleReturnLocalFirst({
      originalBillId: "original",
      items: [{ originalBillItemId: "original_item", productId: "product_sugar", name: "Sugar", quantity: 1, enteredUnit: "piece", ratePerRateUnit: 25 }],
      refundMode: "cash", ownerPin: "4321",
    });
    expect(result.grandTotal).toBe(-25);
    expect(rows("payments")[0].amount).toBe(-25);
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

  it.each(["synced", "pending_sync"])("return projection preserves %s customer profile state", async (status) => {
    const customer = { ...rows("customers")[0], udharAmount: 50, totalUdhar: 50, udhar_amount: 50, total_udhar: 50, udharAmountPaise: 5000, sync_status: status };
    dbState.committed.customers = [customer];
    dbState.instant.customers = [customer];
    await createSaleReturnLocalFirst({
      items: [{ productId: "product_sugar", name: "Sugar", quantity: 2, enteredUnit: "piece", ratePerRateUnit: 25, gstRate: 0 }],
      refundMode: "udhar", customerId: "customer_ramesh", ownerPin: "4321",
    });
    expect(rows("customers")[0]).toMatchObject({ udharAmount: 0, totalUdhar: 0, udhar_amount: 0, total_udhar: 0, udharAmountPaise: 0, sync_status: status, balance_derived_from_local_ledger: true });
    expect(calculateLedgerBalance(rows("customer_ledger") as CustomerLedgerEntry[])).toBe(-50);
    expect(rows("sync_outbox").some(row => row.entity_type === "customer")).toBe(false);
  });

  it("rejects an excessive udhar refund without changing stock, debt or the outbox", async () => {
    dbState.committed.customers = [{ ...rows("customers")[0], udharAmount: 10, totalUdhar: 10 }];
    // Deliberately stale memory must not permit a return against an old balance.
    const before = clone(dbState.committed);
    await expect(createSaleReturnLocalFirst({
      items: [{ productId: "product_sugar", name: "Sugar", quantity: 1, enteredUnit: "piece", ratePerRateUnit: 25 }],
      refundMode: "udhar", customerId: "customer_ramesh", ownerPin: "4321",
    })).rejects.toThrow("exceeds the outstanding udhar");
    expect(dbState.committed).toEqual(before);
  });

  it("requires a 4-digit owner PIN", async () => {
    await expect(createSaleReturnLocalFirst({
      items: [{ productId: "product_sugar", name: "Sugar", quantity: 1, enteredUnit: "piece", ratePerRateUnit: 25 }],
      refundMode: "cash",
      ownerPin: "",
    })).rejects.toMatchObject({ code: "OWNER_PIN_REQUIRED" });
  });
});

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
      const staged = Object.fromEntries(
        Object.entries(dbState.committed).map(([table, rows]) => [table, cloneRows(rows)]),
      ) as Record<string, unknown[]>;

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
          const keyField = table === "settings" ? "key" : "id";
          const key = row[keyField];
          const rows = ensure(table);
          const index = rows.findIndex((existing) => (existing as Record<string, unknown>)[keyField] === key);
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

describe("billing business rules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbState.idCounter = 0;
    dbState.failOnTable = null;
    dbState.committed = {
      customers: [{ id: "customer_1", name: "Ramesh", type: "regular", udharAmount: 25, totalUdhar: 25 }],
    };
  });

  it("blocks paid amount above bill total unless advance mode is enabled", async () => {
    await expect(createBillLocalFirst(baseInput({
      buyerPaidAmount: 120,
      payments: [{ mode: BillPaymentMode.cash, amount: 120 }],
    }))).rejects.toThrow(/paid amount cannot exceed/i);
    expect(mockedOfflineDB.transaction).not.toHaveBeenCalled();

    const advanceBill = await createBillLocalFirst(baseInput({
      allowAdvancePayment: true,
      buyerPaidAmount: 120,
      payments: [{ mode: BillPaymentMode.cash, amount: 120 }],
    }));

    expect(advanceBill.totalAmount).toBe(100);
    expect(advanceBill.paidAmount).toBe(120);
    expect(tableRows("payments")[0]).toEqual(expect.objectContaining({ bill_id: advanceBill.id, amount: 120 }));
  });

  it("creates the correct unpaid amount for credit or udhar mode", async () => {
    const bill = await createBillLocalFirst(baseInput({
      buyerPaidAmount: 40,
      payments: [
        { mode: BillPaymentMode.cash, amount: 40 },
        { mode: BillPaymentMode.credit, amount: 60 },
      ],
    }));

    expect(bill.creditAmount).toBe(60);
    expect(bill.paidAmount).toBe(40);
    expect(tableRows("payments")).toHaveLength(1);
    expect(tableRows("payments")[0]).toEqual(expect.objectContaining({ bill_id: bill.id, mode: BillPaymentMode.cash, amount: 40 }));
    expect(tableRows("customer_ledger")[0]).toEqual(expect.objectContaining({
      bill_id: bill.id,
      customer_id: "customer_1",
      amount: 60,
      balance_after: 85,
    }));
    expect(tableRows("customers")[0]).toEqual(expect.objectContaining({ id: "customer_1", udharAmount: 85, totalUdhar: 85 }));
  });

  it("blocks split cash plus UPI payments above bill total", async () => {
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

  it("blocks discounts greater than subtotal", async () => {
    await expect(createBillLocalFirst(baseInput({
      items: [{ productId: "product_1", name: "Sugar", quantity: 1, enteredUnit: "kg", ratePerRateUnit: 100, gstRate: 18 }],
      discount: 110,
      actualAmount: 0,
      buyerPaidAmount: 0,
      payments: [],
    }))).rejects.toThrow(/discount cannot exceed bill total/i);
    expect(mockedOfflineDB.transaction).not.toHaveBeenCalled();
  });

  it("requires owner PIN before saving below-minimum selling price bills", async () => {
    await expect(createBillLocalFirst(baseInput({
      sensitiveActions: ["selling_below_minimum_price"],
      reason: "Owner approved below minimum rate",
    }))).rejects.toThrow(/required/i);
    expect(mockedOfflineDB.transaction).not.toHaveBeenCalled();

    const bill = await createBillLocalFirst(baseInput({
      sensitiveActions: ["selling_below_minimum_price"],
      ownerPin: "1234",
      reason: "Owner approved below minimum rate",
    }));

    expect(bill.id).toMatch(/^bill_/);
    expect(tableRows("local_audit_logs").some((row) => row.action === "selling_below_minimum_price" && row.owner_pin_provided === true)).toBe(true);
  });

  it("derives sensitive approval locally even when a caller omits sensitiveActions", async () => {
    dbState.committed.products = [{
      id: "product_1",
      name: "Sugar",
      defaultPricePerRateUnit: 100,
      minPricePerRateUnit: 45,
      stockBaseQty: 20,
      baseUnit: "kg",
      rateUnit: "kg",
    }];
    const discounted = baseInput({
      items: [{ productId: "product_1", name: "Sugar", quantity: 2, enteredUnit: "kg", ratePerRateUnit: 100, gstRate: 0 }],
      discount: 100,
      actualAmount: 100,
      buyerPaidAmount: 100,
      payments: [{ mode: BillPaymentMode.cash, amount: 100 }],
      sensitiveActions: [],
      reason: "Owner approved promotion",
    });

    await expect(createBillLocalFirst(discounted)).rejects.toThrow(/owner.?pin/i);
    const bill = await createBillLocalFirst({ ...discounted, ownerPin: "1234" });
    expect(bill.discount).toBe(100);
    expect(tableRows("local_audit_logs").some((row) => row.action === "large_discount" && row.owner_pin_provided === true)).toBe(true);
  });

  it("persists the pricing snapshot on bill items and carries it into the CREATE_BILL sync payload", async () => {
    await createBillLocalFirst(baseInput({
      items: [{
        productId: "product_1",
        name: "Sugar",
        quantity: 10,
        enteredUnit: "kg",
        ratePerRateUnit: 40,
        gstRate: 0,
        originalUnitPrice: 45,
        appliedPricingRuleId: "rule_bulk_1",
        appliedPricingRuleType: "PRODUCT_QUANTITY_PRICE",
        pricingExplanation: "Bulk price for 10+ kg",
        pricingConfidence: 1,
        pricingCalculationVersion: "pricing-v1",
        wasPriceOverridden: false,
      }],
      actualAmount: 400,
      buyerPaidAmount: 400,
      payments: [{ mode: BillPaymentMode.cash, amount: 400 }],
    }));

    // 1. The durable local bill_items row keeps the full "why this price" snapshot
    //    (snake_case is the persisted column convention).
    const item = tableRows("bill_items")[0];
    expect(item).toMatchObject({
      applied_pricing_rule_id: "rule_bulk_1",
      applied_pricing_rule_type: "PRODUCT_QUANTITY_PRICE",
      pricing_explanation: "Bulk price for 10+ kg",
      original_unit_price: 45,
      pricing_calculation_version: "pricing-v1",
      was_price_overridden: false,
    });

    // 2. The same snapshot rides the CREATE_BILL outbox payload to the backend
    //    (camelCase — the FE→BE sync contract the audit trail depends on). A
    //    future refactor that strips these from the schema/payload fails here.
    const createBill = tableRows("sync_outbox").find((op) => op.operation_type === "CREATE_BILL");
    expect(createBill).toBeTruthy();
    const payloadItems = (createBill!.payload as { items: Array<Record<string, unknown>> }).items;
    expect(payloadItems[0]).toMatchObject({
      appliedPricingRuleId: "rule_bulk_1",
      appliedPricingRuleType: "PRODUCT_QUANTITY_PRICE",
      pricingExplanation: "Bulk price for 10+ kg",
      originalUnitPrice: 45,
      pricingCalculationVersion: "pricing-v1",
    });
  });

  it("creates bill items, payments, ledger entries, inventory movements, audit logs and outbox in one transaction", async () => {
    const bill = await createBillLocalFirst(baseInput({
      buyerPaidAmount: 40,
      payments: [
        { mode: BillPaymentMode.cash, amount: 40 },
        { mode: BillPaymentMode.credit, amount: 60 },
      ],
    }));

    expect(mockedOfflineDB.transaction).toHaveBeenCalledTimes(1);
    expect(mockedOfflineDB.transaction).toHaveBeenCalledWith(
      expect.arrayContaining(["bills", "bill_items", "payments", "customer_ledger", "inventory_movements", "local_audit_logs", "sync_outbox", "settings", "customers"]),
      expect.any(Function),
    );
    expect(tableRows("bills")).toHaveLength(1);
    expect(tableRows("bill_items")).toHaveLength(1);
    expect(tableRows("payments")).toHaveLength(1);
    expect(tableRows("customer_ledger")).toHaveLength(1);
    expect(tableRows("inventory_movements")).toHaveLength(1);
    expect(tableRows("local_audit_logs")).toHaveLength(1);
    expect(tableRows("sync_outbox").some((row) => row.operation_type === "CREATE_BILL" && row.entity_id === bill.id)).toBe(true);
  });

  it("does not create a partial bill when the bill transaction fails", async () => {
    dbState.failOnTable = "inventory_movements";

    await expect(createBillLocalFirst(baseInput({
      buyerPaidAmount: 40,
      payments: [
        { mode: BillPaymentMode.cash, amount: 40 },
        { mode: BillPaymentMode.credit, amount: 60 },
      ],
    }))).rejects.toThrow(/inventory_movements write failure/i);

    expect(tableRows("bills")).toHaveLength(0);
    expect(tableRows("bill_items")).toHaveLength(0);
    expect(tableRows("payments")).toHaveLength(0);
    expect(tableRows("customer_ledger")).toHaveLength(0);
    expect(tableRows("inventory_movements")).toHaveLength(0);
    expect(tableRows("local_audit_logs")).toHaveLength(0);
    expect(tableRows("sync_outbox")).toHaveLength(0);
    expect(tableRows("customers")[0]).toEqual(expect.objectContaining({ id: "customer_1", udharAmount: 25, totalUdhar: 25 }));
    expect(mockedWriteInstantMemoryCache).not.toHaveBeenCalled();
  });
});

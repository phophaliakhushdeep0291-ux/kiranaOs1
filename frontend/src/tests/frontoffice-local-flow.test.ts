import { beforeEach, describe, expect, it, vi } from "vitest";
import { BillInputBillType, BillPaymentMode, type BillInput, type Product } from "@/types/api";
import type { CustomerLedgerEntry } from "@/features/ledger/accounting";
import type { SupplierDueRow } from "@/features/finance/services/FinancialAggregationService";

const dbState = vi.hoisted(() => ({
  committed: {} as Record<string, Array<Record<string, unknown>>>,
  instant: {} as Record<string, unknown[]>,
  idCounter: 0,
}));

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function rows(table: string) {
  return (dbState.committed[table] ?? []) as Array<Record<string, unknown>>;
}

function replaceRow(table: string, value: Record<string, unknown>, target = dbState.committed) {
  target[table] ??= [];
  const key = table === "settings" ? value.key : value.id;
  const index = target[table].findIndex((row) => row[table === "settings" ? "key" : "id"] === key);
  if (index >= 0) target[table][index] = clone(value);
  else target[table].push(clone(value));
}

vi.mock("@/lib/offline/db", () => ({
  filterRowsForCurrentScope: vi.fn((input: unknown[]) => input),
  offlineDB: {
    getAll: vi.fn(async (table: string) => clone(dbState.committed[table] ?? [])),
    put: vi.fn(async (table: string, value: unknown) => replaceRow(table, value as Record<string, unknown>)),
    enqueueOutboxOperation: vi.fn(async (event: unknown) => {
      dbState.committed.sync_outbox ??= [];
      dbState.committed.sync_outbox.push(clone(event as Record<string, unknown>));
    }),
    transaction: vi.fn(async (_tables: string[], callback: (tx: {
      put: (table: string, value: unknown) => Promise<void>;
      putMany: (table: string, values: unknown[]) => Promise<void>;
      enqueueOutboxOperation: (event: unknown) => Promise<void>;
      setSetting: (key: string, value: unknown, expiresAt?: number | null) => Promise<void>;
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
        setSetting: vi.fn(async (key: string, value: unknown, expiresAt?: number | null) => {
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
  readInstantCache: vi.fn((key: string, fallback: unknown) => clone((dbState.instant[key] as unknown[]) ?? fallback)),
  upsertCachedListItem: vi.fn((key: string, item: Record<string, unknown>, maxItems = 500) => {
    const current = (dbState.instant[key] ?? []) as Array<Record<string, unknown>>;
    dbState.instant[key] = [clone(item), ...current.filter((row) => row.id !== item.id)].slice(0, maxItems);
  }),
  writeInstantMemoryCache: vi.fn((key: string, value: unknown[]) => {
    dbState.instant[key] = clone(value);
  }),
}));

import { createBillLocalFirst } from "@/features/billing/local-actions";
import { recordPaymentLocalFirst, reversePaymentWithOwnerPinLocalFirst } from "@/features/payments/local-actions";
import { recordPurchaseLocalFirst } from "@/features/inventory/local-actions";
import { markPurchasePaidLocal, updatePurchaseLocal } from "@/features/purchases/local-actions";
import { calculateLedgerBalance } from "@/features/ledger/accounting";

function seedFrontOffice() {
  const product: Product & Record<string, unknown> = {
    id: "product_sugar",
    name: "Sugar",
    category: "Grocery",
    unit: "kg",
    displayUnit: "kg",
    baseUnit: "kg",
    rateUnit: "kg",
    stockBaseQty: 10,
    costPerRateUnit: 40,
    averageCostPrice: 40,
    defaultPricePerRateUnit: 50,
    lowStockThreshold: 1,
    status: "active",
  };
  const customer = {
    id: "customer_ramesh",
    name: "Ramesh",
    mobile: "9876543210",
    type: "regular",
    udharAmount: 0,
    totalUdhar: 0,
    trustScore: 80,
  };
  dbState.committed = {
    products: [product],
    customers: [customer],
    bills: [],
    bill_items: [],
    payments: [],
    customer_ledger: [],
    inventory_movements: [],
    purchase_bills: [],
    local_audit_logs: [],
    sync_outbox: [],
    settings: [],
    id_mappings: [],
  };
  dbState.instant = {
    products: [product],
    inventory: [product],
    customers: [customer],
    bills: [],
    payments: [],
    customer_ledger: [],
    inventory_movements: [],
  };
}

function billInput(overrides: Partial<BillInput> = {}): BillInput {
  return {
    billType: BillInputBillType.normal_sale,
    customerId: "customer_ramesh",
    customerName: "Ramesh",
    customerMobile: "9876543210",
    items: [
      {
        productId: "product_sugar",
        name: "Sugar",
        quantity: 4,
        enteredUnit: "kg",
        ratePerRateUnit: 50,
        gstRate: 0,
      },
    ],
    discount: 0,
    actualAmount: 200,
    buyerPaidAmount: 0,
    payments: [{ mode: BillPaymentMode.credit, amount: 200 }],
    ...overrides,
  };
}

function ledgerFor(customerId: string) {
  return rows("customer_ledger").filter((entry) => entry.customerId === customerId || entry.customer_id === customerId) as unknown as CustomerLedgerEntry[];
}

function purchaseDisplayRow(overrides: Partial<SupplierDueRow> = {}): SupplierDueRow {
  return {
    id: "stock_purchase_1",
    source: "inventory_movement",
    supplierId: undefined,
    supplierName: "Govind Traders",
    invoiceNumber: "INV-100",
    date: "2026-06-18T10:00:00.000Z",
    amount: 500,
    paid: 100,
    due: 400,
    paymentMode: "cash",
    status: "partial",
    ...overrides,
  } as SupplierDueRow;
}

describe("front office local-first cashier flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbState.idCounter = 0;
    seedFrontOffice();
  });

  it("stores estimate bills as quote-only even if stale payment data is present", async () => {
    const estimate = await createBillLocalFirst(billInput({
      billType: BillInputBillType.estimate,
      buyerPaidAmount: 200,
      allowAdvancePayment: true,
      advanceAmount: 200,
      payments: [{ mode: BillPaymentMode.credit, amount: 200 }],
    }));

    expect(rows("bills")).toHaveLength(1);
    expect(rows("bills")[0]).toEqual(expect.objectContaining({
      id: estimate.id,
      billNo: expect.stringMatching(/^EST-\d{4}-LOCAL-/),
      billNumber: expect.stringMatching(/^EST-\d{4}-LOCAL-/),
      billType: BillInputBillType.estimate,
      paidAmount: 0,
      buyerPaidAmount: 0,
      creditAmount: 0,
    }));
    expect(rows("bill_items")).toHaveLength(1);
    expect(rows("payments")).toHaveLength(0);
    expect(rows("customer_ledger")).toHaveLength(0);
    expect(rows("inventory_movements")).toHaveLength(0);
    expect(rows("customers")[0]).toEqual(expect.objectContaining({ udharAmount: 0, totalUdhar: 0 }));
    expect(rows("sync_outbox").filter((row) => row.operation_type === "CREATE_CUSTOMER")).toHaveLength(0);
    expect(rows("sync_outbox").find((row) => row.operation_type === "CREATE_BILL")).toEqual(expect.objectContaining({
      entity_id: estimate.id,
      payload: expect.objectContaining({
        billType: BillInputBillType.estimate,
        paidAmount: 0,
        buyerPaidAmount: 0,
        creditAmount: 0,
        dueAmount: 0,
        paymentStatus: "estimate",
        payments: [],
        tenderPayments: [],
        creditPayments: [],
        ledgerEntries: [],
      }),
    }));
  });

  it("keeps bill credit, same-amount udhar payments, reversal, purchase, and outbox output consistent", async () => {
    const bill = await createBillLocalFirst(billInput());

    expect(rows("bills")).toHaveLength(1);
    expect(rows("bill_items")).toHaveLength(1);
    expect(rows("payments")).toHaveLength(0);
    expect(rows("inventory_movements")).toEqual([
      expect.objectContaining({ action: "sale", product_id: "product_sugar", quantity_delta: -4 }),
    ]);
    expect(rows("customers")[0]).toEqual(expect.objectContaining({ id: "customer_ramesh", udharAmount: 200, totalUdhar: 200 }));
    expect(calculateLedgerBalance(ledgerFor("customer_ramesh"))).toBe(200);
    expect(rows("sync_outbox").filter((row) => row.operation_type === "CREATE_BILL")).toHaveLength(1);
    expect(rows("sync_outbox").find((row) => row.operation_type === "CREATE_BILL")).toEqual(expect.objectContaining({
      entity_id: bill.id,
      payload: expect.objectContaining({
        paidAmount: 0,
        creditAmount: 200,
        dueAmount: 200,
        payments: [],
        ledgerEntries: [expect.objectContaining({ amount: 200, customerId: "customer_ramesh" })],
      }),
    }));

    const firstPayment = await recordPaymentLocalFirst("customer_ramesh", { amount: 100, mode: "cash", note: "First half" });
    const secondPayment = await recordPaymentLocalFirst("customer_ramesh", { amount: 100, mode: "cash", note: "Second half" });

    expect(rows("payments").filter((row) => row.status === "active")).toHaveLength(2);
    expect(rows("customer_ledger").filter((row) => row.type === "PAYMENT")).toHaveLength(2);
    expect(calculateLedgerBalance(ledgerFor("customer_ramesh"))).toBe(0);
    expect(rows("customers")[0]).toEqual(expect.objectContaining({ udharAmount: 0, totalUdhar: 0 }));
    expect(rows("sync_outbox").filter((row) => row.operation_type === "RECORD_PAYMENT")).toHaveLength(2);
    const paymentOutboxKeys = rows("sync_outbox")
      .filter((row) => row.operation_type === "RECORD_PAYMENT")
      .map((row) => String(row.idempotency_key));
    expect(paymentOutboxKeys).toHaveLength(2);
    expect(new Set(paymentOutboxKeys).size).toBe(2);
    expect(paymentOutboxKeys.every((key) => key.startsWith("record-payment:customer_ramesh:payment_"))).toBe(true);

    await expect(recordPaymentLocalFirst("customer_ramesh", { amount: 1, mode: "cash" }))
      .rejects.toMatchObject({ code: "UDHAR_PAYMENT_EXCEEDS_OUTSTANDING" });

    await reversePaymentWithOwnerPinLocalFirst({
      paymentId: secondPayment.paymentId,
      ownerPin: "1234",
      reason: "Wrong tender selected",
    });

    expect(rows("payments").find((row) => row.id === secondPayment.paymentId)).toEqual(expect.objectContaining({ status: "reversed" }));
    expect(calculateLedgerBalance(ledgerFor("customer_ramesh"))).toBe(100);
    expect(rows("customers")[0]).toEqual(expect.objectContaining({ udharAmount: 100, totalUdhar: 100 }));
    expect(rows("sync_outbox").filter((row) => row.operation_type === "REVERSE_PAYMENT")).toHaveLength(1);

    const purchase = await recordPurchaseLocalFirst({
      productId: "product_sugar",
      quantity: 10,
      enteredUnit: "kg",
      supplierName: "Govind Traders",
      invoiceNumber: "INV-100",
      billAmount: 500,
      purchasePaymentStatus: "partial",
      purchasePaymentMode: "cash",
      purchasePaidAmount: 100,
      purchaseDueAmount: 400,
      purchaseDueDate: "2026-06-30",
      costPerRateUnit: 50,
      note: "Counter test purchase",
    });
    // Use the id the engine actually assigned (a global counter) instead of guessing it,
    // so the edit/mark-paid flow resolves the same row the purchase just created.
    const purchaseRowId = (purchase.movement as { id: string }).id;

    expect(rows("products")[0]).toEqual(expect.objectContaining({ id: "product_sugar", stockBaseQty: 20, costPerRateUnit: 45 }));
    expect(rows("inventory_movements").find((row) => row.action === "purchase")).toEqual(expect.objectContaining({
      product_id: "product_sugar",
      invoice_number: "INV-100",
      purchase_payment_status: "partial",
      purchase_paid_amount: 100,
      purchase_due_amount: 400,
      purchase_due_date: "2026-06-30",
    }));
    expect(rows("sync_outbox").find((row) => row.operation_type === "STOCK_PURCHASE")).toEqual(expect.objectContaining({
      payload: expect.objectContaining({
        purchasePaymentStatus: "partial",
        purchasePaidAmount: 100,
        purchaseDueAmount: 400,
        purchaseDueDate: "2026-06-30",
      }),
    }));

    await updatePurchaseLocal(purchaseDisplayRow({ id: purchaseRowId }), {
      supplierName: "Govind Traders",
      invoiceNumber: "INV-100",
      amount: 500,
      paid: 250,
      due: 250,
      paymentMode: "cash",
      status: "partial",
    });
    expect(rows("inventory_movements").find((row) => row.action === "purchase")).toEqual(expect.objectContaining({
      purchase_paid_amount: 250,
      purchase_due_amount: 250,
      purchase_payment_status: "partial",
    }));

    await markPurchasePaidLocal(purchaseDisplayRow({ id: purchaseRowId, paid: 250, due: 250 }), "upi");
    expect(rows("inventory_movements").find((row) => row.action === "purchase")).toEqual(expect.objectContaining({
      purchase_paid_amount: 500,
      purchase_due_amount: 0,
      purchase_payment_status: "paid",
      purchase_payment_mode: "upi",
    }));
    expect(rows("sync_outbox").filter((row) => row.operation_type === "UPDATE_PURCHASE_BILL")).toHaveLength(2);

    expect(firstPayment.amount).toBe(100);
    expect(secondPayment.amount).toBe(100);
    expect(new Set(rows("sync_outbox").map((row) => row.op_id)).size).toBe(rows("sync_outbox").length);
  });
});

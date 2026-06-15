import { beforeEach, describe, expect, it, vi } from "vitest";
import { BillInputBillType, BillPaymentMode, type BillInput } from "@/types/api";
import { calculateLedgerBalance, normaliseLedgerType } from "@/features/ledger/accounting";

const dbState = vi.hoisted(() => ({
  scope: {
    tenant_id: "tenant_ledger_A",
    store_id: "store_ledger_A",
    device_id: "device_ledger_A",
  },
  committed: {} as Record<string, Array<Record<string, unknown>>>,
  idCounter: 0,
}));

function clone<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;
}

function tableRows(table: string) {
  dbState.committed[table] ??= [];
  return dbState.committed[table];
}

function scopedRows(table: string) {
  return tableRows(table).filter((row) => row.tenant_id === dbState.scope.tenant_id && row.store_id === dbState.scope.store_id);
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
  nowIso: () => "2026-06-06T09:30:00.000Z",
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
        enqueueOutboxOperation: vi.fn(async (event: Record<string, unknown>) => putInto("sync_outbox", event, staged)),
        setSetting: vi.fn(async (key: string, value: unknown, expiresAt?: number | null) => putInto("settings", {
          key,
          value,
          tenant_id: dbState.scope.tenant_id,
          store_id: dbState.scope.store_id,
          updated_at: "2026-06-06T09:30:00.000Z",
          expires_at: expiresAt ?? null,
        }, staged)),
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
  writeInstantCache: vi.fn(),
  writeInstantMemoryCache: vi.fn(),
}));

import { offlineDB } from "@/lib/offline/db";
import { createBillLocalFirst } from "@/features/billing/local-actions";
import { cancelBillWithOwnerPinLocalFirst } from "@/features/bills/local-actions";
import { readCustomerLedgerEntries } from "@/features/ledger/local-actions";
import { recordPaymentLocalFirst, reversePaymentWithOwnerPinLocalFirst } from "@/features/payments/local-actions";
import { loadCustomerDetail, loadCustomersWithLedger } from "@/features/customers/customer-ledger-data";

function resetTables() {
  dbState.idCounter = 0;
  dbState.committed = {
    customers: [],
    bills: [],
    bill_items: [],
    payments: [],
    customer_ledger: [],
    inventory_movements: [],
    local_audit_logs: [],
    sync_outbox: [],
    settings: [],
  };
}

function seedCustomer(overrides: Record<string, unknown> = {}) {
  putInto("customers", {
    id: "customer_1",
    local_id: "customer_1",
    tenant_id: dbState.scope.tenant_id,
    store_id: dbState.scope.store_id,
    device_id: dbState.scope.device_id,
    name: "Ramesh",
    type: "udhar",
    udharAmount: 0,
    totalUdhar: 0,
    sync_status: "synced",
    deleted_at: null,
    ...overrides,
  });
}

function creditBillInput(overrides: Partial<BillInput> = {}): BillInput {
  return {
    billType: BillInputBillType.normal_sale,
    customerId: "customer_1",
    customerName: "Ramesh",
    items: [
      {
        productId: "product_1",
        name: "Sugar",
        quantity: 5,
        enteredUnit: "kg",
        ratePerRateUnit: 100,
        gstRate: 0,
      },
    ],
    discount: 0,
    actualAmount: 500,
    buyerPaidAmount: 0,
    payments: [{ mode: BillPaymentMode.credit, amount: 500 }],
    ...overrides,
  };
}

function seedLedger(row: Record<string, unknown>) {
  putInto("customer_ledger", {
    tenant_id: dbState.scope.tenant_id,
    store_id: dbState.scope.store_id,
    device_id: dbState.scope.device_id,
    customerId: "customer_1",
    customer_id: "customer_1",
    deleted_at: null,
    sync_status: "synced",
    ...row,
  });
}

describe("customer ledger correctness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetTables();
    seedCustomer();
  });

  it("BILL increases customer balance", async () => {
    const bill = await createBillLocalFirst(creditBillInput());
    const ledger = scopedRows("customer_ledger");

    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toEqual(expect.objectContaining({
      type: "BILL",
      source_type: "bill",
      bill_id: bill.id,
      customer_id: "customer_1",
      amount: 500,
      balance_after: 500,
    }));
    expect(calculateLedgerBalance(ledger)).toBe(500);
    expect(scopedRows("customers")[0]).toEqual(expect.objectContaining({ udharAmount: 500, totalUdhar: 500 }));
    const outboxRows = scopedRows("sync_outbox");
    expect(outboxRows.filter((row) => row.operation_type === "CREATE_BILL")).toHaveLength(1);
    expect(outboxRows.some((row) => row.operation_type === "UPDATE_CUSTOMER")).toBe(false);
    expect(outboxRows.find((row) => row.operation_type === "CREATE_BILL")?.payload).toEqual(expect.objectContaining({
      payments: [],
      paymentBreakdown: [],
      paidAmount: 0,
      creditAmount: 500,
      ledgerEntries: [expect.objectContaining({ type: "BILL", amount: 500, customerId: "customer_1" })],
    }));
  });

  it("PAYMENT decreases customer balance", async () => {
    seedLedger({
      id: "ledger_bill_1",
      type: "BILL",
      source_type: "bill",
      source_id: "bill_1",
      bill_id: "bill_1",
      amount: 500,
      balance_after: 500,
      entry_at: "2026-06-06T08:00:00.000Z",
      created_at: "2026-06-06T08:00:00.000Z",
    });
    putInto("customers", { ...scopedRows("customers")[0], udharAmount: 500, totalUdhar: 500 });

    const result = await recordPaymentLocalFirst("customer_1", { amount: 200, mode: "cash", note: "partial payment" });
    const ledger = scopedRows("customer_ledger");

    expect(result).toEqual(expect.objectContaining({ success: true, amount: 200, customerId: "customer_1" }));
    expect(ledger).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "PAYMENT",
        source_type: "payment",
        payment_id: result.paymentId,
        amount: 200,
        balance_after: 300,
      }),
    ]));
    expect(calculateLedgerBalance(ledger)).toBe(300);
    expect(scopedRows("customers")[0]).toEqual(expect.objectContaining({ udharAmount: 300, totalUdhar: 300 }));
  });

  it("CORRECTION adjusts balance", () => {
    const ledger = [
      { id: "bill_ledger", type: "BILL", amount: 500, entry_at: "2026-06-06T08:00:00.000Z" },
      { id: "correction_ledger", type: "CORRECTION", amount: -75, entry_at: "2026-06-06T09:00:00.000Z" },
    ];

    expect(calculateLedgerBalance(ledger)).toBe(425);
    expect(normaliseLedgerType("CORRECTION")).toBe("CORRECTION");
  });

  it("CANCELLED_BILL reverses udhar impact by appending a correction without mutating the original BILL ledger entry", async () => {
    putInto("bills", {
      id: "bill_credit_1",
      local_id: "bill_credit_1",
      tenant_id: dbState.scope.tenant_id,
      store_id: dbState.scope.store_id,
      device_id: dbState.scope.device_id,
      billNo: "BILL-1",
      billNumber: "BILL-1",
      customerId: "customer_1",
      customerName: "Ramesh",
      billType: "normal_sale",
      status: "pending_sync",
      creditAmount: 300,
      grandTotal: 300,
      totalAmount: 300,
      sync_status: "pending_sync",
      deleted_at: null,
    });
    const originalBillLedger = {
      id: "ledger_bill_1",
      type: "BILL",
      source_type: "bill",
      source_id: "bill_credit_1",
      bill_id: "bill_credit_1",
      amount: 300,
      balance_after: 300,
      entry_at: "2026-06-06T08:00:00.000Z",
      created_at: "2026-06-06T08:00:00.000Z",
    };
    seedLedger(originalBillLedger);
    putInto("customers", { ...scopedRows("customers")[0], udharAmount: 300, totalUdhar: 300 });

    await cancelBillWithOwnerPinLocalFirst("bill_credit_1", "1234", "Customer returned order");

    const ledger = scopedRows("customer_ledger");
    expect(ledger).toHaveLength(2);
    expect(ledger.find((row) => row.id === "ledger_bill_1")).toEqual(expect.objectContaining(originalBillLedger));
    const cancellationEntry = ledger.find((row) => row.id !== "ledger_bill_1");
    expect(cancellationEntry).toEqual(expect.objectContaining({
      type: "bill_cancel_correction",
      source_type: "bill",
      source_id: "bill_credit_1",
      bill_id: "bill_credit_1",
      amount: -300,
      note: "Customer returned order",
    }));
    expect(normaliseLedgerType(cancellationEntry?.type)).toBe("CANCELLED_BILL");
    expect(calculateLedgerBalance(ledger)).toBe(0);
    expect(scopedRows("customers")[0]).toEqual(expect.objectContaining({ udharAmount: 0, totalUdhar: 0 }));
  });

  it("ledger remains append-only across bill, payment, cancellation, and reversal events", async () => {
    const bill = await createBillLocalFirst(creditBillInput({ actualAmount: 400, payments: [{ mode: BillPaymentMode.credit, amount: 400 }] }));
    const originalBillLedger = clone(scopedRows("customer_ledger")[0]);

    const payment = await recordPaymentLocalFirst("customer_1", { amount: 150, mode: "upi", note: "first collection" });
    const ledgerAfterPayment = clone(scopedRows("customer_ledger"));

    await reversePaymentWithOwnerPinLocalFirst({ paymentId: payment.paymentId, ownerPin: "1234", reason: "UPI failed later" });
    await cancelBillWithOwnerPinLocalFirst(bill.id, "1234", "Bill cancelled");

    const ledger = scopedRows("customer_ledger");
    expect(ledger).toHaveLength(4);
    expect(ledger.find((row) => row.id === originalBillLedger.id)).toEqual(originalBillLedger);
    for (const row of ledgerAfterPayment) {
      expect(ledger.find((current) => current.id === row.id)).toEqual(expect.objectContaining(row));
    }
    expect(ledger.map((row) => normaliseLedgerType(row.type, row.source_type))).toEqual(expect.arrayContaining(["BILL", "PAYMENT", "CORRECTION", "CANCELLED_BILL"]));
  });

  it("payment reversal appends correction and does not delete original payment", async () => {
    seedLedger({
      id: "ledger_bill_1",
      type: "BILL",
      source_type: "bill",
      amount: 500,
      balance_after: 500,
      entry_at: "2026-06-06T08:00:00.000Z",
      created_at: "2026-06-06T08:00:00.000Z",
    });
    seedLedger({
      id: "ledger_payment_1",
      type: "PAYMENT",
      source_type: "payment",
      source_id: "payment_1",
      paymentId: "payment_1",
      payment_id: "payment_1",
      amount: 200,
      balance_after: 300,
      entry_at: "2026-06-06T08:30:00.000Z",
      created_at: "2026-06-06T08:30:00.000Z",
    });
    putInto("payments", {
      id: "payment_1",
      local_id: "payment_1",
      tenant_id: dbState.scope.tenant_id,
      store_id: dbState.scope.store_id,
      device_id: dbState.scope.device_id,
      customerId: "customer_1",
      customer_id: "customer_1",
      mode: "cash",
      amount: 200,
      status: "active",
      sync_status: "pending_sync",
    });
    putInto("customers", { ...scopedRows("customers")[0], udharAmount: 300, totalUdhar: 300 });

    const result = await reversePaymentWithOwnerPinLocalFirst({ paymentId: "payment_1", ownerPin: "1234", reason: "Duplicate payment" });

    expect(result).toEqual(expect.objectContaining({ success: true, paymentId: "payment_1", pendingSync: true }));
    expect(offlineDB.delete).not.toHaveBeenCalled();
    expect(scopedRows("payments")).toHaveLength(1);
    expect(scopedRows("payments")[0]).toEqual(expect.objectContaining({ id: "payment_1", status: "reversed", reversed_at: expect.any(String) }));
    expect(scopedRows("customer_ledger")).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "CORRECTION",
        source_type: "payment_reversal",
        source_id: "payment_1",
        payment_id: "payment_1",
        amount: 200,
        balance_after: 500,
      }),
    ]));
    expect(calculateLedgerBalance(scopedRows("customer_ledger"))).toBe(500);
  });

  it("ledger entries are tenant/store scoped", async () => {
    seedLedger({ id: "ledger_current", type: "BILL", amount: 100, entry_at: "2026-06-06T08:00:00.000Z" });
    putInto("customer_ledger", {
      id: "ledger_other_tenant",
      tenant_id: "tenant_ledger_B",
      store_id: dbState.scope.store_id,
      device_id: "device_other",
      customerId: "customer_1",
      customer_id: "customer_1",
      type: "BILL",
      amount: 900,
      entry_at: "2026-06-06T08:00:00.000Z",
    });
    putInto("customer_ledger", {
      id: "ledger_other_store",
      tenant_id: dbState.scope.tenant_id,
      store_id: "store_ledger_B",
      device_id: "device_other",
      customerId: "customer_1",
      customer_id: "customer_1",
      type: "BILL",
      amount: 700,
      entry_at: "2026-06-06T08:00:00.000Z",
    });

    const rows = await readCustomerLedgerEntries("customer_1");

    expect(rows).toEqual([expect.objectContaining({ id: "ledger_current", tenant_id: dbState.scope.tenant_id, store_id: dbState.scope.store_id })]);
    expect(calculateLedgerBalance(rows)).toBe(100);
  });

  it("customer detail hides pending bill echoes after the synced bill arrives", async () => {
    putInto("bills", {
      id: "bill_local_echo_1",
      local_id: "bill_local_echo_1",
      clientBillId: "bill_local_echo_1",
      client_bill_id: "bill_local_echo_1",
      customerId: "customer_1",
      customer_id: "customer_1",
      customerName: "Ramesh",
      billNo: "PENDING-LOCAL",
      grandTotal: 280,
      actualAmount: 280,
      status: "pending_sync",
      sync_status: "pending_sync",
      tenant_id: dbState.scope.tenant_id,
      store_id: dbState.scope.store_id,
      device_id: dbState.scope.device_id,
      createdAt: "2026-06-06T10:00:00.000Z",
      created_at: "2026-06-06T10:00:00.000Z",
      deleted_at: null,
    });
    putInto("bills", {
      id: "server_bill_echo_1",
      server_id: "server_bill_echo_1",
      local_id: "bill_local_echo_1",
      clientBillId: "bill_local_echo_1",
      client_bill_id: "bill_local_echo_1",
      customerId: "customer_1",
      customer_id: "customer_1",
      customerName: "Ramesh",
      billNo: "KOS-2026-000010",
      grandTotal: 280,
      actualAmount: 280,
      status: "completed",
      sync_status: "synced",
      isSynced: true,
      is_synced: true,
      tenant_id: dbState.scope.tenant_id,
      store_id: dbState.scope.store_id,
      device_id: dbState.scope.device_id,
      createdAt: "2026-06-06T10:00:00.000Z",
      created_at: "2026-06-06T10:00:00.000Z",
      deleted_at: null,
    });

    const detail = await loadCustomerDetail("customer_1");

    expect(detail?.bills).toHaveLength(1);
    expect(detail?.bills[0]).toEqual(expect.objectContaining({ id: "server_bill_echo_1", billNo: "KOS-2026-000010" }));
  });

  it("ledger-only customer balances remain visible when customer cache identity is missing", async () => {
    dbState.committed.customers = [];
    seedLedger({
      id: "ledger_orphan_1",
      customerId: "server_customer_orphan",
      customer_id: "server_customer_orphan",
      customerName: "Khushdeep phophalia",
      type: "BILL",
      source_type: "bill",
      amount: 63,
      balance_after: 63,
      entry_at: "2026-06-06T10:00:00.000Z",
      created_at: "2026-06-06T10:00:00.000Z",
    });

    const customers = await loadCustomersWithLedger();

    expect(customers).toHaveLength(1);
    expect(customers[0]).toEqual(expect.objectContaining({
      id: "server_customer_orphan",
      name: "Khushdeep phophalia",
      ledgerBalance: 63,
      totalUdhar: 63,
      udharAmount: 63,
      ledger_only: true,
    }));
  });
});

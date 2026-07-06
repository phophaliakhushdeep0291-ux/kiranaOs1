import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  tenantId: "tenant_reports",
  storeId: "store_reports",
  rows: {} as Record<string, Array<Record<string, unknown>>>,
}));

function inScope<T>(rows: T[]): T[] {
  return rows.filter((row) => {
    const record = row as Record<string, unknown>;
    return (
      record.tenant_id === state.tenantId && record.store_id === state.storeId
    );
  });
}

vi.mock("@/lib/offline/context", () => ({
  getOfflineScope: vi.fn(() => ({
    tenant_id: state.tenantId,
    store_id: state.storeId,
    device_id: "device_reports",
  })),
  nowIso: vi.fn(() => new Date().toISOString()),
}));

vi.mock("@/lib/offline/db", () => ({
  offlineDB: {
    getAll: vi.fn(async (table: string) => state.rows[table] ?? []),
  },
  filterRowsForCurrentScope: vi.fn(inScope),
}));

import {
  buildDailyClosingReport,
  buildLocalReportSnapshot,
} from "@/features/reports/local-reporting";

const scope = {
  tenant_id: "tenant_reports",
  store_id: "store_reports",
  device_id: "device_reports",
};

function bill(
  id: string,
  createdAt: string,
  overrides: Record<string, unknown> = {},
) {
  const grandTotal = Number(
    overrides.grandTotal ?? overrides.totalAmount ?? 100,
  );
  const paidAmount = Number(overrides.paidAmount ?? grandTotal);
  return {
    id,
    billNo: id,
    billNumber: id,
    billType: "normal_sale",
    status: "paid",
    grandTotal,
    totalAmount: grandTotal,
    paidAmount,
    buyerPaidAmount: paidAmount,
    creditAmount: Math.max(0, grandTotal - paidAmount),
    discount: 0,
    createdAt,
    created_at: createdAt,
    sync_status: "synced",
    ...scope,
    ...overrides,
  };
}

function payment(
  id: string,
  paidAt: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    mode: "cash",
    amount: 100,
    paidAt,
    paid_at: paidAt,
    createdAt: paidAt,
    created_at: paidAt,
    status: "active",
    sync_status: "synced",
    ...scope,
    ...overrides,
  };
}

function billItem(
  id: string,
  billId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    billId,
    bill_id: billId,
    productId: "product_sugar",
    product_id: "product_sugar",
    name: "Sugar",
    quantity: 1,
    ratePerRateUnit: 100,
    rate_per_rate_unit: 100,
    line_total: 100,
    sync_status: "synced",
    ...scope,
    ...overrides,
  };
}

function product(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: "Sugar",
    category: "grocery",
    defaultPricePerRateUnit: 100,
    costPrice: 60,
    stockBaseQty: 20,
    lowStockThreshold: 5,
    sync_status: "synced",
    ...scope,
    ...overrides,
  };
}

function ledger(
  id: string,
  createdAt: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    customerId: "customer_1",
    customer_id: "customer_1",
    type: "PAYMENT",
    source_type: "payment",
    amount: -50,
    entry_at: createdAt,
    createdAt,
    created_at: createdAt,
    sync_status: "synced",
    ...scope,
    ...overrides,
  };
}

function setRows(rows: Record<string, Array<Record<string, unknown>>>) {
  state.rows = {
    bills: [],
    bill_items: [],
    payments: [],
    customer_ledger: [],
    products: [],
    customers: [],
    inventory_movements: [],
    sync_outbox: [],
    ...rows,
  };
}

describe("local reports and daily closing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-06T12:00:00.000Z"));
    state.tenantId = "tenant_reports";
    state.storeId = "store_reports";
    setRows({});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("builds a 7-day report from local Dexie data", async () => {
    setRows({
      bills: [
        bill("bill_today", "2026-06-06T10:00:00.000Z", { grandTotal: 150 }),
        bill("bill_inside_window", "2026-05-31T10:00:00.000Z", {
          grandTotal: 100,
        }),
        bill("bill_old", "2026-05-30T10:00:00.000Z", { grandTotal: 999 }),
      ],
      payments: [
        payment("pay_today", "2026-06-06T10:00:00.000Z", {
          bill_id: "bill_today",
          amount: 150,
        }),
        payment("pay_inside_window", "2026-05-31T10:00:00.000Z", {
          bill_id: "bill_inside_window",
          amount: 100,
        }),
        payment("pay_old", "2026-05-30T10:00:00.000Z", {
          bill_id: "bill_old",
          amount: 999,
        }),
      ],
    });

    const snapshot = await buildLocalReportSnapshot({
      from: "2026-06-06",
      to: "2026-06-06",
    });

    expect(snapshot.sevenDay.sales).toBe(250);
    expect(snapshot.sevenDay.bills).toBe(2);
  });

  it("daily closing calculates cash correctly", async () => {
    setRows({
      bills: [bill("bill_cash", "2026-06-06T09:00:00.000Z")],
      payments: [
        payment("payment_cash", "2026-06-06T09:05:00.000Z", {
          bill_id: "bill_cash",
          mode: "cash",
          amount: 100,
        }),
      ],
    });

    const closing = await buildDailyClosingReport("2026-06-06");

    expect(closing.cashReceived).toBe(100);
    expect(closing.expectedCashInDrawer).toBe(100);
  });

  it("daily closing calculates UPI correctly", async () => {
    setRows({
      bills: [bill("bill_upi", "2026-06-06T09:00:00.000Z", { grandTotal: 75 })],
      payments: [
        payment("payment_upi", "2026-06-06T09:05:00.000Z", {
          bill_id: "bill_upi",
          mode: "upi",
          amount: 75,
        }),
      ],
    });

    const closing = await buildDailyClosingReport("2026-06-06");

    expect(closing.upiReceived).toBe(75);
    expect(closing.cashReceived).toBe(0);
  });

  it("daily closing calculates udhar correctly", async () => {
    setRows({
      bills: [
        bill("bill_udhar", "2026-06-06T10:00:00.000Z", {
          grandTotal: 100,
          paidAmount: 40,
          buyerPaidAmount: 40,
          creditAmount: 60,
          customerId: "customer_1",
          customer_id: "customer_1",
        }),
      ],
      payments: [
        payment("payment_cash", "2026-06-06T10:05:00.000Z", {
          bill_id: "bill_udhar",
          customer_id: "customer_1",
          mode: "cash",
          amount: 40,
        }),
      ],
    });

    const closing = await buildDailyClosingReport("2026-06-06");

    expect(closing.totalSales).toBe(100);
    expect(closing.cashReceived).toBe(40);
    expect(closing.udharGiven).toBe(60);
  });

  it("includes old udhar payments correctly", async () => {
    setRows({
      bills: [
        bill("bill_today", "2026-06-06T10:00:00.000Z", { grandTotal: 80 }),
      ],
      payments: [
        payment("payment_sale", "2026-06-06T10:05:00.000Z", {
          bill_id: "bill_today",
          mode: "cash",
          amount: 80,
        }),
        payment("payment_old_udhar", "2026-06-06T11:00:00.000Z", {
          bill_id: null,
          customer_id: "customer_1",
          mode: "cash",
          amount: 35,
        }),
      ],
      customer_ledger: [
        ledger("ledger_old_udhar", "2026-06-06T11:00:00.000Z", {
          bill_id: null,
          payment_id: "payment_old_udhar",
          amount: -35,
        }),
      ],
    });

    const closing = await buildDailyClosingReport("2026-06-06");

    expect(closing.cashReceived).toBe(115);
    expect(closing.oldUdharPaymentReceived).toBe(35);
  });

  it("does not count orphan sale payment echoes as old udhar recovery", async () => {
    setRows({
      bills: [
        bill("bill_today_udhar", "2026-06-06T10:00:00.000Z", {
          grandTotal: 49500,
          paidAmount: 45000,
          buyerPaidAmount: 45000,
          creditAmount: 4500,
          customerId: "customer_1",
          customer_id: "customer_1",
          payments: [{ mode: "cash", amount: 45000 }],
        }),
      ],
      payments: [
        payment("payment_sale_orphan_echo", "2026-06-06T10:02:00.000Z", {
          bill_id: null,
          customer_id: "customer_1",
          mode: "cash",
          amount: 45000,
        }),
        payment("payment_old_udhar_real", "2026-06-06T11:00:00.000Z", {
          bill_id: null,
          customer_id: "customer_1",
          mode: "cash",
          amount: 4000,
        }),
      ],
      customer_ledger: [
        ledger("ledger_old_udhar_real", "2026-06-06T11:00:00.000Z", {
          bill_id: null,
          payment_id: "payment_old_udhar_real",
          source_id: "payment_old_udhar_real",
          amount: -4000,
        }),
      ],
    });

    const closing = await buildDailyClosingReport("2026-06-06");

    expect(closing.totalSales).toBe(49500);
    expect(closing.udharGiven).toBe(4500);
    expect(closing.oldUdharPaymentReceived).toBe(4000);
    expect(closing.oldUdharCashReceived).toBe(4000);
    expect(closing.oldUdharUpiReceived).toBe(0);
    expect(closing.cashSales).toBe(45000);
    expect(closing.upiSales).toBe(0);
    expect(closing.cashReceived).toBe(49000);
    expect(closing.expectedCashInDrawer).toBe(49000);
  });

  it("subtracts same-day sale cash before treating loose payment rows as old udhar", async () => {
    setRows({
      bills: [
        bill("bill_today_cash_udhar", "2026-06-06T10:00:00.000Z", {
          grandTotal: 49590,
          paidAmount: 45090,
          buyerPaidAmount: 45090,
          creditAmount: 4500,
          customerId: "customer_1",
          customer_id: "customer_1",
          payments: [{ mode: "cash", amount: 45090, paidAt: "2026-06-06T10:00:00.000Z" }],
        }),
      ],
      payments: [
        payment("payment_sale_loose_late_echo", "2026-06-06T17:30:00.000Z", {
          bill_id: null,
          customer_id: "customer_1",
          mode: "cash",
          amount: 45090,
        }),
        payment("payment_old_udhar_loose", "2026-06-06T18:00:00.000Z", {
          bill_id: null,
          customer_id: "customer_1",
          mode: "cash",
          amount: 4000,
        }),
      ],
    });

    const closing = await buildDailyClosingReport("2026-06-06");

    expect(closing.totalSales).toBe(49590);
    expect(closing.udharGiven).toBe(4500);
    expect(closing.oldUdharPaymentReceived).toBe(4000);
    expect(closing.oldUdharCashReceived).toBe(4000);
    expect(closing.oldUdharUpiReceived).toBe(0);
    expect(closing.cashSales).toBe(45090);
    expect(closing.upiSales).toBe(0);
    expect(closing.cashReceived).toBe(49090);
    expect(closing.expectedCashInDrawer).toBe(49090);
  });

  it("matches synced payment rows through bill id aliases before old udhar classification", async () => {
    setRows({
      bills: [
        bill("bill_local", "2026-06-06T10:00:00.000Z", {
          server_id: "bill_server",
          grandTotal: 100,
          paidAmount: 100,
          buyerPaidAmount: 100,
        }),
      ],
      payments: [
        payment("payment_server_alias", "2026-06-06T10:04:00.000Z", {
          bill_id: null,
          server_bill_id: "bill_server",
          mode: "cash",
          amount: 100,
        }),
      ],
    });

    const closing = await buildDailyClosingReport("2026-06-06");

    expect(closing.cashReceived).toBe(100);
    expect(closing.oldUdharPaymentReceived).toBe(0);
  });

  it("subtracts supplier purchase cash paid and tracks purchase due", async () => {
    setRows({
      bills: [
        bill("bill_today", "2026-06-06T10:00:00.000Z", { grandTotal: 100 }),
      ],
      payments: [
        payment("payment_sale", "2026-06-06T10:05:00.000Z", {
          bill_id: "bill_today",
          mode: "cash",
          amount: 100,
        }),
        payment("payment_old_udhar", "2026-06-06T11:00:00.000Z", {
          bill_id: null,
          customer_id: "customer_1",
          mode: "cash",
          amount: 50,
        }),
      ],
      inventory_movements: [
        {
          id: "purchase_1",
          productId: "product_sugar",
          product_id: "product_sugar",
          productName: "Sugar",
          type: "purchase",
          action: "purchase",
          billAmount: 120,
          bill_amount: 120,
          purchasePaidAmount: 70,
          purchase_paid_amount: 70,
          purchaseDueAmount: 50,
          purchase_due_amount: 50,
          purchasePaymentMode: "cash",
          purchase_payment_mode: "cash",
          createdAt: "2026-06-06T12:00:00.000Z",
          created_at: "2026-06-06T12:00:00.000Z",
          sync_status: "pending_sync",
          ...scope,
        },
      ],
    });

    const snapshot = await buildLocalReportSnapshot({
      from: "2026-06-06",
      to: "2026-06-06",
    });
    const closing = await buildDailyClosingReport("2026-06-06");

    expect(snapshot.paymentBreakdown.cashIn).toBe(150);
    expect(snapshot.paymentBreakdown.purchaseCashPaid).toBe(70);
    expect(snapshot.paymentBreakdown.purchaseDue).toBe(50);
    expect(snapshot.paymentBreakdown.netCashInHand).toBe(80);
    expect(closing.expectedCashInDrawer).toBe(80);
    expect(closing.purchaseDue).toBe(50);
  });

  it("profit estimate uses item cost before product cost", async () => {
    setRows({
      bills: [
        bill("bill_profit", "2026-06-06T10:00:00.000Z", { grandTotal: 200 }),
      ],
      bill_items: [
        billItem("item_profit", "bill_profit", {
          product_id: "product_sugar",
          quantity: 2,
          rate_per_rate_unit: 100,
          line_total: 200,
          cost_per_rate_unit: 70,
        }),
      ],
      products: [product("product_sugar", { costPrice: 999 })],
      payments: [
        payment("payment_profit", "2026-06-06T10:05:00.000Z", {
          bill_id: "bill_profit",
          amount: 200,
        }),
      ],
    });

    const snapshot = await buildLocalReportSnapshot({
      from: "2026-06-06",
      to: "2026-06-06",
    });

    expect(snapshot.selected.profitEstimate).toBe(60);
    expect(snapshot.topProducts[0]).toEqual(
      expect.objectContaining({
        productId: "product_sugar",
        profitEstimate: 60,
      }),
    );
  });

  it("excludes cancelled bills and their payments", async () => {
    setRows({
      bills: [
        bill("bill_valid", "2026-06-06T10:00:00.000Z", { grandTotal: 100 }),
        bill("bill_cancelled", "2026-06-06T11:00:00.000Z", {
          grandTotal: 500,
          status: "cancelled",
        }),
      ],
      payments: [
        payment("payment_valid", "2026-06-06T10:05:00.000Z", {
          bill_id: "bill_valid",
          amount: 100,
        }),
        payment("payment_cancelled", "2026-06-06T11:05:00.000Z", {
          bill_id: "bill_cancelled",
          amount: 500,
        }),
      ],
    });

    const closing = await buildDailyClosingReport("2026-06-06");

    expect(closing.totalSales).toBe(100);
    expect(closing.cashReceived).toBe(100);
  });

  it("counts estimate (kacha) bills and their payments like real sales", async () => {
    setRows({
      bills: [
        bill("bill_valid", "2026-06-06T10:00:00.000Z", { grandTotal: 100 }),
        bill("bill_estimate", "2026-06-06T11:00:00.000Z", {
          grandTotal: 400,
          billType: "estimate",
        }),
        bill("bill_rough", "2026-06-06T12:00:00.000Z", {
          grandTotal: 300,
          billType: "rough_estimate",
        }),
      ],
      payments: [
        payment("payment_valid", "2026-06-06T10:05:00.000Z", {
          bill_id: "bill_valid",
          mode: "cash",
          amount: 100,
        }),
        payment("payment_estimate", "2026-06-06T11:05:00.000Z", {
          bill_id: "bill_estimate",
          mode: "upi",
          amount: 400,
        }),
        payment("payment_rough", "2026-06-06T12:05:00.000Z", {
          bill_id: "bill_rough",
          mode: "cash",
          amount: 300,
        }),
      ],
    });

    const closing = await buildDailyClosingReport("2026-06-06");

    // Estimates work the same as real bills — money counts in the day's totals.
    expect(closing.totalSales).toBe(800);
    expect(closing.cashReceived).toBe(400);
    expect(closing.upiReceived).toBe(400);
  });

  it("flags low stock only when stock is truly at/under the alert (thresholds are base units)", async () => {
    setRows({
      products: [
        // Weighed items: stockBaseQty and lowStockThreshold are BOTH base units (g).
        product("product_atta", { name: "Atta", unit: "kg", displayUnit: "kg", stockBaseQty: 5000, lowStockThreshold: 2000 }), // 5 kg vs 2 kg → healthy
        product("product_dal", { name: "Dal", unit: "kg", displayUnit: "kg", stockBaseQty: 1000, lowStockThreshold: 2000 }), // 1 kg vs 2 kg → low
        product("product_biscuit", { name: "Biscuit", unit: "piece", displayUnit: "piece", stockBaseQty: 50, lowStockThreshold: 10 }),
        product("product_match", { name: "Matchbox", unit: "piece", displayUnit: "piece", stockBaseQty: 3, lowStockThreshold: 10 }), // low
        product("product_noalert", { name: "No Alert", unit: "piece", displayUnit: "piece", stockBaseQty: 0, lowStockThreshold: 0 }), // no threshold → never low
      ],
    });

    const snapshot = await buildLocalReportSnapshot({ from: "2026-06-06", to: "2026-06-06" });
    const names = snapshot.lowStock.map((row) => row.name);

    expect(names).toContain("Dal");
    expect(names).toContain("Matchbox");
    // The old display-vs-base comparison flagged EVERY weighed product as low (5 <= 2000).
    expect(names).not.toContain("Atta");
    expect(names).not.toContain("Biscuit");
    expect(names).not.toContain("No Alert");
    // Numbers surface in display units so the list reads "1 of 2 kg", not "1 of 2000".
    expect(snapshot.lowStock.find((row) => row.name === "Dal")).toEqual(
      expect.objectContaining({ stock: 1, threshold: 2, unit: "kg" }),
    );
  });

  it("marks reports as local estimates when pending sync exists", async () => {
    setRows({
      bills: [bill("bill_pending", "2026-06-06T10:00:00.000Z")],
      payments: [
        payment("payment_pending", "2026-06-06T10:05:00.000Z", {
          bill_id: "bill_pending",
        }),
      ],
      sync_outbox: [
        {
          op_id: "op_bill_pending",
          clientEventId: "op_bill_pending",
          entity_type: "bill",
          operation_type: "CREATE_BILL",
          status: "PENDING",
          sync_status: "pending_sync",
          ...scope,
        },
      ],
    });

    const snapshot = await buildLocalReportSnapshot({
      from: "2026-06-06",
      to: "2026-06-06",
    });
    const closing = await buildDailyClosingReport("2026-06-06");

    expect(snapshot.pendingSyncCount).toBe(1);
    expect(snapshot.dataSourceLabel).toBe("Local estimate");
    expect(closing.isLocalEstimate).toBe(true);
  });

  it("dashboard report totals dedupe pending local bill and synced server bill", async () => {
    const createdAt = "2026-06-06T10:00:00.000Z";
    setRows({
      bills: [
        bill("server_bill_1", createdAt, {
          grandTotal: 250,
          paidAmount: 200,
          buyerPaidAmount: 200,
          creditAmount: 50,
          grossProfit: 80,
          localBillId: "local_bill_1",
          local_bill_id: "local_bill_1",
          clientBillId: "local_bill_1",
          client_bill_id: "local_bill_1",
          idempotencyKey: "create-bill:tenant_reports:store_reports:device_reports:local_bill_1",
          idempotency_key: "create-bill:tenant_reports:store_reports:device_reports:local_bill_1",
          isSynced: true,
          is_synced: true,
          sync_status: "synced",
        }),
        bill("local_bill_1", createdAt, {
          grandTotal: 250,
          paidAmount: 200,
          buyerPaidAmount: 200,
          creditAmount: 50,
          grossProfit: 80,
          localBillId: "local_bill_1",
          local_bill_id: "local_bill_1",
          clientBillId: "local_bill_1",
          client_bill_id: "local_bill_1",
          idempotencyKey: "create-bill:tenant_reports:store_reports:device_reports:local_bill_1",
          idempotency_key: "create-bill:tenant_reports:store_reports:device_reports:local_bill_1",
          isSynced: false,
          is_synced: false,
          status: "pending_sync",
          sync_status: "pending_sync",
        }),
      ],
    });

    const snapshot = await buildLocalReportSnapshot({
      from: "2026-06-06",
      to: "2026-06-06",
    });

    expect(snapshot.today.sales).toBe(250);
    expect(snapshot.today.bills).toBe(1);
    expect(snapshot.today.profitEstimate).toBe(80);
    expect(snapshot.today.udharSales).toBe(50);
  });

  it("dashboard profit uses deduped bill profit instead of duplicate raw bill items", async () => {
    const createdAt = "2026-06-06T10:00:00.000Z";
    setRows({
      bills: [
        bill("server_bill_1", createdAt, {
          grandTotal: 250,
          grossProfit: 80,
          localBillId: "local_bill_1",
          local_bill_id: "local_bill_1",
          idempotencyKey: "create-bill:tenant_reports:store_reports:device_reports:local_bill_1",
          idempotency_key: "create-bill:tenant_reports:store_reports:device_reports:local_bill_1",
        }),
        bill("local_bill_1", createdAt, {
          grandTotal: 250,
          grossProfit: 80,
          localBillId: "local_bill_1",
          local_bill_id: "local_bill_1",
          idempotencyKey: "create-bill:tenant_reports:store_reports:device_reports:local_bill_1",
          idempotency_key: "create-bill:tenant_reports:store_reports:device_reports:local_bill_1",
          sync_status: "pending_sync",
        }),
      ],
      bill_items: [
        billItem("local_item_1", "local_bill_1", { line_total: 250, local_id: "local_item_1" }),
        billItem("server_item_1", "server_bill_1", { line_total: 250, local_id: "local_item_1", server_id: "server_item_1" }),
      ],
      products: [product("product_sugar", { costPrice: 60 })],
    });

    const snapshot = await buildLocalReportSnapshot({
      from: "2026-06-06",
      to: "2026-06-06",
    });

    expect(snapshot.today.sales).toBe(250);
    expect(snapshot.today.bills).toBe(1);
    expect(snapshot.today.profitEstimate).toBe(80);
  });

  it("dashboard profit fallback dedupes local/server item echoes for a bill without stored grossProfit", async () => {
    const createdAt = "2026-06-06T10:00:00.000Z";
    setRows({
      bills: [bill("local_bill_1", createdAt, { grandTotal: 100 })],
      bill_items: [
        billItem("local_item_1", "local_bill_1", { local_id: "local_item_1" }),
        billItem("server_item_1", "local_bill_1", { local_id: "local_item_1", server_id: "server_item_1" }),
      ],
      products: [product("product_sugar", { costPrice: 60 })],
    });

    const snapshot = await buildLocalReportSnapshot({
      from: "2026-06-06",
      to: "2026-06-06",
    });

    expect(snapshot.today.sales).toBe(100);
    expect(snapshot.today.profitEstimate).toBe(40);
  });

  it("dashboard pending udhar falls back to customer balances when ledger rows are not present yet", async () => {
    setRows({
      customers: [
        { id: "customer_1", name: "Ramesh", udharAmount: 120, totalUdhar: 120, ...scope },
        { id: "customer_2", name: "Suresh", udharAmount: 80, totalUdhar: 80, ...scope },
      ],
    });

    const snapshot = await buildLocalReportSnapshot({
      from: "2026-06-06",
      to: "2026-06-06",
    });

    expect(snapshot.pendingUdhar).toBe(200);
  });

  it("dashboard pending udhar uses the same deduped ledger balance as Udhar page", async () => {
    setRows({
      customers: [
        { id: "customer_1", name: "Khushdeep", mobile: "9571738238", udharAmount: 2070, totalUdhar: 2070, ...scope },
      ],
      customer_ledger: [
        ledger("server_ledger_540", "2026-06-06T10:00:00.000Z", {
          customerId: "customer_1",
          customer_id: "customer_1",
          type: "DEBIT",
          source_type: "BILL",
          source_id: "server_bill_540",
          billId: "server_bill_540",
          bill_id: "server_bill_540",
          amount: 540,
          sync_status: "synced",
        }),
        ledger("ledger_local_bill_540_credit", "2026-06-06T10:01:00.000Z", {
          customerId: "customer_1",
          customer_id: "customer_1",
          type: "BILL",
          source_type: "BILL",
          source_id: "PENDING-E7EE28",
          billId: "PENDING-E7EE28",
          bill_id: "PENDING-E7EE28",
          amount: 540,
          sync_status: "pending_sync",
          note: "Udhar from PENDING-E7EE28",
        }),
        ledger("server_ledger_450", "2026-06-06T10:10:00.000Z", {
          customerId: "customer_1",
          customer_id: "customer_1",
          type: "DEBIT",
          source_type: "BILL",
          source_id: "server_bill_450",
          billId: "server_bill_450",
          bill_id: "server_bill_450",
          amount: 450,
          sync_status: "synced",
        }),
        ledger("ledger_local_bill_450_credit", "2026-06-06T10:11:00.000Z", {
          customerId: "customer_1",
          customer_id: "customer_1",
          type: "BILL",
          source_type: "BILL",
          source_id: "PENDING-5A9BDF",
          billId: "PENDING-5A9BDF",
          bill_id: "PENDING-5A9BDF",
          amount: 450,
          sync_status: "pending_sync",
          note: "Udhar from PENDING-5A9BDF",
        }),
        ledger("server_ledger_45", "2026-06-06T10:20:00.000Z", {
          customerId: "customer_1",
          customer_id: "customer_1",
          type: "DEBIT",
          source_type: "BILL",
          source_id: "server_bill_45",
          billId: "server_bill_45",
          bill_id: "server_bill_45",
          amount: 45,
          sync_status: "synced",
        }),
      ],
    });

    const snapshot = await buildLocalReportSnapshot({
      from: "2026-06-06",
      to: "2026-06-06",
    });

    expect(snapshot.pendingUdhar).toBe(1035);
    expect(snapshot.topCustomers[0]).toEqual(expect.objectContaining({
      customerId: "customer_1",
      balance: 1035,
    }));
  });


  it("dashboard report payment bars do not double count local/server payment echoes", async () => {
    setRows({
      bills: [
        bill("server_bill_split", "2026-06-06T10:00:00.000Z", {
          grandTotal: 1980,
          paidAmount: 800,
          buyerPaidAmount: 800,
          creditAmount: 1180,
          customerId: "customer_1",
          customer_id: "customer_1",
          payments: [
            payment("local_cash_echo", "2026-06-06T10:00:00.000Z", {
              bill_id: "PENDING-LOCAL",
              customer_id: "customer_1",
              mode: "cash",
              amount: 650,
              sync_status: "pending_sync",
            }),
            payment("server_cash", "2026-06-06T10:00:02.000Z", {
              bill_id: "server_bill_split",
              customer_id: "customer_1",
              mode: "cash",
              amount: 650,
              sync_status: "synced",
            }),
            payment("local_upi_echo", "2026-06-06T10:00:00.000Z", {
              bill_id: "PENDING-LOCAL",
              customer_id: "customer_1",
              mode: "upi",
              amount: 150,
              sync_status: "pending_sync",
            }),
            payment("server_upi", "2026-06-06T10:00:02.000Z", {
              bill_id: "server_bill_split",
              customer_id: "customer_1",
              mode: "upi",
              amount: 150,
              sync_status: "synced",
            }),
          ],
        }),
      ],
    });

    const snapshot = await buildLocalReportSnapshot({
      from: "2026-06-06",
      to: "2026-06-06",
    });

    expect(snapshot.paymentBreakdown.cash).toBe(650);
    expect(snapshot.paymentBreakdown.upi).toBe(150);
    expect(snapshot.paymentBreakdown.udhar).toBe(1180);
    expect(snapshot.selected.cashSales).toBe(650);
    expect(snapshot.selected.upiSales).toBe(150);
  });

  it("reports are tenant/store scoped", async () => {
    setRows({
      bills: [
        bill("bill_current", "2026-06-06T10:00:00.000Z", { grandTotal: 100 }),
        {
          ...bill("bill_other_tenant", "2026-06-06T10:00:00.000Z", {
            grandTotal: 900,
          }),
          tenant_id: "tenant_other",
        },
        {
          ...bill("bill_other_store", "2026-06-06T10:00:00.000Z", {
            grandTotal: 700,
          }),
          store_id: "store_other",
        },
      ],
      payments: [
        payment("payment_current", "2026-06-06T10:05:00.000Z", {
          bill_id: "bill_current",
          amount: 100,
        }),
        {
          ...payment("payment_other_tenant", "2026-06-06T10:05:00.000Z", {
            bill_id: "bill_other_tenant",
            amount: 900,
          }),
          tenant_id: "tenant_other",
        },
        {
          ...payment("payment_other_store", "2026-06-06T10:05:00.000Z", {
            bill_id: "bill_other_store",
            amount: 700,
          }),
          store_id: "store_other",
        },
      ],
      sync_outbox: [
        {
          op_id: "current",
          status: "PENDING",
          sync_status: "pending_sync",
          ...scope,
        },
        {
          op_id: "other_tenant",
          status: "PENDING",
          sync_status: "pending_sync",
          ...scope,
          tenant_id: "tenant_other",
        },
      ],
    });

    const snapshot = await buildLocalReportSnapshot({
      from: "2026-06-06",
      to: "2026-06-06",
    });

    expect(snapshot.selected.sales).toBe(100);
    expect(snapshot.selected.bills).toBe(1);
    expect(snapshot.paymentBreakdown.cash).toBe(100);
    expect(snapshot.pendingSyncCount).toBe(1);
  });
});

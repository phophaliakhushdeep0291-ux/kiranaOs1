import { describe, expect, it } from "vitest";
import { aggregateFinancialRows } from "@/features/finance/services/FinancialAggregationService";

const date = "2026-06-06";

function bill(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    billNo: id,
    billNumber: id,
    billType: "normal_sale",
    status: "paid",
    grandTotal: 200,
    totalAmount: 200,
    paidAmount: 150,
    buyerPaidAmount: 150,
    creditAmount: 50,
    createdAt: `${date}T10:00:00.000`,
    created_at: `${date}T10:00:00.000`,
    sync_status: "synced",
    ...overrides,
  };
}

function payment(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    mode: "cash",
    amount: 150,
    paidAt: `${date}T10:05:00.000`,
    paid_at: `${date}T10:05:00.000`,
    createdAt: `${date}T10:05:00.000`,
    created_at: `${date}T10:05:00.000`,
    status: "active",
    sync_status: "synced",
    ...overrides,
  };
}

describe("FinancialAggregationService", () => {
  it("aggregates revenue, product profit, collections, udhar, and supplier dues from local rows", () => {
    const snapshot = aggregateFinancialRows({
      date,
      bills: [bill("bill_today")],
      billItems: [
        {
          id: "item_1",
          billId: "bill_today",
          bill_id: "bill_today",
          productId: "product_rice",
          product_id: "product_rice",
          quantity: 2,
          ratePerRateUnit: 100,
          rate_per_rate_unit: 100,
          line_total: 200,
          cost_per_rate_unit: 60,
        },
      ],
      payments: [
        payment("payment_sale", { billId: "bill_today", bill_id: "bill_today", amount: 150 }),
        payment("payment_old_udhar", { billId: null, bill_id: null, customerId: "customer_1", customer_id: "customer_1", amount: 35 }),
      ],
      ledger: [
        {
          id: "ledger_bill",
          customerId: "customer_1",
          customer_id: "customer_1",
          type: "BILL",
          source_type: "BILL",
          amount: 500,
          createdAt: `${date}T09:00:00.000`,
          created_at: `${date}T09:00:00.000`,
        },
        {
          id: "ledger_payment",
          customerId: "customer_1",
          customer_id: "customer_1",
          type: "PAYMENT",
          source_type: "PAYMENT",
          amount: 100,
          createdAt: "2026-06-05T09:30:00.000",
          created_at: "2026-06-05T09:30:00.000",
        },
      ],
      products: [
        {
          id: "product_rice",
          name: "Rice",
          defaultPricePerRateUnit: 100,
          costPrice: 60,
        },
      ],
      customers: [{ id: "customer_1", name: "Ramesh", mobile: "9999999999" }],
      inventoryMovements: [
        {
          id: "purchase_1",
          action: "purchase",
          type: "purchase",
          supplierName: "Wholesaler",
          supplier_name: "Wholesaler",
          billAmount: 300,
          bill_amount: 300,
          purchasePaidAmount: 100,
          purchase_paid_amount: 100,
          purchaseDueAmount: 200,
          purchase_due_amount: 200,
          purchasePaymentMode: "cash",
          purchase_payment_mode: "cash",
          createdAt: `${date}T12:00:00.000`,
          created_at: `${date}T12:00:00.000`,
        },
      ],
    });

    expect(snapshot.revenueToday).toBe(200);
    expect(snapshot.totalBillsToday).toBe(1);
    expect(snapshot.profitToday).toBe(80);
    expect(snapshot.profitByProduct[0]).toEqual(expect.objectContaining({ productName: "Rice", profit: 80 }));
    expect(snapshot.cashSalesToday).toBe(150);
    expect(snapshot.cashUdharRecoveryToday).toBe(35);
    expect(snapshot.totalCashCollectedToday).toBe(185);
    expect(snapshot.totalOutstandingUdhar).toBe(400);
    expect(snapshot.totalCustomersWithUdhar).toBe(1);
    expect(snapshot.supplierDue).toBe(200);
    expect(snapshot.purchaseDueToday).toBe(200);
    expect(snapshot.supplierCashPaidToday).toBe(100);
    expect(snapshot.cashDrawer.expectedClosingCash).toBe(85);
  });

  it("counts estimate tenders and preserves them after history deletion", () => {
    const deletedAt = `${date}T12:00:00.000`;
    const snapshot = aggregateFinancialRows({
      date,
      bills: [
        bill("estimate_cash", { billType: "estimate", grandTotal: 100, paidAmount: 100, creditAmount: 0, payments: [{ mode: "cash", amount: 100 }], deletedAt, deleted_at: deletedAt }),
        bill("estimate_upi", { billType: "estimate", grandTotal: 200, paidAmount: 200, creditAmount: 0, payments: [{ mode: "upi", amount: 200 }] }),
        bill("estimate_bank", { billType: "estimate", grandTotal: 300, paidAmount: 300, creditAmount: 0, payments: [{ mode: "bank", amount: 300 }] }),
        bill("estimate_udhar", { billType: "estimate", grandTotal: 400, paidAmount: 0, creditAmount: 400, payments: [{ mode: "credit", amount: 400 }] }),
      ],
    });

    expect(snapshot.revenueToday).toBe(1000);
    expect(snapshot.cashSalesToday).toBe(100);
    expect(snapshot.upiSalesToday).toBe(200);
    expect(snapshot.bankSalesToday).toBe(300);
    expect(snapshot.udharSalesToday).toBe(400);
    expect(snapshot.totalCashCollectedToday).toBe(100);
    expect(snapshot.totalUpiCollectedToday).toBe(200);
    expect(snapshot.totalBankCollectedToday).toBe(300);
  });

  it("nets a bill-level discount from fallback profit exactly once", () => {
    const snapshot = aggregateFinancialRows({
      date,
      bills: [bill("discounted_bill", {
        subtotal: 200,
        discount: 20,
        grandTotal: 180,
        totalAmount: 180,
        paidAmount: 180,
        buyerPaidAmount: 180,
        creditAmount: 0,
      })],
      billItems: [{
        id: "discounted_item",
        billId: "discounted_bill",
        bill_id: "discounted_bill",
        productId: "product_rice",
        product_id: "product_rice",
        quantity: 2,
        ratePerRateUnit: 100,
        rate_per_rate_unit: 100,
        line_total: 200,
        cost_per_rate_unit: 60,
      }],
      products: [{ id: "product_rice", name: "Rice", costPrice: 60 }],
    });

    expect(snapshot.revenueToday).toBe(180);
    expect(snapshot.discountToday).toBe(20);
    expect(snapshot.profitToday).toBe(60);
  });

  it("keeps discounted profit stable when local and server item echoes coexist", () => {
    const sharedItem = {
      billId: "discounted_bill",
      bill_id: "discounted_bill",
      productId: "product_rice",
      product_id: "product_rice",
      quantity: 2,
      ratePerRateUnit: 100,
      rate_per_rate_unit: 100,
      line_total: 200,
      cost_per_rate_unit: 60,
      local_id: "local_item",
    };
    const snapshot = aggregateFinancialRows({
      date,
      bills: [bill("discounted_bill", {
        subtotal: 200,
        discount: 20,
        grandTotal: 180,
        totalAmount: 180,
        paidAmount: 180,
        buyerPaidAmount: 180,
        creditAmount: 0,
      })],
      billItems: [
        { id: "local_item", ...sharedItem },
        { id: "server_item", server_id: "server_item", ...sharedItem },
      ],
      products: [{ id: "product_rice", name: "Rice", costPrice: 60 }],
    });

    expect(snapshot.profitToday).toBe(60);
  });

  it("collapses local/server bill echoes before calculating dashboard totals", () => {
    const snapshot = aggregateFinancialRows({
      date,
      bills: [
        bill("server_bill", {
          localBillId: "local_bill",
          local_bill_id: "local_bill",
          clientBillId: "local_bill",
          client_bill_id: "local_bill",
          sync_status: "synced",
          isSynced: true,
        }),
        bill("local_bill", {
          localBillId: "local_bill",
          local_bill_id: "local_bill",
          clientBillId: "local_bill",
          client_bill_id: "local_bill",
          status: "pending_sync",
          sync_status: "pending_sync",
          isSynced: false,
        }),
      ],
      payments: [payment("payment_server", { billId: "server_bill", bill_id: "server_bill", amount: 150 })],
    });

    expect(snapshot.revenueToday).toBe(200);
    expect(snapshot.totalBillsToday).toBe(1);
    expect(snapshot.cashSalesToday).toBe(150);
  });

  it("does not count loose today bill payment echoes as old udhar recovery", () => {
    const snapshot = aggregateFinancialRows({
      date,
      bills: [
        bill("bill_mixed_udhar", {
          grandTotal: 22500,
          totalAmount: 22500,
          paidAmount: 20500,
          buyerPaidAmount: 20500,
          creditAmount: 2000,
          customerId: "customer_1",
          customer_id: "customer_1",
          payments: [
            { id: "server_payment_cash", mode: "cash", amount: 20000, paidAt: `${date}T11:00:00.000`, paid_at: `${date}T11:00:00.000` },
            { id: "server_payment_upi", mode: "upi", amount: 500, paidAt: `${date}T11:00:00.000`, paid_at: `${date}T11:00:00.000` },
          ],
        }),
      ],
      payments: [
        payment("loose_cash_echo", { billId: null, bill_id: null, customerId: "customer_1", customer_id: "customer_1", amount: 20000, paidAt: `${date}T11:01:00.000`, paid_at: `${date}T11:01:00.000` }),
        payment("loose_upi_echo", { billId: null, bill_id: null, customerId: "customer_1", customer_id: "customer_1", mode: "upi", amount: 500, paidAt: `${date}T11:01:00.000`, paid_at: `${date}T11:01:00.000` }),
      ],
      ledger: [
        {
          id: "ledger_bill_udhar",
          customerId: "customer_1",
          customer_id: "customer_1",
          type: "debit",
          amount: 2000,
          billId: "bill_mixed_udhar",
          bill_id: "bill_mixed_udhar",
          createdAt: `${date}T11:00:00.000`,
          created_at: `${date}T11:00:00.000`,
        },
      ],
    });

    expect(snapshot.revenueToday).toBe(22500);
    expect(snapshot.cashSalesToday).toBe(20000);
    expect(snapshot.upiSalesToday).toBe(500);
    expect(snapshot.cashUdharRecoveryToday).toBe(0);
    expect(snapshot.upiUdharRecoveryToday).toBe(0);
    expect(snapshot.totalCashCollectedToday).toBe(20000);
    expect(snapshot.totalUpiCollectedToday).toBe(500);
    expect(snapshot.totalOutstandingUdhar).toBe(2000);
  });

  it("keeps reports consistent when bill items and opening udhar are duplicated after sync", () => {
    const snapshot = aggregateFinancialRows({
      date,
      bills: [
        bill("server_bill_740", {
          grandTotal: 740,
          totalAmount: 740,
          subtotal: 742,
          discount: 2,
          paidAmount: 540,
          buyerPaidAmount: 540,
          creditAmount: 200,
          customerId: "customer_1",
          customer_id: "customer_1",
          payments: [
            { id: "pay_cash", mode: "cash", amount: 350, paidAt: `${date}T10:00:00.000`, paid_at: `${date}T10:00:00.000` },
            { id: "pay_upi", mode: "upi", amount: 190, paidAt: `${date}T10:00:00.000`, paid_at: `${date}T10:00:00.000` },
          ],
        }),
      ],
      billItems: [
        { id: "sugar_local", billId: "server_bill_740", bill_id: "server_bill_740", productId: "sugar", product_id: "sugar", name: "sugar", quantity: 2, ratePerRateUnit: 43, rate_per_rate_unit: 43, line_total: 86, cost_per_rate_unit: 39 },
        { id: "sugar_server", billId: "server_bill_740", bill_id: "server_bill_740", productId: "sugar", product_id: "sugar", name: "sugar", quantity: 2, ratePerRateUnit: 43, rate_per_rate_unit: 43, line_total: 86, cost_per_rate_unit: 39 },
        { id: "chai_local", billId: "server_bill_740", bill_id: "server_bill_740", productId: "chai", product_id: "chai", name: "chai pati", quantity: 2, ratePerRateUnit: 290, rate_per_rate_unit: 290, line_total: 580, cost_per_rate_unit: 260 },
        { id: "chai_server", billId: "server_bill_740", bill_id: "server_bill_740", productId: "chai", product_id: "chai", name: "chai pati", quantity: 2, ratePerRateUnit: 290, rate_per_rate_unit: 290, line_total: 580, cost_per_rate_unit: 260 },
        { id: "aata_local", billId: "server_bill_740", bill_id: "server_bill_740", productId: "aata", product_id: "aata", name: "aata", quantity: 2, ratePerRateUnit: 38, rate_per_rate_unit: 38, line_total: 76, cost_per_rate_unit: 32 },
        { id: "aata_server", billId: "server_bill_740", bill_id: "server_bill_740", productId: "aata", product_id: "aata", name: "aata", quantity: 2, ratePerRateUnit: 38, rate_per_rate_unit: 38, line_total: 76, cost_per_rate_unit: 32 },
      ],
      ledger: [
        {
          id: "ledger_bill_credit",
          customerId: "customer_1",
          customer_id: "customer_1",
          type: "debit",
          source_type: "bill",
          source_id: "server_bill_740",
          billId: "server_bill_740",
          bill_id: "server_bill_740",
          amount: 200,
          note: "Bill KOS-2026-000001",
          createdAt: `${date}T10:00:00.000`,
          created_at: `${date}T10:00:00.000`,
        },
        {
          id: "ledger_opening_duplicate",
          customerId: "customer_1",
          customer_id: "customer_1",
          type: "debit",
          source_type: "opening_balance",
          amount: 200,
          note: "Opening udhar balance",
          createdAt: `${date}T10:00:20.000`,
          created_at: `${date}T10:00:20.000`,
        },
      ],
      products: [
        { id: "sugar", name: "sugar", costPrice: 39 },
        { id: "chai", name: "chai pati", costPrice: 260 },
        { id: "aata", name: "aata", costPrice: 32 },
      ],
      customers: [{ id: "customer_1", name: "khushdeep", mobile: "9571738238" }],
    });

    expect(snapshot.revenueToday).toBe(740);
    expect(snapshot.cashSalesToday).toBe(350);
    expect(snapshot.upiSalesToday).toBe(190);
    expect(snapshot.udharSalesToday).toBe(200);
    expect(snapshot.totalOutstandingUdhar).toBe(200);
    expect(snapshot.profitByProduct.map((row) => [row.productId, row.revenue])).toEqual([
      ["chai", 580],
      ["sugar", 86],
      ["aata", 76],
    ]);
  });

  it("counts ledger udhar payments once and keeps their cash or UPI mode", () => {
    const snapshot = aggregateFinancialRows({
      date,
      payments: [
        payment("payment_old_udhar_upi", { billId: null, bill_id: null, customerId: "customer_1", customer_id: "customer_1", mode: "upi", amount: 700 }),
      ],
      ledger: [
        {
          id: "ledger_old_udhar_upi",
          customerId: "customer_1",
          customer_id: "customer_1",
          type: "PAYMENT",
          source_type: "payment",
          source_id: "payment_old_udhar_upi",
          paymentId: "payment_old_udhar_upi",
          payment_id: "payment_old_udhar_upi",
          mode: "upi",
          amount: 700,
          createdAt: `${date}T10:05:00.000`,
          created_at: `${date}T10:05:00.000`,
        },
      ],
    });

    expect(snapshot.cashUdharRecoveryToday).toBe(0);
    expect(snapshot.upiUdharRecoveryToday).toBe(700);
    expect(snapshot.totalCashCollectedToday).toBe(0);
    expect(snapshot.totalUpiCollectedToday).toBe(700);
  });

  it("does not turn loose same-day sale payment echoes into cash in hand", () => {
    const snapshot = aggregateFinancialRows({
      date,
      bills: [
        bill("bill_today_cash_udhar", {
          grandTotal: 49590,
          totalAmount: 49590,
          paidAmount: 45090,
          buyerPaidAmount: 45090,
          creditAmount: 4500,
          cashAmount: 45090,
          cash_amount: 45090,
          customerId: "customer_1",
          customer_id: "customer_1",
          payments: [{ mode: "cash", amount: 45090, paidAt: `${date}T10:00:00.000`, paid_at: `${date}T10:00:00.000` }],
        }),
      ],
      payments: [
        payment("payment_sale_loose_late_echo", {
          billId: null,
          bill_id: null,
          customerId: "customer_1",
          customer_id: "customer_1",
          amount: 45090,
          paidAt: `${date}T17:30:00.000`,
          paid_at: `${date}T17:30:00.000`,
        }),
        payment("payment_old_udhar_loose", {
          billId: null,
          bill_id: null,
          customerId: "customer_1",
          customer_id: "customer_1",
          amount: 4000,
          paidAt: `${date}T18:00:00.000`,
          paid_at: `${date}T18:00:00.000`,
        }),
      ],
    });

    expect(snapshot.revenueToday).toBe(49590);
    expect(snapshot.cashSalesToday).toBe(45090);
    expect(snapshot.cashUdharRecoveryToday).toBe(4000);
    expect(snapshot.totalCashCollectedToday).toBe(49090);
  });

  it("builds supplier purchase rows from synced purchase history", () => {
    const snapshot = aggregateFinancialRows({
      date,
      purchaseBills: [
        {
          id: "purchase_history_1",
          supplierName: "Govind ji",
          supplier_name: "Govind ji",
          billAmount: 4100,
          bill_amount: 4100,
          purchasePaidAmount: 0,
          purchase_paid_amount: 0,
          purchaseDueAmount: 4100,
          purchase_due_amount: 4100,
          purchasePaymentStatus: "due",
          purchase_payment_status: "due",
          createdAt: `${date}T12:00:00.000`,
          created_at: `${date}T12:00:00.000`,
          sync_status: "synced",
        },
      ],
    });

    expect(snapshot.supplierDueRows).toHaveLength(1);
    expect(snapshot.supplierDueRows[0]).toEqual(expect.objectContaining({
      supplierName: "Govind ji",
      amount: 4100,
      due: 4100,
      source: "purchase_bill",
    }));
    expect(snapshot.supplierDue).toBe(4100);
  });

  it("dedupes synced purchase history and inventory movement copies of the same purchase", () => {
    const snapshot = aggregateFinancialRows({
      date,
      purchaseBills: [
        {
          id: "purchase_history_1",
          productId: "product_rice",
          product_id: "product_rice",
          supplierName: "Govind ji",
          supplier_name: "Govind ji",
          invoiceNumber: "LPB-123456",
          invoice_number: "LPB-123456",
          billAmount: 4100,
          bill_amount: 4100,
          purchasePaidAmount: 0,
          purchase_paid_amount: 0,
          purchaseDueAmount: 4100,
          purchase_due_amount: 4100,
          purchasePaymentStatus: "due",
          purchase_payment_status: "due",
          createdAt: `${date}T12:00:05.000`,
          created_at: `${date}T12:00:05.000`,
          sync_status: "synced",
        },
      ],
      inventoryMovements: [
        {
          id: "stock_purchase_1",
          productId: "product_rice",
          product_id: "product_rice",
          action: "purchase",
          type: "purchase",
          supplierName: "govind ji",
          supplier_name: "govind ji",
          purchaseBillNo: "LPB-123456",
          purchase_bill_no: "LPB-123456",
          billAmount: 4100,
          bill_amount: 4100,
          purchasePaidAmount: 0,
          purchase_paid_amount: 0,
          purchaseDueAmount: 4100,
          purchase_due_amount: 4100,
          purchasePaymentStatus: "due",
          purchase_payment_status: "due",
          createdAt: `${date}T12:00:00.000`,
          created_at: `${date}T12:00:00.000`,
          sync_status: "pending_sync",
        },
      ],
    });

    expect(snapshot.supplierDueRows).toHaveLength(1);
    expect(snapshot.supplierDueRows[0]).toEqual(expect.objectContaining({
      source: "purchase_bill",
      invoiceNumber: "LPB-123456",
      amount: 4100,
      due: 4100,
    }));
    expect(snapshot.supplierDue).toBe(4100);
    expect(snapshot.purchaseDueToday).toBe(4100);
  });

  it("dedupes a paid purchase history row against a stale unpaid inventory movement copy", () => {
    const snapshot = aggregateFinancialRows({
      date,
      purchaseBills: [
        {
          id: "purchase_history_paid",
          productId: "product_rice",
          product_id: "product_rice",
          supplierName: "Govind ji",
          supplier_name: "Govind ji",
          invoiceNumber: "LPB-PAID-1",
          invoice_number: "LPB-PAID-1",
          billAmount: 4100,
          bill_amount: 4100,
          purchasePaidAmount: 4100,
          purchase_paid_amount: 4100,
          purchaseDueAmount: 0,
          purchase_due_amount: 0,
          purchasePaymentStatus: "paid",
          purchase_payment_status: "paid",
          createdAt: `${date}T12:00:05.000`,
          created_at: `${date}T12:00:05.000`,
          sync_status: "synced",
        },
      ],
      inventoryMovements: [
        {
          id: "stock_purchase_stale",
          productId: "product_rice",
          product_id: "product_rice",
          action: "purchase",
          type: "purchase",
          supplierName: "govind ji",
          supplier_name: "govind ji",
          purchaseBillNo: "LPB-PAID-1",
          purchase_bill_no: "LPB-PAID-1",
          billAmount: 4100,
          bill_amount: 4100,
          purchasePaidAmount: 0,
          purchase_paid_amount: 0,
          purchaseDueAmount: 4100,
          purchase_due_amount: 4100,
          purchasePaymentStatus: "due",
          purchase_payment_status: "due",
          createdAt: `${date}T12:00:00.000`,
          created_at: `${date}T12:00:00.000`,
          sync_status: "pending_sync",
        },
      ],
    });

    expect(snapshot.supplierDueRows).toHaveLength(1);
    expect(snapshot.supplierDueRows[0]).toEqual(expect.objectContaining({
      source: "purchase_bill",
      invoiceNumber: "LPB-PAID-1",
      amount: 4100,
      paid: 4100,
      due: 0,
      status: "paid",
    }));
    expect(snapshot.supplierDue).toBe(0);
    expect(snapshot.purchaseDueToday).toBe(0);
  });
});

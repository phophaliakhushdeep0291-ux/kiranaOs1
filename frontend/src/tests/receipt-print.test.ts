import { describe, expect, it } from "vitest";
import { BillInputBillType, BillPaymentMode, type Bill, type Product } from "@/lib/api/client";
import { buildBillingReceiptHtml } from "@/features/billing/pages/billing-print";
import type { PrintableBill } from "@/features/billing/pages/billing-types";
import { buildBillPrintHtml, buildPrintableBillSnapshot } from "@/features/bills/print";

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: "product_1",
    name: "<Sugar & Tea>",
    defaultPricePerRateUnit: 50,
    rateUnit: "kg",
    ...overrides,
  };
}

describe("receipt printing", () => {
  it("renders a premium thermal receipt with shop, customer, item, and payment details", () => {
    const bill: PrintableBill = {
      billNo: "KOS-1001",
      createdAt: "2026-06-09T10:30:00.000Z",
      customerName: "Ramesh",
      customerMobile: "9876543210",
      items: [{ product: product(), quantity: 2, rate: 50, unit: "kg" }],
      subtotal: 100,
      discount: 5,
      total: 95,
      paid: 60,
      credit: 35,
      paymentMode: BillPaymentMode.cash,
      billType: BillInputBillType.normal_sale,
      payments: [
        { mode: BillPaymentMode.cash, amount: 40 },
        { mode: BillPaymentMode.upi, amount: 20 },
        { mode: BillPaymentMode.credit, amount: 35 },
      ],
      shop: {
        name: "Sharma General Store",
        address: "Shop 12, Main Market",
        city: "Indore",
        phone: "9999999999",
        gstNumber: "23ABCDE1234F1Z5",
        cashierName: "Khushdeep",
      },
    };

    const html = buildBillingReceiptHtml(bill);

    expect(html).toContain("@page { size: 80mm auto; margin: 4mm; }");
    expect(html).toContain("Sharma General Store");
    expect(html).toContain("GSTIN: 23ABCDE1234F1Z5");
    expect(html).toContain("Original customer copy");
    expect(html).toContain("Sale receipt");
    expect(html).toContain("&lt;Sugar &amp; Tea&gt;");
    expect(html).toContain("Cash");
    expect(html).toContain("UPI");
    expect(html).toContain("Udhar");
    expect(html).toContain("Rs 95");
    expect(html).not.toContain(String.fromCharCode(8377));
    expect(html).not.toContain("not a final bill"); // a real sale must not show the estimate marker
  });

  it("marks an estimate receipt with its own banner + EST number, not a sale label", () => {
    const bill: PrintableBill = {
      billNo: "EST-2026-000007",
      createdAt: "2026-06-09T10:30:00.000Z",
      customerName: "Ramesh",
      items: [{ product: product(), quantity: 2, rate: 50, unit: "kg" }],
      subtotal: 100,
      discount: 0,
      total: 100,
      paid: 0,
      credit: 0,
      paymentMode: BillPaymentMode.cash,
      billType: BillInputBillType.estimate,
      payments: [],
      shop: { name: "Sharma General Store" },
    };

    const html = buildBillingReceiptHtml(bill);

    expect(html).toContain('class="estimate-banner">Estimate'); // the banner element, not just the CSS rule
    expect(html).toContain("not a final bill");
    expect(html).toContain("EST-2026-000007");
    expect(html).not.toContain("Sale receipt");
  });

  it("does not double-count paid amount when duplicate print has bill and payment rows", () => {
    const bill: Bill = {
      id: "bill_1",
      billNo: "KOS-1002",
      billNumber: "KOS-1002",
      billType: "normal_sale",
      status: "paid",
      customerName: "Walk-in",
      subtotal: 500,
      discount: 0,
      grandTotal: 500,
      paidAmount: 500,
      creditAmount: 0,
      createdAt: "2026-06-09T11:00:00.000Z",
    };

    const snapshot = buildPrintableBillSnapshot(
      bill,
      [{ name: "Rice", quantity: 5, enteredUnit: "kg", ratePerRateUnit: 100, line_total: 500 }],
      [{ mode: "cash", amount: 500 }],
    );
    const html = buildBillPrintHtml(snapshot);

    expect(snapshot.paid).toBe(500);
    expect(snapshot.payments).toEqual([{ mode: "cash", amount: 500 }]);
    expect(html).toContain("Duplicate copy");
    expect(html).toContain("Rs 500");
    expect(html).not.toContain("Rs 1,000");
  });
});

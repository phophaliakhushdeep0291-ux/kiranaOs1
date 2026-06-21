import { describe, expect, it } from "vitest";
import {
  billRecordToShareInput,
  buildBillReceiptText,
  buildWhatsappShareUrl,
  derivePaymentModeLabel,
  normalizeWhatsappNumber,
} from "@/features/bills/share";

describe("normalizeWhatsappNumber", () => {
  it("prefixes 91 to a bare 10-digit Indian mobile", () => {
    expect(normalizeWhatsappNumber("9876543210")).toBe("919876543210");
  });
  it("strips a leading 0", () => {
    expect(normalizeWhatsappNumber("09876543210")).toBe("919876543210");
  });
  it("keeps an already country-coded number", () => {
    expect(normalizeWhatsappNumber("919876543210")).toBe("919876543210");
    expect(normalizeWhatsappNumber("+91 98765 43210")).toBe("919876543210");
  });
  it("returns empty for missing/blank", () => {
    expect(normalizeWhatsappNumber("")).toBe("");
    expect(normalizeWhatsappNumber(undefined)).toBe("");
  });
});

describe("derivePaymentModeLabel", () => {
  it("labels full credit as Udhar", () => {
    expect(derivePaymentModeLabel([{ mode: "credit" }], 200, 200)).toBe("Udhar");
  });
  it("labels mixed tender + credit as Split", () => {
    expect(derivePaymentModeLabel([{ mode: "cash" }, { mode: "credit" }], 50, 200)).toBe("Split");
  });
  it("labels single tender", () => {
    expect(derivePaymentModeLabel([{ mode: "upi" }], 0, 200)).toBe("UPI");
    expect(derivePaymentModeLabel([{ mode: "cash" }], 0, 200)).toBe("Cash");
  });
});

describe("buildBillReceiptText", () => {
  const input = {
    shopName: "Sharma General Store",
    shopLocation: "Main Market",
    billNo: "KOS-2026-000042",
    dateIso: "2026-06-21T10:00:00.000Z",
    items: [
      { name: "Aashirvaad Atta 5kg", quantity: 1, rate: 265, lineTotal: 265 },
      { name: "Basmati Rice 1kg", quantity: 2, rate: 118, lineTotal: 236 },
    ],
    total: 501,
    paid: 501,
    credit: 0,
    paymentMode: "Cash",
  };

  it("includes shop, bill no, items, total and paid", () => {
    const text = buildBillReceiptText(input);
    expect(text).toContain("*Sharma General Store*");
    expect(text).toContain("Bill KOS-2026-000042");
    expect(text).toContain("• Aashirvaad Atta 5kg — 1 × ₹265 = ₹265");
    expect(text).toContain("• Basmati Rice 1kg — 2 × ₹118 = ₹236");
    expect(text).toContain("*Total: ₹501*");
    expect(text).toContain("Paid: ₹501 (Cash)");
    expect(text).not.toContain("Udhar baki");
  });

  it("shows Udhar baki only when there is credit", () => {
    const text = buildBillReceiptText({ ...input, paid: 300, credit: 201, paymentMode: "Split" });
    expect(text).toContain("Udhar baki: ₹201");
  });

  it("formats non-integer money with two decimals", () => {
    const text = buildBillReceiptText({ ...input, total: 99.5, items: [], paid: 99.5 });
    expect(text).toContain("*Total: ₹99.50*");
  });
});

describe("buildWhatsappShareUrl", () => {
  const base = { shopName: "S", billNo: "B1", items: [], total: 100, paid: 100, credit: 0 };

  it("targets the customer number when present", () => {
    const url = buildWhatsappShareUrl({ ...base, customerMobile: "9876543210" });
    expect(url.startsWith("https://wa.me/919876543210?text=")).toBe(true);
  });
  it("falls back to the chat picker with no number", () => {
    const url = buildWhatsappShareUrl(base);
    expect(url.startsWith("https://wa.me/?text=")).toBe(true);
  });
  it("url-encodes the receipt body", () => {
    const url = buildWhatsappShareUrl(base);
    expect(url).toContain("%F0%9F%A7%BE"); // 🧾 encoded
    expect(url).not.toContain("\n");
  });
});

describe("billRecordToShareInput", () => {
  it("maps snake/camel bill fields and marks returns", () => {
    const input = billRecordToShareInput(
      { billNo: "KOS-1", billType: "sales_return", grandTotal: -50, creditAmount: 0, paidAmount: -50, customer_mobile: "9123456780", created_at: "2026-06-21T00:00:00Z" },
      { items: [{ name: "Rice", quantity: 1, rate: 50, line_total: 50 }], shopName: "My Kirana" },
    );
    expect(input.isReturn).toBe(true);
    expect(input.billNo).toBe("KOS-1");
    expect(input.customerMobile).toBe("9123456780");
    expect(input.items).toHaveLength(1);
    // money helper takes absolute value, so the return still reads cleanly
    expect(buildBillReceiptText(input)).toContain("*Total: ₹50*");
  });
});

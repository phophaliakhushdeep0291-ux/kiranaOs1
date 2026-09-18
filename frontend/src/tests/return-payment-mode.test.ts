import { describe, expect, it } from "vitest";
import { isSalesReturnBill, resolveBillPaymentMode } from "@/features/core/bills/payment-mode";
import { dedupeBillItemsForDisplay } from "@/features/core/sync/bill-reconciliation";

describe("return payment display", () => {
  it("recognizes negative return-line echoes without dropping genuine equal lines", () => {
    const local = { id: "local_item", productId: "sugar", name: "Sugar", quantity: -1, ratePerRateUnit: 20, lineTotal: -20 };
    const server = { ...local, id: "server_item", server_id: "server_item", sync_status: "synced" };
    expect(dedupeBillItemsForDisplay([local, server], -20)).toHaveLength(1);
    expect(dedupeBillItemsForDisplay([local, server], 20)).toHaveLength(1);
    expect(dedupeBillItemsForDisplay([local, server], -40)).toHaveLength(2);
  });
  it("shows debt reductions as credit refunds even without a tender payment", () => {
    const bill = { billType: "sales_return", grandTotal: -20, refundMode: "udhar", creditAmount: 0, payments: [] };
    expect(isSalesReturnBill(bill)).toBe(true);
    expect(resolveBillPaymentMode(bill)).toBe("udhar");
  });
  it.each(["upi", "bank", "cash"])("reads negative %s tender on older return records", (mode) => {
    expect(resolveBillPaymentMode({ bill_type: "sales_return", payments: [{ amount: -20, mode }] })).toBe(mode);
  });
  it("preserves store credit and the ordinary sale's credit status", () => {
    expect(resolveBillPaymentMode({ billType: "sales_return", refundMode: "gift_card" })).toBe("gift_card");
    expect(resolveBillPaymentMode({ billType: "normal_sale", creditAmount: 20 })).toBe("udhar");
    expect(isSalesReturnBill({ billType: "normal_sale" })).toBe(false);
  });
});

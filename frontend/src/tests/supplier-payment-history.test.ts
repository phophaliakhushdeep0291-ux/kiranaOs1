import { describe, expect, it, vi } from "vitest";
const rows = vi.hoisted(() => ({ payments: [] as Record<string, unknown>[], purchase_bills: [] as Record<string, unknown>[] }));
vi.mock("@/lib/offline/db", () => ({
  filterRowsForCurrentScope: (values: unknown[]) => values,
  offlineDB: { getAll: async (table: keyof typeof rows) => rows[table] ?? [] },
}));
import { listSupplierPaymentsLocal } from "@/features/core/purchases/local-actions";

describe("supplier payment history after device recovery", () => {
  it("shows cloud payments and their reversal status without local payment rows", async () => {
    rows.payments = [];
    rows.purchase_bills = [{ id: "purchase-server", supplierPayments: [
      { id: "ledger-1", local_id: "payment-local", kind: "supplier_payment", amount: 250, mode: "upi", purchase_history_id: "purchase-server", paid_at: "2026-09-07" },
      { id: "ledger-2", kind: "supplier_payment", amount: -250, mode: "upi", purchase_history_id: "purchase-server", reverses_payment_id: "ledger-1", paid_at: "2026-09-08" },
      { id: "ledger-3", kind: "supplier_payment", amount: 250, mode: "cash", purchase_history_id: "purchase-server", paid_at: "2026-09-08" },
    ] }];
    const result = await listSupplierPaymentsLocal({ id: "purchase-local", purchaseKeys: ["purchase-server"], supplierId: "supplier-1", supplierName: "Supplier", invoiceNumber: "INV-1", date: "2026-09-07", amount: 1000, paid: 250, due: 750, paymentMode: "cash", status: "partial", source: "purchase_bill" });
    expect(result).toHaveLength(2);
    expect(result.find((row) => row.id === "ledger-1")?.status).toBe("reversed");
    expect(result.find((row) => row.id === "ledger-3")?.amount).toBe(250);
  });
});

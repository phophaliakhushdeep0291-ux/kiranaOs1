import { beforeEach, describe, expect, it, vi } from "vitest";
import { BillInputBillType, BillPaymentMode, type BillInput } from "@/types/api";

// The orchestration composes two ALREADY-tested primitives (createBillLocalFirst +
// cancelBillWithOwnerPinLocalFirst). These unit tests pin the composition itself:
// ordering, pre-validation, and that an add-on never voids. The real money/stock/
// udhar outcome of the resulting CREATE_BILL + CANCEL_BILL events is proven in the
// backend integration suite (sync.integration.test.js).

const h = vi.hoisted(() => ({
  bills: [] as Record<string, unknown>[],
  createBillLocalFirst: vi.fn(),
  cancelBillWithOwnerPinLocalFirst: vi.fn(),
}));

vi.mock("@/lib/offline/context", () => ({
  getOfflineScope: () => ({ tenant_id: "t1", store_id: "s1", device_id: "d1" }),
  nowIso: () => "2026-06-14T10:00:00.000Z",
}));
vi.mock("@/lib/offline/db", () => ({
  offlineDB: {
    getAll: vi.fn(async (table: string) => (table === "bills" ? [...h.bills] : [])),
  },
}));
vi.mock("@/lib/offline/instant-cache", () => ({
  readInstantCache: vi.fn(() => []),
  createLocalId: (prefix: string) => `${prefix}_id`,
}));
vi.mock("@/features/core/billing/local-actions", () => ({ createBillLocalFirst: h.createBillLocalFirst }));
vi.mock("@/features/core/bills/local-actions", () => ({ cancelBillWithOwnerPinLocalFirst: h.cancelBillWithOwnerPinLocalFirst }));

import {
  addItemsToFinalizedBillLocalFirst,
  billInputFromBill,
  computeBillInputTotal,
  editFinalizedBillLocalFirst,
} from "@/features/core/bills/edit-actions";

function activeBill(overrides: Record<string, unknown> = {}) {
  return {
    id: "bill_orig",
    clientBillId: "bill_orig",
    status: "active",
    billType: "normal_sale",
    gstMode: "inclusive",
    discount: 0,
    customerId: "cust1",
    customerName: "Ramesh",
    items: [{ name: "Sugar", quantity: 2, ratePerRateUnit: 50, enteredUnit: "kg", gstRate: 0 }],
    ...overrides,
  };
}

function replacement(overrides: Partial<BillInput> = {}): BillInput {
  return {
    billType: BillInputBillType.normal_sale,
    gstMode: "inclusive",
    customerId: "cust1",
    customerName: "Ramesh",
    discount: 0,
    items: [{ name: "Sugar", quantity: 3, enteredUnit: "kg", ratePerRateUnit: 50, gstRate: 0 }],
    actualAmount: 150,
    buyerPaidAmount: 150,
    payments: [{ mode: BillPaymentMode.cash, amount: 150 }],
    ...overrides,
  };
}

describe("edit after finalize (void + recreate) orchestration", () => {
  beforeEach(() => {
    h.bills.length = 0;
    h.createBillLocalFirst.mockReset();
    h.cancelBillWithOwnerPinLocalFirst.mockReset();
    let created = 0;
    h.createBillLocalFirst.mockImplementation(async (input: BillInput) => {
      created += 1;
      const id = `new_${created}`;
      return { id, billNo: `PENDING-${created}`, billNumber: `PENDING-${created}`, clientBillId: id, status: "pending_sync", __input: input };
    });
    h.cancelBillWithOwnerPinLocalFirst.mockImplementation(async (id: string, ownerPin: string, reason?: string) => ({
      id, status: "cancelled", __ownerPin: ownerPin, __reason: reason,
    }));
  });

  it("creates the corrected bill FIRST, then voids the original with the owner PIN", async () => {
    h.bills.push(activeBill());
    const result = await editFinalizedBillLocalFirst({
      originalBillId: "bill_orig",
      ownerPin: "1234",
      reason: "wrong quantity",
      replacement: replacement(),
    });

    expect(h.createBillLocalFirst).toHaveBeenCalledTimes(1);
    expect(h.cancelBillWithOwnerPinLocalFirst).toHaveBeenCalledTimes(1);
    expect(h.cancelBillWithOwnerPinLocalFirst).toHaveBeenCalledWith("bill_orig", "1234", expect.any(String));
    // Create must run before cancel so a bad replacement never voids the original.
    expect(h.createBillLocalFirst.mock.invocationCallOrder[0])
      .toBeLessThan(h.cancelBillWithOwnerPinLocalFirst.mock.invocationCallOrder[0]);
    // The replacement is a brand-new bill with its OWN client identity (the orchestration
    // never reuses the original's), so it can't collapse into the original on sync.
    expect(result.created.clientBillId).toBe("new_1");
    expect(result.created.clientBillId).not.toBe("bill_orig");
    expect(result.cancelled.status).toBe("cancelled");
  });

  it("a malformed owner PIN voids nothing and creates nothing (pre-flight before any write)", async () => {
    h.bills.push(activeBill());
    await expect(editFinalizedBillLocalFirst({ originalBillId: "bill_orig", ownerPin: "12", replacement: replacement() }))
      .rejects.toThrow();
    expect(h.createBillLocalFirst).not.toHaveBeenCalled();
    expect(h.cancelBillWithOwnerPinLocalFirst).not.toHaveBeenCalled();
  });

  it("editing a missing bill creates and cancels nothing", async () => {
    await expect(editFinalizedBillLocalFirst({ originalBillId: "ghost", ownerPin: "1234", replacement: replacement() }))
      .rejects.toThrow(/not found/i);
    expect(h.createBillLocalFirst).not.toHaveBeenCalled();
    expect(h.cancelBillWithOwnerPinLocalFirst).not.toHaveBeenCalled();
  });

  it("refuses to edit an already-cancelled bill", async () => {
    h.bills.push(activeBill({ status: "cancelled" }));
    await expect(editFinalizedBillLocalFirst({ originalBillId: "bill_orig", ownerPin: "1234", replacement: replacement() }))
      .rejects.toThrow(/already cancelled/i);
    expect(h.createBillLocalFirst).not.toHaveBeenCalled();
    expect(h.cancelBillWithOwnerPinLocalFirst).not.toHaveBeenCalled();
  });

  it("add-on creates a separate independent bill and voids nothing (no PIN)", async () => {
    h.bills.push(activeBill());
    const created = await addItemsToFinalizedBillLocalFirst({
      originalBillId: "bill_orig",
      addOn: replacement({ items: [{ name: "Salt", quantity: 1, enteredUnit: "kg", ratePerRateUnit: 20, gstRate: 0 }], payments: [{ mode: BillPaymentMode.cash, amount: 20 }], actualAmount: 20, buyerPaidAmount: 20 }),
    });

    expect(h.createBillLocalFirst).toHaveBeenCalledTimes(1);
    expect(h.cancelBillWithOwnerPinLocalFirst).not.toHaveBeenCalled();
    expect(created.clientBillId).toBe("new_1");
  });
});

describe("bill input reconstruction helpers", () => {
  it("billInputFromBill rebuilds items, customer, gst mode and a fully-paid cash default", () => {
    const input = billInputFromBill(
      { customerId: "c1", customerName: "Ramesh", gstMode: "inclusive", discount: 10, billType: "normal_sale" },
      [{ name: "Sugar", quantity: 2, rate_per_rate_unit: 50, entered_unit: "kg", gst_rate: 0 }],
    );
    expect(input.items).toEqual([{ productId: undefined, name: "Sugar", quantity: 2, enteredUnit: "kg", ratePerRateUnit: 50, gstRate: 0, wasPriceOverridden: false }]);
    expect(input.customerId).toBe("c1");
    expect(input.gstMode).toBe("inclusive");
    // total = 2*50 - 10 discount = 90, defaulted to a single full cash payment
    expect(input.payments).toEqual([{ mode: BillPaymentMode.cash, amount: 90 }]);
    expect(input.buyerPaidAmount).toBe(90);
  });

  it("computeBillInputTotal: inclusive keeps the entered price, exclusive adds GST, discount subtracts", () => {
    const items = [{ name: "x", quantity: 1, enteredUnit: "pc", ratePerRateUnit: 100, gstRate: 18 }];
    expect(computeBillInputTotal(items, 0, "inclusive")).toBe(100);
    expect(computeBillInputTotal(items, 0, "exclusive")).toBe(118);
    expect(computeBillInputTotal(items, 10, "inclusive")).toBe(90);
  });
});

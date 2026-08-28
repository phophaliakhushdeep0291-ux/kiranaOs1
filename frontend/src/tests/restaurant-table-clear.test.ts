import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HeldBill } from "@/features/core/billing/pages/billing-types";

const state = vi.hoisted(() => ({
  rows: new Map<string, unknown>(),
  updateOrder: vi.fn(),
  listTickets: vi.fn(),
  voidTicket: vi.fn(),
}));

vi.mock("@/lib/offline/db", () => ({
  offlineDB: {
    getSetting: vi.fn(async (key: string) => structuredClone(state.rows.get(key) ?? null)),
    transaction: vi.fn(async (_stores: string[], work: (tx: { setSetting: (key: string, value: unknown) => Promise<void> }) => Promise<unknown>) => {
      const before = structuredClone(state.rows);
      try {
        return await work({ setSetting: async (key, value) => { state.rows.set(key, structuredClone(value)); } });
      } catch (error) {
        state.rows = before;
        throw error;
      }
    }),
  },
}));

vi.mock("@/features/core/orders/api", () => ({ updateCustomerOrder: state.updateOrder }));
vi.mock("@/features/verticals/restaurant/service/restaurant-api", () => ({
  listKitchenTickets: state.listTickets,
  voidKitchenTicket: state.voidTicket,
}));

const { BILLING_DRAFT_KEY, HELD_BILLS_KEY } = await import("@/features/core/billing/pages/open-bills");
const { TABLE_BILLS_KEY } = await import("@/features/verticals/restaurant/service/table-store");
const { cancelAndReleaseTable } = await import("@/features/verticals/restaurant/service/open-table");

const guestBill = {
  id: "bill-t1",
  label: "T1 • table",
  createdAt: "2026-08-28T10:00:00.000Z",
  cart: [{
    product: { id: "dish-1", name: "Dal Fry" },
    quantity: 1,
    rate: 180,
    unit: "plate",
    guestOrderId: "order-1",
    guestOrderLineId: "order-1-0",
  }],
} as HeldBill;

beforeEach(() => {
  state.rows.clear();
  state.rows.set(HELD_BILLS_KEY, [guestBill]);
  state.rows.set(TABLE_BILLS_KEY, { "table-1": guestBill.id });
  state.rows.set(BILLING_DRAFT_KEY, { activeBillId: guestBill.id, cart: guestBill.cart });
  state.updateOrder.mockReset().mockResolvedValue({ id: "order-1", status: "cancelled" });
  state.listTickets.mockReset().mockResolvedValue([{ id: "kot-1", billId: guestBill.id }]);
  state.voidTicket.mockReset().mockResolvedValue({ id: "kot-1", deleted: true });
});

describe("clearing restaurant table service", () => {
  it("cancels guest work and recalls the KOT before removing the local bill", async () => {
    const result = await cancelAndReleaseTable("table-1");
    expect(state.updateOrder).toHaveBeenCalledWith("order-1", { status: "cancelled" });
    expect(state.voidTicket).toHaveBeenCalledWith("kot-1");
    expect(result).toEqual({ cancelledOrders: 1, voidedTickets: 1 });
    expect(state.rows.get(HELD_BILLS_KEY)).toEqual([]);
    expect(state.rows.get(TABLE_BILLS_KEY)).toEqual({});
    expect(state.rows.get(BILLING_DRAFT_KEY)).toEqual({});
  });

  it("keeps the table and bill intact when server cancellation fails", async () => {
    state.updateOrder.mockRejectedValueOnce(new Error("Connection lost"));
    await expect(cancelAndReleaseTable("table-1")).rejects.toThrow("Connection lost");
    expect(state.voidTicket).not.toHaveBeenCalled();
    expect(state.rows.get(HELD_BILLS_KEY)).toEqual([guestBill]);
    expect(state.rows.get(TABLE_BILLS_KEY)).toEqual({ "table-1": guestBill.id });
  });
});

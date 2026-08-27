import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomerOrder } from "@/features/core/orders/api";
import type { Product } from "@/types/api";
import type { HeldBill } from "@/features/core/billing/pages/billing-types";

const state = vi.hoisted(() => ({ rows: new Map<string, unknown>(), failKey: "", queue: Promise.resolve(), update: vi.fn() }));
vi.mock("@/features/core/orders/api", () => ({ updateCustomerOrder: state.update }));
vi.mock("@/lib/offline/db", () => ({ offlineDB: {
  getSetting: async (key: string) => structuredClone(state.rows.get(key) ?? null),
  transaction: async (_stores: string[], work: (tx: { setSetting: (key: string, value: unknown) => Promise<void> }) => Promise<unknown>) => {
    const operation = state.queue.then(async () => {
      const before = structuredClone(state.rows);
      try {
        return await work({ setSetting: async (key, value) => {
          if (key === state.failKey) throw new Error("Disk full");
          state.rows.set(key, structuredClone(value));
        } });
      } catch (error) { state.rows = before; throw error; }
    });
    state.queue = operation.then(() => undefined, () => undefined);
    return operation;
  },
} }));
import { acceptGuestOrderToTable, loadPendingGuestOrders, mergeCartLines, guestOrderCartLines, PENDING_GUEST_ORDERS_KEY, ACCEPTED_GUEST_ORDERS_KEY } from "@/features/verticals/restaurant/service/guest-orders";
import { HELD_BILLS_KEY } from "@/features/core/billing/pages/open-bills";
import { TABLE_BILLS_KEY } from "@/features/verticals/restaurant/service/table-store";

const table = { id: "t1", name: "T1", section: "Main", seats: 4 };
const products = [{ id: "p1", name: "Dosa", rateUnit: "plate", defaultPricePerRateUnit: 150 }] as Product[];
const order = { id: "o1", shopId: "s1", status: "new", fulfillmentType: "dine_in", tableId: "t1", note: "Serve together",
  items: [{ productId: "p1", name: "Dosa", unit: "plate", price: 120, qty: 2, note: "No chilli" }] } as CustomerOrder;
const bills = () => state.rows.get(HELD_BILLS_KEY) as HeldBill[];

beforeEach(() => { state.rows.clear(); state.failKey = ""; state.queue = Promise.resolve(); state.update.mockReset().mockResolvedValue({ status: "accepted" }); });

describe("durable guest acceptance", () => {
  it("claims before saving a bill and commits the table and marker together", async () => {
    state.update.mockImplementation(async () => { expect(bills()).toBeUndefined(); return { status: "accepted" }; });
    await acceptGuestOrderToTable(order, table, products);
    expect(bills()[0].cart[0]).toMatchObject({ quantity: 2, rate: 120, note: "No chilli — Serve together", manualRate: true });
    expect(state.rows.get(TABLE_BILLS_KEY)).toEqual({ t1: bills()[0].id });
    expect(state.rows.get(ACCEPTED_GUEST_ORDERS_KEY)).toEqual(["o1"]);
    expect(await loadPendingGuestOrders()).toEqual([]);
  });
  it("does not add food when server acceptance fails", async () => {
    state.update.mockRejectedValue(new Error("Already cancelled"));
    await expect(acceptGuestOrderToTable(order, table, products)).rejects.toThrow("Already cancelled");
    expect(bills()).toBeUndefined();
  });
  it("retains the same claim key across a lost response and retry", async () => {
    state.update.mockRejectedValueOnce(new Error("Connection lost"));
    await expect(acceptGuestOrderToTable(order, table, products)).rejects.toThrow();
    expect(await loadPendingGuestOrders()).toHaveLength(1);
    await acceptGuestOrderToTable(order, table, products);
    expect(state.update.mock.calls[0][1].acceptanceKey).toBe(state.update.mock.calls[1][1].acceptanceKey);
    expect(bills()[0].cart[0].quantity).toBe(2);
  });
  it("rolls back all bill writes on storage failure, then recovers once", async () => {
    state.failKey = TABLE_BILLS_KEY;
    await expect(acceptGuestOrderToTable(order, table, products)).rejects.toThrow("Disk full");
    expect(bills()).toBeUndefined();
    expect(state.rows.get(ACCEPTED_GUEST_ORDERS_KEY)).toBeUndefined();
    expect(await loadPendingGuestOrders()).toHaveLength(1);
    state.failKey = "";
    await acceptGuestOrderToTable(order, table, products);
    await acceptGuestOrderToTable(order, table, products);
    expect(bills()[0].cart[0].quantity).toBe(2);
  });
  it("does not contact the server if the journal cannot be saved", async () => {
    state.failKey = PENDING_GUEST_ORDERS_KEY;
    await expect(acceptGuestOrderToTable(order, table, products)).rejects.toThrow();
    expect(state.update).not.toHaveBeenCalled();
  });
  it("refuses partial imports", async () => {
    await expect(acceptGuestOrderToTable(order, table, [])).rejects.toThrow("Refresh the catalogue");
    expect(state.update).not.toHaveBeenCalled();
  });
  it("simultaneous retries produce one local import", async () => {
    await Promise.all([acceptGuestOrderToTable(order, table, products), acceptGuestOrderToTable(order, table, products)]);
    expect(bills()[0].cart[0].quantity).toBe(2);
    expect(new Set(state.update.mock.calls.map((call) => call[1].acceptanceKey)).size).toBe(1);
  });
  it("keeps differently instructed or priced rounds apart", () => {
    const first = guestOrderCartLines(order, products).lines;
    const second = guestOrderCartLines({ ...order, note: "Bring later" }, products).lines;
    expect(mergeCartLines(first, second)).toHaveLength(2);
    expect(mergeCartLines(first, first)[0].quantity).toBe(4);
  });
});

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
import { BILLING_DRAFT_KEY, HELD_BILLS_KEY, MAX_OPEN_BILLS } from "@/features/core/billing/pages/open-bills";
import { TABLE_BILLS_KEY } from "@/features/verticals/restaurant/service/table-store";

const table = { id: "t1", name: "T1", section: "Main", seats: 4 };
const products = [{ id: "p1", name: "Dosa", rateUnit: "plate", defaultPricePerRateUnit: 150 }] as Product[];
const order = { id: "o1", shopId: "s1", status: "new", fulfillmentType: "dine_in", tableId: "t1", note: "Serve together",
  items: [{ productId: "p1", name: "Dosa", unit: "plate", price: 120, qty: 2, note: "No chilli" }] } as CustomerOrder;
const bills = () => state.rows.get(HELD_BILLS_KEY) as HeldBill[];

beforeEach(() => { state.rows.clear(); state.failKey = ""; state.queue = Promise.resolve(); state.update.mockReset().mockResolvedValue({ ...order, status: "accepted" }); });

describe("durable guest acceptance", () => {
  it("uses the accepted snapshot after cancellation instead of the stale inbox", async () => {
    const stale = { ...order, items: [...order.items, { ...order.items[0], name: "Second dosa", qty: 3 }] };
    state.update.mockResolvedValue({ ...stale, status: "accepted", items: [{ ...stale.items[1], qty: 2, lineId: "o1-1", cancelledQty: 1 }] });
    await acceptGuestOrderToTable(stale, table, products);
    expect(bills()[0].cart).toHaveLength(1);
    expect(bills()[0].cart[0]).toMatchObject({ quantity: 2, guestOrderLineId: "o1-1" });
  });
  it("does not import an old quote if server confirmation is incomplete", async () => {
    state.update.mockResolvedValue({ status: "accepted" });
    await expect(acceptGuestOrderToTable(order, table, products)).rejects.toThrow("Could not confirm");
    expect(bills()).toBeUndefined();
    expect(await loadPendingGuestOrders()).toHaveLength(1);
  });
  it("claims before saving a bill and commits the table and marker together", async () => {
    state.update.mockImplementation(async () => { expect(bills()).toBeUndefined(); return { ...order, status: "accepted" }; });
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
  it("retires a pending operation only after a definitive claim rejection", async () => {
    state.update.mockRejectedValue(Object.assign(new Error("Already handled"), { status: 409, data: { code: "ORDER_ALREADY_CLAIMED" } }));
    await expect(acceptGuestOrderToTable(order, table, products)).rejects.toThrow();
    expect(await loadPendingGuestOrders()).toEqual([]);
    expect(bills()).toBeUndefined();
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
  it("never evicts another table at the open-bill limit", async () => {
    state.rows.set(HELD_BILLS_KEY, Array.from({ length: MAX_OPEN_BILLS }, (_, i) => ({ id: `held-${i}`, cart: [] })));
    await expect(acceptGuestOrderToTable(order, table, products)).rejects.toThrow("open-bill limit");
    expect(bills()).toHaveLength(MAX_OPEN_BILLS);
    expect(state.update).not.toHaveBeenCalled();
  });
  it("merges another QR round into the active table draft without a park/reopen dance", async () => {
    state.rows.set(TABLE_BILLS_KEY, { t1: "active" });
    state.rows.set(HELD_BILLS_KEY, [{ id: "active", label: "T1", createdAt: new Date().toISOString(), cart: [] }]);
    state.rows.set(BILLING_DRAFT_KEY, { activeBillId: "active", cart: [] });
    await acceptGuestOrderToTable(order, table, products);
    expect((state.rows.get(BILLING_DRAFT_KEY) as { cart: unknown[] }).cart).toHaveLength(1);
    expect((state.rows.get(BILLING_DRAFT_KEY) as { activeBillId: string }).activeBillId).toBe("active");
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

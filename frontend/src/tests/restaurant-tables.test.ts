import { describe, expect, it } from "vitest";
import type { CartItem, HeldBill } from "@/features/core/billing/pages/billing-types";
import {
  buildKotTicket, buildOccupancy, cartRunningTotal, kitchenFireIdempotencyKey, nextKotStatus, pendingKotLines,
  pruneKotTickets, reconcileTableBills, withLiveDraft,
  type KotTicket, type RestaurantTable,
} from "@/features/verticals/restaurant/service/table-store";

function line(name: string, quantity: number, rate: number, note?: string): CartItem {
  return {
    product: { id: `p-${name}`, name } as CartItem["product"],
    quantity,
    rate,
    unit: "plate",
    note,
  };
}

function bill(id: string, cart: CartItem[]): HeldBill {
  return { id, label: `${id} • table`, createdAt: new Date().toISOString(), cart };
}

const T3: RestaurantTable = { id: "table-3", name: "T3", section: "Dining", seats: 4 };

describe("restaurant tables", () => {
  it("counts a table's running total from its parked cart, net of line discounts", () => {
    expect(cartRunningTotal([line("Paneer", 1, 240), line("Naan", 2, 45)])).toBe(330);
    expect(cartRunningTotal([{ ...line("Paneer", 1, 240), lineDiscount: 40 }])).toBe(200);
    expect(cartRunningTotal(undefined)).toBe(0);
    expect(cartRunningTotal([{ ...line("Burger", 2, 150), addons: [{ optionId: "cheese", groupName: "Extras", name: "Cheese", price: 25 }] }])).toBe(350);
  });

  it("fires only what the kitchen has not been told about", () => {
    const cart = [line("Paneer", 1, 240), line("Naan", 2, 45)];
    const first = pendingKotLines(cart, []);
    expect(first.map((l) => `${l.qty}x ${l.name}`)).toEqual(["1x Paneer", "2x Naan"]);

    const ticket = buildKotTicket(T3, "bill-1", first, []);
    // A third naan is added after the first ticket: the kitchen must hear about
    // one naan, not three, and must not be re-told about the paneer.
    const grown = [line("Paneer", 1, 240), line("Naan", 3, 45)];
    expect(pendingKotLines(grown, [ticket]).map((l) => `${l.qty}x ${l.name}`)).toEqual(["1x Naan"]);

    // Nothing new to say once the ticket covers the whole cart.
    expect(pendingKotLines(cart, [ticket])).toEqual([]);
  });

  it("carries the line note through to the ticket, since that is the instruction", () => {
    const [pending] = pendingKotLines([line("Paneer", 1, 240, "less spicy")], []);
    expect(pending.note).toBe("less spicy");
    const [configured] = pendingKotLines([{
      ...line("Burger", 1, 150, "well done"),
      addons: [{ optionId: "cheese", groupName: "Extras", name: "Cheese", price: 25, quantity: 2 }],
    }], []);
    expect(configured.note).toBe("2× Cheese · well done");
  });

  it("frees a table whose bill was settled, and one left holding an emptied cart", () => {
    const map = { "table-3": "bill-1", "table-4": "bill-2", "table-5": "bill-3" };
    const held = [bill("bill-2", []), bill("bill-3", [line("Chai", 1, 30)])];

    // bill-1 is gone (settled and pruned); bill-2 is still listed but empty,
    // which is what the till leaves behind after a table pays.
    expect(reconcileTableBills(map, held)).toEqual({ "table-5": "bill-3" });
  });

  it("keeps a just-seated table whose cart is still empty", () => {
    const map = { "table-3": "bill-1" };
    const held = [bill("bill-1", [])];
    expect(reconcileTableBills(map, held, "bill-1")).toEqual({ "table-3": "bill-1" });
    expect(reconcileTableBills(map, held, "bill-other")).toEqual({});
  });

  it("scopes fired items to one sitting, so a re-seated table still reaches the kitchen", () => {
    const served = buildKotTicket(T3, "bill-old", [{ key: "k", name: "Naan", qty: 2, unit: "piece" }], []);
    const cart = [line("Naan", 2, 45)];
    const [row] = buildOccupancy([T3], [bill("bill-new", cart)], { "table-3": "bill-new" }, [served]);

    // The previous party's ticket must not silence the new one's order.
    expect(row.tickets).toEqual([]);
    expect(row.pendingKotLines.map((l) => l.name)).toEqual(["Naan"]);
  });

  it("shows the table being rung up from the live draft, not its stale parked copy", () => {
    const parked = [bill("bill-1", [])];
    const draft = { activeBillId: "bill-1", cart: [line("Paneer", 1, 240)] };
    const [row] = buildOccupancy(
      [T3], withLiveDraft(parked, draft), { "table-3": "bill-1" }, [],
    );
    expect(row.items).toBe(1);
    expect(row.runningTotal).toBe(240);
  });

  it("numbers tickets in sequence and walks each one to served", () => {
    const first = buildKotTicket(T3, "bill-1", [], []);
    const second = buildKotTicket(T3, "bill-1", [], [first]);
    expect([first.ticketNo, second.ticketNo]).toEqual([1, 2]);

    expect(nextKotStatus("new")).toBe("preparing");
    expect(nextKotStatus("preparing")).toBe("ready");
    expect(nextKotStatus("ready")).toBe("served");
    expect(nextKotStatus("served")).toBeNull();
  });

  it("uses one kitchen idempotency key for the same round across taps and tills", () => {
    const lines = pendingKotLines([line("Paneer", 1, 240), line("Naan", 2, 45)], []);
    const reordered = [...lines].reverse();
    expect(kitchenFireIdempotencyKey("bill-1", lines)).toBe(kitchenFireIdempotencyKey("bill-1", reordered));
    expect(kitchenFireIdempotencyKey("bill-1", lines)).not.toBe(
      kitchenFireIdempotencyKey("bill-1", [{ ...lines[0], qty: 2 }, lines[1]]),
    );
    expect(kitchenFireIdempotencyKey("bill-1", lines).length).toBeLessThanOrEqual(120);
  });

  it("drops day-old tickets so the pass shows work, not history", () => {
    const now = Date.now();
    const stale = { ...buildKotTicket(T3, "b", [], []), createdAt: new Date(now - 25 * 3600_000).toISOString() };
    const fresh = buildKotTicket(T3, "b", [], []);
    expect(pruneKotTickets([stale, fresh] as KotTicket[], now).map((t) => t.id)).toEqual([fresh.id]);
  });
});

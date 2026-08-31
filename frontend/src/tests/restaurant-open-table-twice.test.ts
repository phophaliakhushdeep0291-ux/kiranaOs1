import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BillingDraft, HeldBill } from "@/features/core/billing/pages/billing-types";

/**
 * Opening the same table twice.
 *
 * A waiter seats a party, opens the table, is called away before keying
 * anything, and opens it again. The bill they left behind has an empty cart,
 * which everywhere else means "settled, free the table" — everywhere except
 * for the one table currently loaded at the till, which is exactly this one.
 *
 * Reconciling without naming it therefore threw it away and a second bill was
 * started for the same table: two "T1 • table" entries in the open-bills
 * switcher, the first orphaned with no table pointing at it, and a real chance
 * of the party's food being split across both. TablesPage always passed the
 * active bill id; `openTableInBilling` did not.
 */

const settings = new Map<string, unknown>();

vi.mock("@/lib/offline/db", () => ({
  offlineDB: {
    getSetting: vi.fn(async (key: string) => (settings.has(key) ? settings.get(key) : null)),
    setSetting: vi.fn(async (key: string, value: unknown) => {
      settings.set(key, value);
    }),
    delete: vi.fn(async (_store: string, key: string) => {
      settings.delete(key);
    }),
  },
}));

const { BILLING_DRAFT_KEY, HELD_BILLS_KEY } = await import("@/features/core/billing/pages/open-bills");
const { TABLE_BILLS_KEY } = await import("@/features/verticals/restaurant/service/table-store");
const { openTableInBilling } = await import("@/features/verticals/restaurant/service/open-table");

const TABLE = { id: "table-1", name: "T1", section: "Dining", seats: 4 };

beforeEach(() => settings.clear());

describe("seating a table twice", () => {
  it("reopens the bill it already has rather than starting a second one", async () => {
    const first = await openTableInBilling(TABLE);
    // Called away before keying anything: the cart is still empty.
    const second = await openTableInBilling(TABLE);

    expect(second.id).toBe(first.id);
    expect(settings.get(HELD_BILLS_KEY)).toHaveLength(1);
    expect((settings.get(TABLE_BILLS_KEY) as Record<string, string>)[TABLE.id]).toBe(first.id);
  });

  it("does not leave an orphaned bill in the switcher", async () => {
    await openTableInBilling(TABLE);
    await openTableInBilling(TABLE);

    const held = settings.get(HELD_BILLS_KEY) as HeldBill[];
    const map = settings.get(TABLE_BILLS_KEY) as Record<string, string>;
    const pointedAt = new Set(Object.values(map));
    // Every open bill belongs to a table. Nothing is stranded.
    expect(held.every((bill) => pointedAt.has(bill.id))).toBe(true);
  });

  // A table's tab belongs to the floor screen, not to the counter's open-bills
  // strip: the strip filters on this tag, so if it is missing every seated table
  // shows up beside the walk-ins waiting to pay.
  it("marks the bill as the table's tab", async () => {
    const bill = await openTableInBilling(TABLE);
    expect(bill.tableId).toBe(TABLE.id);
    expect((settings.get(HELD_BILLS_KEY) as HeldBill[])[0].tableId).toBe(TABLE.id);
    expect((settings.get(BILLING_DRAFT_KEY) as BillingDraft).tableId).toBe(TABLE.id);
  });

  // Tabs parked by an older build carry no tag. Left alone they would read as
  // counter bills for the rest of their life, which is the whole problem again
  // for every table already seated when the till updates.
  it("adopts a tab parked before bills knew their table", async () => {
    const legacy: HeldBill = {
      id: "bill-legacy", label: `${TABLE.name} • table`, createdAt: new Date().toISOString(),
      cart: [{ product: { id: "p-naan", name: "Butter Naan" }, quantity: 1, rate: 45, unit: "piece" }],
      selectedCustomerId: "walk_in", customerName: TABLE.name,
    } as HeldBill;
    settings.set(HELD_BILLS_KEY, [legacy]);
    settings.set(TABLE_BILLS_KEY, { [TABLE.id]: legacy.id });

    const reopened = await openTableInBilling(TABLE);

    expect(reopened.id).toBe(legacy.id);
    expect(reopened.tableId).toBe(TABLE.id);
    expect((settings.get(HELD_BILLS_KEY) as HeldBill[])).toHaveLength(1);
    expect((settings.get(HELD_BILLS_KEY) as HeldBill[])[0].tableId).toBe(TABLE.id);
    // And the food it was holding is still on it.
    expect(reopened.cart).toHaveLength(1);
  });

  it("still parks the cart of whatever table was open before", async () => {
    const other = await openTableInBilling({ ...TABLE, id: "table-7", name: "T7" });
    // The counter keys a dish into T7; the workspace holds it, the parked set
    // does not yet.
    settings.set(BILLING_DRAFT_KEY, {
      ...(settings.get(BILLING_DRAFT_KEY) as BillingDraft),
      cart: [{ product: { id: "p-dal", name: "Dal Fry" }, quantity: 1, rate: 180, unit: "piece" }],
    } as BillingDraft);

    await openTableInBilling(TABLE);

    const held = settings.get(HELD_BILLS_KEY) as HeldBill[];
    const parked = held.find((bill) => bill.id === other.id);
    expect(parked?.cart).toHaveLength(1);
    // And the workspace has moved to T1.
    expect((settings.get(BILLING_DRAFT_KEY) as BillingDraft).activeBillId).not.toBe(other.id);
  });
});

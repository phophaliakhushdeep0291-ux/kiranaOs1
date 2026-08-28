import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CartItem, HeldBill } from "@/features/core/billing/pages/billing-types";

/**
 * A floor busier than the till's open-bill cap.
 *
 * `upsertOpenBill` enforces the cap by dropping the oldest entry. On a full
 * floor that entry is another table's running order — seated, eaten, and now
 * unbillable, while the table -> bill map still points at a bill that no longer
 * exists, so that table reconciles away and reads as free. Guest-order
 * acceptance already guarded this; seating from the floor screen did not.
 *
 * Refusing is recoverable. Losing an order silently is not.
 */

const settings = new Map<string, unknown>();

vi.mock("@/lib/offline/db", () => ({
  offlineDB: {
    getSetting: vi.fn(async (key: string) => (settings.has(key) ? settings.get(key) : null)),
    setSetting: vi.fn(async (key: string, value: unknown) => { settings.set(key, value); }),
    delete: vi.fn(async (_s: string, key: string) => { settings.delete(key); }),
  },
}));

const { HELD_BILLS_KEY, MAX_OPEN_BILLS } = await import("@/features/core/billing/pages/open-bills");
const { TABLE_BILLS_KEY } = await import("@/features/verticals/restaurant/service/table-store");
const { openTableInBilling } = await import("@/features/verticals/restaurant/service/open-table");

const line = (name: string): CartItem =>
  ({ product: { id: `p-${name}`, name }, quantity: 1, rate: 100, unit: "piece" }) as CartItem;

beforeEach(() => settings.clear());

describe("a floor busier than the open-bill cap", () => {
  it("keeps every seated table's order when one more table is seated", async () => {
    const seated: Array<{ id: string; billId: string }> = [];

    // Seat MAX_OPEN_BILLS tables and key a dish into each, so every one of them
    // is a real running order rather than an empty placeholder.
    for (let i = 1; i <= MAX_OPEN_BILLS; i += 1) {
      const table = { id: `table-${i}`, name: `T${i}`, section: "Dining", seats: 4 };
      const bill = await openTableInBilling(table);
      const held = (settings.get(HELD_BILLS_KEY) as HeldBill[]).map((entry) =>
        entry.id === bill.id ? { ...entry, cart: [line(`dish-${i}`)] } : entry);
      settings.set(HELD_BILLS_KEY, held);
      seated.push({ id: table.id, billId: bill.id });
    }

    const before = settings.get(HELD_BILLS_KEY) as HeldBill[];
    expect(before).toHaveLength(MAX_OPEN_BILLS);

    // The next party walks in. The till has nowhere to put them, and says so.
    await expect(
      openTableInBilling({ id: "table-overflow", name: "T-overflow", section: "Dining", seats: 2 }),
    ).rejects.toThrow(/Settle or clear a table/);

    const after = settings.get(HELD_BILLS_KEY) as HeldBill[];
    const map = settings.get(TABLE_BILLS_KEY) as Record<string, string>;
    const survivors = new Set(after.map((bill) => bill.id));

    // Every table that was seated and has food on it still has its order, and
    // nothing is mapped to a bill that no longer exists.
    expect(seated.filter((row) => !survivors.has(row.billId))).toEqual([]);
    expect(after).toHaveLength(MAX_OPEN_BILLS);
    expect(map["table-overflow"]).toBeUndefined();
    for (const row of seated) expect(map[row.id]).toBe(row.billId);
  });
});

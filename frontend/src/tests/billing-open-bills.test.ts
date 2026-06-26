import { describe, expect, it } from "vitest";
import { MAX_OPEN_BILLS, newBillId, upsertOpenBill } from "@/features/billing/pages/open-bills";
import type { HeldBill } from "@/features/billing/pages/billing-types";

function bill(id: string, items = 1): HeldBill {
  return {
    id,
    label: `${id} • ${items} items`,
    createdAt: new Date().toISOString(),
    cart: Array.from({ length: items }, () => ({})) as HeldBill["cart"],
  };
}

describe("open bills switcher helpers", () => {
  it("replaces a same-id bill in place (no duplicate, order preserved)", () => {
    const list = [bill("a", 1), bill("b", 2), bill("c", 3)];
    const next = upsertOpenBill(list, bill("b", 9));
    expect(next).toHaveLength(3);
    expect(next.map((entry) => entry.id)).toEqual(["a", "b", "c"]); // order kept
    expect(next[1].cart).toHaveLength(9); // updated content
    expect(next.filter((entry) => entry.id === "b")).toHaveLength(1); // no dupe
  });

  it("prepends a new bill", () => {
    const next = upsertOpenBill([bill("a")], bill("z"));
    expect(next.map((entry) => entry.id)).toEqual(["z", "a"]);
  });

  it("caps the number of open bills", () => {
    let list: HeldBill[] = [];
    for (let i = 0; i < MAX_OPEN_BILLS + 5; i += 1) list = upsertOpenBill(list, bill(`b${i}`));
    expect(list).toHaveLength(MAX_OPEN_BILLS);
  });

  it("mints unique bill ids", () => {
    const ids = new Set(Array.from({ length: 50 }, () => newBillId()));
    expect(ids.size).toBe(50);
  });
});

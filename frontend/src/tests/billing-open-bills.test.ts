import { describe, expect, it } from "vitest";
import { billingDraftFromHeldBill, heldBillFromBillingDraft, MAX_OPEN_BILLS, newBillId, upsertOpenBill } from "@/features/billing/pages/open-bills";
import type { BillingDraft, HeldBill } from "@/features/billing/pages/billing-types";

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

  it("replaces a same source-order bill even when the held bill id changed", () => {
    const list = [
      { ...bill("a", 1), sourceOrderId: "order-1" },
      bill("b", 2),
    ];
    const next = upsertOpenBill(list, { ...bill("new-random-id", 5), sourceOrderId: "order-1" });
    expect(next).toHaveLength(2);
    expect(next.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(next[0].sourceOrderId).toBe("order-1");
    expect(next[0].cart).toHaveLength(5);
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

  it("converts between active billing draft and held bill without losing source order identity", () => {
    const draft: BillingDraft = {
      activeBillId: "active-1",
      sourceOrderId: "order-9",
      customerName: "Ramesh",
      cart: bill("seed", 2).cart,
    };
    const held = heldBillFromBillingDraft(draft);
    expect(held).toMatchObject({ id: "active-1", sourceOrderId: "order-9", customerName: "Ramesh" });

    const restored = billingDraftFromHeldBill(held!);
    expect(restored).toMatchObject({ activeBillId: "active-1", sourceOrderId: "order-9", customerName: "Ramesh" });
    expect(restored.cart).toHaveLength(2);
  });
});

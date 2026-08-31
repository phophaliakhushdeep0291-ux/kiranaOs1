import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { HeldBill } from "@/features/core/billing/pages/billing-types";

/**
 * What belongs in the counter's open-bills strip.
 *
 * Two things were showing there that are not bills standing at the counter.
 *
 * The active bill was prepended AND listed again out of `heldBills`, because the
 * two ways of loading a bill disagree about where it lives: `resumeHeldBill`
 * lifts it out of the held set, while `openTableInBilling` deliberately leaves a
 * table's tab in it — the floor screen reads the tab from there. One table,
 * two identical chips, and a shopkeeper reasonably asking which one is real.
 *
 * And a seated table's tab is not a bill waiting to be paid. It belongs to the
 * floor screen until somebody asks to settle it, which is what "Open order" is
 * for — that makes the tab the active bill, and the active bill is a chip again.
 * With every seated table in the strip, a guest ordering a second round changed
 * a total the cashier might have been reading at that moment.
 */

const page = readFileSync("src/features/core/billing/pages/BillingPage.tsx", "utf8");

/** The filter as the page applies it, pinned to the same expression. */
function counterBills(heldBills: HeldBill[], activeBillId: string): HeldBill[] {
  return heldBills.filter((entry) => entry.id !== activeBillId && !entry.tableId);
}

const bill = (id: string, tableId?: string): HeldBill => ({
  id,
  label: id,
  createdAt: new Date().toISOString(),
  cart: [{ product: { id: "p1", name: "Dal Fry" }, quantity: 1, rate: 180, unit: "piece" }],
  ...(tableId ? { tableId } : {}),
}) as HeldBill;

describe("the counter's open-bills strip", () => {
  it("does not list the active bill twice", () => {
    const held = [bill("bill-a"), bill("bill-b")];
    // "Open order" leaves the table's tab in the held set and makes it active.
    expect(counterBills(held, "bill-a").map((b) => b.id)).toEqual(["bill-b"]);
  });

  it("leaves seated tables to the floor screen", () => {
    const held = [bill("walk-in-1"), bill("t3-tab", "table-3"), bill("t5-tab", "table-5")];
    expect(counterBills(held, "some-other-bill").map((b) => b.id)).toEqual(["walk-in-1"]);
  });

  it("shows a table's tab once it is the bill being settled", () => {
    // Not as a held chip — as the active one, which the page always prepends.
    const held = [bill("t3-tab", "table-3")];
    expect(counterBills(held, "t3-tab")).toEqual([]);
  });

  it("is the expression the page actually renders", () => {
    expect(page).toContain("const counterBills = heldBills.filter((entry) => entry.id !== activeBillId && !entry.tableId);");
    // And the strip is fed from it, not from the raw held set.
    expect(page).toContain("...counterBills.map((entry): OpenBillChip");
    expect(page).not.toContain("...heldBills.map((entry): OpenBillChip");
  });

  // Settling used to clear only the workspace draft, which is enough for a counter
  // bill (never parked while it is being rung up) but not for a table tab, which
  // openTableInBilling deliberately leaves parked so the floor screen can read it.
  // The paid copy survived, the table -> bill map still pointed at it, and the
  // table read "seated, Rs330" after the guests had paid and gone.
  it("drops the settled bill from the open set, which is what frees the table", () => {
    expect(page).toContain("const remainingOpenBills = heldBills.filter((entry) => entry.id !== activeBillId);");
    expect(page).toContain("saveSettingList(HELD_BILLS_KEY, remainingOpenBills);");
    // reconcileTableBills keeps a table only while its bill is still open, so
    // billing frees the floor without knowing what a table is.
    const reconcile = readFileSync("src/features/verticals/restaurant/service/table-store.ts", "utf8");
    expect(reconcile).toContain("const bill = live.get(billId);");
    expect(reconcile).toContain("if (!bill) continue;");
  });

  it("keeps the table tag through a save, and drops it once the bill is settled", () => {
    // Rebuilding the workspace bill field by field is where the tag was lost;
    // carrying it over to the next walk-in would be the opposite bug.
    expect(page).toContain("tableId: activeTableId,");
    expect(page).toContain("setActiveTableId(bill.tableId);");
    expect(page).toContain("setActiveTableId(undefined);");
  });
});

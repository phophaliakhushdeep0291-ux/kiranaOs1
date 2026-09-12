import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CartItem } from "@/features/core/billing/pages/billing-types";

/**
 * Taking the money for food the kitchen was never told about.
 *
 * Firing is manual and stays manual — a guest's order reaching the pass with
 * nobody looking is how a cancelled table still gets cooked. But nothing joined
 * that to the till: a table reading "2 to fire" settled without a word, and over
 * one run of four tables two were paid in full with no ticket raised against
 * them at all. The guests bought food nobody had been asked to cook, and their
 * own tracking page then sat at "Being cooked" for good, because order progress
 * is driven by the ticket that never existed.
 *
 * The check warns; it never refuses. A cashier standing in front of a guest
 * knows things the software does not, and on a quiet evening the kitchen may
 * have been told out loud.
 */

const tickets = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock("@/features/verticals/restaurant/service/restaurant-api", () => ({
  listKitchenTickets: vi.fn(async () => tickets.rows),
}));

const { unfiredKitchenLines } = await import("@/features/verticals/restaurant/billing-unfired-kot-check");
const { firstSettleWarning, registerSettleCheck, resetSettleChecks } = await import("@/features/core/billing/settle-checks");

const line = (name: string, quantity: number): CartItem => ({
  product: { id: `p-${name}`, name },
  quantity,
  rate: 100,
  unit: "piece",
}) as CartItem;

const ticket = (billId: string, lines: Array<{ key: string; qty: number }>) => ({
  id: `t-${billId}`, ticketNo: 1, tableId: "table-1", tableName: "T1", billId,
  createdAt: new Date().toISOString(), status: "new",
  lines: lines.map((row) => ({ ...row, name: row.key, unit: "piece" })),
});

beforeEach(() => { tickets.rows = []; });

describe("settling a table with food still to fire", () => {
  it("warns, naming what the kitchen has not been told about", async () => {
    const cart = [line("Paneer Butter Masala", 1), line("Gulab Jamun", 2)];
    const warning = await unfiredKitchenLines({ billId: "bill-1", tableId: "table-1", cart });

    expect(warning).not.toBeNull();
    expect(warning?.title.vars).toMatchObject({ count: 2 });
    // The dish and the count, so the cashier can check the pass without guessing.
    expect(String(warning?.body.vars?.items)).toContain("1× Paneer Butter Masala");
    expect(String(warning?.body.vars?.items)).toContain("2× Gulab Jamun");
  });

  it("says nothing once everything has been fired", async () => {
    const cart = [line("Paneer Butter Masala", 1)];
    const { cartItemKey } = await import("@/features/core/billing/pages/billing-types");
    tickets.rows = [ticket("bill-1", [{ key: cartItemKey(cart[0]), qty: 1 }])];

    expect(await unfiredKitchenLines({ billId: "bill-1", tableId: "table-1", cart })).toBeNull();
  });

  it("counts only this bill's tickets, not the last party's at the same table", async () => {
    const cart = [line("Paneer Butter Masala", 1)];
    const { cartItemKey } = await import("@/features/core/billing/pages/billing-types");
    // A table is reused all evening. The previous sitting fired the same dish;
    // counting it would settle this party's food as though it had gone.
    tickets.rows = [ticket("bill-previous-party", [{ key: cartItemKey(cart[0]), qty: 1 }])];

    expect(await unfiredKitchenLines({ billId: "bill-1", tableId: "table-1", cart })).not.toBeNull();
  });

  it("leaves counter sales alone — there is no floor to fire from", async () => {
    expect(await unfiredKitchenLines({ billId: "bill-1", cart: [line("Butter Naan", 1)] })).toBeNull();
    expect(await unfiredKitchenLines({ billId: "bill-1", tableId: "table-1", cart: [] })).toBeNull();
  });
});

describe("the check registry core billing consults", () => {
  beforeEach(() => resetSettleChecks());

  it("returns the first thing worth saying and stops there", async () => {
    const second = vi.fn(async () => ({ title: { key: "a" }, body: { key: "b" }, confirm: { key: "c" } }));
    registerSettleCheck({ id: "first", run: async () => ({ title: { key: "x" }, body: { key: "y" }, confirm: { key: "z" } }) as never });
    registerSettleCheck({ id: "second", run: second as never });

    const warning = await firstSettleWarning({ billId: "b", cart: [] });
    expect(warning?.title.key).toBe("x");
    // One dialog at a time: a stack of them in front of a queue gets dismissed
    // unread, which is worse than not asking.
    expect(second).not.toHaveBeenCalled();
  });

  it("never stops a shop taking money because a check broke", async () => {
    registerSettleCheck({ id: "broken", run: async () => { throw new Error("offline"); } });
    await expect(firstSettleWarning({ billId: "b", cart: [] })).resolves.toBeNull();
  });

  it("is wired into the confirm path ahead of the PIN and printer gates", () => {
    const page = readFileSync("src/features/core/billing/pages/BillingPage.tsx", "utf8");
    expect(page).toContain("void firstSettleWarning({ billId: activeBillId, tableId: activeTableId, cart, slotValues: billingSlotValues })");
    // The gate can be re-entered from the PIN dialog, so answering the warning
    // must hand back everything that confirm was already carrying — otherwise
    // the approval just collected is dropped and the PIN is asked for twice.
    expect(page).toContain("handleConfirm(pending?.billType, pending?.printDecision, pending?.approval)");
    expect(page.indexOf("firstSettleWarning")).toBeLessThan(page.indexOf("const sensitiveActions = requiredBillingSensitiveActions();"));
  });

  it("is declared by the restaurant pack and nothing else", () => {
    const pack = readFileSync("src/features/verticals/restaurant/pack.ts", "utf8");
    const slots = readFileSync("src/app/vertical-slots.ts", "utf8");
    expect(pack).toContain('"restaurant/unfired-kot"');
    expect(slots).toContain('"restaurant/unfired-kot": () => import("@/features/verticals/restaurant/billing-unfired-kot-check")');
  });
});

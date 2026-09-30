import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeGstBreakdown } from "@/lib/gst";
import type { CartItem } from "@/features/core/billing/pages/billing-types";
import {
  piecesByProduct, prepareUnitBillItems, pruneSelection, selectedUnits,
  type SelectedUnit,
} from "@/features/verticals/electronics/units/billing-selection";

/**
 * The serials chosen for a bill, and what choosing them does to its lines.
 *
 * A return has to name the exact handset, so a line of three phones with three
 * serials is sent as three lines of one. That split is money: the discount has
 * to land on the pieces to the paisa, and — the part that was missed — the
 * total the counter collects has to be worked out on the SAME lines the server
 * will see. GST is rounded per line, so two phones on one line and the same two
 * on two lines differ by a paisa about half the time in exclusive mode, and the
 * server refuses a payment that does not equal its own total.
 */

const pick = (id: string, productId = "phone"): SelectedUnit => ({ id, productId, label: `IMEI-${id}` });
const online = { online: true };
const phoneLine = (over: Record<string, unknown> = {}) => ({ productId: "phone", name: "Galaxy A16", quantity: 1, enteredUnit: "piece", ratePerRateUnit: 100, lineDiscount: 0, ...over });
const cartLine = (id: string, quantity: number, over: Partial<CartItem> = {}) => ({ product: { id, name: `Product ${id}` }, quantity, rate: 100, unit: "piece", ...over }) as CartItem;

describe("one bill line per chosen unit", () => {
  it("splits a line into single pieces, each carrying its serial", () => {
    const lines = prepareUnitBillItems([phoneLine({ quantity: 3 })], [pick("1"), pick("2"), pick("3")], online);
    expect(lines.map((line) => line.trackedUnitId)).toEqual(["1", "2", "3"]);
    expect(lines.map((line) => line.quantity)).toEqual([1, 1, 1]);
  });

  it("divides the line's discount by piece without losing a paisa", () => {
    const lines = prepareUnitBillItems([phoneLine({ quantity: 3, lineDiscount: 1 })], [pick("1"), pick("2"), pick("3")], online);
    expect(lines.map((line) => line.lineDiscount)).toEqual([0.34, 0.33, 0.33]);
  });

  it("keeps a serial that WAS chosen when another piece on the line has none", () => {
    // The cashier ticked one of two. Dropping both because the line is
    // incomplete would throw away a record they had already made.
    const lines = prepareUnitBillItems([phoneLine({ quantity: 3, lineDiscount: 1 })], [pick("1")], online);

    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ quantity: 1, trackedUnitId: "1", lineDiscount: 0.34 });
    // The rest stay together as an ordinary line, with the rest of the discount.
    expect(lines[1]).toMatchObject({ quantity: 2, lineDiscount: 0.66 });
    expect(lines[1].trackedUnitId).toBeUndefined();
  });

  it("gives each product's serials to that product's lines only", () => {
    const lines = prepareUnitBillItems(
      [phoneLine({ quantity: 2 }), phoneLine({ productId: "charger", name: "Charger", quantity: 1 })],
      [pick("9", "tablet"), pick("1"), pick("2")],
      online,
    );
    expect(lines.map((line) => [line.productId, line.trackedUnitId])).toEqual([["phone", "1"], ["phone", "2"], ["charger", undefined]]);
  });

  it("leaves alone everything a serial cannot go on", () => {
    const custom = { name: "Screen guard fitting", quantity: 1, lineDiscount: 0 };
    const half = phoneLine({ quantity: 1.5 });
    expect(prepareUnitBillItems([custom, half], [pick("1")], online)).toEqual([custom, half]);
  });

  it("returns the very same lines when nothing was chosen", () => {
    // Billing runs this for every bill of every electronics shop; most of them
    // are chargers and covers.
    const lines = [phoneLine({ quantity: 2 })];
    expect(prepareUnitBillItems(lines, undefined, online)).toBe(lines);
    expect(prepareUnitBillItems(lines, [], online)).toBe(lines);
    expect(prepareUnitBillItems(lines, "not a selection", online)).toBe(lines);
  });

  it("attaches nothing offline — a serial is reserved by the server, and a queued bill has none to ask", () => {
    const lines = [phoneLine({ quantity: 2 })];
    expect(prepareUnitBillItems(lines, [pick("1"), pick("2")], { online: false })).toBe(lines);
  });
});

describe("the payable is worked out on the lines that are sent", () => {
  // An ex-GST price for a round MRP: ₹10,000 at 18% is ₹8,474.58 before tax.
  const twoPhones = [{ productId: "phone", price: 8474.58, quantity: 2, gstRate: 18, lineDiscount: 0 }];
  const payable = (lines: typeof twoPhones) => {
    const breakdown = computeGstBreakdown(lines, "exclusive");
    return Math.round((breakdown.discountedLineTotal + breakdown.gstToAdd) * 100);
  };

  it("differs by a paisa between one line of two and two lines of one", () => {
    // Why this matters at all. The server sees two lines: 18% of ₹8,474.58 is
    // ₹1,525.4244, which rounds down on each phone and up on the pair.
    const split = prepareUnitBillItems(twoPhones, [pick("1"), pick("2")], online);
    expect(payable(twoPhones)).toBe(20_000_01);
    expect(payable(split)).toBe(20_000_00);
  });

  it("so billing totals the prepared lines, and sends the prepared lines, with one context", () => {
    // Wiring, asserted on the source because it lives inside a 2,500-line
    // component: the GST breakdown must take `gstLines`, `gstLines` must come
    // from prepareBillingItems, and the payload must go through it too — both
    // with the connectivity billing itself reads.
    const page = readFileSync(new URL("../features/core/billing/pages/BillingPage.tsx", import.meta.url), "utf8");
    const prepared = page.match(/prepareBillingItems\(/g) ?? [];
    expect(prepared).toHaveLength(2);
    expect(page.match(/\{ online: isOnline \}/g)).toHaveLength(2);
    expect(page).toMatch(/const gstLines = useMemo\(\s*\(\) => prepareBillingItems\(/);
    expect(page).toMatch(/computeGstBreakdown\(\s*gstLines,/);
    expect(page).toMatch(/items: prepareBillingItems\(activeBillingSlots, billingSlotValues, cart\.map\(/);
  });

  it("takes nothing off the subtotal or the discount by splitting", () => {
    const discounted = [{ productId: "phone", price: 8474.58, quantity: 3, gstRate: 18, lineDiscount: 100 }];
    const split = prepareUnitBillItems(discounted, [pick("1"), pick("2")], online);
    const whole = computeGstBreakdown(discounted, "inclusive");
    const pieces = computeGstBreakdown(split, "inclusive");
    // Inclusive GST is extracted, not added: the payable is the same either way.
    expect(pieces.discountedLineTotal).toBe(whole.discountedLineTotal);
    expect(pieces.gstToAdd).toBe(0);
  });
});

describe("the choice as the cart changes under it", () => {
  it("counts only whole pieces of catalogue products as places a serial can go", () => {
    const pieces = piecesByProduct([
      cartLine("phone", 2),
      cartLine("phone", 1, { sellingUnit: { id: "box", name: "Box", unitCode: "box", conversionToBase: 1 } as CartItem["sellingUnit"] }),
      cartLine("cable", 1.5),
      cartLine("fitting", 1, { isCustom: true }),
    ]);
    expect(pieces.get("phone")).toEqual({ name: "Product phone", pieces: 3 });
    expect(pieces.get("cable")?.pieces).toBe(0);
    expect(pieces.has("fitting")).toBe(false);
  });

  it("drops what the bill no longer has room for, and otherwise hands back the same array", () => {
    const chosen = [pick("1"), pick("2"), pick("7", "tablet")];
    // The quantity went from two phones to one, and the tablet was removed.
    expect(pruneSelection(chosen, [cartLine("phone", 1)])).toEqual([pick("1")]);

    const fits = [pick("1"), pick("2")];
    expect(pruneSelection(fits, [cartLine("phone", 2)])).toBe(fits);
  });

  it("reads a stored choice as untrusted — the draft is persisted JSON", () => {
    expect(selectedUnits([pick("1"), null, { id: "2" }, { id: "", productId: "phone", label: "x" }, pick("1"), "junk"])).toEqual([pick("1")]);
    expect(selectedUnits({ id: "1" })).toEqual([]);
    expect(selectedUnits(undefined)).toEqual([]);
  });
});

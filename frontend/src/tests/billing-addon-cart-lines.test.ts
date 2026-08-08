import { describe, expect, it } from "vitest";
import {
  addonFingerprint,
  addonUnitPrice,
  cartItemKey,
  type CartItem,
  type SelectedAddon,
} from "@/features/core/billing/pages/billing-types";
import type { Product } from "@/types/api";

/**
 * What a chosen add-on does to the identity and the price of a cart line.
 *
 * The rule under test is a money rule, not a display one: two of the same dish
 * ordered differently are two lines. Merging them would bill both at whichever
 * rate landed first and hand the kitchen one ticket that cannot be cooked.
 */

const DISH = { id: "dish_paneer", name: "Paneer tikka", gstRate: 5 } as unknown as Product;

function line(addons?: SelectedAddon[], overrides: Partial<CartItem> = {}): CartItem {
  return { product: DISH, quantity: 1, rate: 220, unit: "plate", addons, ...overrides } as CartItem;
}

const CHEESE: SelectedAddon = { optionId: "opt_cheese", groupName: "Extras", name: "Extra cheese", price: 30 };
const JALAPENO: SelectedAddon = { optionId: "opt_jalapeno", groupName: "Extras", name: "Jalapeño", price: 20 };
const NO_ONION: SelectedAddon = { optionId: "opt_no_onion", groupName: "Instructions", name: "No onion", price: 0 };

describe("add-ons and cart line identity", () => {
  it("keeps the same dish ordered differently on separate lines", () => {
    expect(cartItemKey(line([CHEESE]))).not.toBe(cartItemKey(line()));
  });

  it("merges the same choices whatever order they were tapped in", () => {
    // "cheese then jalapeño" and "jalapeño then cheese" are the same plate, and
    // two lines for it is something the waiter has to explain to the guest.
    expect(cartItemKey(line([CHEESE, JALAPENO]))).toBe(cartItemKey(line([JALAPENO, CHEESE])));
  });

  it("separates a free instruction too, because the kitchen cooks it differently", () => {
    // No money changes hands for "no onion", so a key built from price alone
    // would merge these — and one of the two guests would get onion.
    expect(cartItemKey(line([NO_ONION]))).not.toBe(cartItemKey(line()));
  });

  it("still separates by pack and batch as it always did", () => {
    const withUnit = line([CHEESE], { sellingUnit: { unitCode: "portion-half" } as CartItem["sellingUnit"] });
    expect(cartItemKey(withUnit)).not.toBe(cartItemKey(line([CHEESE])));
  });

  it("fingerprints an unconfigured line as plain rather than empty", () => {
    expect(addonFingerprint(undefined)).toBe("plain");
    expect(addonFingerprint([])).toBe("plain");
  });
});

describe("add-on money", () => {
  it("prices per unit of the dish, not per line", () => {
    // Two burgers with cheese are two lots of cheese. Returning a per-line figure
    // here is what would make the caller multiply by quantity a second time.
    expect(addonUnitPrice([CHEESE, JALAPENO])).toBe(50);
  });

  it("counts a repeated option as the quantity it is", () => {
    expect(addonUnitPrice([{ ...CHEESE, quantity: 2 }])).toBe(60);
  });

  it("adds nothing for a free instruction", () => {
    expect(addonUnitPrice([NO_ONION])).toBe(0);
  });

  it("ignores a malformed price instead of poisoning the line total with NaN", () => {
    // A NaN here would propagate through the line, the bill total and the tender,
    // and the first place anyone would see it is the printed receipt.
    expect(addonUnitPrice([{ ...CHEESE, price: Number.NaN }])).toBe(0);
    expect(addonUnitPrice([{ ...CHEESE, quantity: Number.NaN }])).toBe(0);
  });

  it("is zero for a line nobody configured", () => {
    expect(addonUnitPrice(undefined)).toBe(0);
  });
});

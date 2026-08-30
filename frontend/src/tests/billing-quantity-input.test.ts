import { describe, expect, it } from "vitest";
import { hasTypedQuantity, parseQuantityQuery } from "@/features/core/billing/pages/billing-quantity-input";

describe("typing a quantity in the billing search", () => {
  it("reads a leading multiplier", () => {
    expect(parseQuantityQuery("3*rice")).toEqual({ term: "rice", quantity: 3 });
  });

  it("reads a trailing multiplier, because both are muscle memory", () => {
    expect(parseQuantityQuery("rice*3")).toEqual({ term: "rice", quantity: 3 });
  });

  it("keeps decimals, because loose goods are sold by weight", () => {
    // 2.5 kg of atta is an ordinary line in a kirana, not an edge case.
    expect(parseQuantityQuery("2.5*atta")).toEqual({ term: "atta", quantity: 2.5 });
    expect(parseQuantityQuery("atta*0.5")).toEqual({ term: "atta", quantity: 0.5 });
  });

  it("tolerates the spaces a real person types", () => {
    expect(parseQuantityQuery(" 3 * basmati rice ")).toEqual({ term: "basmati rice", quantity: 3 });
  });

  it("leaves an ordinary search completely alone", () => {
    expect(parseQuantityQuery("basmati rice")).toEqual({ term: "basmati rice", quantity: null });
    expect(parseQuantityQuery("")).toEqual({ term: "", quantity: null });
  });
});

describe("product names that look like quantities", () => {
  // The whole reason the syntax needs a separator. Each of these is a real
  // product on an Indian shelf, and reading a leading number as a count would
  // silently bill several of something the customer did not ask for.
  it.each(["5 Star", "7Up", "100 Pipers", "50-50 biscuit", "2 Minute Noodles"])(
    "does not treat %s as a quantity",
    (name) => {
      expect(parseQuantityQuery(name)).toEqual({ term: name, quantity: null });
    },
  );

  it("does not treat a pack size printed on the item as a quantity", () => {
    // "Vim Bar 3x" is what somebody types to FIND the product.
    expect(parseQuantityQuery("Vim Bar 3x")).toEqual({ term: "Vim Bar 3x", quantity: null });
    expect(parseQuantityQuery("Maggi 12x")).toEqual({ term: "Maggi 12x", quantity: null });
  });
});

describe("a multiplier that is not one", () => {
  it("ignores zero and negatives rather than billing them", () => {
    expect(parseQuantityQuery("0*rice").quantity).toBeNull();
    expect(parseQuantityQuery("-2*rice").quantity).toBeNull();
  });

  it("ignores a bare asterisk mid-typing", () => {
    // The cashier is between keystrokes. A till is not the place to argue.
    expect(parseQuantityQuery("*rice").quantity).toBeNull();
    expect(parseQuantityQuery("rice*").quantity).toBeNull();
  });

  it("ignores something that is not a number at all", () => {
    expect(parseQuantityQuery("abc*rice").quantity).toBeNull();
  });

  it("clamps a slipped keypress instead of billing four thousand kilos", () => {
    // Cancelling a bill costs a shop more than retyping one.
    expect(parseQuantityQuery("50000*rice").quantity).toBe(9999);
  });

  it("carries the multiplier before the item is typed", () => {
    // "3*" with the caret still blinking. There is nothing to search for, but
    // the three is real and the UI should be able to show it.
    expect(parseQuantityQuery("3*")).toEqual({ term: "", quantity: 3 });
  });
});

describe("hasTypedQuantity", () => {
  it("treats an explicit one as typed, because the cashier meant it", () => {
    expect(hasTypedQuantity(parseQuantityQuery("1*rice"))).toBe(true);
  });

  it("is false when nothing was typed", () => {
    expect(hasTypedQuantity(parseQuantityQuery("rice"))).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { formToInput, productToForm } from "@/features/core/products/pages/product-form-state";
import type { Product } from "@/types/api";

/**
 * Some things a shop sells are not things it stocks.
 *
 * A cooked dish is made to order and its ingredients are what leave the store
 * room; a service is performed. Counting those drives a number nothing ever
 * restocks further below zero every service, and fills the store room with rows
 * a shopkeeper cannot act on.
 *
 * Putting something on a menu switches this off automatically, which is right
 * for Dal Fry and wrong for the bottled water sold beside it — so the owner has
 * to be able to say otherwise, and the form has to carry what they said.
 */
describe("counting a product as stock", () => {
  const base = (over: Partial<Product> = {}) => productToForm({
    id: "p1", name: "Mineral Water", category: "general", unit: "piece",
    ...over,
  } as Product);

  it("reads the product's own answer, defaulting to counted", () => {
    expect(base().stockTrackingEnabled).toBe(true);
    expect(base({ stockTrackingEnabled: false }).stockTrackingEnabled).toBe(false);
  });

  it("carries the owner's answer into what gets saved", () => {
    // The regression this pins: the payload hardcoded `true` for both fields, so
    // every save re-tracked the product. A dish edited once came straight back
    // into the store room, and an owner who had said "do not count the bottled
    // water" lost that the next time they touched its price.
    const saved = formToInput({ ...base(), stockTrackingEnabled: false });
    expect(saved.stockTrackingEnabled).toBe(false);
    expect(saved.trackStock).toBe(false);
  });

  it("still counts an ordinary product", () => {
    const saved = formToInput({ ...base(), stockTrackingEnabled: true });
    expect(saved.stockTrackingEnabled).toBe(true);
    expect(saved.trackStock).toBe(true);
  });

  it("survives a round trip, so editing twice does not undo it", () => {
    const once = formToInput({ ...base(), stockTrackingEnabled: false });
    const again = formToInput(productToForm({ ...(once as unknown as Product), id: "p1" }));
    expect(again.stockTrackingEnabled).toBe(false);
  });
});

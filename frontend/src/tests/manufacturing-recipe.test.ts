import { describe, expect, it } from "vitest";
import { recipePayload, type RecipeDraft } from "@/features/verticals/manufacturing/recipe-draft";
import type { Product } from "@/types/api";
const products = [{ id: "finished", batchTrackingEnabled: true }, { id: "raw" }, { id: "carton" }] as Product[];
const draft = (): RecipeDraft => ({ name: " Recipe ", finishedProductId: "finished", output: "10", materials: [
  { key: "a", productId: "raw", quantity: "12.5", wastage: "2" },
  { key: "b", productId: "carton", quantity: "5", wastage: "0" },
] });
describe("manufacturing recipe", () => {
  it("preserves quantities and wastage for every ingredient and packaging material", () => {
    expect(recipePayload(draft(), products)).toEqual({ name: "Recipe", finishedProductId: "finished", outputQuantityBaseQty: 10, items: [
      { materialProductId: "raw", quantityBaseQty: 12.5, wastagePercent: 2 },
      { materialProductId: "carton", quantityBaseQty: 5, wastagePercent: 0 },
    ] });
  });
  it.each(["raw", "finished", "missing", ""])("rejects duplicate, self or unavailable material %s", (id) => {
    const input = draft(); input.materials[1].productId = id;
    expect(() => recipePayload(input, products)).toThrow("materials");
  });
  it.each(["0", "-2", "Infinity", "0.001", "1000000001", ""])("rejects invalid stock quantity %s", (quantity) => {
    const input = draft(); input.materials[0].quantity = quantity;
    expect(() => recipePayload(input, products)).toThrow("quantity");
  });
  it("requires tracked finished stock, material rows and valid wastage", () => {
    const input = draft();
    expect(() => recipePayload(input, products.map(p => ({ ...p, batchTrackingEnabled: false })))).toThrow("finished");
    input.materials[1].wastage = "101"; expect(() => recipePayload(input, products)).toThrow("wastage");
    input.materials = []; expect(() => recipePayload(input, products)).toThrow("materials");
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { productToForm, formToInput } from "@/features/products/pages/product-form-state";

const source = readFileSync("src/features/products/pages/ProductsPage.tsx", "utf8");

// Standard retail systems solve "a pack I count and reorder separately" with a separate
// SKU (Shopify, Square, Lightspeed), not a second stock bucket on one product. Duplicate
// makes that path cheap — but a copy must not inherit anything that identifies the
// ORIGINAL, or the two SKUs collide.
const original = {
  id: "prod_ghadi_70g",
  name: "Ghadi Surf",
  category: "grocery",
  brand: "Ghadi",
  barcode: "8901234567890",
  hsn: "3402",
  gstRate: 5,
  mrp: 70,
  costPrice: 58,
  sellingPrice: 63,
  stockBaseQty: 40,
  lowStockThreshold: 5,
  reorderLevel: 20,
  rateUnit: "packet",
  displayUnit: "packet",
  baseUnit: "gram",
  sellingUnits: [
    { id: "unit_db_id_of_original", name: "packet", unitType: "packet", unitCode: "packet-1000-gram", packSizeValue: 1000, packSizeUnit: "gram", conversionToBase: 1000, defaultPrice: 63, isDefault: true, isActive: true },
  ],
} as never;

// Mirrors duplicateProduct() in ProductsPage.tsx.
function duplicateForm() {
  const src = productToForm(original);
  return { ...src, name: `${src.name} (copy)`, barcode: "", stockQuantity: 0, sellingUnits: [] };
}

describe("duplicating a product as a new SKU", () => {
  it("carries over the catalogue details worth keeping", () => {
    const copy = duplicateForm();
    expect(copy.category).toBe("grocery");
    expect(copy.brand).toBe("Ghadi");
    expect(copy.hsn).toBe("3402");
    expect(copy.gstRate).toBe(5);
    expect(copy.sellingPrice).toBe(63);
    expect(copy.costPrice).toBe(58);
    expect(copy.reorderLevel).toBe(20);
  });

  it("gives the copy a distinct name, because the server rejects a duplicate active name", () => {
    expect(duplicateForm().name).toBe("Ghadi Surf (copy)");
  });

  it("clears the barcode so two SKUs never scan to the same thing", () => {
    expect(duplicateForm().barcode).toBe("");
  });

  it("starts the new SKU at zero stock rather than cloning the count", () => {
    expect(duplicateForm().stockQuantity).toBe(0);
  });

  // The subtle one. productToForm carries the SOURCE product's selling-unit database ids,
  // and formToInput reuses previousDefault.id when the unitCode matches — which would
  // attach another product's unit row to the new SKU.
  it("never inherits the source product's selling-unit database id", () => {
    const src = productToForm(original);
    expect(src.sellingUnits[0]?.id).toBe("unit_db_id_of_original");

    const copyInput = formToInput(duplicateForm());
    const ids = (copyInput.sellingUnits ?? []).map((unit) => (unit as { id?: string }).id);
    expect(ids.every((id) => id === undefined)).toBe(true);
  });

  it("still builds a usable default selling unit for the copy", () => {
    const copyInput = formToInput(duplicateForm());
    const units = copyInput.sellingUnits ?? [];
    expect(units.length).toBeGreaterThan(0);
    expect(units.some((unit) => (unit as { isDefault?: boolean }).isDefault)).toBe(true);
  });
});

describe("the action is reachable", () => {
  it("appears in both the desktop row menu and the mobile card menu", () => {
    expect(source).toContain("duplicateProduct(product)");
    expect(source.match(/duplicateProduct\(product\)/g)?.length).toBe(2);
  });

  it("is permission checked like every other product write", () => {
    const at = source.indexOf("const duplicateProduct");
    expect(at).toBeGreaterThan(-1);
    expect(source.slice(at, at + 400)).toContain("manageProducts.allowed");
  });

  it("saves as a new product instead of overwriting the source", () => {
    const at = source.indexOf("const duplicateProduct");
    expect(source.slice(at, at + 900)).toContain("setEditing(null)");
  });
});

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BUSINESS_TYPE_IDS, saveBusinessType, type BusinessType } from "@/features/core/settings/business-type-store";
import {
  PRODUCT_ATTRIBUTE_SECTION_TITLE,
  PRODUCT_ATTRIBUTES,
  foreignProductAttributeKeys,
  normalizeProductAttributes,
  productAttributeFieldsFor,
  productAttributesForSave,
} from "@/features/core/products/product-attributes";
import { formToInput, productToForm } from "@/features/core/products/pages/product-form-state";
import {
  parseProductsCsv,
  productImportColumns,
  buildProductTemplateCsv,
} from "@/features/core/products/import/product-import-csv";
import type { Product } from "@/types/api";

/**
 * A shop type that changes the labels on a form but not the fields underneath it
 * is a theme, not a vertical. These tests hold the two things that make the trade
 * fields real: every trade actually has its own, and what a shopkeeper types
 * survives the round trip out of the form and back — including across a change of
 * business type, which is the case that silently destroys data if the merge is
 * wrong.
 */

function baseValues(overrides: Record<string, unknown> = {}) {
  return {
    ...productToForm(),
    name: "Test product",
    sellingPrice: 100,
    ...overrides,
  } as Parameters<typeof formToInput>[0];
}

describe("every business type carries its own product fields", () => {
  it("defines a non-empty catalogue and a section title for all of them", () => {
    for (const businessType of BUSINESS_TYPE_IDS) {
      const groups = PRODUCT_ATTRIBUTES[businessType];
      expect(groups.length, `${businessType} has no attribute groups`).toBeGreaterThan(0);
      expect(productAttributeFieldsFor(businessType).length, `${businessType} has no fields`).toBeGreaterThan(0);
      expect(PRODUCT_ATTRIBUTE_SECTION_TITLE[businessType]).toBeTruthy();
    }
  });

  it("keeps field keys unique inside a trade, so one value cannot shadow another", () => {
    for (const businessType of BUSINESS_TYPE_IDS) {
      const keys = productAttributeFieldsFor(businessType).map((field) => field.key);
      expect(new Set(keys).size, `${businessType} repeats an attribute key`).toBe(keys.length);
    }
  });

  it("gives every field a label, and every select some options", () => {
    for (const businessType of BUSINESS_TYPE_IDS) {
      for (const field of productAttributeFieldsFor(businessType)) {
        expect(field.label, `${businessType}.${field.key} has no label`).toBeTruthy();
        // A key is a permanent reference from stored data — it has to be a plain
        // identifier, never anything a rename or a space could break.
        expect(field.key, `${businessType}.${field.key} is not a plain identifier`).toMatch(/^[a-z][a-zA-Z0-9]*$/);
        if (field.type === "select") {
          expect(field.options?.length, `${businessType}.${field.key} is a select with no options`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("does not restate a field that is already a product column of its own", () => {
    // These drive behaviour — billing, stock, tax, prescription checks — so a
    // trade field with the same name would give the shop two answers to one
    // question, and only one of them would be the one the app reads.
    const realColumns = new Set([
      "name", "category", "brand", "barcode", "sku", "hsn", "mrp", "gstRate",
      "description", "imageUrl", "drugSchedule", "batchTrackingEnabled",
      "reorderLevel", "packagingMode", "isLooseItem", "menuCourse", "foodType",
      "spiceLevel", "prepMinutes", "menuTags",
    ]);
    for (const businessType of BUSINESS_TYPE_IDS) {
      for (const field of productAttributeFieldsFor(businessType)) {
        expect(realColumns.has(field.key), `${businessType}.${field.key} duplicates a real product column`).toBe(false);
      }
    }
  });
});

describe("trade details round-trip through the product form", () => {
  it("sends what was typed, and clears a field left empty", () => {
    saveBusinessType("pharmacy");
    const payload = formToInput(baseValues({
      name: "Paracetamol 500 mg",
      attributes: { genericName: "Paracetamol", unitsPerStrip: 10, coldChain: false },
    }));

    expect(payload.attributes?.genericName).toBe("Paracetamol");
    expect(payload.attributes?.unitsPerStrip).toBe(10);
    expect(payload.attributes?.coldChain).toBe(false);
    // Named with no value: the server reads that as "clear it", which is how the
    // form deletes a detail the shop no longer wants.
    expect(payload.attributes?.composition).toBe("");
  });

  it("reads a saved product back into the form unchanged", () => {
    const product = {
      name: "Cotton Shirt",
      attributes: { fabric: "100% cotton", fit: "Slim", season: "Summer" },
    } as unknown as Product;

    expect(productToForm(product).attributes).toEqual({
      fabric: "100% cotton",
      fit: "Slim",
      season: "Summer",
    });
  });

  it("drops blanks rather than storing them, so a cleared box is not an edit", () => {
    expect(normalizeProductAttributes({ fabric: "  ", fit: "Slim", pages: Number.NaN, junk: { a: 1 } }))
      .toEqual({ fit: "Slim" });
  });
});

describe("switching business type does not destroy what the old trade recorded", () => {
  it("carries another trade's keys through a save under the new trade", () => {
    // The shop was a pharmacy, recorded a composition, then switched to kirana.
    // The kirana form has no composition box, so its payload never names one —
    // and passing the value back untouched is the only thing that stops the next
    // save from wiping it.
    saveBusinessType("kirana");
    const payload = productAttributesForSave("kirana", {
      composition: "Paracetamol 500 mg",
      storage: "Chilled",
    });

    expect(payload.composition).toBe("Paracetamol 500 mg");
    expect(payload.storage).toBe("Chilled");
    expect(payload.fssaiLicence).toBe("");
  });

  it("lists the leftover keys so the owner can see and clear them", () => {
    const foreign = foreignProductAttributeKeys("kirana", {
      composition: "Paracetamol 500 mg",
      storage: "Chilled",
      rack: "A3",
    });

    // storage and rack are kirana's own fields; composition is not.
    expect(foreign).toEqual(["composition"]);
  });

  it("reports nothing foreign when the trade owns every stored key", () => {
    expect(foreignProductAttributeKeys("footwear", { closure: "Lace-up", warrantyMonths: 3 })).toEqual([]);
  });
});

describe("bulk import carries the trade's fields too", () => {
  it("appends the trade's columns after the fixed ones, never in place of them", () => {
    const columns = productImportColumns("pharmacy");
    const headers = columns.map((column) => column.header);

    expect(headers.slice(0, 3)).toEqual(["Name", "Category", "Unit"]);
    expect(columns.some((column) => column.field === "attr:composition")).toBe(true);
    expect(buildProductTemplateCsv("pharmacy").split("\n")[0]).toContain("Composition");
  });

  it("reads trade columns off a row and types them correctly", () => {
    const columns = productImportColumns("pharmacy");
    const header = columns.map((column) => column.header).join(",");
    const row = columns.map((column) => {
      if (column.field === "name") return "Paracetamol 500 mg";
      if (column.field === "costPrice") return "8";
      if (column.field === "sellingPrice") return "12";
      if (column.field === "attr:genericName") return "Paracetamol";
      if (column.field === "attr:unitsPerStrip") return "10";
      if (column.field === "attr:coldChain") return "no";
      return "";
    }).join(",");

    const parsed = parseProductsCsv(`${header}\n${row}\n`, undefined, "pharmacy");

    expect(parsed.errorCount).toBe(0);
    expect(parsed.rows[0].formData?.attributes).toEqual({
      genericName: "Paracetamol",
      unitsPerStrip: 10,
      coldChain: false,
    });
  });

  it("leaves a sheet with no trade columns exactly as it was", () => {
    const columns = productImportColumns("kirana");
    const header = ["Name", "Cost Price", "Selling Price"].join(",");
    const parsed = parseProductsCsv(`${header}\nTata Salt,22,26\n`, undefined, "kirana");

    expect(parsed.errorCount).toBe(0);
    expect(parsed.rows[0].formData?.attributes).toEqual({});
    expect(columns.length).toBeGreaterThan(3);
  });
});

describe("the catalogue stays in step with the business-type list", () => {
  it("covers every id, including ones added later", () => {
    const covered = Object.keys(PRODUCT_ATTRIBUTES) as BusinessType[];
    expect([...covered].sort()).toEqual([...BUSINESS_TYPE_IDS].sort());
  });
});

describe("the catalogue stays out of the startup shell", () => {
  it("is not imported by the offline write path", () => {
    // products/local-actions.ts is reachable from the app entry, so whatever it
    // imports every shop downloads before first paint. Importing the catalogue
    // here put all twelve trades' labels and help text into the startup chunk and
    // pushed initial JS past its ceiling — caught by the bundle budget, but only
    // after a full build. The value helpers live in their own module so the shell
    // can have them without the vocabulary.
    const source = readFileSync(
      fileURLToPath(new URL("../features/core/products/local-actions.ts", import.meta.url)),
      "utf8",
    );
    expect(source).not.toMatch(/from "@\/features\/core\/products\/product-attributes"/);
    expect(source).toMatch(/from "@\/features\/core\/products\/product-attribute-values"/);
  });
});

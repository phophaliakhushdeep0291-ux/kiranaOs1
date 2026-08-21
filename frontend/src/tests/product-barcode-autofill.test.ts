import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { baseUnitFor, sellingUnitConversion } from "@/features/core/products/pages/product-pricing";
import { productsEn as productsEnglish } from "@/features/core/settings/translations/products";
import { productsHi as productsHindi } from "@/features/core/settings/translations/products.hi";

const source = readFileSync("src/features/core/products/pages/components/ProductFormPanel.tsx", "utf8");

/**
 * The shop already had a barcode lookup — scanning an unknown code at the till
 * offers to create the product with its details filled in — but the product form
 * could not use it, so building a catalogue by hand meant typing everything a
 * scanner could have read.
 */
describe("filling a new product from its barcode", () => {
  it("never rewrites what the shop is already typing", () => {
    const at = source.indexOf("async function fillFromBarcode");
    expect(at).toBeGreaterThan(-1);
    const body = source.slice(at, at + 2600);
    // A saved product is never touched, and a product already named is left alone.
    expect(body).toContain("if (editing) return;");
    expect(body).toContain('if ((form.getValues("name") ?? "").trim()) return;');
    // Every field is filled only while it is still blank.
    expect(body).toContain('if (String(form.getValues(field) ?? "").trim()) return;');
  });

  it("runs on blur, not on every keystroke", () => {
    expect(source).toContain("void fillFromBarcode();");
    expect(source).toContain("onBlur={(event) => { void barcodeField.onBlur(event); void fillFromBarcode(); }}");
  });

  it("asks for nothing until the code is long enough to be one", () => {
    const at = source.indexOf("async function fillFromBarcode");
    expect(source.slice(at, at + 2600)).toContain("if (code.length < 8) return;");
  });

  it("treats an abbreviated measure as the shop's own spelling of it", () => {
    // A lookup answers "g" where the select offers "gram". Same base unit, same
    // factor, so the pricing rules already say they are the same measure — which is
    // what the form uses rather than keeping a second alias table.
    expect(baseUnitFor("g")).toBe(baseUnitFor("gram"));
    expect(sellingUnitConversion(1, "g")).toBe(sellingUnitConversion(1, "gram"));
    // and something the shop cannot express stays unmatched, leaving pack size alone.
    expect(baseUnitFor("furlong")).not.toBe(baseUnitFor("gram"));
  });

  it("says what it did, in both languages", () => {
    expect(productsEnglish["products.form.barcodeFilled"]).toBe("Filled in from the barcode");
    expect(productsHindi["products.form.barcodeFilled"]).toBeTruthy();
  });
});

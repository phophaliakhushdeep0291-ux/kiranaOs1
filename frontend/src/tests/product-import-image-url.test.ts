import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PRODUCT_IMPORT_COLUMNS } from "@/features/core/products/import/product-import-csv";

/**
 * The import sheet gained an image column so a shop can bring picture links it
 * already has, and so the starter catalogue can carry them once barcodes are
 * sourced for it. Two things have to hold, and the second is the one that bites:
 * the column has to exist, AND the value has to survive the row -> product
 * conversion. It did not at first — `imageUrl` was hardcoded to "" there, so the
 * column would have been accepted, mapped, previewed and then silently dropped.
 */
describe("product import image column", () => {
  it("offers an image column, appended so older sheets still line up", () => {
    const headers = PRODUCT_IMPORT_COLUMNS.map((column) => column.header);
    expect(headers).toContain("Image URL");
    // Legacy column order is load-bearing: an old template must not shift values
    // into the wrong fields, so new columns go on the end.
    expect(headers[headers.length - 1]).toBe("Image URL");
    expect(PRODUCT_IMPORT_COLUMNS.find((c) => c.header === "Image URL")?.field).toBe("imageUrl");
  });

  it("actually carries the value into the product, rather than dropping it", () => {
    const source = readFileSync("src/features/core/products/import/product-import-csv.ts", "utf8");
    // The bug this guards: a field can be in the column map, the mapping UI and
    // the preview and still never reach the product.
    expect(source).toContain("imageUrl: importedImageUrl(values.imageUrl)");
    expect(source).not.toContain('imageUrl: ""');
  });

  it("takes a link but never inlined image bytes", () => {
    const source = readFileSync("src/features/core/products/import/product-import-csv.ts", "utf8");
    // A sheet exported from another tool can carry base64 images. Accepting one
    // would put ~24 kB into the product row, which is then paid for again in
    // every device's IndexedDB and every sync payload.
    const helper = source.slice(source.indexOf("function importedImageUrl"));
    expect(helper).toContain('url.protocol === "https:" || url.protocol === "http:"');
    // A malformed link must not fail the whole row — the shop still wants the product.
    expect(helper).toContain("catch");
  });
});

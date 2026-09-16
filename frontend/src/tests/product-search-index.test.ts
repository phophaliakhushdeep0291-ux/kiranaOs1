import { describe, expect, it } from "vitest";
import { createProductSearchIndex } from "@/features/core/products/product-search-index";
import { productMatchesSearch } from "@/features/core/products/product-reliability";

const products = [
  { id: "sugar", name: "Sugar", category: "grocery", barcode: "8901000000011", sku: "SUG-01", unit: "kg", aliases: ["cheeni", "चीनी"] },
  { id: "rice", name: "Basmati_Rice", category: "grocery", barcode: null, sku: "RICE.02", unit: "kg", aliases: ["चावल"] },
  { id: "soap", name: "ＳＯＡＰ", category: "care", barcode: null, sku: null, unit: "piece", aliases: [] },
];

describe("catalogue search index", () => {
  it.each(["", "  ", "SUG", "cheeni", "चीनी", "8901000000011", "rice.02", "basmati-rice", "ＳＯＡＰ", "grocery", "not found"])("preserves search results and order for %s", (query) => {
    expect(createProductSearchIndex(products).search(query))
      .toEqual(products.filter((product) => productMatchesSearch(product, query)));
  });

  it("combines catalogue search with active UI filters", () => {
    expect(createProductSearchIndex(products).search("grocery", (product) => product.id !== "sugar"))
      .toEqual([products[1]]);
  });

  it("does not renormalize catalogue fields for every search", () => {
    let reads = 0;
    const product = { ...products[0], get name() { reads += 1; return "Sugar"; } };
    const index = createProductSearchIndex([product]);
    const initialReads = reads;
    for (const query of ["s", "su", "sug", "suga", "sugar"]) expect(index.search(query)).toEqual([product]);
    expect(initialReads).toBeGreaterThan(0);
    expect(reads).toBe(initialReads);
  });

  it("rebuilds from edited data and does not leak rows between catalogue snapshots", () => {
    const first = createProductSearchIndex(products);
    const next = createProductSearchIndex([{ ...products[0], name: "Salt", aliases: [], sku: null }]);
    expect(next.search("sugar")).toEqual([]);
    expect(next.search("salt")).toHaveLength(1);
    expect(next.search("rice")).toEqual([]);
    expect(first.search("sugar")).toEqual([products[0]]);
  });

  it("finds products beyond the first thousand in a large catalogue", () => {
    const large = Array.from({ length: 10_000 }, (_, i) => ({ ...products[0], id: `p${i}`, name: `Item ${i}`, barcode: null, sku: null, aliases: [] }));
    expect(createProductSearchIndex(large).search("Item 9999")).toEqual([large[9999]]);
  });
});

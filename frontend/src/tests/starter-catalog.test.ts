import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  KIRANA_STARTER_CATALOG,
  KIRANA_STARTER_CATALOG_CHECKSUM,
} from "@/features/core/products/starter-catalog/kirana-catalog.generated";
import {
  STARTER_CATALOG_ITEM_COUNT,
  starterCatalogToCsv,
} from "@/features/core/products/starter-catalog/starter-catalog";
import { PRODUCT_IMPORT_COLUMNS, parseProductsCsv } from "@/features/core/products/import/product-import-csv";
import { UNITS } from "@/features/core/products/pages/product-pricing";

const csvPath = fileURLToPath(new URL("../../../catalog/kirana-starter-catalog.csv", import.meta.url));
const csvText = readFileSync(csvPath, "utf8");

/**
 * Same two normalisations scripts/generate-starter-catalog.mjs applies before hashing.
 * Line endings and the BOM are not content — git rewrites them per platform — so hashing
 * raw bytes would fail this test on a clean clone instead of on a real edit.
 */
function normalise(text: string): string {
  return text.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

describe("starter catalog generated module", () => {
  it("is not stale relative to the source CSV", () => {
    const checksum = createHash("sha256").update(normalise(csvText), "utf8").digest("hex");
    expect(
      KIRANA_STARTER_CATALOG_CHECKSUM,
      "catalog/kirana-starter-catalog.csv changed without regenerating. Run: npm run catalog:generate",
    ).toBe(checksum);
  });

  it("round-trips back to the source CSV byte for byte", () => {
    // Stronger than the checksum: proves generation lost nothing, rather than only that
    // the two files were produced at the same moment.
    expect(starterCatalogToCsv(KIRANA_STARTER_CATALOG)).toBe(normalise(csvText));
  });

  it("keeps the advertised item count truthful", () => {
    expect(KIRANA_STARTER_CATALOG).toHaveLength(STARTER_CATALOG_ITEM_COUNT);
  });

  it("ships 560 products, 48 of them loose", () => {
    expect(KIRANA_STARTER_CATALOG).toHaveLength(560);
    expect(KIRANA_STARTER_CATALOG.filter((item) => item.isLooseItem)).toHaveLength(48);
  });

  it("is frozen, so no screen can edit what the next shop gets", () => {
    expect(Object.isFrozen(KIRANA_STARTER_CATALOG)).toBe(true);
    expect(Object.isFrozen(KIRANA_STARTER_CATALOG[0])).toBe(true);
    expect(Object.isFrozen(KIRANA_STARTER_CATALOG[0].aliases)).toBe(true);
  });
});

describe("starter catalog data", () => {
  it("uses only units the product form actually offers", () => {
    // A unit that converts correctly but is missing from UNITS produces a product the
    // shopkeeper cannot edit without the form resetting the field.
    const known = new Set<string>(UNITS);
    const unknownUnits = [...new Set(KIRANA_STARTER_CATALOG.map((item) => item.unit))].filter((unit) => !known.has(unit));
    const unknownPackUnits = [...new Set(KIRANA_STARTER_CATALOG.map((item) => item.packSizeUnit))]
      .filter((unit) => unit !== "" && !known.has(unit));
    expect(unknownUnits).toEqual([]);
    expect(unknownPackUnits).toEqual([]);
  });

  it("ships no barcodes, because an invented one bills the wrong item", () => {
    expect(KIRANA_STARTER_CATALOG.filter((item) => item.skuBarcode !== "")).toEqual([]);
  });

  it("opens every product at zero stock", () => {
    // Stock the shop does not have is a money bug the day it prices its first sale.
    expect(KIRANA_STARTER_CATALOG.filter((item) => item.stockQuantity !== 0)).toEqual([]);
  });

  it("gives every product a search alias", () => {
    expect(KIRANA_STARTER_CATALOG.filter((item) => item.aliases.length === 0)).toEqual([]);
  });

  it("parses cleanly through the importer the built-in load actually uses", () => {
    const parsed = parseProductsCsv(starterCatalogToCsv(KIRANA_STARTER_CATALOG));
    expect(parsed.headerError).toBeUndefined();
    expect(parsed.errorCount).toBe(0);
    expect(parsed.validCount).toBe(560);
    // Auto-detected as a native file: every column maps with no manual work.
    expect(parsed.headers).toEqual(PRODUCT_IMPORT_COLUMNS.map((column) => column.header));
  });
});

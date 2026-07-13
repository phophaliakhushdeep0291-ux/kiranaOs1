import { describe, expect, it } from "vitest";
import {
  PRODUCT_IMPORT_COLUMNS,
  autoMapProductHeaders,
  buildProductImportErrorCsv,
  buildProductTemplateCsv,
  detectProductImportSource,
  fingerprintProductImport,
  parseCsv,
  parseProductsCsv,
  planProductImport,
} from "@/features/products/import/product-import-csv";
import type { Product } from "@/types/api";

const HEADER = PRODUCT_IMPORT_COLUMNS.map((c) => c.header).join(",");

describe("product CSV template", () => {
  it("includes the required headers", () => {
    const csv = buildProductTemplateCsv();
    expect(csv).toContain("Name");
    expect(csv).toContain("SKU/Barcode");
    expect(csv).toContain("Selling Price");
    // header + one example row
    expect(csv.trim().split("\n")).toHaveLength(2);
  });
});

describe("parseCsv", () => {
  it("handles quoted fields with commas and escaped quotes", () => {
    const grid = parseCsv('a,"b,c","d""e"\n1,2,3\n');
    expect(grid[0]).toEqual(["a", "b,c", 'd"e']);
    expect(grid[1]).toEqual(["1", "2", "3"]);
  });

  it("rejects an unclosed quoted value instead of shifting later columns", () => {
    expect(() => parseCsv('Name,Selling Price\n"Broken,20\n')).toThrow(/unclosed/i);
  });
});

describe("parseProductsCsv", () => {
  it("accepts a valid row and maps it to a product input", () => {
    const csv = `${HEADER}\nTata Salt 1kg,Grocery,kg,8901234567890,28,22,26,0,100,10,20,25010010,Tata,"namak, salt",Iodised salt\n`;
    const res = parseProductsCsv(csv);
    expect(res.validCount).toBe(1);
    expect(res.errorCount).toBe(0);
    const row = res.rows[0];
    expect(row.valid).toBe(true);
    expect(row.input?.barcode).toBe("8901234567890");
    expect(row.input?.sellingPrice).toBe(26);
    expect(row.input?.unit).toBe("kg");
  });

  it("accepts a row missing SKU/Barcode", () => {
    const csv = `${HEADER}\nNoCode Item,Grocery,piece,,10,8,10,0,5,,,,,,\n`;
    const res = parseProductsCsv(csv);
    expect(res.validCount).toBe(1);
    expect(res.errorCount).toBe(0);
    expect(res.rows[0].valid).toBe(true);
    expect(res.rows[0].input?.barcode).toBeUndefined();
  });

  it("flags a non-numeric price", () => {
    const csv = `${HEADER}\nBad Price,Grocery,piece,SKU1,10,8,abc,0,5,,,,,,\n`;
    const res = parseProductsCsv(csv);
    expect(res.rows[0].valid).toBe(false);
    expect(res.rows[0].errors.join(" ")).toMatch(/number|selling/i);
  });

  it("flags a row missing the product name", () => {
    const csv = `${HEADER}\n,Grocery,piece,SKU2,10,8,10,0,5,,,,,,\n`;
    const res = parseProductsCsv(csv);
    expect(res.rows[0].valid).toBe(false);
  });

  it("reports a header error when required columns are missing", () => {
    const res = parseProductsCsv("Foo,Bar\n1,2\n");
    expect(res.headerError).toBeTruthy();
    expect(res.rows).toHaveLength(0);
  });

  it("ignores fully blank rows", () => {
    const csv = `${HEADER}\nTata Salt,Grocery,kg,SKU3,28,22,26,0,100,,,,,,\n\n,,,,,,,,,,,,,,\n`;
    const res = parseProductsCsv(csv);
    expect(res.rows).toHaveLength(1);
  });

  it("maps common Vyapar-style headers and Indian currency values", () => {
    const csv = "Item Name,Item Code,Purchase Price,Sale Price,Opening Quantity,Base Unit\nTata Tea,TEA-1,Rs. 120,\u20B9160,25,packet\n";
    const mapping = autoMapProductHeaders(parseCsv(csv)[0]);
    const res = parseProductsCsv(csv, mapping);
    expect(detectProductImportSource(res.headers)).toBe("vyapar");
    expect(res.rows[0].values.skuBarcode).toBe("TEA-1");
    // A packet without a declared weight is unsafe: 250 g and 1 kg must stay distinct.
    expect(res.rows[0].errors.join(" ")).toMatch(/pack size/i);
  });

  it("keeps packet weights in the product selling unit", () => {
    const csv = "Product Name,Purchase Price,Selling Price,Unit,Pack Size,Pack Unit,Barcode\nTata Salt,22,26,packet,1,kg,SALT-1KG\n";
    const res = parseProductsCsv(csv);
    expect(res.validCount).toBe(1);
    const defaultUnit = res.rows[0].input?.sellingUnits?.find((unit) => unit.isDefault);
    expect(defaultUnit?.packSizeValue).toBe(1);
    expect(defaultUnit?.packSizeUnit).toBe("kg");
    expect(defaultUnit?.conversionToBase).toBe(1000);
  });

  it("accepts loose goods without inventing a packet size", () => {
    const csv = "Name,Cost Price,Selling Price,Unit,Loose Item\nLoose Sugar,40,48,kg,yes\n";
    const res = parseProductsCsv(csv);
    expect(res.validCount).toBe(1);
    expect(res.rows[0].input?.isLooseItem).toBe(true);
    expect(res.rows[0].input?.baseUnit).toBe("gram");
  });
});

describe("product import dry-run", () => {
  const existing: Product = {
    id: "product-1",
    name: "Tata Salt",
    brand: "Tata",
    unit: "packet",
    displayUnit: "1 kg packet",
    baseUnit: "gram",
    rateUnit: "packet",
    barcode: "SALT-1KG",
    defaultPricePerRateUnit: 26,
    sellingPrice: 26,
    costPrice: 22,
    stockBaseQty: 10_000,
    lowStockThreshold: 2_000,
    sellingUnits: [{
      name: "1 kg packet",
      unitType: "packet",
      unitCode: "packet-1-kg",
      packSizeValue: 1,
      packSizeUnit: "kg",
      conversionToBase: 1000,
      barcode: "SALT-1KG",
      defaultPrice: 26,
      isDefault: true,
      isActive: true,
    }],
  };

  it("marks duplicate barcodes in the same file as errors", () => {
    const csv = "Name,Cost Price,Selling Price,Barcode\nOne,10,12,DUP-1\nTwo,20,24,DUP-1\n";
    const plan = planProductImport(parseProductsCsv(csv), []);
    expect(plan.errorCount).toBe(2);
    expect(plan.importCount).toBe(0);
    expect(buildProductImportErrorCsv(plan)).toMatch(/Duplicate barcode/i);
  });

  it("skips an existing barcode by default so retries cannot duplicate it", () => {
    const csv = "Name,Cost Price,Selling Price,Unit,Pack Size,Pack Unit,Barcode\nTata Salt,23,28,packet,1,kg,SALT-1KG\n";
    const plan = planProductImport(parseProductsCsv(csv), [existing]);
    expect(plan.skipCount).toBe(1);
    expect(plan.createCount).toBe(0);
    expect(plan.rows[0].matchedProductId).toBe(existing.id);
  });

  it("updates only mapped columns and preserves existing stock when stock is absent", () => {
    const csv = "Name,Cost Price,Selling Price,Unit,Pack Size,Pack Unit,Barcode\nTata Salt,23,28,packet,1,kg,SALT-1KG\n";
    const plan = planProductImport(parseProductsCsv(csv), [existing], "update-existing");
    expect(plan.updateCount).toBe(1);
    expect(plan.rows[0].finalInput?.sellingPrice).toBe(28);
    expect(plan.rows[0].finalInput?.stockBaseQty).toBe(10_000);
  });

  it("treats different packet weights as different products without a barcode", () => {
    const csv = "Name,Cost Price,Selling Price,Unit,Pack Size,Pack Unit\nSugar,20,25,packet,500,g\nSugar,38,45,packet,1,kg\n";
    const plan = planProductImport(parseProductsCsv(csv), []);
    expect(plan.createCount).toBe(2);
    expect(plan.errorCount).toBe(0);
  });

  it("can dry-run 10,000 products without dropping rows", () => {
    const rows = Array.from({ length: 10_000 }, (_, index) => `Product ${index + 1},10,12,SKU-${index + 1}`);
    const csv = `Name,Cost Price,Selling Price,Barcode\n${rows.join("\n")}\n`;
    const result = parseProductsCsv(csv);
    const plan = planProductImport(result, []);
    expect(result.rows).toHaveLength(10_000);
    expect(plan.createCount).toBe(10_000);
    expect(plan.errorCount).toBe(0);
    expect(fingerprintProductImport(csv)).toBe(fingerprintProductImport(csv));
  });
});

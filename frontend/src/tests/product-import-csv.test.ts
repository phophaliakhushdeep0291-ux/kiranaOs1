import { describe, expect, it } from "vitest";
import { buildProductTemplateCsv, parseCsv, parseProductsCsv, PRODUCT_IMPORT_COLUMNS } from "@/features/products/import/product-import-csv";

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

  it("flags a row missing SKU/Barcode (required)", () => {
    const csv = `${HEADER}\nNoCode Item,Grocery,piece,,10,8,10,0,5,,,,,,\n`;
    const res = parseProductsCsv(csv);
    expect(res.validCount).toBe(0);
    expect(res.rows[0].valid).toBe(false);
    expect(res.rows[0].errors.join(" ")).toMatch(/SKU|Barcode/i);
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
});

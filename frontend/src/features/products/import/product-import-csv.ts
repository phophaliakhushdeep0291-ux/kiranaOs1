import type { ProductInput } from "@/types/api";
import { productFormSchema, formToInput, type ProductFormData } from "@/features/products/pages/product-form-state";

// Zero-dependency CSV import for products. CSV is a first-class Excel format (Excel opens/edits
// it and "Save As CSV" round-trips), so we avoid a heavy/vulnerable spreadsheet parser. Users
// download the template, fill it in Excel, save as CSV, and upload it back.

export interface ImportColumn {
  header: string;
  field: keyof ProductFormData | "skuBarcode";
  example: string;
  required?: boolean;
}

// Column order = template order. `field` maps the column to a ProductFormData key.
export const PRODUCT_IMPORT_COLUMNS: ImportColumn[] = [
  { header: "Name", field: "name", example: "Tata Salt 1kg", required: true },
  { header: "Category", field: "category", example: "Grocery" },
  { header: "Unit", field: "unit", example: "piece" },
  { header: "SKU/Barcode", field: "skuBarcode", example: "8901234567890", required: true },
  { header: "MRP", field: "mrp", example: "28" },
  { header: "Cost Price", field: "costPrice", example: "22", required: true },
  { header: "Selling Price", field: "sellingPrice", example: "26", required: true },
  { header: "GST %", field: "gstRate", example: "0" },
  { header: "Opening Stock", field: "stockQuantity", example: "100" },
  { header: "Low Stock Alert", field: "lowStockAlert", example: "10" },
  { header: "Reorder Level", field: "reorderLevel", example: "20" },
  { header: "HSN", field: "hsn", example: "25010010" },
  { header: "Brand", field: "brand", example: "Tata" },
  { header: "Aliases", field: "aliasesText", example: "namak, salt" },
  { header: "Description", field: "description", example: "Iodised salt" },
];

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Template CSV (headers + one example row) for download. */
export function buildProductTemplateCsv(): string {
  const headers = PRODUCT_IMPORT_COLUMNS.map((c) => csvEscape(c.header)).join(",");
  const example = PRODUCT_IMPORT_COLUMNS.map((c) => csvEscape(c.example)).join(",");
  return `${headers}\n${example}\n`;
}

/** Minimal RFC-4180-ish CSV parser: handles quoted fields, commas/newlines in quotes, "" escapes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const s = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 1; } else { inQuotes = false; }
      } else { field += c; }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n") {
      row.push(field); rows.push(row); row = []; field = "";
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

export interface ParsedProductRow {
  rowNumber: number; // 1-based data row (excludes header)
  name: string;
  values: Record<string, string>;
  input?: ProductInput;
  errors: string[];
  valid: boolean;
}

export interface ParseProductsResult {
  rows: ParsedProductRow[];
  validCount: number;
  errorCount: number;
  headerError?: string;
}

const NUMERIC_FIELDS = new Set(["mrp", "costPrice", "sellingPrice", "gstRate", "stockQuantity", "lowStockAlert", "reorderLevel"]);

function rowToFormData(values: Record<string, string>): ProductFormData {
  const num = (key: string): number => {
    const raw = (values[key] ?? "").trim();
    if (!raw) return 0;
    const n = Number(raw.replace(/[₹,\s]/g, ""));
    return Number.isFinite(n) ? n : NaN;
  };
  return {
    name: (values.name ?? "").trim(),
    category: (values.category ?? "").trim() || "general",
    brand: (values.brand ?? "").trim() || undefined,
    unit: ((values.unit ?? "").trim() || "piece").toLowerCase(),
    barcode: (values.skuBarcode ?? "").trim(),
    hsn: (values.hsn ?? "").trim() || undefined,
    aliasesText: (values.aliasesText ?? "").trim(),
    mrp: num("mrp"),
    costPrice: num("costPrice"),
    sellingPrice: num("sellingPrice"),
    gstRate: num("gstRate"),
    minimumSellingPrice: 0,
    retailPrice: 0,
    retailFromQuantity: 1,
    wholesalePrice: 0,
    wholesaleFromQuantity: 10,
    stockQuantity: num("stockQuantity"),
    lowStockAlert: num("lowStockAlert"),
    reorderLevel: num("reorderLevel"),
    description: (values.description ?? "").trim() || undefined,
    imageUrl: "",
    isLooseItem: false,
    isActive: true,
  } as ProductFormData;
}

/** Parse an uploaded CSV into validated product rows ready for preview + import. */
export function parseProductsCsv(text: string): ParseProductsResult {
  const grid = parseCsv(text).filter((r) => r.some((cell) => cell.trim() !== ""));
  if (grid.length === 0) return { rows: [], validCount: 0, errorCount: 0, headerError: "The file is empty." };

  const headerCells = grid[0].map((h) => h.trim().toLowerCase());
  const colIndex: Partial<Record<string, number>> = {};
  for (const col of PRODUCT_IMPORT_COLUMNS) {
    const idx = headerCells.indexOf(col.header.toLowerCase());
    if (idx >= 0) colIndex[col.field as string] = idx;
  }
  if (colIndex.name === undefined || colIndex.skuBarcode === undefined) {
    return { rows: [], validCount: 0, errorCount: 0, headerError: "Missing required columns. Use the downloaded template (Name and SKU/Barcode are required)." };
  }

  const rows: ParsedProductRow[] = [];
  for (let i = 1; i < grid.length; i += 1) {
    const cells = grid[i];
    const values: Record<string, string> = {};
    for (const col of PRODUCT_IMPORT_COLUMNS) {
      const idx = colIndex[col.field as string];
      values[col.field as string] = idx !== undefined ? (cells[idx] ?? "") : "";
    }
    const errors: string[] = [];
    // numeric format check (clearer than a generic zod message)
    for (const f of NUMERIC_FIELDS) {
      if ((values[f] ?? "").trim() && Number.isNaN(Number((values[f] ?? "").replace(/[₹,\s]/g, "")))) {
        errors.push(`${f} is not a number`);
      }
    }
    const parsed = productFormSchema.safeParse(rowToFormData(values));
    let input: ProductInput | undefined;
    if (!parsed.success) {
      for (const issue of parsed.error.issues) errors.push(issue.message);
    } else {
      input = formToInput(parsed.data);
    }
    rows.push({
      rowNumber: i,
      name: values.name?.trim() || `(row ${i})`,
      values,
      input,
      errors,
      valid: errors.length === 0 && Boolean(input),
    });
  }

  const validCount = rows.filter((r) => r.valid).length;
  return { rows, validCount, errorCount: rows.length - validCount };
}

/** Trigger a browser download of the CSV template. */
export function downloadProductTemplate(filename = "kiranaos-products-template.csv"): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([buildProductTemplateCsv()], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

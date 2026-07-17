import type { Product, ProductInput } from "@/types/api";
import {
  formToInput,
  productFormSchema,
  productToForm,
  type ProductFormData,
} from "@/features/products/pages/product-form-state";

// CSV remains the safest spreadsheet interchange format in the browser. Excel, Google
// Sheets, Vyapar, myBillBook, and Tally-compatible exports can all produce CSV without
// adding a vulnerable spreadsheet parser to the billing application.

export interface ImportColumn {
  header: string;
  field: keyof ProductFormData | "skuBarcode";
  example: string;
  required?: boolean;
}

export type ProductImportField = ImportColumn["field"];
export type ProductImportMapping = Partial<Record<ProductImportField, number>>;
export type ProductImportSource = "kiranaos" | "vyapar" | "mybillbook" | "tally" | "generic";
export type ProductImportStrategy = "skip-existing" | "update-existing";
export type ProductImportAction = "create" | "update" | "skip" | "invalid";

// Keep the legacy column order stable. New packet/loose fields are appended so an old
// Veyra template can still be imported without shifting values into the wrong fields.
export const PRODUCT_IMPORT_COLUMNS: ImportColumn[] = [
  { header: "Name", field: "name", example: "Tata Salt 1kg", required: true },
  { header: "Category", field: "category", example: "Grocery" },
  { header: "Unit", field: "unit", example: "piece" },
  { header: "SKU/Barcode", field: "skuBarcode", example: "8901234567890" },
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
  { header: "Pack Size", field: "packSizeValue", example: "1" },
  { header: "Pack Unit", field: "packSizeUnit", example: "kg" },
  { header: "Loose Item", field: "isLooseItem", example: "no" },
  { header: "Active", field: "isActive", example: "yes" },
];

const COLUMN_ALIASES: Partial<Record<ProductImportField, string[]>> = {
  name: ["name", "product name", "item name", "item", "stock item", "particulars"],
  category: ["category", "product category", "item category", "group", "item group", "parent"],
  unit: ["unit", "uom", "base unit", "base units", "sale unit", "sales unit", "primary unit"],
  skuBarcode: ["sku barcode", "sku", "barcode", "bar code", "item code", "product code", "code"],
  mrp: ["mrp", "item mrp", "maximum retail price"],
  costPrice: ["cost price", "purchase price", "purchase rate", "buy price", "buying price", "standard cost"],
  sellingPrice: ["selling price", "sale price", "sales price", "selling rate", "sale rate", "standard price"],
  gstRate: ["gst", "gst percent", "gst rate", "tax", "tax percent", "tax rate"],
  stockQuantity: ["opening stock", "opening balance", "opening quantity", "stock", "stock quantity", "current stock", "closing stock", "quantity"],
  lowStockAlert: ["low stock alert", "low stock", "minimum stock", "min stock", "alert quantity"],
  reorderLevel: ["reorder level", "re order level", "reorder quantity", "reorder point"],
  hsn: ["hsn", "hsn code", "hsn sac", "hsn sac code"],
  brand: ["brand", "manufacturer", "company"],
  aliasesText: ["aliases", "alias", "search aliases", "alternate name", "alternative name"],
  description: ["description", "product description", "item description", "notes"],
  packSizeValue: ["pack size", "packet size", "net quantity", "net qty", "weight", "size"],
  packSizeUnit: ["pack unit", "packet unit", "weight unit", "size unit", "net unit"],
  isLooseItem: ["loose item", "is loose", "loose", "item type", "stock type"],
  isActive: ["active", "is active", "status", "enabled"],
};

const NUMERIC_FIELDS = new Set<ProductImportField>([
  "mrp",
  "costPrice",
  "sellingPrice",
  "gstRate",
  "stockQuantity",
  "lowStockAlert",
  "reorderLevel",
  "packSizeValue",
]);

const PACKET_UNITS = new Set(["packet", "pack", "pouch"]);

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function buildProductTemplateCsv(): string {
  const headers = PRODUCT_IMPORT_COLUMNS.map((column) => csvEscape(column.header)).join(",");
  const example = PRODUCT_IMPORT_COLUMNS.map((column) => csvEscape(column.example)).join(",");
  return `${headers}\n${example}\n`;
}

/** RFC-4180-style parser with explicit malformed-quote detection. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const source = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (inQuotes) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += character;
      }
    } else if (character === '"') {
      if (field.length > 0) throw new Error("A quoted value starts after unquoted text.");
      inQuotes = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (inQuotes) throw new Error("The CSV contains an unclosed quoted value.");
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function normaliseHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .toLowerCase()
    .replace(/%/g, " percent ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function aliasesFor(column: ImportColumn): string[] {
  return Array.from(new Set([column.header, ...(COLUMN_ALIASES[column.field] ?? [])].map(normaliseHeader)));
}

export function autoMapProductHeaders(headers: string[]): ProductImportMapping {
  const normalisedHeaders = headers.map(normaliseHeader);
  const mapping: ProductImportMapping = {};
  const used = new Set<number>();

  for (const column of PRODUCT_IMPORT_COLUMNS) {
    const aliases = aliasesFor(column);
    const index = normalisedHeaders.findIndex((header, sourceIndex) => !used.has(sourceIndex) && aliases.includes(header));
    if (index >= 0) {
      mapping[column.field] = index;
      used.add(index);
    }
  }
  return mapping;
}

export function detectProductImportSource(headers: string[]): ProductImportSource {
  const values = new Set(headers.map(normaliseHeader));
  const templateMatches = PRODUCT_IMPORT_COLUMNS.filter((column) => values.has(normaliseHeader(column.header))).length;
  if (templateMatches >= 8) return "kiranaos";
  if (values.has("stock item") || values.has("base units") || values.has("standard cost")) return "tally";
  if (values.has("item mrp") || values.has("purchase rate") || values.has("low stock quantity")) return "mybillbook";
  if (values.has("item code") && (values.has("sale price") || values.has("purchase price"))) return "vyapar";
  return "generic";
}

export interface ProductImportInspection {
  headers: string[];
  mapping: ProductImportMapping;
  source: ProductImportSource;
  dataRowCount: number;
}

export function inspectProductImportCsv(text: string): ProductImportInspection {
  const grid = parseCsv(text).filter((row) => row.some((cell) => cell.trim() !== ""));
  if (grid.length === 0) throw new Error("The file is empty.");
  const headers = grid[0].map((header, index) => index === 0 ? header.replace(/^\uFEFF/, "").trim() : header.trim());
  return {
    headers,
    mapping: autoMapProductHeaders(headers),
    source: detectProductImportSource(headers),
    dataRowCount: Math.max(0, grid.length - 1),
  };
}

function parseImportNumber(rawValue: string): number {
  const raw = rawValue.trim();
  if (!raw) return 0;
  const parenthesised = raw.startsWith("(") && raw.endsWith(")");
  const cleaned = raw
    .replace(/[\u20B9,\s]/g, "")
    .replace(/^(?:rs\.?|inr)/i, "")
    .replace(/%$/, "")
    .replace(/^\(/, "")
    .replace(/\)$/, "");
  const number = Number(cleaned);
  return Number.isFinite(number) ? (parenthesised ? -number : number) : Number.NaN;
}

function parseImportBoolean(value: string, defaultValue: boolean): boolean {
  const normalised = value.trim().toLowerCase();
  if (!normalised) return defaultValue;
  if (["yes", "y", "true", "1", "active", "enabled", "loose"].includes(normalised)) return true;
  if (["no", "n", "false", "0", "inactive", "disabled", "packed", "packet"].includes(normalised)) return false;
  return defaultValue;
}

function rowToFormData(values: Record<string, string>): ProductFormData {
  const numberValue = (field: ProductImportField) => parseImportNumber(values[field] ?? "");
  return {
    name: (values.name ?? "").trim(),
    category: (values.category ?? "").trim() || "general",
    brand: (values.brand ?? "").trim() || undefined,
    unit: ((values.unit ?? "").trim() || "piece").toLowerCase(),
    packSizeValue: numberValue("packSizeValue") || 1,
    packSizeUnit: ((values.packSizeUnit ?? "").trim() || "piece").toLowerCase(),
    sellingUnits: [],
    barcode: (values.skuBarcode ?? "").trim(),
    hsn: (values.hsn ?? "").trim() || undefined,
    aliasesText: (values.aliasesText ?? "").trim(),
    mrp: numberValue("mrp"),
    costPrice: numberValue("costPrice"),
    sellingPrice: numberValue("sellingPrice"),
    gstRate: numberValue("gstRate"),
    minimumSellingPrice: 0,
    retailPrice: 0,
    retailFromQuantity: 1,
    wholesalePrice: 0,
    wholesaleFromQuantity: 10,
    stockQuantity: numberValue("stockQuantity"),
    lowStockAlert: numberValue("lowStockAlert"),
    batchTrackingEnabled: false,
    reorderLevel: numberValue("reorderLevel"),
    description: (values.description ?? "").trim() || undefined,
    imageUrl: "",
    isLooseItem: parseImportBoolean(values.isLooseItem ?? "", false),
    isActive: parseImportBoolean(values.isActive ?? "", true),
  };
}

export interface ParsedProductRow {
  rowNumber: number;
  name: string;
  values: Record<string, string>;
  providedFields: ProductImportField[];
  formData?: ProductFormData;
  input?: ProductInput;
  errors: string[];
  valid: boolean;
}

export interface ParseProductsResult {
  rows: ParsedProductRow[];
  validCount: number;
  errorCount: number;
  headers: string[];
  mapping: ProductImportMapping;
  source: ProductImportSource;
  headerError?: string;
}

function emptyParseResult(message: string): ParseProductsResult {
  return {
    rows: [],
    validCount: 0,
    errorCount: 0,
    headers: [],
    mapping: {},
    source: "generic",
    headerError: message,
  };
}

/** Parse and validate an uploaded CSV without changing any local or cloud data. */
export function parseProductsCsv(text: string, selectedMapping?: ProductImportMapping): ParseProductsResult {
  let grid: string[][];
  try {
    grid = parseCsv(text).filter((row) => row.some((cell) => cell.trim() !== ""));
  } catch (error) {
    return emptyParseResult(error instanceof Error ? error.message : "The CSV could not be parsed.");
  }
  if (grid.length === 0) return emptyParseResult("The file is empty.");

  const headers = grid[0].map((header, index) => index === 0 ? header.replace(/^\uFEFF/, "").trim() : header.trim());
  const mapping = selectedMapping ?? autoMapProductHeaders(headers);
  const source = detectProductImportSource(headers);
  const missingColumns = PRODUCT_IMPORT_COLUMNS
    .filter((column) => column.required && mapping[column.field] === undefined)
    .map((column) => column.header);
  if (missingColumns.length > 0) {
    return {
      ...emptyParseResult(`Map the required columns before continuing: ${missingColumns.join(", ")}.`),
      headers,
      mapping,
      source,
    };
  }

  const rows: ParsedProductRow[] = [];
  for (let sourceRowIndex = 1; sourceRowIndex < grid.length; sourceRowIndex += 1) {
    const cells = grid[sourceRowIndex];
    const values: Record<string, string> = {};
    const providedFields: ProductImportField[] = [];

    for (const column of PRODUCT_IMPORT_COLUMNS) {
      const sourceColumnIndex = mapping[column.field];
      const value = sourceColumnIndex === undefined ? "" : (cells[sourceColumnIndex] ?? "");
      values[column.field] = value;
      if (sourceColumnIndex !== undefined && value.trim() !== "") providedFields.push(column.field);
    }

    const errors: string[] = [];
    for (const column of PRODUCT_IMPORT_COLUMNS.filter((item) => item.required)) {
      if (!(values[column.field] ?? "").trim()) errors.push(`${column.header} is required`);
    }
    for (const field of NUMERIC_FIELDS) {
      const value = values[field] ?? "";
      if (value.trim() && Number.isNaN(parseImportNumber(value))) {
        const label = PRODUCT_IMPORT_COLUMNS.find((column) => column.field === field)?.header ?? String(field);
        errors.push(`${label} is not a valid number`);
      }
    }

    const formData = rowToFormData(values);
    if (!formData.isLooseItem && PACKET_UNITS.has(formData.unit.toLowerCase())) {
      if (!providedFields.includes("packSizeValue") || !providedFields.includes("packSizeUnit")) {
        errors.push("Packed items require Pack Size and Pack Unit (for example 500 g or 1 kg)");
      }
    }

    const parsed = productFormSchema.safeParse(formData);
    let input: ProductInput | undefined;
    if (!parsed.success) {
      for (const issue of parsed.error.issues) errors.push(issue.message);
    } else if (errors.length === 0) {
      input = formToInput(parsed.data);
    }

    rows.push({
      rowNumber: sourceRowIndex,
      name: values.name?.trim() || `(row ${sourceRowIndex})`,
      values,
      providedFields,
      formData: parsed.success ? parsed.data : undefined,
      input,
      errors: Array.from(new Set(errors)),
      valid: errors.length === 0 && Boolean(input),
    });
  }

  const validCount = rows.filter((row) => row.valid).length;
  return {
    rows,
    validCount,
    errorCount: rows.length - validCount,
    headers,
    mapping,
    source,
  };
}

function normaliseIdentityPart(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function barcodeKey(value: unknown): string {
  return String(value ?? "").trim().replace(/\s+/g, "").toUpperCase();
}

function productNameIdentity(input: ProductInput): string {
  const defaultUnit = input.sellingUnits?.find((unit) => unit.isDefault) ?? input.sellingUnits?.[0];
  return [
    normaliseIdentityPart(input.name),
    normaliseIdentityPart(input.brand),
    normaliseIdentityPart(defaultUnit?.unitType ?? input.unit ?? input.displayUnit),
    normaliseIdentityPart(defaultUnit?.packSizeValue),
    normaliseIdentityPart(defaultUnit?.packSizeUnit),
  ].join("|");
}

function existingProductBarcodes(product: Product): string[] {
  return Array.from(new Set([
    barcodeKey(product.barcode),
    barcodeKey(product.sku),
    ...(product.sellingUnits ?? []).map((unit) => barcodeKey(unit.barcode)),
  ].filter(Boolean)));
}

function existingProductIdentity(product: Product): string {
  const input = formToInput(productToForm(product));
  return productNameIdentity(input);
}

function mergeRowWithExistingProduct(row: ParsedProductRow, existing: Product): ProductInput {
  const mergedForm = productToForm(existing);
  const merged = mergedForm as unknown as Record<string, unknown>;
  const imported = row.formData as unknown as Record<string, unknown>;
  for (const field of row.providedFields) {
    if (field === "skuBarcode") merged.barcode = row.values.skuBarcode?.trim() ?? "";
    else merged[field] = imported[field];
  }
  const parsed = productFormSchema.parse(mergedForm);
  return formToInput(parsed);
}

export interface PlannedProductImportRow extends ParsedProductRow {
  action: ProductImportAction;
  matchReason?: "barcode" | "name-pack";
  matchedProductId?: string;
  finalInput?: ProductInput;
}

export interface ProductImportPlan {
  rows: PlannedProductImportRow[];
  createCount: number;
  updateCount: number;
  skipCount: number;
  errorCount: number;
  importCount: number;
}

function addToMultiMap(map: Map<string, Product[]>, key: string, product: Product): void {
  if (!key) return;
  map.set(key, [...(map.get(key) ?? []), product]);
}

/**
 * Reconcile a dry-run against current local products. Barcode is authoritative; products
 * without one use name + brand + unit + packet size so 500 g and 1 kg remain distinct.
 */
export function planProductImport(
  result: ParseProductsResult,
  existingProducts: Product[],
  strategy: ProductImportStrategy = "skip-existing",
): ProductImportPlan {
  const barcodeRows = new Map<string, number[]>();
  const identityRows = new Map<string, number[]>();
  for (const row of result.rows.filter((item) => item.valid && item.input)) {
    const barcode = barcodeKey(row.input?.barcode ?? row.input?.sku);
    const identity = row.input ? productNameIdentity(row.input) : "";
    const target = barcode ? barcodeRows : identityRows;
    const key = barcode || identity;
    target.set(key, [...(target.get(key) ?? []), row.rowNumber]);
  }

  const existingByBarcode = new Map<string, Product[]>();
  const existingByIdentity = new Map<string, Product[]>();
  for (const product of existingProducts.filter((item) => !item.deletedAt)) {
    for (const barcode of existingProductBarcodes(product)) addToMultiMap(existingByBarcode, barcode, product);
    addToMultiMap(existingByIdentity, existingProductIdentity(product), product);
  }

  const rows: PlannedProductImportRow[] = result.rows.map((row) => {
    if (!row.valid || !row.input) return { ...row, action: "invalid" };
    const barcode = barcodeKey(row.input.barcode ?? row.input.sku);
    const identity = productNameIdentity(row.input);
    const duplicateRows = barcode ? barcodeRows.get(barcode) : identityRows.get(identity);
    if ((duplicateRows?.length ?? 0) > 1) {
      return {
        ...row,
        errors: [...row.errors, `Duplicate ${barcode ? "barcode" : "product and pack size"} in rows ${duplicateRows?.join(", ")}`],
        valid: false,
        action: "invalid",
      };
    }

    const barcodeMatches = barcode ? (existingByBarcode.get(barcode) ?? []) : [];
    const identityMatches = existingByIdentity.get(identity) ?? [];
    if (barcodeMatches.length > 1 || (!barcode && identityMatches.length > 1)) {
      return {
        ...row,
        errors: [...row.errors, "Multiple existing products match this row. Resolve the duplicate products first."],
        valid: false,
        action: "invalid",
      };
    }

    let match = barcodeMatches[0];
    let matchReason: PlannedProductImportRow["matchReason"] = match ? "barcode" : undefined;
    if (!match && identityMatches.length === 1) {
      const candidate = identityMatches[0];
      const candidateBarcodes = existingProductBarcodes(candidate);
      if (barcode && candidateBarcodes.length > 0 && !candidateBarcodes.includes(barcode)) {
        return {
          ...row,
          errors: [...row.errors, "The same product and pack size already exists with a different barcode."],
          valid: false,
          action: "invalid",
        };
      }
      match = candidate;
      matchReason = "name-pack";
    }

    if (!match) return { ...row, action: "create", finalInput: row.input };
    if (strategy === "skip-existing") {
      return { ...row, action: "skip", matchedProductId: match.id, matchReason };
    }

    try {
      return {
        ...row,
        action: "update",
        matchedProductId: match.id,
        matchReason,
        finalInput: mergeRowWithExistingProduct(row, match),
      };
    } catch (error) {
      return {
        ...row,
        errors: [...row.errors, error instanceof Error ? error.message : "Could not merge this row with the existing product."],
        valid: false,
        action: "invalid",
      };
    }
  });

  const createCount = rows.filter((row) => row.action === "create").length;
  const updateCount = rows.filter((row) => row.action === "update").length;
  const skipCount = rows.filter((row) => row.action === "skip").length;
  const errorCount = rows.filter((row) => row.action === "invalid").length;
  return { rows, createCount, updateCount, skipCount, errorCount, importCount: createCount + updateCount };
}

export function buildProductImportErrorCsv(plan: ProductImportPlan): string {
  const columns = ["Row", "Action", "Errors", ...PRODUCT_IMPORT_COLUMNS.map((column) => column.header)];
  const rows = plan.rows
    .filter((row) => row.action === "invalid")
    .map((row) => [
      String(row.rowNumber),
      row.action,
      row.errors.join("; "),
      ...PRODUCT_IMPORT_COLUMNS.map((column) => row.values[column.field] ?? ""),
    ]);
  return [columns, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n") + "\n";
}

function triggerCsvDownload(content: string, filename: string): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function downloadProductTemplate(filename = "kiranaos-products-template.csv"): void {
  triggerCsvDownload(buildProductTemplateCsv(), filename);
}

export function downloadProductImportErrors(plan: ProductImportPlan, filename = "kiranaos-product-import-errors.csv"): void {
  triggerCsvDownload(buildProductImportErrorCsv(plan), filename);
}

export function fingerprintProductImport(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `products-${(hash >>> 0).toString(16).padStart(8, "0")}-${text.length}`;
}

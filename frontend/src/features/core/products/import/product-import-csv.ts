import type { Product, ProductInput } from "@/types/api";
import { getStoredBusinessType, type BusinessType } from "@/features/core/settings/business-type-store";
import { defaultCategoryFor } from "@/features/core/settings/business-types";
import {
  productAttributeFieldsFor,
  type ProductAttributeField,
  type ProductAttributes,
} from "@/features/core/products/product-attributes";
import {
  defaultStockTrackingForBusinessType,
  formToInput,
  productFormSchema,
  productToForm,
  type ProductFormData,
} from "@/features/core/products/pages/product-form-state";
import {
  isKnownPackUnit,
  sellingUnitCode,
  sellingUnitConversion,
  sellingUnitName,
} from "@/features/core/products/pages/product-pricing";

/** One extra pack size, shaped exactly as the product form holds it. */
type ProductFormSellingUnit = ProductFormData["sellingUnits"][number];

// CSV remains the safest spreadsheet interchange format in the browser. Excel, Google
// Sheets, Vyapar, myBillBook, and Tally-compatible exports can all produce CSV without
// adding a vulnerable spreadsheet parser to the billing application.

/**
 * A trade-details column, tagged so it cannot be confused with a form field.
 *
 * The prefix is what lets one mapping object hold both kinds: `attr:composition`
 * is a key on the product's attribute bag, `brand` is a column on the product
 * itself, and nothing downstream has to keep a second list to tell them apart.
 */
export type ProductImportAttributeField = `attr:${string}`;

export interface ImportColumn {
  header: string;
  field: keyof ProductFormData | "skuBarcode" | ProductImportAttributeField;
  example: string;
  required?: boolean;
}

export type ProductImportField = ImportColumn["field"];
export type ProductImportMapping = Partial<Record<ProductImportField, number>>;
export type ProductImportSource = "kiranaos" | "vyapar" | "mybillbook" | "tally" | "generic";
export type ProductImportStrategy = "skip-existing" | "update-existing";
export type ProductImportAction = "create" | "update" | "skip" | "invalid";

// Keep the legacy column order stable. New packet/loose fields are appended so an old
// Artha template can still be imported without shifting values into the wrong fields.
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
  // Every OTHER size the same stock is sold in. One cell rather than a numbered run of
  // columns, because the count varies per product and a spreadsheet cannot grow a column
  // per row; and one row per product rather than one per pack, because a pack is not a
  // product here — it is a selling unit drawing on the product's single pool of stock.
  { header: "Pack Sizes", field: "sellingUnits", example: "packet 500 gram @ 30 | packet 5 kg @ 265" },
  // A link, never image bytes. A pasted data URL would put ~24 kB of base64 into
  // the product row for every line of the sheet, and that row is carried in full
  // by every sync payload and every catalogue re-download. Scanning a barcode
  // fills this automatically from the product lookup; the column exists so a shop
  // that already has its own photo URLs can bring them, and so the starter
  // catalogue can carry them once barcodes are sourced for it.
  { header: "Image URL", field: "imageUrl", example: "https://example.com/tata-salt.jpg" },
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
  // Deliberately none of "size"/"pack size" — those belong to the DEFAULT pack above,
  // and stealing them here would move a product's own size into its extra-sizes list.
  sellingUnits: ["pack sizes", "other pack sizes", "extra packs", "selling units"],
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

export function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function attributeExample(field: ProductAttributeField): string {
  if (field.type === "boolean") return "no";
  if (field.type === "select") return field.options?.[0] ?? "";
  // The placeholder already reads "e.g. 100% cotton", which is exactly what an
  // example cell should say — minus the prefix, which is form copy, not data.
  return (field.placeholder ?? "").replace(/^e\.g\.\s*/i, "");
}

/**
 * The trade's own columns, appended after the fixed ones.
 *
 * Appended rather than interleaved, and never replacing a base column: an older
 * template must still import into the same fields, and the starter catalogue
 * writes the base list directly. A shop that changes business type gets a
 * different tail on its next template download and can still import the old one
 * — the unmatched columns simply map to nothing.
 */
export function productImportAttributeColumns(businessType: BusinessType): ImportColumn[] {
  return productAttributeFieldsFor(businessType).map((field) => ({
    header: field.label,
    field: `attr:${field.key}` as ProductImportAttributeField,
    example: attributeExample(field),
  }));
}

export function productImportColumns(businessType: BusinessType = getStoredBusinessType()): ImportColumn[] {
  return [...PRODUCT_IMPORT_COLUMNS, ...productImportAttributeColumns(businessType)];
}

export function buildProductTemplateCsv(businessType: BusinessType = getStoredBusinessType()): string {
  const columns = productImportColumns(businessType);
  const headers = columns.map((column) => csvEscape(column.header)).join(",");
  const example = columns.map((column) => csvEscape(column.example)).join(",");
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

export function autoMapProductHeaders(
  headers: string[],
  businessType: BusinessType = getStoredBusinessType(),
): ProductImportMapping {
  const normalisedHeaders = headers.map(normaliseHeader);
  const mapping: ProductImportMapping = {};
  const used = new Set<number>();

  // Base columns first, so a trade field that happens to share a label with one
  // of them ("Brand", "Colour") can never steal the column the product itself
  // needs — the fixed fields are the ones billing and stock read.
  for (const column of productImportColumns(businessType)) {
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

/**
 * A link to a picture, or nothing.
 *
 * Deliberately refuses a `data:` URL. Someone exporting from another tool can
 * easily produce a sheet with base64 images inlined, and accepting those would
 * put ~24 kB into every product row — a cost paid again in each device's
 * IndexedDB, in every sync payload, and in every catalogue re-download. An
 * unusable value is dropped rather than failing the row: a bad image link is not
 * a reason to reject a product someone is trying to stock.
 */
function importedImageUrl(value: string | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function parseImportBoolean(value: string, defaultValue: boolean): boolean {
  const normalised = value.trim().toLowerCase();
  if (!normalised) return defaultValue;
  if (["yes", "y", "true", "1", "active", "enabled", "loose"].includes(normalised)) return true;
  if (["no", "n", "false", "0", "inactive", "disabled", "packed", "packet"].includes(normalised)) return false;
  return defaultValue;
}

/* ─── The "Pack Sizes" cell ──────────────────────────────────────────────────
 *
 * `packet 5 kg @ 265 #8901234500055 | packet 500 gram @ 30`
 *
 * Written and read in one place so the two can never drift apart. The label is the
 * pack's own display name, so a round-trip through this file is a no-op and a shop
 * editing the cell by hand types what it already sees on the product screen.
 *
 * Deliberately absent: per-pack cost and MRP. Leaving them blank is what makes the
 * server scale them from the product, which is both the form's default and what a
 * shop means by "the 5 kg costs five times the 1 kg" — writing them out would freeze
 * today's arithmetic into every future price change.
 */
const PACK_CELL_SEPARATOR = /[|;\n]+/;

function splitOnce(value: string, marker: string): [string, string | undefined] {
  const index = value.indexOf(marker);
  return index === -1 ? [value, undefined] : [value.slice(0, index), value.slice(index + 1)];
}

export function formatPackSizesCell(units: ProductFormSellingUnit[]): string {
  return units
    .filter((unit) => !unit.isDefault && unit.isActive !== false)
    .map((unit) => {
      const label = sellingUnitName(unit.unitType, unit.packSizeValue, unit.packSizeUnit);
      const barcode = String(unit.barcode ?? "").trim();
      return `${label} @ ${Number(unit.defaultPrice) || 0}${barcode ? ` #${barcode}` : ""}`;
    })
    .join(" | ");
}

export interface ParsedPackSizesCell {
  units: ProductFormSellingUnit[];
  errors: string[];
}

/**
 * `fallbackUnitType` lets a shop write the shorthand `5 kg @ 265` and mean "another
 * packet of this", which is how a person writing the column by hand thinks of it.
 */
export function parsePackSizesCell(cell: string, fallbackUnitType: string): ParsedPackSizesCell {
  const units: ProductFormSellingUnit[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  if (!cell.trim()) return { units, errors };

  for (const rawEntry of cell.split(PACK_CELL_SEPARATOR)) {
    const entry = rawEntry.trim();
    if (!entry) continue;

    const [packPart, barcodePart] = splitOnce(entry, "#");
    const [namePart, pricePart] = splitOnce(packPart, "@");
    if (pricePart === undefined) {
      errors.push(`Pack "${entry}" needs a price — write it as "packet 500 gram @ 30"`);
      continue;
    }
    const price = parseImportNumber(pricePart);
    if (!Number.isFinite(price) || price < 0) {
      errors.push(`Pack "${entry}" has no valid price`);
      continue;
    }

    const tokens = namePart.trim().split(/\s+/).filter(Boolean);
    let unitType: string;
    let packSizeValue: number;
    let packSizeUnit: string;
    if (tokens.length >= 3 && Number(tokens[1]) > 0) {
      [unitType, packSizeValue, packSizeUnit] = [tokens[0], Number(tokens[1]), tokens[2]];
    } else if (tokens.length === 2 && Number(tokens[0]) > 0) {
      [unitType, packSizeValue, packSizeUnit] = [fallbackUnitType, Number(tokens[0]), tokens[1]];
    } else if (tokens.length === 1 && !Number.isFinite(Number(tokens[0]))) {
      [unitType, packSizeValue, packSizeUnit] = [tokens[0], 1, tokens[0]];
    } else {
      errors.push(`Pack "${entry}" is not a size — write it as "packet 500 gram @ 30"`);
      continue;
    }
    unitType = unitType.toLowerCase();
    packSizeUnit = packSizeUnit.toLowerCase();

    // A measure nobody tabulated converts at 1:1, so "500 gm" would quietly build a
    // 500-PIECE pack. Refuse it by name rather than import a pack that empties a shelf.
    if (!isKnownPackUnit(packSizeUnit)) {
      errors.push(`Pack "${entry}" uses an unknown measure "${packSizeUnit}"`);
      continue;
    }
    const conversionToBase = sellingUnitConversion(packSizeValue, packSizeUnit);
    if (!(conversionToBase > 0)) {
      errors.push(`Pack "${entry}" has no size`);
      continue;
    }
    const unitCode = sellingUnitCode(unitType, packSizeValue, packSizeUnit);
    if (seen.has(unitCode)) {
      errors.push(`Pack "${sellingUnitName(unitType, packSizeValue, packSizeUnit)}" is listed twice`);
      continue;
    }
    seen.add(unitCode);

    units.push({
      name: sellingUnitName(unitType, packSizeValue, packSizeUnit),
      unitType,
      unitCode,
      packSizeValue,
      packSizeUnit,
      conversionToBase,
      barcode: (barcodePart ?? "").trim() || null,
      defaultPrice: price,
      costPrice: null,
      maximumPrice: null,
      onHandQty: null,
      isDefault: false,
      isActive: true,
    });
  }
  return { units, errors };
}

/**
 * The trade columns of one row, turned into the product's attribute bag.
 *
 * Blank cells are skipped rather than stored empty — a spreadsheet is mostly
 * blanks, and writing every one of them would fill the bag with nothing and make
 * "this product has no fabric recorded" indistinguishable from "someone typed a
 * space". A number that will not parse is skipped for the same reason a bad
 * price row is rejected: a wrong figure is worse than a missing one.
 */
function rowToAttributes(values: Record<string, string>, businessType: BusinessType): ProductAttributes {
  const attributes: ProductAttributes = {};
  for (const field of productAttributeFieldsFor(businessType)) {
    const raw = (values[`attr:${field.key}`] ?? "").trim();
    if (!raw) continue;
    if (field.type === "number") {
      const parsed = parseImportNumber(raw);
      if (Number.isFinite(parsed)) attributes[field.key] = parsed;
      continue;
    }
    if (field.type === "boolean") {
      attributes[field.key] = parseImportBoolean(raw, false);
      continue;
    }
    attributes[field.key] = field.maxLength ? raw.slice(0, field.maxLength) : raw;
  }
  return attributes;
}

function rowToFormData(
  values: Record<string, string>,
  businessType: BusinessType,
  sellingUnits: ProductFormSellingUnit[],
): ProductFormData {
  const numberValue = (field: ProductImportField) => parseImportNumber(values[field] ?? "");
  return {
    attributes: rowToAttributes(values, businessType),
    name: (values.name ?? "").trim(),
    // The Pack Sizes column carries what a product is SOLD in, never how many of each
    // are on the shelf: a spreadsheet has one stock figure per row, so every imported
    // product keeps the shared pool and its sizes all draw on that.
    packagingMode: "pooled",
    // A spreadsheet row is one plain product. A size × colour grid is entered on
    // the product screen, where the shop can see the combinations it is creating.
    variantAxes: [],
    category: (values.category ?? "").trim() || defaultCategoryFor(businessType),
    brand: (values.brand ?? "").trim() || undefined,
    unit: ((values.unit ?? "").trim() || "piece").toLowerCase(),
    packSizeValue: numberValue("packSizeValue") || 1,
    packSizeUnit: ((values.packSizeUnit ?? "").trim() || "piece").toLowerCase(),
    sellingUnits,
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
    // A restaurant product import is normally its menu. Ingredients and bottled
    // goods can still be opted into stock on their row after import.
    stockTrackingEnabled: defaultStockTrackingForBusinessType(businessType),
    // A bulk import never classifies a controlled drug — that is a decision
    // someone makes per medicine, not a column to be trusted from a CSV.
    drugSchedule: null,
    reorderLevel: numberValue("reorderLevel"),
    description: (values.description ?? "").trim() || undefined,
    imageUrl: importedImageUrl(values.imageUrl),
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
export function parseProductsCsv(
  text: string,
  selectedMapping?: ProductImportMapping,
  businessType: BusinessType = getStoredBusinessType(),
): ParseProductsResult {
  let grid: string[][];
  try {
    grid = parseCsv(text).filter((row) => row.some((cell) => cell.trim() !== ""));
  } catch (error) {
    return emptyParseResult(error instanceof Error ? error.message : "The CSV could not be parsed.");
  }
  if (grid.length === 0) return emptyParseResult("The file is empty.");

  const headers = grid[0].map((header, index) => index === 0 ? header.replace(/^\uFEFF/, "").trim() : header.trim());
  const columns = productImportColumns(businessType);
  const mapping = selectedMapping ?? autoMapProductHeaders(headers, businessType);
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

    for (const column of columns) {
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

    const packSizes = parsePackSizesCell(
      values.sellingUnits ?? "",
      ((values.unit ?? "").trim() || "piece").toLowerCase(),
    );
    errors.push(...packSizes.errors);

    const formData = rowToFormData(values, businessType, packSizes.units);
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

export function downloadProductTemplate(filename = "artha-products-template.csv"): void {
  triggerCsvDownload(buildProductTemplateCsv(), filename);
}

export function downloadProductImportErrors(plan: ProductImportPlan, filename = "artha-product-import-errors.csv"): void {
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

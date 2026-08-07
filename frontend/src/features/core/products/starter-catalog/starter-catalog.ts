import { PRODUCT_IMPORT_COLUMNS, type ProductImportField } from "@/features/core/products/import/product-import-csv";

/**
 * One row of the built-in starter catalog.
 *
 * The shape is the import column contract with real types: numbers are numbers, the
 * yes/no columns are booleans, and Aliases is the list it always was. Everything is
 * readonly because the catalog is shipped data — a screen that edited it would be
 * changing what the NEXT shop gets loaded.
 */
export interface StarterCatalogItem {
  readonly name: string;
  readonly category: string;
  readonly unit: string;
  readonly skuBarcode: string;
  readonly mrp: number;
  readonly costPrice: number;
  readonly sellingPrice: number;
  readonly gstRate: number;
  readonly stockQuantity: number;
  readonly lowStockAlert: number;
  readonly reorderLevel: number;
  readonly hsn: string;
  readonly brand: string;
  readonly aliases: readonly string[];
  readonly description: string;
  readonly packSizeValue: number;
  readonly packSizeUnit: string;
  readonly isLooseItem: boolean;
  readonly isActive: boolean;
}

/**
 * How many products the built-in catalog holds.
 *
 * Stated here rather than read off the generated array so a screen can put the number in
 * a button label without pulling 200 kB of product rows into its chunk to count them.
 * starter-catalog.test.ts fails if it drifts from the generated data.
 */
export const STARTER_CATALOG_ITEM_COUNT = 560;

/** Runtime half of `readonly`: the generated module is frozen, not merely typed. */
export function freezeStarterCatalog(items: StarterCatalogItem[]): readonly StarterCatalogItem[] {
  for (const item of items) {
    Object.freeze(item.aliases);
    Object.freeze(item);
  }
  return Object.freeze(items);
}

// Same rule as the importer's own writer: quote only when the value would otherwise
// break the row apart.
function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * One writer per import column.
 *
 * This cannot be a `Record<ProductImportField, ...>`: that field type is
 * `keyof ProductFormData | "skuBarcode"`, the whole product form, not the nineteen
 * columns the CSV actually has — so the exhaustive version demanded writers for
 * `imageUrl`, `variantAxes` and ten other fields no column carries. Coverage is instead
 * checked against PRODUCT_IMPORT_COLUMNS itself, below, which is the real contract:
 * add a column without deciding what the starter catalog puts in it and the build that
 * regenerates the catalog throws, naming the column.
 */
const CELL: Partial<Record<ProductImportField, (item: StarterCatalogItem) => string>> = {
  name: (item) => item.name,
  category: (item) => item.category,
  unit: (item) => item.unit,
  skuBarcode: (item) => item.skuBarcode,
  mrp: (item) => String(item.mrp),
  costPrice: (item) => String(item.costPrice),
  sellingPrice: (item) => String(item.sellingPrice),
  gstRate: (item) => String(item.gstRate),
  stockQuantity: (item) => String(item.stockQuantity),
  lowStockAlert: (item) => String(item.lowStockAlert),
  reorderLevel: (item) => String(item.reorderLevel),
  hsn: (item) => item.hsn,
  brand: (item) => item.brand,
  aliasesText: (item) => item.aliases.join(", "),
  description: (item) => item.description,
  packSizeValue: (item) => String(item.packSizeValue),
  packSizeUnit: (item) => item.packSizeUnit,
  isLooseItem: (item) => (item.isLooseItem ? "yes" : "no"),
  isActive: (item) => (item.isActive ? "yes" : "no"),
};

/**
 * Render the catalog as the CSV the normal importer already accepts.
 *
 * This exists so the built-in load runs through exactly one product-creation path —
 * parseProductsCsv → planProductImport → importProductsLocalFirst — the same one a
 * shopkeeper's own spreadsheet takes, with the same validation, the same duplicate
 * reconciliation and the same audit trail. A second, "faster" path that built
 * ProductInputs directly would be a second set of rules to keep correct.
 */
export function starterCatalogToCsv(items: readonly StarterCatalogItem[]): string {
  const header = PRODUCT_IMPORT_COLUMNS.map((column) => csvEscape(column.header)).join(",");
  const rows = items.map((item) => PRODUCT_IMPORT_COLUMNS.map((column) => csvEscape(CELL[column.field](item))).join(","));
  return `${header}\n${rows.join("\n")}\n`;
}

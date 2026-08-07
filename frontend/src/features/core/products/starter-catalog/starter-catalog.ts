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
 * Exhaustive over the import contract on purpose. Adding a column to
 * PRODUCT_IMPORT_COLUMNS without deciding what the starter catalog puts in it is a
 * typecheck error here rather than a silently blank column at the shop counter.
 */
const CELL: Record<ProductImportField, (item: StarterCatalogItem) => string> = {
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

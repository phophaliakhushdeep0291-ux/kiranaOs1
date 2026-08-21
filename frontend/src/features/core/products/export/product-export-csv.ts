import type { Product } from "@/types/api";
import { roundMoney } from "@/lib/money";
import { getStoredBusinessType, type BusinessType } from "@/features/core/settings/business-type-store";
import { productToForm, type ProductFormData } from "@/features/core/products/pages/product-form-state";
import {
  csvEscape,
  formatPackSizesCell,
  productImportColumns,
  type ImportColumn,
} from "@/features/core/products/import/product-import-csv";

/**
 * A shop's catalogue, written in the format its own importer reads.
 *
 * This exists to move a catalogue between shops — the same owner opening a second
 * branch should not retype four hundred items. So the contract that matters is not
 * "a readable spreadsheet" but "a file the Import dialog accepts": the columns are
 * `productImportColumns()` itself, in its order, rather than a list copied here that
 * would drift the first time a trade gained a field.
 *
 * What deliberately does NOT travel: ids, stock movements, bills, and anything else
 * that belongs to the shop it came from. A pack's cost and MRP stay blank so the new
 * shop scales them from its own product figures — see `formatPackSizesCell`.
 */
/**
 * The whole shelf, counted in the pack the importer will count in.
 *
 * NOT `form.stockQuantity`: on a "count each size" product that field holds the DEFAULT
 * pack's own count, because that is what its box on the form means. Exporting it wrote
 * 30 for a product holding 30x1kg + 6x5kg + 24x500g and quietly left 42 kg behind. The
 * product's base total divided by the default pack is the same number the form shows for
 * a pooled product, so one formula serves both modes.
 */
function exportOpeningStock(form: ProductFormData, product: Product): number {
  const units = product.sellingUnits ?? [];
  const conversion = Number(units.find((unit) => unit.isDefault)?.conversionToBase ?? units[0]?.conversionToBase ?? 0);
  const baseQuantity = Number(product.stockBaseQty ?? Number.NaN);
  if (conversion > 0 && Number.isFinite(baseQuantity)) return roundMoney(baseQuantity / conversion);
  return Number(form.stockQuantity) || 0;
}

function cellFor(column: ImportColumn, form: ProductFormData, product: Product): string {
  const field = column.field;
  if (field === "skuBarcode") return String(form.barcode ?? product.sku ?? "");
  if (field === "sellingUnits") return formatPackSizesCell(form.sellingUnits ?? []);
  if (field === "stockQuantity") return String(exportOpeningStock(form, product));
  if (typeof field === "string" && field.startsWith("attr:")) {
    const value = form.attributes?.[field.slice("attr:".length)];
    if (value === undefined || value === null) return "";
    if (typeof value === "boolean") return value ? "yes" : "no";
    return String(value);
  }

  const value = form[field as keyof ProductFormData];
  if (value === undefined || value === null) return "";
  // The importer reads these back with parseImportBoolean, which spells them this way.
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "string") return value;
  return "";
}

export function buildProductExportCsv(
  products: Product[],
  businessType: BusinessType = getStoredBusinessType(),
): string {
  const columns = productImportColumns(businessType);
  const header = columns.map((column) => csvEscape(column.header)).join(",");
  const lines = products.map((product) => {
    const form = productToForm(product);
    return columns.map((column) => csvEscape(cellFor(column, form, product))).join(",");
  });
  return `${[header, ...lines].join("\n")}\n`;
}

export function productExportFileName(shopName: string | undefined, today = new Date()): string {
  const slug = String(shopName ?? "shop")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "shop";
  return `products-${slug}-${today.toISOString().slice(0, 10)}.csv`;
}

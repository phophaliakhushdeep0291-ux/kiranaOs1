import { fromInventoryBaseQty, roundInventoryValue, toInventoryBaseQty } from "@/features/core/inventory/calculations";
import type { InventoryItem, Product, ProductSellingUnit } from "@/types/api";

type StockRecord = (Product | InventoryItem) & Record<string, unknown>;

function readNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (value === "" || value === null || value === undefined) continue;
    const numberValue = Number(value);
    if (Number.isFinite(numberValue)) return numberValue;
  }
  return undefined;
}

function cleanText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function sameText(left: unknown, right: unknown) {
  return String(left ?? "").trim().toLowerCase() === String(right ?? "").trim().toLowerCase();
}

function unitMatches(unit: ProductSellingUnit, value?: string | null) {
  if (!value) return false;
  return sameText(unit.unitCode, value) || sameText(unit.name, value) || sameText(unit.unitType, value);
}

export function activeInventorySellingUnits(item?: Product | InventoryItem | null): ProductSellingUnit[] {
  return (item?.sellingUnits ?? []).filter((unit) => unit && unit.isActive !== false);
}

/**
 * A pack's size, as a shopkeeper says it out loud: "5 kg", "500 gram".
 *
 * The stored `name` carries the container too ("packet 5 kg"), which is fine on its
 * own line but turns a list of sizes into a wall of repeated words. Falls back to
 * the full name when a pack has no size on it (a restaurant portion, say).
 */
export function packSizeLabel(unit: ProductSellingUnit): string {
  const size = Number(unit.packSizeValue ?? 0);
  const measure = String(unit.packSizeUnit ?? "").trim();
  if (size > 0 && measure) return `${size} ${measure}`;
  return unit.name ?? unit.unitCode;
}

export function defaultInventorySellingUnit(item?: Product | InventoryItem | null): ProductSellingUnit | undefined {
  const units = activeInventorySellingUnits(item);
  return units.find((unit) => unit.isDefault) ?? units[0];
}

export function findInventorySellingUnit(item?: Product | InventoryItem | null, value?: string | null): ProductSellingUnit | undefined {
  const units = activeInventorySellingUnits(item);
  const defaultUnit = units.find((unit) => unit.isDefault) ?? units[0];
  if (!value) return defaultUnit;
  const exact = units.find((unit) => unitMatches(unit, value));
  if (exact) return exact;
  const sameType = units.filter((unit) => sameText(unit.unitType, value));
  return sameType.find((unit) => unit.isDefault) ?? sameType[0];
}

export function inventoryBaseQuantity(item: Product | InventoryItem): number {
  const record = item as StockRecord;
  const explicitBase = readNumber(
    item.stockBaseQty,
    record.stock_base_qty,
    record.currentStockBaseQty,
    record.current_stock_base_qty,
  );
  if (explicitBase !== undefined) return roundInventoryValue(explicitBase);

  const displayQty = readNumber(item.stockQuantity, record.stock_quantity, record.quantity, record.qty) ?? 0;
  const sellingUnit = defaultInventorySellingUnit(item);
  if (sellingUnit && sellingUnit.conversionToBase > 0) {
    return roundInventoryValue(displayQty * sellingUnit.conversionToBase);
  }
  return toInventoryBaseQty(displayQty, item.unit ?? item.rateUnit ?? item.displayUnit ?? item.baseUnit ?? "piece", item.baseUnit);
}

export function inventoryMovementUnit(item?: Product | InventoryItem | null): string {
  const sellingUnit = defaultInventorySellingUnit(item);
  return sellingUnit?.unitCode
    ?? cleanText(item?.stockUnit)
    ?? cleanText(item?.unit)
    ?? cleanText(item?.rateUnit)
    ?? cleanText(item?.displayUnit)
    ?? cleanText(item?.baseUnit)
    ?? "piece";
}

export function inventorySimpleUnit(item?: Product | InventoryItem | null, value?: string | null): string {
  const sellingUnit = findInventorySellingUnit(item, value);
  return sellingUnit?.unitType
    ?? cleanText(value)
    ?? cleanText(item?.unit)
    ?? cleanText(item?.rateUnit)
    ?? cleanText(item?.displayUnit)
    ?? cleanText(item?.baseUnit)
    ?? "piece";
}

export function inventoryUnitLabel(item?: Product | InventoryItem | null, value?: string | null): string {
  const sellingUnit = findInventorySellingUnit(item, value);
  return sellingUnit?.name
    ?? cleanText(value)
    ?? cleanText(item?.displayUnit)
    ?? cleanText(item?.unit)
    ?? cleanText(item?.rateUnit)
    ?? cleanText(item?.baseUnit)
    ?? "piece";
}

export function inventoryConversionToBase(item?: Product | InventoryItem | null, value?: string | null): number | undefined {
  const sellingUnit = findInventorySellingUnit(item, value);
  return sellingUnit && sellingUnit.conversionToBase > 0
    ? roundInventoryValue(sellingUnit.conversionToBase)
    : undefined;
}

export function inventoryQuantityToBase(item: Product | InventoryItem | undefined, quantity: number, unit?: string | null): number {
  const sellingUnit = findInventorySellingUnit(item, unit);
  if (sellingUnit && sellingUnit.conversionToBase > 0) {
    return roundInventoryValue(Number(quantity || 0) * sellingUnit.conversionToBase);
  }
  const fallbackUnit = unit ?? item?.unit ?? item?.rateUnit ?? item?.displayUnit ?? item?.baseUnit ?? "piece";
  return toInventoryBaseQty(quantity, fallbackUnit, item?.baseUnit);
}

export function inventoryDisplayQuantity(item: Product | InventoryItem, unit?: string | null): number {
  const baseQty = inventoryBaseQuantity(item);
  const sellingUnit = findInventorySellingUnit(item, unit);
  if (sellingUnit && sellingUnit.conversionToBase > 0) {
    return roundInventoryValue(baseQty / sellingUnit.conversionToBase);
  }
  const targetUnit = unit ?? item.unit ?? item.rateUnit ?? item.displayUnit ?? item.baseUnit ?? "piece";
  return fromInventoryBaseQty(baseQty, item.baseUnit ?? targetUnit, targetUnit);
}

/**
 * How much of this product is on the shelf, said in one line: "60 piece 100 ml".
 *
 * The count has to be the shopkeeper's, not the database's. Stock is stored in
 * base units (g/ml/piece), so sixty 100 ml bottles are 6,000 on disk. A caller
 * that divides by a unit NAME rather than the pack's own conversion gets none of
 * that back — product-pricing's fromBaseQty falls through to a factor of 1 for
 * any measure it does not recognise, and a pack name ("piece 100 ml") is never in
 * its table, so the raw 6,000 was printed under the bottle's own label. A
 * per-pack product answers with its default pack's own count, because it keeps no
 * single pooled total that could be divided.
 *
 * Negative stock is real and worth seeing: the counter lets a sale through when a
 * stock-in has not been recorded yet, and the deficit is what tells the owner to
 * reconcile.
 */
export function inventoryStockLabel(item: Product | InventoryItem): string {
  const label = inventoryUnitLabel(item);
  const pack = defaultInventorySellingUnit(item);
  const quantity = item.packagingMode === "per_pack" && pack
    ? roundInventoryValue(Number(pack.onHandQty ?? 0))
    : inventoryDisplayQuantity(item);
  if (!Number.isFinite(quantity)) return label;
  return `${quantity.toLocaleString("en-IN")} ${label}`;
}

export function inventoryAverageUnitCost(item?: Product | InventoryItem | null, unit?: string | null): number {
  const sellingUnit = findInventorySellingUnit(item, unit);
  const cost = item?.averageCostPrice
    ?? item?.costPerRateUnit
    ?? item?.costPrice
    ?? sellingUnit?.costPrice
    ?? 0;
  return roundInventoryValue(Number(cost || 0));
}

export function inventoryStockValue(item: Product | InventoryItem, unit?: string | null): number {
  return roundInventoryValue(inventoryDisplayQuantity(item, unit) * inventoryAverageUnitCost(item, unit));
}

/**
 * What one packaging costs to buy. The product's average cost is per DEFAULT pack,
 * so a 5 kg bag valued at the 500 g packet's cost undercounts stock value tenfold.
 * The pack's own cost wins; otherwise the product cost is scaled to its size.
 */
export function inventoryPackUnitCost(item: Product | InventoryItem, unit?: ProductSellingUnit | null): number {
  const own = Number(unit?.costPrice ?? 0);
  if (own > 0) return roundInventoryValue(own);

  const productCost = inventoryAverageUnitCost(item);
  const defaultUnit = defaultInventorySellingUnit(item);
  const defaultConversion = Number(defaultUnit?.conversionToBase ?? 0);
  const unitConversion = Number(unit?.conversionToBase ?? 0);
  if (!(productCost > 0) || !(defaultConversion > 0) || !(unitConversion > 0)) return productCost;
  if (defaultConversion === unitConversion) return productCost;
  return roundInventoryValue((productCost / defaultConversion) * unitConversion);
}

/** One line of stock as the shopkeeper counts it: a whole product, or one of its packs. */
export interface InventoryStockRow {
  key: string;
  item: InventoryItem;
  /** The packaging this row counts. Undefined for products with one shared pool. */
  unit?: ProductSellingUnit;
  unitCode?: string;
  label: string;
  quantity: number;
  unitCost: number;
  value: number;
  isTracked: boolean;
  isOut: boolean;
  isLow: boolean;
}

/**
 * Expand a product into the rows an inventory screen should show.
 *
 * A product that counts each size separately becomes ONE ROW PER SIZE, because
 * that is the question being asked of these screens — "which size do I need to
 * order?" — and a single blended number cannot answer it. Everything else stays a
 * single row: pooled sizes all draw on the same sack, so splitting them would show
 * the same stock several times over.
 */
export function inventoryStockRows(item: Product | InventoryItem): InventoryStockRow[] {
  const normalized = normalizeInventoryItem(item);
  const isTracked = (normalized.stockTrackingEnabled ?? normalized.trackStock ?? true) !== false;
  const packs = activeInventorySellingUnits(normalized);

  if (normalized.packagingMode === "per_pack" && packs.length > 0) {
    return packs.map((unit) => {
      const quantity = roundInventoryValue(Number(unit.onHandQty ?? 0));
      const threshold = Number(unit.lowStockThreshold ?? 0);
      const unitCost = inventoryPackUnitCost(normalized, unit);
      return {
        key: `${normalized.id}:${unit.unitCode}`,
        item: normalized,
        unit,
        unitCode: unit.unitCode,
        label: unit.name ?? unit.unitCode,
        quantity,
        unitCost,
        value: roundInventoryValue(quantity * unitCost),
        isTracked,
        isOut: isTracked && quantity <= 0,
        isLow: isTracked && threshold > 0 && quantity > 0 && quantity <= threshold,
      };
    });
  }

  const movementUnit = inventoryMovementUnit(normalized);
  const quantity = inventoryDisplayQuantity(normalized, movementUnit);
  const baseQty = inventoryBaseQuantity(normalized);
  const threshold = Number(normalized.lowStockThreshold ?? (normalized as StockRecord).low_stock_threshold ?? 0);
  const unitCost = inventoryAverageUnitCost(normalized, movementUnit);
  return [{
    key: normalized.id,
    item: normalized,
    unitCode: movementUnit,
    label: inventoryUnitLabel(normalized, movementUnit),
    quantity,
    unitCost,
    value: roundInventoryValue(quantity * unitCost),
    isTracked,
    isOut: isTracked && baseQty <= 0,
    isLow: isTracked && threshold > 0 && baseQty > 0 && baseQty <= threshold,
  }];
}

export function normalizeInventoryItem(item: Product | InventoryItem): InventoryItem {
  const record = item as StockRecord;
  const baseQty = inventoryBaseQuantity(item);
  const withBase = { ...item, stockBaseQty: baseQty };
  const movementUnit = inventoryMovementUnit(withBase);
  const displayQty = inventoryDisplayQuantity(withBase, movementUnit);
  const averageCost = inventoryAverageUnitCost(withBase, movementUnit);
  const lowThreshold = readNumber(item.lowStockThreshold, (item as StockRecord).low_stock_threshold) ?? 0;
  return {
    ...item,
    productId: cleanText(record.productId) ?? item.id,
    stockBaseQty: baseQty,
    stockQuantity: displayQty,
    stockUnit: movementUnit,
    unit: inventorySimpleUnit(withBase, movementUnit),
    displayUnit: inventoryUnitLabel(withBase, movementUnit),
    rateUnit: inventorySimpleUnit(withBase, movementUnit),
    averageCostPrice: averageCost,
    costPerRateUnit: averageCost,
    costPrice: averageCost,
    isLowStock: lowThreshold > 0 && baseQty <= lowThreshold,
  } as InventoryItem;
}

function rowKey(item: Product | InventoryItem): string | undefined {
  const record = item as StockRecord;
  return cleanText(record.productId)
    ?? cleanText(record.product_id)
    ?? cleanText(item.id)
    ?? cleanText(record.local_id)
    ?? cleanText(record.server_id);
}

function isDeleted(item: Product | InventoryItem) {
  const record = item as StockRecord;
  return item.deletedAt != null || record.deleted_at != null;
}

function mergeRows(existing: InventoryItem | undefined, incoming: Product | InventoryItem): InventoryItem {
  if (!existing) return normalizeInventoryItem(incoming);
  const merged = { ...existing, ...incoming } as InventoryItem & Record<string, unknown>;
  const incomingCost = readNumber((incoming as StockRecord).averageCostPrice, (incoming as StockRecord).costPerRateUnit, (incoming as StockRecord).costPrice);
  if (incomingCost !== undefined) {
    merged.averageCostPrice = incomingCost;
    merged.costPerRateUnit = incomingCost;
    merged.costPrice = incomingCost;
  }
  for (const key of ["imageUrl", "barcode", "sku", "aliases", "sellingUnits", "brand", "description", "mrp"]) {
    if ((merged[key] === null || merged[key] === undefined) && (existing as StockRecord)[key] != null) {
      merged[key] = (existing as StockRecord)[key];
    }
  }
  return normalizeInventoryItem(merged);
}

export function mergeInventoryRows(...groups: Array<Array<Product | InventoryItem> | undefined | null>): InventoryItem[] {
  const rows = groups.flatMap((group) => group ?? []).filter((item) => item && !isDeleted(item));
  const merged = new Map<string, InventoryItem>();
  const anonymous: InventoryItem[] = [];

  for (const row of rows) {
    const key = rowKey(row);
    if (!key) {
      anonymous.push(normalizeInventoryItem(row));
      continue;
    }
    merged.set(key, mergeRows(merged.get(key), row));
  }

  return [...merged.values(), ...anonymous];
}

/**
 * The `subject` rows, filled in from `detail` — a LEFT JOIN, not a union.
 *
 * `mergeInventoryRows` returns every row of every group it is handed. That is
 * right when the groups are alternative views of the same catalogue, which is
 * what both other callers pass. It is wrong when one group is a SHORTLIST and
 * the other is the whole shop: the Low Stock Alerts panel merged the catalogue
 * into the server's low-stock list to pick up names and photos, and got the
 * catalogue back — so it listed the three smallest products in the shop
 * regardless of their reorder level, while the count beside it stayed right.
 *
 * `detail` is merged first so `subject` still wins on conflicting fields,
 * exactly as it did when the call was a plain merge.
 */
export function enrichInventoryRows(
  subject: Array<Product | InventoryItem> | undefined | null,
  ...detail: Array<Array<Product | InventoryItem> | undefined | null>
): InventoryItem[] {
  const wanted = new Set<string>();
  for (const row of subject ?? []) {
    const key = row && rowKey(row);
    if (key) wanted.add(key);
  }
  if (wanted.size === 0) return [];
  return mergeInventoryRows(...detail, subject).filter((row) => {
    const key = rowKey(row);
    return key !== undefined && wanted.has(key);
  });
}

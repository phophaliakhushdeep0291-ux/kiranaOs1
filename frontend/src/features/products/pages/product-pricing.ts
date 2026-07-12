import type { Product } from "@/lib/api/client";

export const UNITS = [
  "piece", "dozen", "set", "pair", "bundle", "roll", "sheet",
  "kg", "gram", "litre", "ml",
  "meter", "yard",
  "packet", "box",
  "strip", "tablet", "bottle", "tube",
  "plate", "glass",
  "custom",
] as const;

export const CATEGORIES = ["all", "general", "grocery", "dairy", "beverages", "snacks", "household", "personal_care", "stationery", "other"];

const UNIT_TO_BASE_UNIT: Record<string, string> = {
  kg: "gram", gram: "gram", g: "gram",
  litre: "ml", liter: "ml", ml: "ml",
  piece: "piece", packet: "packet", box: "box",
  dozen: "piece", bundle: "bundle", roll: "roll", sheet: "sheet",
  set: "set", pair: "pair",
  meter: "meter", yard: "yard",
  strip: "strip", tablet: "tablet", bottle: "bottle", tube: "tube",
  plate: "plate", glass: "glass",
  custom: "custom",
};

const UNIT_FACTOR_TO_BASE: Record<string, number> = {
  kg: 1000, gram: 1, g: 1,
  litre: 1000, liter: 1000, ml: 1,
  piece: 1, packet: 1, box: 1,
  dozen: 12, bundle: 1, roll: 1, sheet: 1,
  set: 1, pair: 1,
  meter: 1, yard: 1,
  strip: 1, tablet: 1, bottle: 1, tube: 1,
  plate: 1, glass: 1,
  custom: 1,
};

export function round2(value: number): number {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

export function baseUnitFor(unit: string): string {
  return UNIT_TO_BASE_UNIT[unit] ?? unit ?? "piece";
}

export function sellingUnitConversion(packSizeValue: number, packSizeUnit: string): number {
  return round2(Number(packSizeValue || 0) * (UNIT_FACTOR_TO_BASE[packSizeUnit] ?? 1));
}

export function sellingUnitName(unitType: string, packSizeValue?: number | null, packSizeUnit?: string | null): string {
  const type = String(unitType || "unit").trim();
  if (!(Number(packSizeValue) > 0) || !packSizeUnit) return type;
  if (Number(packSizeValue) === 1 && packSizeUnit === type) return type;
  return `${type} ${Number(packSizeValue)} ${packSizeUnit}`;
}

export function sellingUnitCode(unitType: string, packSizeValue?: number | null, packSizeUnit?: string | null): string {
  return [unitType, Number(packSizeValue) > 0 ? Number(packSizeValue) : 1, packSizeUnit || "count"]
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function toBaseQty(quantity: number, unit: string): number {
  return round2(Number(quantity || 0) * (UNIT_FACTOR_TO_BASE[unit] ?? 1));
}

export function fromBaseQty(baseQty: number | undefined, unit: string | null | undefined): number {
  return round2(Number(baseQty || 0) / (UNIT_FACTOR_TO_BASE[unit || "piece"] ?? 1));
}

export function averageCost(product?: Product): number {
  return round2(Number(product?.averageCostPrice ?? product?.costPrice ?? product?.costPerRateUnit ?? 0));
}

export function productDisplayUnit(product: Product): string {
  return product.unit ?? product.displayUnit ?? product.rateUnit ?? "piece";
}

export function productMinimumPrice(product: Product): number {
  return round2(product.minimumSellingPrice ?? product.minPricePerRateUnit ?? 0);
}

export function productRetailPrice(product: Product): number {
  return round2(product.retailPrice ?? product.retailPricePerRateUnit ?? product.defaultPricePerRateUnit);
}

export function productWholesalePrice(product: Product): number {
  return round2(product.wholesalePrice ?? product.wholesalePricePerRateUnit ?? product.defaultPricePerRateUnit);
}

export function isLowStock(product: Product): boolean {
  // Both sides are base units. A product with no alert threshold (0) is never "low" —
  // matching the backend's low-stock filter — and zero stock is "out of stock", not "low".
  const threshold = Number(product.lowStockThreshold ?? 0);
  return threshold > 0 && Number(product.stockBaseQty ?? 0) <= threshold;
}

export function isDeletedProduct(product: Product): boolean {
  return product.deletedAt != null || ("deleted_at" in product && product.deleted_at != null);
}

export function isInactiveProduct(product: Product): boolean {
  return product.status === "inactive" || product.isActive === false;
}

export function needsOwnerPinForPrices(minimumSellingPrice: number, prices: number[]): boolean {
  const min = Number(minimumSellingPrice || 0);
  if (min <= 0) return false;
  return prices
    .filter((price) => Number(price) > 0)
    .some((price) => Number(price) < min);
}

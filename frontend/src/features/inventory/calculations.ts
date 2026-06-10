export const INVENTORY_UNIT_CONVERSION: Record<string, number> = {
  kg: 1000, kilogram: 1000, kilograms: 1000,
  gram: 1, grams: 1, g: 1,
  litre: 1000, liter: 1000, litres: 1000, liters: 1000, ltr: 1000,
  ml: 1,
  piece: 1, pieces: 1, pcs: 1,
  packet: 1, pkt: 1,
  box: 1,
  bundle: 1,
  dozen: 12,
  set: 1,
  pair: 1,
  roll: 1,
  sheet: 1,
  meter: 1, metre: 1, meters: 1, metres: 1, mtr: 1,
  yard: 1, yards: 1, yd: 1,
  strip: 1, strips: 1,
  tablet: 1, tablets: 1, tab: 1,
  bottle: 1, bottles: 1,
  tube: 1, tubes: 1,
  plate: 1, plates: 1,
  glass: 1, glasses: 1,
  custom: 1,
};

type UnitFamily = "weight" | "volume" | "count" | "length" | "custom";

const UNIT_FAMILIES: Record<string, UnitFamily> = {
  kg: "weight", kilogram: "weight", kilograms: "weight",
  gram: "weight", grams: "weight", g: "weight",
  litre: "volume", liter: "volume", litres: "volume", liters: "volume", ltr: "volume",
  ml: "volume",
  piece: "count", pieces: "count", pcs: "count",
  packet: "count", pkt: "count",
  box: "count",
  bundle: "count",
  dozen: "count",
  set: "count", pair: "count", roll: "count", sheet: "count",
  strip: "count", tablet: "count", strips: "count", tablets: "count", tab: "count",
  bottle: "count", bottles: "count",
  tube: "count", tubes: "count",
  plate: "count", plates: "count",
  glass: "count", glasses: "count",
  meter: "length", metre: "length", meters: "length", metres: "length", mtr: "length",
  yard: "length", yards: "length", yd: "length",
  custom: "custom",
};

export type InventoryPriceSuggestionInput = {
  currentStockBaseQty: number;
  currentAverageCost: number;
  purchaseQuantity: number;
  purchaseUnit: string;
  productBaseUnit?: string | null;
  productRateUnit?: string | null;
  purchaseUnitCost?: number | null;
  billAmount?: number | null;
  minMarginPercent?: number | null;
  sellingMarginPercent?: number | null;
};

export function roundInventoryValue(value: number) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

export function inventoryUnitFactor(unit?: string | null) {
  return INVENTORY_UNIT_CONVERSION[(unit || "piece").toLowerCase()] ?? 1;
}

export function toInventoryBaseQty(quantity: number, fromUnit: string, baseUnit?: string | null) {
  const from = inventoryUnitFactor(fromUnit);
  const base = inventoryUnitFactor(baseUnit || fromUnit || "piece");
  return roundInventoryValue((Number(quantity || 0) * from) / base);
}

export function fromInventoryBaseQty(baseQuantity: number, baseUnit?: string | null, targetUnit?: string | null) {
  const base = inventoryUnitFactor(baseUnit || targetUnit || "piece");
  const target = inventoryUnitFactor(targetUnit || baseUnit || "piece");
  return roundInventoryValue((Number(baseQuantity || 0) * base) / target);
}

export function inventoryUnitFamily(unit?: string | null): UnitFamily {
  return UNIT_FAMILIES[(unit || "piece").toLowerCase()] ?? "custom";
}

export function buildUnitMismatchWarning(enteredUnit?: string | null, productUnit?: string | null): string | undefined {
  const entered = (enteredUnit || "").trim().toLowerCase();
  const product = (productUnit || "").trim().toLowerCase();
  if (!entered || !product || entered === product) return undefined;

  const enteredFamily = inventoryUnitFamily(entered);
  const productFamily = inventoryUnitFamily(product);
  if (enteredFamily === "custom" || productFamily === "custom" || enteredFamily === productFamily) return undefined;

  return `Unit mismatch warning: entered ${enteredUnit} for a product measured in ${productUnit}. Review quantity before saving.`;
}

export function calculateInventoryPriceSuggestions(input: InventoryPriceSuggestionInput) {
  const currentStock = Math.max(Number(input.currentStockBaseQty || 0), 0);
  const currentAverageCost = roundInventoryValue(Number(input.currentAverageCost || 0));
  const purchaseQuantity = Math.max(Number(input.purchaseQuantity || 0), 0);
  const purchaseBaseQty = toInventoryBaseQty(purchaseQuantity, input.purchaseUnit, input.productBaseUnit || input.purchaseUnit);
  const purchaseQtyInRateUnit = Math.max(fromInventoryBaseQty(purchaseBaseQty, input.productBaseUnit || input.purchaseUnit, input.productRateUnit || input.productBaseUnit || input.purchaseUnit), 0);
  const currentStockInRateUnit = Math.max(fromInventoryBaseQty(currentStock, input.productBaseUnit || input.productRateUnit || input.purchaseUnit, input.productRateUnit || input.productBaseUnit || input.purchaseUnit), 0);
  const explicitUnitCost = Number(input.purchaseUnitCost || 0);
  const derivedUnitCost = Number(input.billAmount || 0) > 0 && purchaseQtyInRateUnit > 0 ? Number(input.billAmount) / purchaseQtyInRateUnit : 0;
  const purchaseUnitCost = roundInventoryValue(explicitUnitCost || derivedUnitCost);
  const projectedAverageCost = purchaseUnitCost > 0 && purchaseQtyInRateUnit > 0
    ? roundInventoryValue(((currentAverageCost * currentStockInRateUnit) + (purchaseUnitCost * purchaseQtyInRateUnit)) / Math.max(currentStockInRateUnit + purchaseQtyInRateUnit, purchaseQtyInRateUnit))
    : currentAverageCost;
  const minPriceSuggestion = roundInventoryValue(projectedAverageCost * (1 + Math.max(Number(input.minMarginPercent || 0), 0) / 100));
  const sellingPriceSuggestion = roundInventoryValue(projectedAverageCost * (1 + Math.max(Number(input.sellingMarginPercent || 0), 0) / 100));

  return {
    purchaseBaseQty,
    purchaseQtyInRateUnit,
    purchaseUnitCost,
    projectedAverageCost,
    minPriceSuggestion,
    sellingPriceSuggestion,
  };
}

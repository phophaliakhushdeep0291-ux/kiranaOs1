import type { Product } from "@/types/api";

export function tradeOrderLine(product: Product | undefined, sellingUnitId: string, quantity: string, price: string) {
  if (!product) return null;
  const unit = product.sellingUnits?.find((row) => row.id === sellingUnitId && row.isActive && row.conversionToBase > 0);
  if ((sellingUnitId && !unit) || (product.packagingMode === "per_pack" && !unit)) return null;
  const count = Number(quantity); const unitPrice = Number(price);
  const base = Math.round(count * (unit?.conversionToBase || 1) * 100) / 100;
  if (!quantity.trim() || !price.trim() || !Number.isFinite(count) || !Number.isFinite(unitPrice) || !Number.isFinite(base)
    || count < 0.01 || count > 1e9 || base < 0.01 || base > 1e9 || unitPrice < 0 || unitPrice > 1e9
    || Math.abs(count - Math.round(count * 100) / 100) > 1e-7 || Math.abs(unitPrice - Math.round(unitPrice * 100) / 100) > 1e-7) return null;
  return { productId: product.id, sellingUnitId: unit?.id ?? null, description: product.name, unitName: unit?.name || product.baseUnit, quantity: count, quantityBaseQty: base, unitPrice };
}

import type { Product } from "@/lib/api/client";
import type { StagedBillLine } from "./assistant-staging";
import { cartItemKey, type CartItem } from "./pages/billing-types";
import { roundQuantity } from "./pages/billing-calculations";

/** Shared by the inline assistant and the durable route handoff. */
export function mergeAssistantCart(previous: CartItem[], lines: StagedBillLine[], products: Map<string, Product>) {
  let cart = [...previous];
  const applied: StagedBillLine[] = [];
  const remaining: StagedBillLine[] = [];
  for (const line of lines) {
    const product = line && products.get(line.productId);
    if (!product || !Number.isFinite(line.quantity) || line.quantity <= 0 || !Number.isFinite(line.rate) || line.rate < 0 || typeof line.unit !== "string") {
      remaining.push(line); continue;
    }
    const units = (product.sellingUnits ?? []).filter(unit => unit.isActive !== false);
    const requestedUnit = line.unit.trim().toLowerCase();
    const exactUnits = units.filter(unit => [unit.name, unit.unitCode].filter(Boolean).some(value => String(value).trim().toLowerCase() === requestedUnit));
    const matches = line.sellingUnitId ? units.filter(unit => unit.id === line.sellingUnitId) : exactUnits.length ? exactUnits : units.filter(unit => String(unit.unitType).trim().toLowerCase() === requestedUnit);
    // A generic "pack" must never silently choose one of several pack sizes.
    if ((units.length || line.sellingUnitId) && matches.length !== 1) { remaining.push(line); continue; }
    const sellingUnit = matches[0];
    if (sellingUnit && line.conversionToBase !== undefined && line.conversionToBase !== Number(sellingUnit.conversionToBase)) { remaining.push(line); continue; }
    const catalogRate = sellingUnit?.defaultPrice ?? product.defaultPricePerRateUnit;
    if (catalogRate != null && Math.abs(Number(catalogRate) - line.rate) > 0.001) { remaining.push(line); continue; }
    const candidate: CartItem = { product, quantity: line.quantity, rate: line.rate, unit: sellingUnit?.name ?? line.unit, sellingUnit, manualRate: true };
    const key = cartItemKey(candidate);
    if (cart.some(item => cartItemKey(item) === key)) {
      cart = cart.map(item => cartItemKey(item) === key ? { ...item, quantity: roundQuantity(item.quantity + line.quantity), rate: line.rate, unit: candidate.unit, sellingUnit, manualRate: true } : item);
    } else cart.push(candidate);
    applied.push(line);
  }
  return { cart, applied, remaining };
}

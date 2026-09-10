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
    const product = products.get(line.productId);
    if (!product || !Number.isFinite(line.quantity) || line.quantity <= 0 || !Number.isFinite(line.rate) || line.rate < 0 || typeof line.unit !== "string") {
      remaining.push(line); continue;
    }
    const units = (product.sellingUnits ?? []).filter(unit => unit.isActive !== false);
    const sellingUnit = units.find(unit => [unit.name, unit.unitType, unit.packSizeUnit].filter(Boolean).some(value => String(value).toLowerCase() === line.unit.toLowerCase()))
      ?? units.find(unit => unit.isDefault) ?? units[0];
    const candidate: CartItem = { product, quantity: line.quantity, rate: line.rate, unit: sellingUnit?.name ?? line.unit, sellingUnit, manualRate: true };
    const key = cartItemKey(candidate);
    if (cart.some(item => cartItemKey(item) === key)) {
      cart = cart.map(item => cartItemKey(item) === key ? { ...item, quantity: roundQuantity(item.quantity + line.quantity), rate: line.rate, unit: candidate.unit, sellingUnit, manualRate: true } : item);
    } else cart.push(candidate);
    applied.push(line);
  }
  return { cart, applied, remaining };
}

// ─────────────────────────────────────────────────────────────────────────────
// Bridge from the EXISTING product master → canonical pricing rules.
//
// Artha products already carry a nascent tiered-pricing model that
// billing-calculations.productSellingPrice() reads today:
//   retailPrice / retailFromQuantity, wholesalePrice / wholesaleFromQuantity.
// This adapter translates those existing fields into engine rules so the
// pricing engine is a strict SUPERSET of current behaviour — the same inputs
// produce the same price — rather than a second, diverging calculation.
//
// A future PricingRule table simply appends more rules to this list; nothing
// here needs to change.
// ─────────────────────────────────────────────────────────────────────────────

import type { Product } from "@/lib/api/client";
import { PricingRuleType, type PricingContext, type PricingRule } from "./types";

interface ProductPricingFields extends Product {
  sellingPrice?: number;
  retailPrice?: number;
  retailPricePerRateUnit?: number;
  wholesalePrice?: number;
  wholesalePricePerRateUnit?: number;
  retailFromQuantity?: number;
  wholesaleFromQuantity?: number;
  averageCostPrice?: number;
  costPrice?: number;
  minimumSellingPrice?: number;
}

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Build the pricing context from a product + billing inputs. */
export function contextFromProduct(
  product: Product,
  opts: {
    shopId: string;
    locationId?: string;
    quantity: number;
    billDate: string;
    unitCode?: string;
    sellingUnitId?: string;
    unitLabel?: string;
    defaultPrice?: number;
    minimumSellingPrice?: number;
    maximumRetailPrice?: number;
    productCost?: number;
    customerId?: string;
    customerGroup?: string;
    paymentMethod?: string;
    source: PricingContext["source"];
    staffUserId?: string;
    deviceId?: string;
  },
): PricingContext {
  const p = product as ProductPricingFields;
  const defaultPrice = num(opts.defaultPrice ?? p.sellingPrice ?? p.defaultPricePerRateUnit);
  return {
    shopId: opts.shopId,
    locationId: opts.locationId,
    productId: product.id,
    sellingUnitId: opts.sellingUnitId,
    unitCode: opts.unitCode ?? product.rateUnit ?? product.displayUnit ?? "piece",
    unitLabel: opts.unitLabel,
    customerId: opts.customerId,
    customerGroup: opts.customerGroup,
    quantity: opts.quantity,
    billDate: opts.billDate,
    paymentMethod: opts.paymentMethod,
    productCost: num(opts.productCost ?? p.averageCostPrice ?? p.costPrice ?? product.costPerRateUnit),
    defaultPrice,
    minimumSellingPrice: num(opts.minimumSellingPrice ?? p.minimumSellingPrice ?? product.minPricePerRateUnit),
    maximumRetailPrice: num(opts.maximumRetailPrice ?? (product as { mrp?: number }).mrp),
    source: opts.source,
    staffUserId: opts.staffUserId,
    deviceId: opts.deviceId,
  };
}

/** Translate the product's built-in retail/wholesale quantity tiers into rules. */
export function rulesFromProduct(product: Product): PricingRule[] {
  const p = product as ProductPricingFields;
  const base = num(p.sellingPrice ?? p.defaultPricePerRateUnit);
  const rules: PricingRule[] = [];

  const retail = num(p.retailPrice ?? p.retailPricePerRateUnit, base);
  const retailFrom = num(p.retailFromQuantity, 1);
  const wholesale = num(p.wholesalePrice ?? p.wholesalePricePerRateUnit, base);
  const wholesaleFrom = num(p.wholesaleFromQuantity, 0);

  // Wholesale tier (kicks in at wholesaleFromQuantity) — stronger because higher qty.
  if (wholesaleFrom > 0 && wholesale > 0) {
    rules.push({
      id: `product:${product.id}:wholesale`,
      ruleType: PricingRuleType.PRODUCT_QUANTITY_PRICE,
      productId: product.id,
      minQuantity: wholesaleFrom,
      fixedUnitPrice: wholesale,
      label: `Bulk price for ${wholesaleFrom}+ units`,
      confidence: 1,
    });
  }
  // Retail tier (from retailFromQuantity, but below wholesale threshold).
  if (retail > 0 && retail !== base && retailFrom > 0) {
    rules.push({
      id: `product:${product.id}:retail`,
      ruleType: PricingRuleType.PRODUCT_QUANTITY_PRICE,
      productId: product.id,
      minQuantity: retailFrom,
      maxQuantity: wholesaleFrom > 0 ? wholesaleFrom - 1 : undefined,
      fixedUnitPrice: retail,
      label: retailFrom > 1 ? `Quantity price for ${retailFrom}+ units` : undefined,
      confidence: 1,
    });
  }
  return rules;
}

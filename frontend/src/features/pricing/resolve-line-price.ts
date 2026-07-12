// The one place billing asks "what price for this line?" — replaces the direct
// productSellingPrice() call. It runs the canonical engine over BOTH the
// product's built-in tiers (rulesFromProduct) AND the shop's owner-defined
// PricingRule rows (cached), so it is a strict superset of the old behaviour:
// with no shop rules it returns exactly productSellingPrice().

import type { Product } from "@/lib/api/client";
import { evaluatePricing } from "./engine/engine";
import { contextFromProduct, rulesFromProduct } from "./engine/product-rules";
import { PricingRuleType, type PricingResult, type PricingRule } from "./engine/types";

/** A PricingRule row as returned by GET /api/pricing/rules. */
export interface ApiPricingRule {
  id: string;
  ruleType: string;
  status?: string;
  priority?: number | null;
  productId?: string | null;
  unitCode?: string | null;
  customerId?: string | null;
  customerGroup?: string | null;
  paymentMethod?: string | null;
  minQuantity?: number | null;
  maxQuantity?: number | null;
  fixedUnitPrice?: number | null;
  adjustmentType?: string | null;
  adjustmentValue?: number | null;
  combinePolicy?: string | null;
  validFrom?: string | null;
  validUntil?: string | null;
  requiresOwnerApproval?: boolean;
  name?: string;
}

const RULE_TYPES = new Set<string>(Object.values(PricingRuleType));

/** Normalize a stored/synced rule row into the engine's rule shape. */
export function normalizeApiRule(row: ApiPricingRule): PricingRule | null {
  if (!row?.id || !RULE_TYPES.has(row.ruleType)) return null;
  if (row.status && row.status !== "ACTIVE") return null;
  return {
    id: row.id,
    ruleType: row.ruleType as PricingRuleType,
    priority: row.priority ?? undefined,
    productId: row.productId ?? undefined,
    unitCode: row.unitCode ?? undefined,
    customerId: row.customerId ?? undefined,
    customerGroup: row.customerGroup ?? undefined,
    paymentMethod: row.paymentMethod ?? undefined,
    minQuantity: row.minQuantity ?? undefined,
    maxQuantity: row.maxQuantity ?? undefined,
    fixedUnitPrice: row.fixedUnitPrice ?? undefined,
    adjustmentType: (row.adjustmentType ?? undefined) as PricingRule["adjustmentType"],
    adjustmentValue: row.adjustmentValue ?? undefined,
    combinePolicy: (row.combinePolicy ?? undefined) as PricingRule["combinePolicy"],
    validFrom: row.validFrom ?? undefined,
    validUntil: row.validUntil ?? undefined,
    requiresOwnerApproval: row.requiresOwnerApproval ?? false,
    label: row.name,
    confidence: 1,
  };
}

export interface ResolveLinePriceInput {
  shopId?: string;
  quantity: number;
  billDate?: string;
  unitCode?: string;
  customerId?: string;
  customerGroup?: string;
  paymentMethod?: string;
  /** Owner-defined rules (already normalized). Empty = product tiers only. */
  shopRules?: PricingRule[];
  source?: "BILLING" | "ESTIMATE" | "ORDER" | "OFFLINE_BILLING" | "BILL_EDIT" | "RETURN";
}

export function resolveLinePrice(product: Product, input: ResolveLinePriceInput): PricingResult {
  const rules = [...rulesFromProduct(product), ...(input.shopRules ?? [])];
  const ctx = contextFromProduct(product, {
    shopId: input.shopId ?? "",
    quantity: input.quantity,
    billDate: input.billDate ?? new Date().toISOString(),
    unitCode: input.unitCode,
    customerId: input.customerId,
    customerGroup: input.customerGroup,
    paymentMethod: input.paymentMethod,
    source: input.source ?? "BILLING",
  });
  return evaluatePricing(ctx, rules);
}

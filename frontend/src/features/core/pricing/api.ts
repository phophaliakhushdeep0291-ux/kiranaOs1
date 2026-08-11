import { apiRequest } from "@/lib/api/http";
import type { ApiPricingRule } from "./resolve-line-price";
import type { PricingResult, PricingSettings } from "./engine/types";
import type { ProductSellingUnit } from "@/types/api";

export type { ApiPricingRule } from "./resolve-line-price";

export interface EvaluateRequest {
  productId: string;
  sellingUnitId?: string;
  unitCode?: string;
  customerId?: string;
  customerGroup?: string;
  quantity: number;
  billDate?: string;
  paymentMethod?: string;
  source?: string;
}

export function evaluatePricingRemote(body: EvaluateRequest) {
  return apiRequest<PricingResult>("/pricing/evaluate", { method: "POST", body: JSON.stringify(body) });
}

export function listPricingRules(status = "ACTIVE") {
  const q = status ? `?status=${encodeURIComponent(status)}` : "";
  return apiRequest<{ rules: ApiPricingRule[] }>(`/pricing/rules${q}`, { cache: "no-store" });
}

export function createPricingRule(body: Partial<ApiPricingRule> & { name: string; ruleType: string }, ownerPin: string) {
  return apiRequest<ApiPricingRule>("/pricing/rules", { method: "POST", ownerPin, body: JSON.stringify(body) });
}

export function updatePricingRule(id: string, body: Partial<ApiPricingRule>, ownerPin: string) {
  return apiRequest<ApiPricingRule>(`/pricing/rules/${encodeURIComponent(id)}`, { method: "PATCH", ownerPin, body: JSON.stringify(body) });
}

export function deletePricingRule(id: string, ownerPin: string) {
  return apiRequest<{ id: string; status: string }>(`/pricing/rules/${encodeURIComponent(id)}`, { method: "DELETE", ownerPin });
}

export function getPricingSettings() {
  return apiRequest<PricingSettings>("/pricing/settings", { cache: "no-store" });
}

export function updatePricingSettings(body: Partial<PricingSettings>, ownerPin: string) {
  return apiRequest<PricingSettings>("/pricing/settings", { method: "PATCH", ownerPin, body: JSON.stringify(body) });
}

export function listProductSellingUnits(productId: string) {
  return apiRequest<ProductSellingUnit[]>(`/pricing/products/${encodeURIComponent(productId)}/units`, { cache: "no-store" });
}

export function createProductSellingUnit(productId: string, body: ProductSellingUnit, ownerPin: string) {
  return apiRequest<ProductSellingUnit>(`/pricing/products/${encodeURIComponent(productId)}/units`, {
    method: "POST",
    ownerPin,
    body: JSON.stringify(body),
  });
}

export function updateProductSellingUnit(productId: string, unitId: string, body: Partial<ProductSellingUnit>, ownerPin: string) {
  return apiRequest<ProductSellingUnit>(`/pricing/products/${encodeURIComponent(productId)}/units/${encodeURIComponent(unitId)}`, {
    method: "PATCH",
    ownerPin,
    body: JSON.stringify(body),
  });
}

export function deleteProductSellingUnit(productId: string, unitId: string, ownerPin: string) {
  return apiRequest<{ id: string; isActive: boolean }>(`/pricing/products/${encodeURIComponent(productId)}/units/${encodeURIComponent(unitId)}`, {
    method: "DELETE",
    ownerPin,
  });
}

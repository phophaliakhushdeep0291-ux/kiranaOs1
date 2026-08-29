import { apiRequest, buildQuery } from "@/lib/api/http";
import type { Product, ProductInput, QueryParams, VariantStockByLocation } from "@/types/api";

export function normaliseProductInput(data: ProductInput): ProductInput {
  const unit = data.unit || data.displayUnit || data.rateUnit || "piece";
  const rateUnit = data.rateUnit || unit;
  const displayUnit = data.displayUnit || unit;
  const cost = data.averageCostPrice ?? data.costPerRateUnit ?? data.costPrice ?? 0;
  const min = data.minPricePerRateUnit ?? data.minimumSellingPrice ?? 0;
  const selling = data.defaultPricePerRateUnit ?? data.sellingPrice ?? data.retailPrice ?? 0;
  const retail = data.retailPricePerRateUnit ?? data.retailPrice ?? selling;
  const wholesale = data.wholesalePricePerRateUnit ?? data.wholesalePrice ?? selling;
  const lowStock = data.lowStockThreshold ?? data.lowStockAlert ?? 0;
  const trackStock = data.restaurantItemType !== "prepared";

  return {
    ...data,
    unit,
    rateUnit,
    displayUnit,
    baseUnit: data.baseUnit || displayUnit,
    aliases: data.aliases ?? [],
    stockBaseQty: data.stockBaseQty ?? 0,
    stockTrackingEnabled: trackStock,
    trackStock,
    costPerRateUnit: cost,
    costPrice: cost,
    averageCostPrice: cost,
    minPricePerRateUnit: min,
    minimumSellingPrice: min,
    defaultPricePerRateUnit: selling,
    sellingPrice: selling,
    retailPricePerRateUnit: retail,
    retailPrice: retail,
    retailFromQuantity: data.retailFromQuantity ?? 1,
    wholesalePricePerRateUnit: wholesale,
    wholesalePrice: wholesale,
    wholesaleFromQuantity: data.wholesaleFromQuantity ?? 10,
    quantitySlabPricing: data.quantitySlabPricing ?? [],
    customerSpecificPricing: data.customerSpecificPricing ?? [],
    gstRate: data.gstRate ?? 0,
    lowStockThreshold: lowStock,
    lowStockAlert: lowStock,
    isActive: data.isActive ?? data.status !== "inactive",
    status: data.status ?? ((data.isActive ?? true) ? "active" : "inactive"),
  };
}

/** Where each size physically is. Read-only; empty `locations` means "not a variant product". */
export function getVariantStockByLocation(id: string) {
  return apiRequest<VariantStockByLocation>(`/products/${id}/variant-stock`);
}

export function listProducts(params?: QueryParams) {
  return apiRequest<Product[]>(`/products${buildQuery(params)}`);
}

export function createProduct(data: ProductInput) {
  return apiRequest<Product>("/products", {
    method: "POST",
    body: JSON.stringify(normaliseProductInput(data)),
  });
}

export function updateProduct(id: string, data: ProductInput) {
  return apiRequest<Product>(`/products/${id}`, {
    method: "PATCH",
    body: JSON.stringify(normaliseProductInput(data)),
    ownerPin: data.ownerPin,
  });
}

export function patchProduct(id: string, data: Partial<ProductInput>, ownerPin?: string) {
  return apiRequest<Product>(`/products/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
    ownerPin,
  });
}

export function deleteProduct(id: string, ownerPin?: string) {
  return apiRequest<Product>(`/products/${id}`, { method: "DELETE", ownerPin });
}

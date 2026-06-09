import { apiRequest, buildQuery } from "@/lib/api/http";
import type { InventoryItem, LedgerResult, QueryParams, StockMovementInput } from "@/types/api";

export function getInventory() {
  return apiRequest<InventoryItem[]>("/inventory");
}

export function getLowStock() {
  return apiRequest<InventoryItem[]>("/inventory/low-stock");
}

export function getStockLedger(params?: QueryParams) {
  return apiRequest<LedgerResult<unknown>>(`/inventory/ledger${buildQuery(params)}`);
}

export function recordPurchase(data: StockMovementInput) {
  return apiRequest<unknown>("/inventory/purchase", {
    method: "POST",
    body: JSON.stringify(data),
    ownerPin: data.ownerPin,
  });
}

export function recordDamage(data: StockMovementInput) {
  return apiRequest<unknown>("/inventory/damage", {
    method: "POST",
    body: JSON.stringify(data),
    ownerPin: data.ownerPin,
  });
}

export function stockCorrection(data: StockMovementInput) {
  return apiRequest<unknown>("/inventory/correction", {
    method: "POST",
    body: JSON.stringify(data),
    ownerPin: data.ownerPin,
  });
}

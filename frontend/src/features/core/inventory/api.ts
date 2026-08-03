import { apiRequest, buildQuery } from "@/lib/api/http";
import { safeRandomUUID } from "@/lib/safe-uuid";
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
  const payload = withMovementIdentity(data, "purchase");
  return apiRequest<unknown>("/inventory/purchase", {
    method: "POST",
    body: JSON.stringify(payload),
    ownerPin: data.ownerPin,
  });
}

export function recordDamage(data: StockMovementInput) {
  const payload = withMovementIdentity(data, "damage");
  return apiRequest<unknown>("/inventory/damage", {
    method: "POST",
    body: JSON.stringify(payload),
    ownerPin: data.ownerPin,
  });
}

export function stockCorrection(data: StockMovementInput) {
  const payload = withMovementIdentity(data, "correction");
  return apiRequest<unknown>("/inventory/correction", {
    method: "POST",
    body: JSON.stringify(payload),
    ownerPin: data.ownerPin,
  });
}

function withMovementIdentity(data: StockMovementInput, action: string): StockMovementInput {
  const idempotencyKey = data.idempotencyKey || `inventory:${action}:${safeRandomUUID()}`;
  return {
    ...data,
    idempotencyKey,
    clientMovementId: data.clientMovementId || idempotencyKey,
  };
}

export type StockCountStatus = "counting" | "review" | "applied" | "cancelled";

export interface StockCountLine {
  id: string;
  productId: string;
  productName: string;
  baseUnit: string;
  expectedBaseQty: number | null;
  countedBaseQty: number | null;
  varianceBaseQty: number | null;
  reason?: string | null;
  countedAt?: string | null;
}

export interface StockCountSession {
  id: string;
  name: string;
  status: StockCountStatus;
  blindCount: boolean;
  locationId: string;
  location: { id: string; name: string; code: string };
  createdAt: string;
  updatedAt: string;
  submittedAt?: string | null;
  appliedAt?: string | null;
  cancelledAt?: string | null;
  lines: StockCountLine[];
  summary: {
    totalLines: number;
    countedLines: number;
    remainingLines: number;
    varianceLines: number;
    netVarianceBaseQty: number | null;
  };
}

export function getStockCounts(status: StockCountStatus | "all" = "all", limit = 30) {
  return apiRequest<StockCountSession[]>(`/inventory/counts${buildQuery({ status, limit })}`);
}

export function getStockCount(id: string) {
  return apiRequest<StockCountSession>(`/inventory/counts/${id}`);
}

export function createStockCount(data: { name: string; blindCount: boolean; productIds?: string[] }) {
  return apiRequest<StockCountSession>("/inventory/counts", { method: "POST", body: JSON.stringify(data) });
}

export function updateStockCountLines(id: string, lines: Array<{ productId: string; countedBaseQty: number; reason?: string }>) {
  return apiRequest<StockCountSession>(`/inventory/counts/${id}/lines`, { method: "PATCH", body: JSON.stringify({ lines }) });
}

export function submitStockCount(id: string) {
  return apiRequest<StockCountSession>(`/inventory/counts/${id}/submit`, { method: "POST" });
}

export function decideStockCount(id: string, action: "apply" | "cancel", data: { ownerPin: string; note: string }) {
  return apiRequest<StockCountSession>(`/inventory/counts/${id}/${action}`, {
    method: "POST",
    ownerPin: data.ownerPin,
    body: JSON.stringify({ ownerPin: data.ownerPin, note: data.note }),
  });
}

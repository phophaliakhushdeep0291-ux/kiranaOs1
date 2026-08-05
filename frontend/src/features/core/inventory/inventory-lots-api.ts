import { apiRequest, buildQuery } from "@/lib/api/http";

export interface InventoryLot {
  id: string;
  batchNumber: string;
  manufacturedOn?: string | null;
  expiresOn: string;
  receivedBaseQty: number;
  availableBaseQty: number;
  costPerRateUnit: number;
  status: "active" | "depleted" | "quarantined" | "recalled";
  note?: string | null;
  product: { id: string; name: string; baseUnit: string; rateUnit: string };
  location: { id: string; name: string; code: string };
}

/** One batch the counter may dispense from, in the FEFO order the till itself uses. */
export interface SellableBatch {
  id: string;
  batchNumber: string;
  expiresOn: string;
  availableBaseQty: number;
  /** The MRP printed on this batch's pack. Null means the product's MRP applies. */
  mrp: number | null;
}

export type ExpirySeverity = "expired" | "critical" | "warning";

/** One batch close enough to expiry to act on, with what it would cost to lose. */
export interface ExpiringBatch {
  id: string;
  batchNumber: string;
  expiresOn: string;
  availableBaseQty: number;
  mrp: number | null;
  daysUntilExpiry: number;
  severity: ExpirySeverity;
  /** What the shop paid for what is still on the shelf. */
  valueAtRisk: number;
  product: { id: string; name: string; baseUnit: string; rateUnit: string };
  location: { id: string; name: string; code: string };
}

export interface ExpiryAlerts {
  calculationVersion: string;
  thresholds: { criticalDays: number; warningDays: number };
  buckets: Record<ExpirySeverity, { count: number; valueAtRisk: number }>;
  totalCount: number;
  totalValueAtRisk: number;
  /** Already sorted soonest-first, so a card can take the head of the list. */
  batches: ExpiringBatch[];
}

export const listInventoryLots = (params: { status?: string; expiringWithinDays?: number } = {}) => apiRequest<InventoryLot[]>(`/inventory-lots${buildQuery({ status: params.status ?? "all", expiringWithinDays: params.expiringWithinDays, limit: 500 })}`);
export const getExpiryAlerts = (params: { criticalDays?: number; warningDays?: number } = {}) => apiRequest<ExpiryAlerts>(`/inventory-lots/expiry-alerts${buildQuery({ criticalDays: params.criticalDays, warningDays: params.warningDays })}`);
export const listSellableBatches = (productId: string) => apiRequest<SellableBatch[]>(`/inventory-lots/sellable/${productId}`);
export const changeInventoryLotStatus = (id: string, status: "active" | "quarantined" | "recalled", note: string, ownerPin: string) => apiRequest<InventoryLot>(`/inventory-lots/${id}/status`, { method: "POST", ownerPin, body: JSON.stringify({ status, note }) });

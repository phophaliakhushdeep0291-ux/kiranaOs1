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

export const listInventoryLots = (params: { status?: string; expiringWithinDays?: number } = {}) => apiRequest<InventoryLot[]>(`/inventory-lots${buildQuery({ status: params.status ?? "all", expiringWithinDays: params.expiringWithinDays, limit: 500 })}`);
export const listSellableBatches = (productId: string) => apiRequest<SellableBatch[]>(`/inventory-lots/sellable/${productId}`);
export const changeInventoryLotStatus = (id: string, status: "active" | "quarantined" | "recalled", note: string, ownerPin: string) => apiRequest<InventoryLot>(`/inventory-lots/${id}/status`, { method: "POST", ownerPin, body: JSON.stringify({ status, note }) });

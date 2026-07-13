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

export const listInventoryLots = (params: { status?: string; expiringWithinDays?: number } = {}) => apiRequest<InventoryLot[]>(`/inventory-lots${buildQuery({ status: params.status ?? "all", expiringWithinDays: params.expiringWithinDays, limit: 500 })}`);
export const changeInventoryLotStatus = (id: string, status: "active" | "quarantined" | "recalled", note: string, ownerPin: string) => apiRequest<InventoryLot>(`/inventory-lots/${id}/status`, { method: "POST", ownerPin, body: JSON.stringify({ status, note }) });

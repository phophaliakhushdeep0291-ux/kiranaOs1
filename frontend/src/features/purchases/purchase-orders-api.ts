import { apiRequest } from "@/lib/api/http";

export type PurchaseOrderStatus = "draft" | "sent" | "partially_received" | "received" | "cancelled";
export interface PurchaseOrderItem {
  id: string;
  productId: string;
  productName: string;
  baseUnit: string;
  rateUnit: string;
  orderedBaseQty: number;
  receivedBaseQty: number;
  expectedRate: number;
  expectedAmount: number;
}
export interface PurchaseOrder {
  id: string;
  orderNumber: string;
  supplierId?: string | null;
  supplierName: string;
  locationId: string;
  status: PurchaseOrderStatus;
  expectedOn?: string | null;
  expectedTotal: number;
  createdAt: string;
  items: PurchaseOrderItem[];
  receipts: Array<{ id: string; receiptNumber: string; totalAmount: number; createdAt: string }>;
  location: { id: string; name: string; code: string };
}
export interface ReorderSuggestion {
  productId: string;
  productName: string;
  baseUnit: string;
  rateUnit: string;
  stockBaseQty: number;
  lowStockThreshold: number;
  recommendedOrderBaseQty: number;
  expectedRate: number;
  supplierId?: string | null;
  supplierName?: string | null;
}

export const listPurchaseOrders = () => apiRequest<PurchaseOrder[]>("/purchase-orders?status=all&limit=50");
export const getReorderSuggestions = () => apiRequest<ReorderSuggestion[]>("/purchase-orders/suggestions");
export const createPurchaseOrder = (data: unknown) => apiRequest<PurchaseOrder>("/purchase-orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
export const sendPurchaseOrder = (id: string, ownerPin: string) => apiRequest<PurchaseOrder>(`/purchase-orders/${id}/send`, { method: "POST", ownerPin, headers: { "Content-Type": "application/json" }, body: "{}" });
export const receivePurchaseOrder = (id: string, data: unknown, ownerPin: string) => apiRequest<{ purchaseOrder: PurchaseOrder; receipt: { id: string; receiptNumber: string; totalAmount: number }; idempotentReplay: boolean }>(`/purchase-orders/${id}/receive`, { method: "POST", ownerPin, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
export const cancelPurchaseOrder = (id: string, reason: string, ownerPin: string) => apiRequest<PurchaseOrder>(`/purchase-orders/${id}/cancel`, { method: "POST", ownerPin, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) });

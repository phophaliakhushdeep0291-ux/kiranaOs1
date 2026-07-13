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
  product?: { batchTrackingEnabled?: boolean };
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
  vendorReference?: string | null;
  paymentTerms?: string | null;
  deliveryAddress?: string | null;
  termsAndConditions?: string | null;
  note?: string | null;
  createdAt: string;
  items: PurchaseOrderItem[];
  receipts: PurchaseReceipt[];
  location: { id: string; name: string; code: string };
  supplier?: { id: string; name: string; mobile?: string | null; address?: string | null } | null;
}
export interface PurchaseReceiptItem { id: string; purchaseOrderItemId: string; productId: string; quantityBaseQty: number; actualRate: number; lineAmount: number }
export interface PurchaseReceipt { id: string; receiptNumber: string; supplierInvoiceNumber?: string | null; totalAmount: number; dueAmount?: number; createdAt: string; items: PurchaseReceiptItem[] }
export interface PurchaseReturnItem {
  id: string;
  productId: string;
  quantityBaseQty: number;
  actualRate: number;
  lineAmount: number;
  product?: { id: string; name: string; baseUnit?: string; category?: string | null };
}
export interface PurchaseReturn {
  id: string;
  returnNumber: string;
  totalAmount: number;
  supplierCreditAmount: number;
  refundAmount: number;
  refundMode: string;
  status: "active" | "cancelled";
  cancelledAt?: string | null;
  cancellationReason?: string | null;
  reason: string;
  supplierReference?: string | null;
  createdAt: string;
  idempotentReplay?: boolean;
  supplier?: { id: string; name: string; mobile?: string | null } | null;
  location?: { id: string; name: string; code?: string };
  purchaseReceipt?: { id: string; receiptNumber: string; supplierInvoiceNumber?: string | null };
  items: PurchaseReturnItem[];
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
export const listPurchaseReturns = () => apiRequest<PurchaseReturn[]>("/purchase-returns?limit=200");
export const createPurchaseReturn = (data: unknown, ownerPin: string) => apiRequest<PurchaseReturn>("/purchase-returns", { method: "POST", ownerPin, body: JSON.stringify(data) });
export const cancelPurchaseReturn = (id: string, reason: string, ownerPin: string) => apiRequest<PurchaseReturn>(`/purchase-returns/${id}/cancel`, { method: "POST", ownerPin, body: JSON.stringify({ reason }) });

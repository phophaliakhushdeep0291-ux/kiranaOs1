import { apiRequest } from "@/lib/api/http";

export interface CustomerOrderItem {
  productId: string;
  name: string;
  unit: string;
  price: number;
  qty: number;
}

export interface CustomerOrder {
  id: string;
  shopId: string;
  locationId: string | null;
  customerName: string;
  customerMobile: string;
  customerAddress: string | null;
  note: string | null;
  items: CustomerOrderItem[];
  itemCount: number;
  estimatedTotal: number;
  fulfillmentType: "delivery" | "pickup";
  promisedSlot: string | null;
  status: "new" | "accepted" | "ready" | "fulfilled" | "rejected" | "cancelled";
  billId: string | null;
  acceptedAt: string | null;
  readyAt: string | null;
  fulfilledAt: string | null;
  rejectedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerOrdersResponse {
  orders: CustomerOrder[];
  newCount: number;
  /** Cursor for the next page; null/absent when this page is the last. */
  nextCursor?: string | null;
}

export function listCustomerOrders(status?: string, cursor?: string | null) {
  const params = new URLSearchParams();
  if (status && status !== "all") params.set("status", status);
  if (cursor) params.set("cursor", cursor);
  const query = params.toString();
  return apiRequest<CustomerOrdersResponse>(`/orders${query ? `?${query}` : ""}`);
}

export function updateCustomerOrder(id: string, data: { status?: CustomerOrder["status"]; billId?: string | null }) {
  return apiRequest<CustomerOrder>(`/orders/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

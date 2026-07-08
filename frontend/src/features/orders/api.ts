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
  customerName: string;
  customerMobile: string;
  customerAddress: string | null;
  note: string | null;
  items: CustomerOrderItem[];
  itemCount: number;
  estimatedTotal: number;
  status: "new" | "accepted" | "fulfilled" | "rejected";
  billId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerOrdersResponse {
  orders: CustomerOrder[];
  newCount: number;
}

export function listCustomerOrders(status?: string) {
  const query = status && status !== "all" ? `?status=${encodeURIComponent(status)}` : "";
  return apiRequest<CustomerOrdersResponse>(`/orders${query}`);
}

export function updateCustomerOrder(id: string, data: { status?: CustomerOrder["status"]; billId?: string | null }) {
  return apiRequest<CustomerOrder>(`/orders/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

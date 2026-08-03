import { apiRequest, buildQuery } from "@/lib/api/http";
import type { Customer, CustomerInput, CustomerKhataResult, QueryParams } from "@/types/api";

export function listCustomers(params?: QueryParams) {
  return apiRequest<Customer[]>(`/customers${buildQuery(params)}`);
}

export function createCustomer(data: CustomerInput) {
  return apiRequest<Customer>("/customers", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateCustomer(id: string, data: CustomerInput) {
  return apiRequest<Customer>(`/customers/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function deleteCustomer(id: string) {
  return apiRequest<{ success: boolean; message?: string }>(`/customers/${id}`, { method: "DELETE" });
}

export function getCustomerKhata(id: string) {
  return apiRequest<CustomerKhataResult>(`/customers/${id}/khata`);
}

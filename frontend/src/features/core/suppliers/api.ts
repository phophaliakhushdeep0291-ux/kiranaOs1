import { apiRequest } from "@/lib/api/http";
import type { Supplier } from "@/types/api";

export function listSuppliers() {
  return apiRequest<Supplier[]>("/suppliers");
}

export function createSupplier(data: Partial<Supplier>) {
  return apiRequest<Supplier>("/suppliers", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateSupplier(id: string, data: Partial<Supplier>) {
  return apiRequest<Supplier>(`/suppliers/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

import { apiRequest } from "@/lib/api/http";
import type { Supplier } from "@/types/api";

export interface SupplierStatementRow {
  id: string;
  sourceType: string;
  sourceId: string;
  reference: string;
  businessDate: string;
  purchasePaise: number;
  immediatePaymentPaise: number;
  settlementPaise: number;
  creditPaise: number;
  payableChangePaise: number;
  balancePaise: number;
}

export interface SupplierStatement {
  version: string;
  supplier: Pick<Supplier, "id" | "name" | "mobile" | "gstin">;
  openingBalancePaise: number;
  currentBalancePaise: number;
  operationalDuePaise: number;
  differencePaise: number;
  reconciliationStatus: "balanced" | "attention_required";
  coverage: {
    linkedPurchaseCount: number;
    unlinkedPurchaseCount: number;
    unlinkedPurchaseIds: string[];
    complete: boolean;
  };
  rows: SupplierStatementRow[];
  hasMore: boolean;
  basis: "append_only_financial_ledger";
}

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

export function getSupplierStatement(id: string, range: { from?: string; to?: string } = {}) {
  const query = new URLSearchParams();
  if (range.from) query.set("from", range.from);
  if (range.to) query.set("to", range.to);
  return apiRequest<SupplierStatement>(`/suppliers/${id}/statement${query.size ? `?${query}` : ""}`);
}

export function rebuildSupplierStatement(id: string, ownerPin: string) {
  return apiRequest<{ repairedPurchaseCount: number; repairIncomplete: boolean; idempotentReplay: boolean }>(`/suppliers/${id}/statement/rebuild`, {
    method: "POST",
    ownerPin,
    body: JSON.stringify({}),
  });
}

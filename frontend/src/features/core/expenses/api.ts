import { apiRequest } from "@/lib/api/http";
import { safeRandomUUID } from "@/lib/safe-uuid";
import type { Expense, ExpenseInput, ExpenseOverview, ExpenseSummary } from "@/types/api";

function qs(params?: Record<string, string | undefined>) {
  if (!params) return "";
  const entries = Object.entries(params).filter(([, v]) => v != null && v !== "") as [string, string][];
  return entries.length ? `?${new URLSearchParams(entries).toString()}` : "";
}

export function listExpenses(params?: { category?: string; status?: string; from?: string; to?: string; search?: string }) {
  return apiRequest<Expense[]>(`/expenses${qs(params)}`);
}

export function getExpenseSummary(params?: { from?: string; to?: string }) {
  return apiRequest<ExpenseSummary>(`/expenses/summary${qs(params)}`);
}

export function getExpenseOverview() {
  return apiRequest<ExpenseOverview>("/expenses/overview");
}

export function createExpense(data: ExpenseInput) {
  const idempotencyKey = data.idempotencyKey || `expense:${safeRandomUUID()}`;
  return apiRequest<Expense>("/expenses", {
    method: "POST",
    body: JSON.stringify({
      ...data,
      idempotencyKey,
      clientExpenseId: data.clientExpenseId || idempotencyKey,
    }),
  });
}

export function updateExpense(id: string, data: Partial<ExpenseInput>, ownerPin: string) {
  return apiRequest<Expense>(`/expenses/${id}`, { method: "PATCH", body: JSON.stringify(data), ownerPin });
}

export function deleteExpense(id: string, ownerPin: string) {
  return apiRequest<Expense>(`/expenses/${id}`, { method: "DELETE", ownerPin });
}

export function restoreExpense(id: string, ownerPin: string) {
  return apiRequest<Expense>(`/expenses/${id}/restore`, { method: "POST", ownerPin });
}

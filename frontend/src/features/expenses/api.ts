import { apiRequest } from "@/lib/api/http";
import type { Expense, ExpenseInput, ExpenseSummary } from "@/types/api";

function qs(params?: Record<string, string | undefined>) {
  if (!params) return "";
  const entries = Object.entries(params).filter(([, v]) => v != null && v !== "") as [string, string][];
  return entries.length ? `?${new URLSearchParams(entries).toString()}` : "";
}

export function listExpenses(params?: { category?: string; from?: string; to?: string; search?: string }) {
  return apiRequest<Expense[]>(`/expenses${qs(params)}`);
}

export function getExpenseSummary(params?: { from?: string; to?: string }) {
  return apiRequest<ExpenseSummary>(`/expenses/summary${qs(params)}`);
}

export function createExpense(data: ExpenseInput) {
  return apiRequest<Expense>("/expenses", { method: "POST", body: JSON.stringify(data) });
}

export function updateExpense(id: string, data: Partial<ExpenseInput>) {
  return apiRequest<Expense>(`/expenses/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function deleteExpense(id: string) {
  return apiRequest<Expense>(`/expenses/${id}`, { method: "DELETE" });
}

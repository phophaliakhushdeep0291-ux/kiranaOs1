import { roundMoney } from "@/lib/money";
import type { Expense } from "@/types/api";

/** Scheduled/unpaid expenses and digital payments have not left the drawer. */
export function paidCashExpenseTotal(rows: Expense[]): number {
  return roundMoney(rows
    .filter((row) => row.status === "paid" && row.paymentMode === "cash" && !row.deletedAt)
    .reduce((sum, row) => sum + Number(row.amount), 0));
}

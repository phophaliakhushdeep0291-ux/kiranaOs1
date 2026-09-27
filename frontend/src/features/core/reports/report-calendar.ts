import { format, isValid, parseISO } from "date-fns";
import { roundMoney } from "@/lib/money";
import type { Expense } from "@/types/api";

/** Report rows use the counter's calendar day, just like the expense date picker. */
export function reportCalendarDay(value?: string | null): string | null {
  if (!value) return null;
  const date = parseISO(value);
  return isValid(date) ? format(date, "yyyy-MM-dd") : null;
}

export function expenseTotalsByDay(rows: Pick<Expense, "spentAt" | "amount" | "deletedAt">[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const expense of rows) {
    if (expense.deletedAt) continue;
    const day = reportCalendarDay(expense.spentAt);
    if (day) totals.set(day, roundMoney((totals.get(day) ?? 0) + Number(expense.amount || 0)));
  }
  return totals;
}

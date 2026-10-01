import { expect, it } from "vitest";
import { paidCashExpenseTotal } from "@/features/core/reports/cash-expenses";
import type { Expense } from "@/types/api";

it("closing deducts only paid, active cash expenses", () => {
  const rows = [
    { amount: 10.25, status: "paid", paymentMode: "cash" },
    { amount: 0.1, status: "paid", paymentMode: "cash" },
    { amount: 50, status: "unpaid", paymentMode: "cash" },
    { amount: 60, status: "paid", paymentMode: "upi" },
    { amount: 70, status: "paid", paymentMode: "bank" },
    { amount: 80, status: "paid", paymentMode: "cash", deletedAt: "2026-09-22" },
  ] as Expense[];
  expect(paidCashExpenseTotal(rows)).toBe(10.35);
});

/**
 * How a bill was actually paid, from whatever shape the bill arrived in.
 *
 * A pure credit bill is the case that keeps getting this wrong: nothing was
 * tendered, so it carries NO payment rows and no explicit payment mode. Code
 * that reads only `payments[0].mode` therefore sees nothing and falls through to
 * "cash" — the billing screen's Recent Bills panel labelled every udhar sale as
 * Cash that way, while the dashboard (which checks the outstanding amount first)
 * called the same bills Udhar.
 *
 * Outstanding money is the strongest signal available and is checked first.
 */

export type BillPaymentModeName = "cash" | "upi" | "bank" | "card" | "split" | "udhar" | string;

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

const CREDIT_STATUSES = ["credit", "partial", "unpaid", "due"];

export function billOutstandingAmount(bill: Record<string, unknown>): number {
  return Math.max(
    num(bill.creditAmount ?? bill.credit_amount),
    num(bill.udharAmount ?? bill.udhar_amount),
    num(bill.dueAmount ?? bill.due_amount),
    num(bill.outstandingAmount ?? bill.outstanding_amount),
  );
}

export function resolveBillPaymentMode(bill: Record<string, unknown>): BillPaymentModeName {
  const status = String(bill.paymentStatus ?? bill.payment_status ?? "").toLowerCase();
  if (billOutstandingAmount(bill) > 0 || CREDIT_STATUSES.includes(status)) return "udhar";

  const explicit = String(bill.paymentMode ?? bill.payment_mode ?? "").toLowerCase();
  if (explicit && explicit !== "credit") return explicit;

  const payments = Array.isArray(bill.payments) ? (bill.payments as Array<Record<string, unknown>>) : [];
  const tenderModes = [...new Set(
    payments
      .filter((payment) => String(payment.mode ?? "").toLowerCase() !== "credit" && num(payment.amount) > 0)
      .map((payment) => String(payment.mode ?? "").toLowerCase()),
  )];
  if (tenderModes.length > 1) return "split";
  if (tenderModes.length === 1) return tenderModes[0];
  return "cash";
}

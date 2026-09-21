import { AppError } from "../../../middleware/error.js";
import { toPaiseBigInt } from "../../../utils/money.js";
import { postFinancialLedgerRows } from "../../../modules/finance/general-ledger.service.js";
import { createAuditLog } from "../../../modules/audit/audit.service.js";

export function requireRentalAccounting(booking) {
  if (booking.financialVersion !== 1) throw new AppError("This older booking needs its payment history reconciled before recording more money. Its original payment method is unknown.", 409, "RENTAL_LEGACY_FINANCE_REVIEW");
}

export function rentalTender(mode) {
  if (!["cash", "upi", "bank", "card", "other"].includes(mode)) throw new AppError("Choose how the rental money was paid", 400, "RENTAL_PAYMENT_MODE_REQUIRED");
  return `rental_${mode === "card" ? "bank" : mode}`;
}

// Each event is balanced, dated and immutable. Positive tender is money received;
// refunds negate both the tender and the liability without deleting the receipt.
export async function postRentalEvent(tx, booking, event, entries, { paymentMode = null, reference = null, userId = null, req = null } = {}) {
  const businessDate = new Date();
  const rows = entries.filter(([, amount]) => toPaiseBigInt(amount) !== 0n).map(([entryType, amount]) => ({
    shopId: booking.shopId, sourceType: "rental", sourceId: booking.id, entryType,
    direction: ["rental_advance", "rental_deposit", "rental_income"].includes(entryType) ? "credit" : "debit",
    amountPaise: toPaiseBigInt(amount), paymentMode, businessDate,
    idempotencyKey: `rental:${booking.id}:${event}:${entryType}`,
    evidenceJson: JSON.stringify({ version: 1, event, bookingNumber: booking.bookingNumber, locationId: booking.locationId, reference }),
  }));
  await postFinancialLedgerRows(tx, rows);
  const audit = await createAuditLog({ shopId: booking.shopId, userId, req, client: tx,
    module: "payments", action: ({ booked: "RENTAL_BOOKED", returned: "RENTAL_RETURNED", cancelled: "RENTAL_CANCELLED" })[event] ?? "RENTAL_FINANCIAL_EVENT", entityType: "RentalBooking", entityId: booking.id,
    metadata: { event, paymentMode, reference, entries, locationId: booking.locationId } });
  if (!audit) throw new AppError("Rental change was not saved because its audit record could not be stored", 503, "RENTAL_FINANCIAL_AUDIT_FAILED");
}

import { AppError } from "../../../middleware/error.js";
import { toPaise } from "../../../utils/money.js";
import { postFinancialLedgerRows } from "../../../modules/finance/general-ledger.service.js";
import { createAuditLog } from "../../../modules/audit/audit.service.js";

export function requireRentalAccounting(booking) {
  if (booking.financialVersion !== 1) throw new AppError(
    "This older booking needs its advance and deposit reconciled before further financial changes.",
    409, "RENTAL_LEGACY_FINANCE_REVIEW",
  );
}

export function rentalTender(mode) {
  if (!["cash", "upi", "bank", "card", "other"].includes(mode)) throw new AppError("Select how the money was received or refunded", 400);
  return `rental_${mode === "card" ? "bank" : mode}`;
}

// The status, financial rows, balanced journal and mandatory audit commit together.
// Deposit receipts are liabilities, never sales or profit. Negative tenders are refunds.
export async function postRentalEvent(tx, booking, event, entries, context = {}) {
  const { userId = null, req = null, paymentMode = null, reference = null, reason = null, requestFingerprint = null } = context;
  const metadata = { bookingNumber: booking.bookingNumber, locationId: booking.locationId, event, paymentMode, reference, reason, requestFingerprint };
  const businessDate = new Date();
  const rows = Object.entries(entries).filter(([, amount]) => toPaise(amount) !== 0).map(([entryType, amount]) => ({
    shopId: booking.shopId, customerId: booking.customerId, sourceType: "rental", sourceId: booking.id,
    // Direction is the account's normal posting side; a negative amount reverses it.
    entryType, direction: ["rental_advance", "rental_deposit", "rental_income"].includes(entryType) ? "credit" : "debit", amountPaise: BigInt(toPaise(amount)),
    paymentMode, businessDate, idempotencyKey: `rental:${booking.id}:${event}:${entryType}`,
    evidenceJson: JSON.stringify(metadata),
  }));
  await postFinancialLedgerRows(tx, rows);
  const audit = await createAuditLog({
    client: tx, shopId: booking.shopId, userId, req, module: "payments",
    action: `RENTAL_${event.toUpperCase()}`, entityType: "RentalBooking", entityId: booking.id,
    after: { status: booking.status, advancePaid: booking.advancePaid, depositRefunded: booking.depositRefunded },
    metadata: { ...metadata, entries },
  });
  if (!audit) throw new AppError("The booking was not changed because its audit could not be saved", 503, "RENTAL_AUDIT_FAILED");
}

export async function matchesRentalTender(tx, booking, event, amount, paymentMode, reference = null) {
  const row = await tx.financialLedger.findUnique({ where: { shopId_idempotencyKey: {
    shopId: booking.shopId, idempotencyKey: `rental:${booking.id}:${event}:${rentalTender(paymentMode)}`,
  } } });
  return row && row.amountPaise === BigInt(toPaise(amount)) && row.paymentMode === paymentMode
    && (JSON.parse(row.evidenceJson).reference ?? null) === (reference || null);
}

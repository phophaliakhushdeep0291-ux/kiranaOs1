import type { Translate } from "@/features/core/settings/i18n";

/**
 * A bill that has not reached the server yet carries the number the DEVICE minted
 * for itself — `PENDING-50FA06`, or `EST-2026-LOCAL-50FA06` for an estimate. The
 * real number (`KOS-2026-000002`) is the server's to assign, because only the
 * server can keep one sequence across every till in the shop.
 *
 * That placeholder was being printed verbatim wherever a shopkeeper reads "my bill
 * number": the saved-bill panel said "पिछला बिल: PENDING-CFF518". The sale was
 * safe and the number did resolve after sync, but nothing on the screen said so —
 * it reads like an error at the one moment the shopkeeper is deciding whether the
 * till can be trusted.
 *
 * The local suffix is still worth showing: before sync it is the only handle the
 * shopkeeper has for finding that bill again. So these helpers keep the reference
 * and drop the internal word.
 */

const PENDING_BILL_NUMBER = /^PENDING-(.+)$/i;
const LOCAL_ESTIMATE_NUMBER = /^EST-\d{4}-LOCAL-(.+)$/i;

/** True while the number on this bill is the device's own, not the server's. */
export function isUnsyncedBillNumber(billNo: string | null | undefined): boolean {
  if (!billNo) return false;
  return PENDING_BILL_NUMBER.test(billNo) || LOCAL_ESTIMATE_NUMBER.test(billNo);
}

/**
 * The device's own reference, without the internal prefix — `PENDING-50FA06` → `50FA06`.
 * Returns null for a number the server has already assigned.
 */
export function localBillReference(billNo: string | null | undefined): string | null {
  if (!billNo) return null;
  const pending = PENDING_BILL_NUMBER.exec(billNo);
  if (pending) return pending[1];
  const estimate = LOCAL_ESTIMATE_NUMBER.exec(billNo);
  if (estimate) return estimate[1];
  return null;
}

/**
 * What to print where a shopkeeper reads a bill number. A synced number is shown
 * as-is; an unsynced one becomes its reference plus the word for "not final yet",
 * so nobody reads an internal token as their invoice number.
 */
export function billNumberLabel(billNo: string | null | undefined, t: Translate): string {
  if (!billNo) return "";
  const reference = localBillReference(billNo);
  if (!reference) return billNo;
  return t("billing.billNumber.pending", { reference });
}

/**
 * The same number with no explanation attached, for somewhere that already says
 * the backup is pending — a toast whose body is "cloud backup still to go" does
 * not need the title to repeat it.
 */
export function billNumberShort(billNo: string | null | undefined): string {
  if (!billNo) return "";
  const reference = localBillReference(billNo);
  return reference ? `#${reference}` : billNo;
}

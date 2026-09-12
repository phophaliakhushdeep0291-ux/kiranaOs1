const AMOUNT_KEYS = [
  "grandTotal", "grand_total", "actualAmount", "actual_amount",
  "totalAmount", "total_amount", "amount", "creditAmount", "credit_amount",
];

/** A queued bill carries actualAmount; creditAmount is only the unpaid part.
 * Look for a total across envelope/nested records before falling back to debt. */
export function readSyncSubjectAmount(records: Record<string, unknown>[]): number | null {
  for (const key of AMOUNT_KEYS) {
    for (const record of records) {
      const raw = record[key];
      if (typeof raw !== "number" && typeof raw !== "string") continue;
      if (typeof raw === "string" && raw.trim() === "") continue;
      const value = Number(raw);
      if (Number.isFinite(value)) return value;
    }
  }
  return null;
}

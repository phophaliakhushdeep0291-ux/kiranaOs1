import { round2 } from "../../utils/money.js";

/**
 * How close to expiry a batch has to be before the shop is told about it.
 *
 * Two windows rather than one, because they call for different actions. Inside
 * the critical window a batch is a write-off waiting to happen and wants
 * discounting or returning to the supplier today. The warning window is early
 * enough to simply stop reordering and sell through — useful precisely because
 * it is not urgent yet.
 */
export const NEAR_EXPIRY_CRITICAL_DAYS = 30;
export const NEAR_EXPIRY_WARNING_DAYS = 90;
export const NEAR_EXPIRY_CALCULATION_VERSION = "deterministic_near_expiry_v1";

const DAY = 86_400_000;

/** Whole days from `now` until `expiresOn`; negative once the date has passed. */
export function daysUntilExpiry(expiresOn, now) {
  const expiry = new Date(expiresOn).getTime();
  if (!Number.isFinite(expiry)) return null;
  // Both ends floored to UTC midnight so "expires today" is 0 for every caller,
  // whatever time of day the question is asked.
  const startOfExpiry = Math.floor(expiry / DAY);
  const startOfNow = Math.floor(new Date(now).getTime() / DAY);
  return startOfExpiry - startOfNow;
}

/**
 * Which bucket a batch falls in.
 *
 * `expired` is separate from `critical` on purpose: expired stock is not an
 * early warning, it is money already lost and stock that must not be sold. The
 * allocator already refuses it — this is what tells someone to go remove it
 * from the shelf.
 */
export function classifyExpiry(days, { criticalDays = NEAR_EXPIRY_CRITICAL_DAYS, warningDays = NEAR_EXPIRY_WARNING_DAYS } = {}) {
  if (days === null) return "unknown";
  if (days < 0) return "expired";
  if (days <= criticalDays) return "critical";
  if (days <= warningDays) return "warning";
  return "ok";
}

/**
 * A deterministic near-expiry summary.
 *
 * Like the reorder recommendation, nothing here is a guess: every number is
 * derived from the batches passed in and can be recalculated by hand from the
 * same rows. Callers supply `valueAtRisk` per batch because converting stock to
 * money needs the product's rate unit, which is not this module's business.
 *
 * Batches are returned already sorted by urgency, so the caller can take the
 * first N for a dashboard card without re-sorting.
 */
export function summariseNearExpiry(batches, { now = Date.now(), criticalDays = NEAR_EXPIRY_CRITICAL_DAYS, warningDays = NEAR_EXPIRY_WARNING_DAYS } = {}) {
  const buckets = {
    expired: { count: 0, valueAtRisk: 0 },
    critical: { count: 0, valueAtRisk: 0 },
    warning: { count: 0, valueAtRisk: 0 },
  };

  const rows = [];
  for (const batch of batches ?? []) {
    // A depleted batch cannot expire into a loss — there is nothing left on the
    // shelf to throw away, so counting it would inflate every figure here.
    if (!(Number(batch.availableBaseQty) > 0)) continue;

    const days = daysUntilExpiry(batch.expiresOn, now);
    const bucket = classifyExpiry(days, { criticalDays, warningDays });
    if (bucket === "ok" || bucket === "unknown") continue;

    const valueAtRisk = round2(Math.max(0, Number(batch.valueAtRisk) || 0));
    buckets[bucket].count += 1;
    buckets[bucket].valueAtRisk = round2(buckets[bucket].valueAtRisk + valueAtRisk);
    rows.push({ ...batch, daysUntilExpiry: days, severity: bucket, valueAtRisk });
  }

  // Soonest first — an expired batch outranks one expiring tomorrow, and within
  // a day the larger loss leads.
  rows.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry || b.valueAtRisk - a.valueAtRisk);

  return {
    calculationVersion: NEAR_EXPIRY_CALCULATION_VERSION,
    thresholds: { criticalDays, warningDays },
    buckets,
    totalCount: buckets.expired.count + buckets.critical.count + buckets.warning.count,
    totalValueAtRisk: round2(buckets.expired.valueAtRisk + buckets.critical.valueAtRisk + buckets.warning.valueAtRisk),
    batches: rows,
  };
}

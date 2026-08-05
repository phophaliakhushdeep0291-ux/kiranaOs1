/**
 * Whether a sale may proceed without a doctor's slip.
 *
 * India's Drugs and Cosmetics Rules make dispensing a Schedule H, H1 or X
 * medicine without a valid prescription an offence, and require the sale to be
 * recorded. The register that records it already existed here; nothing stopped
 * the sale happening without one. This is that missing half.
 *
 * Deliberately pure — no database, no request, no clock of its own. The rules
 * are the part worth being certain about, so they are testable on their own.
 */

/** Schedules that cannot be sold without a prescription. */
export const RESTRICTED_SCHEDULES = Object.freeze(["h", "h1", "x"]);

/** Everything the product classifier accepts. `otc` is explicit "sell freely". */
export const DRUG_SCHEDULES = Object.freeze([...RESTRICTED_SCHEDULES, "otc"]);

/**
 * How long the register entry must be kept, in years.
 *
 * H1 is the strict one: its own bound register, retained three years. Ordinary H
 * and X sit at two. Encoded because the retention period is the reason the
 * register records `scheduleType` at all.
 */
export const RETENTION_YEARS = Object.freeze({ h: 2, h1: 3, x: 2 });

export const SCHEDULE_ENFORCEMENT_VERSION = "schedule_h_enforcement_v1";

export function normalizeSchedule(value) {
  const key = String(value ?? "").trim().toLowerCase();
  return DRUG_SCHEDULES.includes(key) ? key : null;
}

export function isRestricted(schedule) {
  return RESTRICTED_SCHEDULES.includes(normalizeSchedule(schedule));
}

/** The strictest schedule on a bill — H1 outranks X, which outranks H. */
export function strictestSchedule(schedules) {
  const order = { h: 1, x: 2, h1: 3 };
  let strictest = null;
  for (const value of schedules ?? []) {
    const key = normalizeSchedule(value);
    if (!key || !order[key]) continue;
    if (!strictest || order[key] > order[strictest]) strictest = key;
  }
  return strictest;
}

/**
 * Can this prescription authorise a dispense right now?
 *
 * Every reason is returned as a code rather than a message so the caller can
 * decide how to phrase it, and so the tests assert on the rule rather than on
 * wording.
 */
export function prescriptionBlockers(prescription, { now = Date.now(), validityDays = 180 } = {}) {
  const blockers = [];
  if (!prescription) return ["PRESCRIPTION_REQUIRED"];
  if (prescription.deletedAt) blockers.push("PRESCRIPTION_DELETED");
  if (prescription.status === "cancelled") blockers.push("PRESCRIPTION_CANCELLED");

  // A slip already used up cannot authorise another sale. refillsAllowed is the
  // number of REPEATS, so one dispense is always permitted: allowed 0 means the
  // single original dispense and nothing after it.
  if (prescription.status === "dispensed" && Number(prescription.refillsUsed ?? 0) > Number(prescription.refillsAllowed ?? 0)) {
    blockers.push("PRESCRIPTION_REFILLS_EXHAUSTED");
  }

  // An old slip is not a licence forever. Six months by default, counted from the
  // date the doctor wrote, not from when it was typed into the register.
  const prescribed = prescription.prescribedOn ? new Date(prescription.prescribedOn).getTime() : NaN;
  if (Number.isFinite(prescribed) && now - prescribed > validityDays * 86_400_000) {
    blockers.push("PRESCRIPTION_EXPIRED");
  }

  return blockers;
}

/**
 * The whole decision for one sale.
 *
 * `lines` are `{ productId, name, schedule }`. A bill with nothing restricted on
 * it is allowed with no prescription whatsoever — which is every sale in every
 * shop that has not classified its catalogue, and every OTC sale in one that has.
 */
export function evaluateSale({ lines, prescription, now = Date.now(), validityDays = 180 } = {}) {
  const restrictedLines = (lines ?? []).filter((line) => isRestricted(line.schedule));

  if (restrictedLines.length === 0) {
    return { allowed: true, requiresPrescription: false, schedule: null, restrictedLines: [], blockers: [], version: SCHEDULE_ENFORCEMENT_VERSION };
  }

  const schedule = strictestSchedule(restrictedLines.map((line) => line.schedule));
  const blockers = prescriptionBlockers(prescription, { now, validityDays });

  return {
    allowed: blockers.length === 0,
    requiresPrescription: true,
    schedule,
    retentionYears: RETENTION_YEARS[schedule] ?? null,
    restrictedLines,
    blockers,
    version: SCHEDULE_ENFORCEMENT_VERSION,
  };
}

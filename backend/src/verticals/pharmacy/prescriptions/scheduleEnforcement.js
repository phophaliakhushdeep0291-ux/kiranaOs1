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

  // A slip already used up cannot authorise another sale.
  //
  // refillsAllowed counts REPEATS, and refillsUsed counts repeats taken — the
  // first hand-over is not a refill, as the register's own doc says and as its
  // dispense path, canDispense and the refillable summary all count it. So a
  // slip that has reached status "dispensed" has already spent its original,
  // and >= is the ceiling: allowed 0 / used 0 is a spent one-time slip, not a
  // sale still to come.
  //
  // This read > for a while, one dispense looser than every other reader of the
  // same two columns. The register would refuse a hand-over that the till, the
  // only place that actually gates a sale, waved through — so a one-time slip
  // handed over at the register could buy Schedule H again at the counter.
  if (prescription.status === "dispensed" && Number(prescription.refillsUsed ?? 0) >= Number(prescription.refillsAllowed ?? 0)) {
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

const normalized = (value) => String(value ?? "").trim().toLowerCase();

/**
 * Every word this bill line's own unit goes by.
 *
 * The register's unit is typed by a chemist; the bill's is whatever the till
 * calls the pack. "strip" on the slip has to meet a pack labelled "Strip" whose
 * code is "strip", in either spelling and either case — comparing one string
 * against one string refuses a bill the app itself built from the slip.
 *
 * Only the names the line carries. The product's rate unit is NOT one of them:
 * a loose line is entered in grams against a per-kilo rate, so the two are
 * different amounts, and treating them as the same word would let 500 of one
 * pass as 500 of the other.
 */
function unitNamesOf(item) {
  return new Set([item.enteredUnit, item.sellingUnitLabel, item.sellingUnitCode].map(normalized).filter(Boolean));
}

/**
 * Does the bill hand over what the attached prescription says?
 *
 * The register entry is the record of what was dispensed against a slip, so a
 * bill closed against it has to agree with it: a restricted medicine must be on
 * the slip, in the unit the slip gives, and no more of it than the slip allows.
 * Until this existed any valid slip authorised any Schedule H line — a slip for
 * one strip of an antibiotic could close a bill for ten of something else.
 *
 * Returns null when they agree, or `{ code, message }` naming the medicine and
 * what is wrong with it. One sentence the counter can act on beats "does not
 * match": the fix is a different one each time.
 *
 * A medicine typed onto the slip by hand has no product id, so it is matched by
 * name — that is all a free-text line has. Lines the slip does not mention are
 * left alone unless they are restricted: a patient buying a bandage with their
 * antibiotics is an ordinary bill.
 *
 * Pure, like everything else in this file.
 */
export function prescriptionLineMismatch({ items, productMap, prescription, restrictedProductIds = new Set() } = {}) {
  const slipLines = prescription?.items ?? [];
  const entry = prescription?.registerNumber ? `prescription ${prescription.registerNumber}` : "the attached prescription";
  const billed = new Map();

  for (const item of items ?? []) {
    const product = item.productId ? productMap?.[item.productId] : null;
    if (!product) continue;

    const onSlip = slipLines.filter((line) => (
      line.productId ? line.productId === item.productId : normalized(line.name) === normalized(product.name)
    ));
    if (onSlip.length === 0) {
      if (!restrictedProductIds.has(item.productId)) continue;
      return {
        code: "PRESCRIPTION_ITEMS_MISMATCH",
        message: `${product.name} is not on ${entry}. Add it to the register entry, or attach the prescription it was written on.`,
      };
    }

    const unitNames = unitNamesOf(item);
    const inThisUnit = onSlip.filter((line) => unitNames.has(normalized(line.unit)));
    if (inThisUnit.length === 0) {
      const prescribedIn = [...new Set(onSlip.map((line) => String(line.unit ?? "").trim()).filter(Boolean))].join(" or ");
      return {
        code: "PRESCRIPTION_ITEMS_MISMATCH",
        message: `${product.name} is prescribed in ${prescribedIn || "another unit"} but billed in ${item.enteredUnit}. Bill it in the prescribed unit, or correct the register entry.`,
      };
    }

    const allowed = inThisUnit.reduce((total, line) => total + (Number(line.qty) || 0), 0);
    const total = (billed.get(item.productId) ?? 0) + (Number(item.quantity) || 0);
    // Two lines of the same medicine add up; the slip is a ceiling on the bill, not on a line.
    if (total > allowed + 1e-9) {
      return {
        code: "PRESCRIPTION_ITEMS_MISMATCH",
        message: `${product.name}: ${total} ${inThisUnit[0].unit} on the bill, but ${entry} allows ${allowed}.`,
      };
    }
    billed.set(item.productId, total);
  }

  if (billed.size === 0) {
    return {
      code: "PRESCRIPTION_ITEMS_MISMATCH",
      message: `Nothing on this bill is on ${entry}. Add one of its medicines, or remove the prescription from the bill.`,
    };
  }
  return null;
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

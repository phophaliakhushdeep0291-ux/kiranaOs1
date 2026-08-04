import assert from "assert";
import {
  STALE_AFTER_DAYS,
  nextRegisterNumber,
  normalizePhone,
  serializePrescription,
  todayKey,
} from "../src/verticals/pharmacy/prescriptions/prescriptions.service.js";
import {
  createPrescriptionSchema,
  updatePrescriptionSchema,
} from "../src/verticals/pharmacy/prescriptions/prescriptions.schema.js";

// The pharmacy prescription register. It is a record rather than a transaction,
// so what has to be right is what the record *says*: which slip can still be
// dispensed, how many repeats are left, how old it is, and that a register
// number is never reused. Those are the derivations a drug inspector reads and
// the counter acts on, so they are pinned here without touching a database.

/** A stored row as Prisma would hand it back. */
function row(overrides = {}) {
  return {
    id: "rx_1",
    registerNumber: "RX-000001",
    status: "pending",
    scheduleType: "h",
    prescribedOn: new Date(),
    dispensedAt: null,
    refillsAllowed: 0,
    refillsUsed: 0,
    ...overrides,
  };
}

function daysAgo(days) {
  return new Date(Date.now() - days * 86_400_000);
}

/* ── Register numbering: sequential, never reused ──────────────────────────── */

const emptyRegister = { prescription: { findFirst: async () => null } };
assert.equal(await nextRegisterNumber(emptyRegister, "shop_1"), "RX-000001", "the first entry opens the register");

const usedRegister = { prescription: { findFirst: async () => ({ registerNumber: "RX-000041" }) } };
assert.equal(await nextRegisterNumber(usedRegister, "shop_1"), "RX-000042", "the next entry follows the highest");

// Derived from the highest number rather than a row count, so deleting an entry
// can never hand its number to a new one — two rows sharing a register number
// would make the register unciteable.
const afterDeletes = { prescription: { findFirst: async () => ({ registerNumber: "RX-000900" }) } };
assert.equal(await nextRegisterNumber(afterDeletes, "shop_1"), "RX-000901", "a gap left by a deletion is not refilled");

// Six-digit padding is load-bearing: the highest is found by sorting text, and
// an unpadded "RX-1000000" would sort below "RX-999999".
assert.equal((await nextRegisterNumber(emptyRegister, "shop_1")).replace("RX-", "").length, 6, "numbers stay six digits");

/* ── Finding a patient again ───────────────────────────────────────────────── */

// The register only works if the patient can be found in it, and a counter types
// the same number differently on different days. All of these are one person.
for (const typed of ["9876543210", "+91 98765-43210", "+919876543210", "098765 43210", "(91) 9876543210"]) {
  assert.equal(normalizePhone(typed), "9876543210", `"${typed}" is the same patient`);
}

// Shorter than a mobile number is kept exactly as typed — the field is optional,
// and a half-remembered number still beats discarding what was written down.
assert.equal(normalizePhone("98765"), "98765", "a partial number is not mangled");
assert.equal(normalizePhone(""), "");
assert.equal(normalizePhone(null), "");
assert.equal(normalizePhone(undefined), "");

/* ── Age and staleness ─────────────────────────────────────────────────────── */

const fresh = serializePrescription(row({ prescribedOn: daysAgo(3) }));
assert.equal(fresh.ageDays, 3, "age is counted in whole days from the date on the slip");
assert.equal(fresh.isStale, false, "a slip written three days ago is fresh");
assert.match(fresh.prescribedOnKey, /^\d{4}-\d{2}-\d{2}$/, "the date key is a plain day string");

const old = serializePrescription(row({ prescribedOn: daysAgo(STALE_AFTER_DAYS + 1) }));
assert.equal(old.isStale, true, `a pending slip older than ${STALE_AFTER_DAYS} days is flagged`);

// Exactly at the boundary is still fresh — the flag fires strictly past it.
const boundary = serializePrescription(row({ prescribedOn: daysAgo(STALE_AFTER_DAYS) }));
assert.equal(boundary.isStale, false, "the staleness boundary is exclusive");

// A slip already handed over is history, however old. Flagging it would put a
// permanent warning on every closed entry in the register.
const oldDispensed = serializePrescription(
  row({ status: "dispensed", prescribedOn: daysAgo(400), dispensedAt: daysAgo(399) }),
);
assert.equal(oldDispensed.isStale, false, "a dispensed slip never goes stale");
assert.match(oldDispensed.dispensedAtKey, /^\d{4}-\d{2}-\d{2}$/, "the dispensed day is exposed too");
assert.equal(serializePrescription(row()).dispensedAtKey, null, "an undispensed slip has no dispensed day");

/* ── Repeats: the first hand-over is not a refill ──────────────────────────── */

assert.equal(serializePrescription(row()).canDispense, true, "a pending slip can be dispensed");

// No repeats allowed: once dispensed, the slip is spent.
const spent = serializePrescription(row({ status: "dispensed", dispensedAt: new Date() }));
assert.equal(spent.canDispense, false, "a one-off slip cannot be dispensed twice");
assert.equal(spent.refillsLeft, 0);

// Two repeats allowed, one used: one left.
const repeating = serializePrescription(
  row({ status: "dispensed", dispensedAt: new Date(), refillsAllowed: 2, refillsUsed: 1 }),
);
assert.equal(repeating.refillsLeft, 1, "repeats left is allowed minus used");
assert.equal(repeating.canDispense, true, "a repeat prescription can be dispensed again");

const exhausted = serializePrescription(
  row({ status: "dispensed", dispensedAt: new Date(), refillsAllowed: 2, refillsUsed: 2 }),
);
assert.equal(exhausted.refillsLeft, 0);
assert.equal(exhausted.canDispense, false, "a slip with every repeat used is spent");

// Never negative, even if the counters were somehow overdrawn.
const overdrawn = serializePrescription(row({ status: "dispensed", refillsAllowed: 1, refillsUsed: 5 }));
assert.equal(overdrawn.refillsLeft, 0, "repeats left never goes negative");
assert.equal(overdrawn.canDispense, false);

// Cancelled is terminal from either open state.
assert.equal(serializePrescription(row({ status: "cancelled" })).canDispense, false, "a cancelled slip is closed");

/* ── Which schedules the law actually bites on ─────────────────────────────── */

for (const scheduleType of ["h", "h1", "x"]) {
  assert.equal(serializePrescription(row({ scheduleType })).isRegulated, true, `schedule ${scheduleType} is regulated`);
}
for (const scheduleType of ["otc", "other"]) {
  assert.equal(serializePrescription(row({ scheduleType })).isRegulated, false, `${scheduleType} is not regulated`);
}

assert.equal(serializePrescription(null), null, "a missing row serialises to nothing, not a crash");

/* ── What the register will accept ─────────────────────────────────────────── */

const minimal = {
  doctorName: "Dr A Sharma",
  patientName: "Ramesh Kumar",
  prescribedOn: todayKey(),
  items: [{ name: "Amoxicillin", qty: 1 }],
};

const parsed = createPrescriptionSchema.parse(minimal);
assert.equal(parsed.scheduleType, "h", "schedule H is the default, so an unmarked slip is treated as regulated");
assert.equal(parsed.items[0].unit, "strip", "medicines default to strips, not pieces");
assert.equal(parsed.refillsAllowed, 0, "no repeats unless the doctor allowed them");
assert.equal(parsed.dispenseNow, false);

// A walk-in buying a strip of antibiotics often gives no number, and the
// register must still be recordable — the entry, not the phone, is the point.
assert.doesNotThrow(() => createPrescriptionSchema.parse({ ...minimal, patientPhone: "" }), "phone is optional");
assert.doesNotThrow(() => createPrescriptionSchema.parse({ ...minimal, patientPhone: "+91 98765-43210" }));
assert.throws(() => createPrescriptionSchema.parse({ ...minimal, patientPhone: "call the clinic" }), /digits/i);

// An entry naming no medicine is not a record of anything.
assert.throws(() => createPrescriptionSchema.parse({ ...minimal, items: [] }), /at least one medicine/i);
assert.throws(() => createPrescriptionSchema.parse({ ...minimal, doctorName: "" }), /Doctor name is required/i);
assert.throws(() => createPrescriptionSchema.parse({ ...minimal, patientName: "" }), /Patient name is required/i);
assert.throws(() => createPrescriptionSchema.parse({ ...minimal, prescribedOn: "04-08-2026" }), /YYYY-MM-DD/i);
assert.throws(() => createPrescriptionSchema.parse({ ...minimal, scheduleType: "schedule-q" }));
assert.throws(() => createPrescriptionSchema.parse({ ...minimal, items: [{ name: "Amoxicillin", qty: 0 }] }), /more than 0/i);

// A PATCH may leave everything alone, but an items array that is present must
// still list a medicine — clearing the lines would empty the record silently.
assert.doesNotThrow(() => updatePrescriptionSchema.parse({}), "an empty correction is allowed");
assert.throws(() => updatePrescriptionSchema.parse({ items: [] }), /Array must contain at least 1/i);
assert.doesNotThrow(() => updatePrescriptionSchema.parse({ notes: "Patient allergic to sulpha" }));

console.log("prescription-register: all checks passed");

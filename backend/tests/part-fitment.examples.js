import assert from "assert";
import {
  describeYears,
  fitmentCoversYear,
  serializeCrossReference,
  serializeFitment,
} from "../src/verticals/auto-parts/fitment/fitment.service.js";
import {
  bulkFitmentSchema,
  createCrossReferenceSchema,
  createFitmentSchema,
} from "../src/verticals/auto-parts/fitment/fitment.schema.js";

// Auto-parts fitment. The counter conversation never starts with a part number —
// it starts with "Swift, 2015, diesel" — so what has to be right is the year
// predicate that decides whether a recorded part fits the car in front of you.
// Getting an open-ended range backwards would hide current stock from a sale.

/* ── A null bound is unbounded, never exclusive ────────────────────────────── */

const closed = { yearFrom: 2015, yearTo: 2020 };
assert.equal(fitmentCoversYear(closed, 2015), true, "the first year is inside the range");
assert.equal(fitmentCoversYear(closed, 2020), true, "the last year is inside the range");
assert.equal(fitmentCoversYear(closed, 2017), true);
assert.equal(fitmentCoversYear(closed, 2014), false, "a year before the range is out");
assert.equal(fitmentCoversYear(closed, 2021), false, "a year after the range is out");

// "Still in production" is the common case, and it must not stop applying the
// moment the calendar passes whatever year the shop typed.
const stillCurrent = { yearFrom: 2015, yearTo: null };
assert.equal(fitmentCoversYear(stillCurrent, 2015), true);
assert.equal(fitmentCoversYear(stillCurrent, 2099), true, "an open end never expires");
assert.equal(fitmentCoversYear(stillCurrent, 2014), false, "an open end does not open the start");

const sinceForever = { yearFrom: null, yearTo: 2012 };
assert.equal(fitmentCoversYear(sinceForever, 1985), true, "an open start reaches back");
assert.equal(fitmentCoversYear(sinceForever, 2013), false);

const unbounded = { yearFrom: null, yearTo: null };
assert.equal(fitmentCoversYear(unbounded, 1985), true);
assert.equal(fitmentCoversYear(unbounded, 2099), true, "a fitment with no bounds fits any year");

// "What fits a Swift?" without naming a year is a legitimate question, and every
// fitment for that car should answer it.
assert.equal(fitmentCoversYear(closed, null), true, "asking without a year matches everything");
assert.equal(fitmentCoversYear(closed, undefined), true);

/* ── How a range reads on screen ───────────────────────────────────────────── */

assert.equal(describeYears(2015, 2020), "2015–2020");
assert.equal(describeYears(2015, 2015), "2015", "a single year does not read as a span");
assert.equal(describeYears(2015, null), "2015 onwards");
assert.equal(describeYears(null, 2012), "up to 2012");
assert.equal(describeYears(null, null), "all years");

/* ── What the counter reads out ────────────────────────────────────────────── */

const withVariant = serializeFitment({ make: "Maruti Suzuki", model: "Swift", variant: "Diesel 1.3 DDiS", yearFrom: 2011, yearTo: 2017 });
assert.equal(withVariant.yearLabel, "2011–2017");
assert.match(withVariant.vehicleLabel, /Maruti Suzuki Swift/, "make and model read as one vehicle");
assert.match(withVariant.vehicleLabel, /Diesel 1\.3 DDiS/, "the variant is part of the label");

const anyVariant = serializeFitment({ make: "Hyundai", model: "i20", variant: null, yearFrom: null, yearTo: null });
assert.equal(anyVariant.vehicleLabel, "Hyundai i20", "no variant leaves no trailing separator");
assert.equal(anyVariant.yearLabel, "all years");

assert.equal(serializeFitment(null), null, "a missing row serialises to nothing, not a crash");

// Whether the shop can actually hand the alternative over is the difference
// between "try this one" and "I can order it".
assert.equal(serializeCrossReference({ alternateProductId: "p_1" }).isStocked, true);
assert.equal(serializeCrossReference({ alternateProductId: null }).isStocked, false, "an OEM number nobody stocks is not stocked");
assert.equal(serializeCrossReference(null), null);

/* ── What the register will accept ─────────────────────────────────────────── */

const fitment = { productId: "prod_1", make: "Maruti Suzuki", model: "Swift" };

const parsed = createFitmentSchema.parse(fitment);
assert.equal(parsed.yearFrom, undefined, "a fitment with no years fits all of them");
assert.equal(parsed.variant, undefined, "no variant means every variant");

assert.doesNotThrow(() => createFitmentSchema.parse({ ...fitment, yearFrom: 2011, yearTo: 2017 }));
assert.doesNotThrow(() => createFitmentSchema.parse({ ...fitment, yearFrom: 2011 }), "an open end is allowed");
assert.doesNotThrow(() => createFitmentSchema.parse({ ...fitment, yearTo: 2011 }), "an open start is allowed");
assert.doesNotThrow(() => createFitmentSchema.parse({ ...fitment, yearFrom: 2015, yearTo: 2015 }));

// A backwards range is a typo, and it would silently match nothing at all.
assert.throws(
  () => createFitmentSchema.parse({ ...fitment, yearFrom: 2020, yearTo: 2011 }),
  /cannot be before/i,
);

// A mistyped year would quietly exclude every real vehicle from the fitment.
assert.throws(() => createFitmentSchema.parse({ ...fitment, yearFrom: 205 }), "a 3-digit year is a typo");
assert.throws(() => createFitmentSchema.parse({ ...fitment, yearTo: 20260 }));

assert.throws(() => createFitmentSchema.parse({ ...fitment, make: "" }), /Enter the make/i);
assert.throws(() => createFitmentSchema.parse({ ...fitment, model: "" }), /Enter the model/i);
assert.throws(() => createFitmentSchema.parse({ ...fitment, productId: "" }), /which part/i);

// One oil filter routinely covers a dozen model-years; entering them one at a
// time is how a shop gives up on recording them at all.
assert.doesNotThrow(() => bulkFitmentSchema.parse({
  productId: "prod_1",
  fitments: [
    { make: "Maruti Suzuki", model: "Swift", yearFrom: 2011, yearTo: 2017 },
    { make: "Maruti Suzuki", model: "Dzire" },
  ],
}));
assert.throws(() => bulkFitmentSchema.parse({ productId: "prod_1", fitments: [] }), /at least one vehicle/i);
assert.throws(
  () => bulkFitmentSchema.parse({ productId: "prod_1", fitments: [{ make: "Maruti", model: "Swift", yearFrom: 2020, yearTo: 2011 }] }),
  /cannot be before/i,
  "a backwards range inside a bulk add is caught too",
);

/* ── Alternatives ──────────────────────────────────────────────────────────── */

const reference = createCrossReferenceSchema.parse({ productId: "prod_1", partNumber: "0986-AF-0553" });
assert.equal(reference.kind, "alternative", "an unlabelled reference is just an alternative");
assert.equal(reference.alternateProductId, undefined, "a number the shop does not stock is still recordable");

for (const kind of ["oem", "alternative", "supersedes", "superseded_by"]) {
  assert.doesNotThrow(() => createCrossReferenceSchema.parse({ productId: "prod_1", partNumber: "X", kind }));
}
assert.throws(() => createCrossReferenceSchema.parse({ productId: "prod_1", partNumber: "X", kind: "maybe" }));
assert.throws(() => createCrossReferenceSchema.parse({ productId: "prod_1", partNumber: "" }), /part number/i);

console.log("part-fitment: all checks passed");

import assert from "assert";
import {
  DUE_SOON_DAYS,
  dueDateFrom,
  serializeTester,
} from "../src/verticals/beauty-cosmetics/testers/testers.service.js";
import {
  closeTesterSchema,
  openTesterSchema,
} from "../src/verticals/beauty-cosmetics/testers/testers.schema.js";

// Cosmetics testers. A tester is a unit opened for customers to try and will
// never be sold. Counted as sellable it makes the shelf wrong, surfaces later as
// shrinkage that looks like theft, and hides a real line of spending. What this
// pins is the reading: how old a tester is, whether it needs replacing, and that
// a closed one stops being chased.

/** A stored row as Prisma would hand it back. */
function tester(overrides = {}) {
  return {
    id: "t_1",
    productName: "Matte Lipstick",
    variant: "Rose 05",
    status: "in_use",
    openedOn: new Date(),
    expectedDays: 90,
    closedOn: null,
    costValue: 180,
    ...overrides,
  };
}

const daysAgo = (days) => new Date(Date.now() - days * 86_400_000);

/* ── When a tester falls due ───────────────────────────────────────────────── */

const opened = new Date(2026, 0, 1);
assert.equal(
  dueDateFrom(opened, 90).getTime(),
  opened.getTime() + 90 * 86_400_000,
  "a 90-day tester falls due 90 days on",
);
assert.equal(dueDateFrom(opened, 0), null, "no expected life means nothing falls due");
assert.equal(dueDateFrom(opened, -30), null, "a negative life is not a life");
assert.equal(dueDateFrom(null, 90), null, "no opening date means nothing falls due");

/* ── Does it need replacing? ───────────────────────────────────────────────── */

const fresh = serializeTester(tester({ openedOn: daysAgo(3) }));
assert.equal(fresh.ageDays, 3);
assert.equal(fresh.daysLeft, 87);
assert.equal(fresh.isDue, false);
assert.equal(fresh.isDueSoon, false);
assert.equal(fresh.isOpen, true);

const soon = serializeTester(tester({ openedOn: daysAgo(80) }));
assert.equal(soon.daysLeft, 10);
assert.equal(soon.isDueSoon, true, `10 days left is inside the ${DUE_SOON_DAYS}-day warning`);
assert.equal(soon.isDue, false, "due soon is not yet due");

const exactlyDue = serializeTester(tester({ openedOn: daysAgo(90) }));
assert.equal(exactlyDue.daysLeft, 0);
assert.equal(exactlyDue.isDue, true, "a tester at the end of its life is due");
assert.equal(exactlyDue.isDueSoon, false, "already due is not merely 'soon'");

const overdue = serializeTester(tester({ openedOn: daysAgo(150) }));
assert.equal(overdue.isDue, true);
assert.equal(overdue.daysLeft, -60);

// The boundary of the warning window, from both sides.
assert.equal(serializeTester(tester({ openedOn: daysAgo(90 - DUE_SOON_DAYS) })).isDueSoon, true);
assert.equal(serializeTester(tester({ openedOn: daysAgo(90 - DUE_SOON_DAYS - 1) })).isDueSoon, false);

// A tester already swapped out is history, however long ago it was opened.
// Leaving it flagged would keep it on the replacement list forever.
const replaced = serializeTester(tester({ status: "replaced", openedOn: daysAgo(400), closedOn: daysAgo(10) }));
assert.equal(replaced.isOpen, false);
assert.equal(replaced.isDue, false, "a closed tester is never due");
assert.equal(replaced.isDueSoon, false);
assert.ok(replaced.closedOnKey, "the day it came off the counter is exposed");

const discarded = serializeTester(tester({ status: "discarded", openedOn: daysAgo(200) }));
assert.equal(discarded.isOpen, false);
assert.equal(discarded.isDue, false);

// A tester with no expected life is never chased — some shops just want the record.
const untimed = serializeTester(tester({ expectedDays: 0 }));
assert.equal(untimed.dueOnKey, null);
assert.equal(untimed.daysLeft, null);
assert.equal(untimed.isDue, false, "with no life set there is nothing to fall due");

assert.match(fresh.openedOnKey, /^\d{4}-\d{2}-\d{2}$/, "the opening day is a plain day string");
assert.equal(serializeTester(tester()).closedOnKey, null, "an open tester has no closing day");
assert.equal(serializeTester(null), null, "a missing row serialises to nothing, not a crash");

/* ── What the register will accept ─────────────────────────────────────────── */

const minimal = { productId: "prod_1" };

const parsed = openTesterSchema.parse(minimal);
assert.equal(parsed.expectedDays, 90, "a quarter is the usual life of a counter tester");
// This default is the whole point: opening a tester really takes the unit out of
// stock, or the register would leave the original problem exactly where it was.
assert.equal(parsed.moveStock, true, "opening a tester moves stock unless said otherwise");
assert.equal(parsed.variant, undefined);

// A shop that already took the unit off the shelf by hand must be able to say so,
// or recording the tester would decrement twice.
assert.doesNotThrow(() => openTesterSchema.parse({ ...minimal, moveStock: false }));

// A mascara wears out in weeks and a powder lasts a year, so the life is per
// tester rather than a fixed rule.
assert.doesNotThrow(() => openTesterSchema.parse({ ...minimal, expectedDays: 30 }));
assert.doesNotThrow(() => openTesterSchema.parse({ ...minimal, expectedDays: 365 }));
assert.throws(() => openTesterSchema.parse({ ...minimal, expectedDays: 0 }), "a zero-day tester is a typo");
assert.throws(() => openTesterSchema.parse({ ...minimal, expectedDays: 5000 }));

assert.throws(() => openTesterSchema.parse({ productId: "" }), /which product/i);
// Omitted entirely, zod reports its own "Required" rather than the custom
// message, which only fires when the field is present and empty.
assert.throws(() => openTesterSchema.parse({}));

// Backdating records a tester opened before the shop started keeping this.
assert.doesNotThrow(() => openTesterSchema.parse({ ...minimal, openedOn: "2026-06-01" }));
assert.throws(() => openTesterSchema.parse({ ...minimal, openedOn: "01-06-2026" }), /YYYY-MM-DD/i);

// The shop's own cost wins when it knows better than weighted average.
assert.doesNotThrow(() => openTesterSchema.parse({ ...minimal, costValue: 300 }));
assert.throws(() => openTesterSchema.parse({ ...minimal, costValue: -50 }));

// "replaced" is the usual case and the one that costs the shop again;
// "discarded" means nothing went out in its place. Counting what testers cost
// depends on being able to tell them apart.
assert.equal(closeTesterSchema.parse({}).status, "replaced", "replacing is the default");
assert.doesNotThrow(() => closeTesterSchema.parse({ status: "discarded" }));
assert.throws(() => closeTesterSchema.parse({ status: "in_use" }), "a tester cannot be closed back to open");
assert.throws(() => closeTesterSchema.parse({ status: "sold" }), "a tester is never sold");

console.log("cosmetics-testers: all checks passed");

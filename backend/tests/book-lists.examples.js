import assert from "assert";
import { buildListReadiness, describeList } from "../src/verticals/stationery-books/book-lists/book-lists.service.js";
import {
  copyBookListSchema,
  createBookListSchema,
} from "../src/verticals/stationery-books/book-lists/book-lists.schema.js";

// Class book lists. A list is a RECIPE, not stock and not an order: readiness is
// recomputed against the live catalogue every time it is read, because the one
// thing it has to be is true at the counter with a parent standing there. What
// this pins is that reading — which lines count as shortfalls, and which do not.

/** The catalogue as `listProducts` returns it, keyed by id. */
function catalogue(rows) {
  return new Map(rows.map((row) => [row.id, row]));
}

const stock = catalogue([
  { id: "maths", name: "NCERT Maths 6", sku: "NC-M6", stockBaseQty: 12, defaultPricePerRateUnit: 180 },
  { id: "english", name: "NCERT English 6", sku: "NC-E6", stockBaseQty: 0, defaultPricePerRateUnit: 165 },
  { id: "notebook", name: "Classmate Notebook A4", sku: "CM-A4", stockBaseQty: 3, defaultPricePerRateUnit: 60 },
  { id: "geometry", name: "Geometry Box", sku: "GB-1", stockBaseQty: 0, defaultPricePerRateUnit: 250 },
]);

function list(items, overrides = {}) {
  return {
    id: "l_1",
    schoolName: "Delhi Public School",
    className: "Class 6",
    academicYear: "2026-27",
    name: "",
    items,
    ...overrides,
  };
}

/* ── What a list is called at the counter ──────────────────────────────────── */

assert.equal(describeList({ className: "Class 6", schoolName: "DPS" }), "Class 6 · DPS");
assert.equal(
  describeList({ className: "Class 6", schoolName: "DPS", name: "Science stream" }),
  "Class 6 · DPS — Science stream",
  "a label is appended when one class has two lists",
);
// The label column is "" rather than null, because NULLs are distinct in a
// unique index and would let the same class be entered twice.
assert.equal(describeList({ className: "Class 6", schoolName: "DPS", name: "" }), "Class 6 · DPS");

/* ── Readiness ─────────────────────────────────────────────────────────────── */

const full = buildListReadiness(list([
  { id: "i1", productId: "maths", name: "NCERT Maths 6", qty: 1, sortOrder: 0 },
  { id: "i2", productId: "english", name: "NCERT English 6", qty: 1, sortOrder: 1 },
  { id: "i3", productId: "notebook", name: "Classmate Notebook A4", qty: 4, sortOrder: 2 },
  { id: "i4", productId: "geometry", name: "Geometry Box", qty: 1, isOptional: true, sortOrder: 3 },
  { id: "i5", productId: null, name: "School diary", qty: 1, sortOrder: 4 },
]), stock);

assert.equal(full.itemCount, 5);
// Optional lines are on many lists. Counting them as shortfalls would make every
// list look unfulfillable and hide the ones that genuinely are.
assert.equal(full.requiredCount, 4, "the optional geometry box is not required");
assert.equal(full.isComplete, false);

const missing = full.missing.map((item) => item.name).sort();
assert.deepEqual(missing, ["Classmate Notebook A4", "NCERT English 6", "School diary"]);
assert.ok(!missing.includes("Geometry Box"), "an out-of-stock optional line is not a shortfall");

// Quantity matters, not merely whether the product exists: three notebooks on
// the shelf do not fill a line asking for four.
const notebooks = full.items.find((item) => item.name === "Classmate Notebook A4");
assert.equal(notebooks.available, 3);
assert.equal(notebooks.shortBy, 1, "the shortfall is the gap, not the whole quantity");
assert.equal(notebooks.isReady, false);

// A line the shop never carried and one whose product was deleted are the same
// thing at the counter: it cannot be handed over.
const diary = full.items.find((item) => item.name === "School diary");
assert.equal(diary.inCatalogue, false);
assert.equal(diary.isReady, false);
assert.equal(diary.available, 0);
assert.equal(diary.price, 0, "an unstocked line contributes nothing to the total");

const maths = full.items.find((item) => item.name === "NCERT Maths 6");
assert.equal(maths.isReady, true);
assert.equal(maths.shortBy, 0);
assert.equal(maths.sku, "NC-M6", "catalogue detail is filled in from the live product");

// What the whole list costs if the parent takes all of it — so every line the
// catalogue can price counts, including ones that are out of stock today (the
// shop will order them in) and the optional geometry box. Only the line the shop
// does not carry at all contributes nothing.
// 180 (maths) + 165 (english, out of stock) + 4×60 (notebooks) + 250 (optional box) + 0 (diary).
assert.equal(full.estimatedTotal, 835);

/* ── A list that can go out today ──────────────────────────────────────────── */

const ready = buildListReadiness(list([
  { id: "i1", productId: "maths", name: "NCERT Maths 6", qty: 2, sortOrder: 0 },
]), stock);
assert.equal(ready.isComplete, true);
assert.equal(ready.shortCount, 0);
assert.deepEqual(ready.missing, []);

// A list of nothing but optional lines is complete — there is nothing the shop
// is obliged to have.
const optionalOnly = buildListReadiness(list([
  { id: "i1", productId: "geometry", name: "Geometry Box", qty: 1, isOptional: true, sortOrder: 0 },
]), stock);
assert.equal(optionalOnly.isComplete, true);
assert.equal(optionalOnly.requiredCount, 0);

// An empty list is a real document — a school that withdraws its list leaves one.
const empty = buildListReadiness(list([]), stock);
assert.equal(empty.itemCount, 0);
assert.equal(empty.isComplete, true);
assert.equal(empty.estimatedTotal, 0);

/* ── Lists are read aloud in the order the school published them ───────────── */

const shuffled = buildListReadiness(list([
  { id: "i3", productId: "notebook", name: "Third", qty: 1, sortOrder: 2 },
  { id: "i1", productId: "maths", name: "First", qty: 1, sortOrder: 0 },
  { id: "i2", productId: "maths", name: "Second", qty: 1, sortOrder: 1 },
]), stock);
assert.deepEqual(shuffled.items.map((item) => item.name), ["First", "Second", "Third"]);

/* ── What the register will accept ─────────────────────────────────────────── */

const minimal = { schoolName: "DPS", className: "Class 6", academicYear: "2026-27" };

const parsed = createBookListSchema.parse(minimal);
assert.deepEqual(parsed.items, [], "a list can be created empty and filled in later");
assert.equal(parsed.isActive, true);

assert.doesNotThrow(() => createBookListSchema.parse({ ...minimal, academicYear: "2026" }), "a bare year is allowed");
assert.doesNotThrow(() => createBookListSchema.parse({ ...minimal, academicYear: "2026-2027" }));
// An Indian academic year straddles two calendar years, so a date is not a year.
assert.throws(() => createBookListSchema.parse({ ...minimal, academicYear: "2026-04-01" }), /2026-27/);
assert.throws(() => createBookListSchema.parse({ ...minimal, academicYear: "next year" }), /2026-27/);

assert.throws(() => createBookListSchema.parse({ ...minimal, schoolName: "" }), /Enter the school/i);
assert.throws(() => createBookListSchema.parse({ ...minimal, className: "" }), /Enter the class/i);

assert.doesNotThrow(() => createBookListSchema.parse({
  ...minimal,
  items: [{ name: "NCERT Maths 6", qty: 1 }],
}), "a line need not be linked to a product");

const withItem = createBookListSchema.parse({ ...minimal, items: [{ name: "NCERT Maths 6", qty: 1 }] });
assert.equal(withItem.items[0].unit, "piece");
assert.equal(withItem.items[0].isOptional, false, "lines are required unless said otherwise");

assert.throws(() => createBookListSchema.parse({ ...minimal, items: [{ name: "", qty: 1 }] }), /needs a name/i);
assert.throws(() => createBookListSchema.parse({ ...minimal, items: [{ name: "Book", qty: 0 }] }), /more than 0/i);

// Copying is how next year's list gets made; it must be able to change only the
// year, which is the usual case.
assert.doesNotThrow(() => copyBookListSchema.parse({ academicYear: "2027-28" }));
assert.doesNotThrow(() => copyBookListSchema.parse({}), "the service decides whether a copy is a duplicate");
assert.throws(() => copyBookListSchema.parse({ academicYear: "whenever" }), /2026-27/);

console.log("book-lists: all checks passed");

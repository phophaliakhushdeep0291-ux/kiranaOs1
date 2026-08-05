import assert from "assert";
import {
  WARRANTY_SOON_DAYS,
  serializeUnit,
  warrantyEndFrom,
} from "../src/verticals/electronics/units/units.service.js";
import {
  receiveUnitsSchema,
  sellUnitSchema,
  updateUnitSchema,
} from "../src/verticals/electronics/units/units.schema.js";

// Electronics serialised units. Stock here is not fungible: the shop sells THAT
// handset, and months later a return or a warranty claim has to find the same
// physical unit. What has to be right is what the record *says* — is it still
// ours, is it in cover, how long is left — and that a unit can always be
// identified. Those derivations are pinned here without touching a database.

/** A stored row as Prisma would hand it back. */
function row(overrides = {}) {
  return {
    id: "u_1",
    productName: "Galaxy A16",
    imei: "351234567890123",
    serialNumber: "SN-001",
    status: "in_stock",
    condition: "new",
    soldAt: null,
    warrantyMonths: 12,
    warrantyUntil: null,
    ...overrides,
  };
}

const daysFromNow = (days) => new Date(Date.now() + days * 86_400_000);

/* ── Warranty runs in calendar months, not 30-day blocks ───────────────────── */

// What the warranty card says is what the customer will argue, and a card says
// "12 months", not "365 days".
const june15 = new Date(2026, 5, 15);
assert.equal(warrantyEndFrom(june15, 12).getFullYear(), 2027, "12 months lands a year on");
assert.equal(warrantyEndFrom(june15, 12).getMonth(), 5);
assert.equal(warrantyEndFrom(june15, 12).getDate(), 15, "cover ends on the same day of the month");

assert.equal(warrantyEndFrom(june15, 6).getMonth(), 11, "6 months from June is December");
assert.equal(warrantyEndFrom(new Date(2026, 11, 10), 1).getFullYear(), 2027, "December rolls into next year");

// The trap: `setMonth` on the 31st silently overflows into the following month,
// so a unit sold on 31 January would show cover ending on 3 March.
const jan31 = new Date(2026, 0, 31);
assert.equal(warrantyEndFrom(jan31, 1).getMonth(), 1, "31 Jan + 1 month stays in February");
assert.equal(warrantyEndFrom(jan31, 1).getDate(), 28, "it clamps to the last day of the shorter month");
const may31 = new Date(2026, 4, 31);
assert.equal(warrantyEndFrom(may31, 1).getMonth(), 5, "31 May + 1 month stays in June");
assert.equal(warrantyEndFrom(may31, 1).getDate(), 30);

// No sale and no months both mean there is nothing to end.
assert.equal(warrantyEndFrom(null, 12), null, "an unsold unit has no cover running");
assert.equal(warrantyEndFrom(june15, 0), null, "zero months is no cover");
assert.equal(warrantyEndFrom(june15, -3), null, "a negative period is not cover");

/* ── Is it in cover? ───────────────────────────────────────────────────────── */

const inCover = serializeUnit(row({ status: "sold", soldAt: new Date(), warrantyUntil: daysFromNow(40) }));
assert.equal(inCover.isUnderWarranty, true, "40 days left is cover");
assert.equal(inCover.isWarrantyExpiringSoon, false, `40 days is beyond the ${WARRANTY_SOON_DAYS}-day warning`);
assert.equal(inCover.warrantyDaysLeft, 40);

const endingSoon = serializeUnit(row({ status: "sold", soldAt: new Date(), warrantyUntil: daysFromNow(5) }));
assert.equal(endingSoon.isUnderWarranty, true);
assert.equal(endingSoon.isWarrantyExpiringSoon, true, "5 days left is worth warning about");

const lastDay = serializeUnit(row({ status: "sold", soldAt: new Date(), warrantyUntil: daysFromNow(0) }));
assert.equal(lastDay.isUnderWarranty, true, "cover lasts through its final day");

// Cover that ran out yesterday is not cover, however the shop feels about it.
const lapsed = serializeUnit(row({ status: "sold", soldAt: new Date(), warrantyUntil: daysFromNow(-1) }));
assert.equal(lapsed.isUnderWarranty, false);
assert.equal(lapsed.isWarrantyExpiringSoon, false, "an expired unit is not 'expiring'");

// A unit still on the shelf is not in warranty, however many months the box
// promises — the clock starts when it is sold, not when it is received.
const onShelf = serializeUnit(row({ warrantyMonths: 24, soldAt: null, warrantyUntil: null }));
assert.equal(onShelf.isUnderWarranty, false, "an unsold unit has no cover to be in");
assert.equal(onShelf.warrantyDaysLeft, null);

/* ── Is it still ours, and can it go out? ──────────────────────────────────── */

for (const status of ["in_stock", "returned", "rma"]) {
  assert.equal(serializeUnit(row({ status })).isHeld, true, `${status} is still on the premises`);
}
for (const status of ["sold", "lost", "scrapped"]) {
  assert.equal(serializeUnit(row({ status })).isHeld, false, `${status} is not on the premises`);
}

assert.equal(serializeUnit(row({ status: "in_stock" })).canSell, true);
// A customer return goes back on the shelf and may be sold again.
assert.equal(serializeUnit(row({ status: "returned" })).canSell, true, "a returned unit is sellable again");
// Away with the service centre: physically ours, but not available to promise.
assert.equal(serializeUnit(row({ status: "rma" })).canSell, false, "a unit at service cannot be sold");
assert.equal(serializeUnit(row({ status: "sold" })).canSell, false);
assert.equal(serializeUnit(row({ status: "lost" })).canSell, false);

assert.equal(serializeUnit(null), null, "a missing row serialises to nothing, not a crash");

/* ── Receiving a box ───────────────────────────────────────────────────────── */

const box = {
  productId: "prod_1",
  warrantyMonths: 12,
  units: [{ imei: "351234567890123", serialNumber: "SN-001" }],
};

const parsedBox = receiveUnitsSchema.parse(box);
assert.equal(parsedBox.units[0].condition, "new", "stock arrives new unless said otherwise");
assert.equal(parsedBox.costPrice, 0);

// A unit nobody can identify is just stock, and being able to find one piece
// again is the entire point of this table.
assert.throws(
  () => receiveUnitsSchema.parse({ ...box, units: [{ condition: "new" }] }),
  /Enter an IMEI or a serial number/i,
  "a unit with no identifier at all is refused",
);
// A laptop has no IMEI; a serial alone is enough.
assert.doesNotThrow(() => receiveUnitsSchema.parse({ ...box, units: [{ serialNumber: "LN-77" }] }));
// A phone box may carry only the IMEI.
assert.doesNotThrow(() => receiveUnitsSchema.parse({ ...box, units: [{ imei: "351234567890123" }] }));

// Both IMEIs of a dual-SIM handset are printed on the box, and they differ.
assert.throws(
  () => receiveUnitsSchema.parse({ ...box, units: [{ imei: "351234567890123", imei2: "351234567890123" }] }),
  /must differ/i,
);

assert.throws(() => receiveUnitsSchema.parse({ ...box, units: [] }), /at least one unit/i);
assert.throws(() => receiveUnitsSchema.parse({ ...box, productId: "" }), /which product/i);
assert.throws(
  () => receiveUnitsSchema.parse({ ...box, units: [{ imei: "35123 4567*890" }] }),
  /letters, digits/i,
  "punctuation that cannot appear on a box is rejected",
);
// Serials are freely alphanumeric and often carry dashes or slashes.
assert.doesNotThrow(() => receiveUnitsSchema.parse({ ...box, units: [{ serialNumber: "LN-77/2026" }] }));

/* ── Selling and correcting ────────────────────────────────────────────────── */

const sale = sellUnitSchema.parse({});
assert.equal(sale.sellingPrice, 0, "a unit may go out at no recorded price");
assert.equal(sale.warrantyMonths, undefined, "months left unset fall back to what the box promised");

assert.doesNotThrow(() => sellUnitSchema.parse({ soldOn: "2026-03-15" }), "a missed entry can be backdated");
assert.throws(() => sellUnitSchema.parse({ soldOn: "15-03-2026" }), /YYYY-MM-DD/i);
assert.throws(() => sellUnitSchema.parse({ customerPhone: "ring the shop" }), /digits/i);
assert.throws(() => sellUnitSchema.parse({ warrantyMonths: 600 }));

assert.doesNotThrow(() => updateUnitSchema.parse({}), "an empty correction is allowed");
assert.doesNotThrow(() => updateUnitSchema.parse({ serialNumber: "SN-002" }));

console.log("product-unit-register: all checks passed");

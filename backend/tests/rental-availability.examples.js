import assert from "assert";
import fs from "fs";
import {
  ACTIVE_STATUSES,
  blockedProductIds,
  getRentalHolds,
  ownedQtyOf,
  resolveWindow,
} from "../src/verticals/clothing/rentals/rentals.service.js";
import { formatDateInTimeZone } from "../src/utils/dates.js";

// Cloth rental availability. The whole feature rests on one rule — a garment is
// free for a window only if nothing already holds it across those days — so this
// guards the overlap predicate, the day boundaries and the storefront blackout.

/* ── Day windows: inclusive at both ends, in the shop's timezone ───────────── */

const window = resolveWindow("2026-08-10", "2026-08-12");
assert.equal(formatDateInTimeZone(window.start), "2026-08-10", "window starts on the from-day");
assert.equal(formatDateInTimeZone(window.end), "2026-08-12", "window ends on the to-day");
assert.ok(window.start < window.end, "start must precede end");

// The trap that flattened the sales graph once already: a bare `new Date("YYYY-MM-DD")`
// is midnight UTC, which is 05:30 on the *same* IST day — anything booked earlier that
// morning would fall outside the window. The end must reach the last millisecond of the day.
const sameDay = resolveWindow("2026-08-10", "2026-08-10");
assert.ok(
  sameDay.end.getTime() - sameDay.start.getTime() > 86_399_000,
  "a one-day booking must still span the whole day, not collapse to an instant",
);
assert.ok(sameDay.end > new Date("2026-08-10T18:00:00.000Z"), "end-of-day must be after the IST evening");

// A window with no dates at all is today, so callers never accidentally scan all time.
const today = resolveWindow(null, null);
assert.equal(formatDateInTimeZone(today.start), formatDateInTimeZone(new Date()), "an empty window means today");

// A return date before the booking date is a mistake, not an empty range.
assert.throws(() => resolveWindow("2026-08-12", "2026-08-10"), /before the booking date/i, "reversed dates are rejected");
assert.throws(() => resolveWindow("not-a-date", "2026-08-10"), /valid date/i, "junk dates are rejected");

/* ── Owned counts: rentals go out as whole pieces ──────────────────────────── */

assert.equal(ownedQtyOf({ stockBaseQty: 3 }), 3);
assert.equal(ownedQtyOf({ stockBaseQty: 2.8 }), 2, "a part-piece cannot be rented out");
assert.equal(ownedQtyOf({ stockBaseQty: -5 }), 0, "negative stock is not rentable");
assert.equal(ownedQtyOf({}), 0);
assert.equal(ownedQtyOf(null), 0);

/* ── The overlap predicate ─────────────────────────────────────────────────── */

/** Records the where-clause the holds scan builds, and answers with canned rows. */
function stubClient(rows = []) {
  const calls = [];
  return {
    calls,
    rentalBooking: {
      findMany: async (args) => {
        calls.push(args);
        return rows;
      },
    },
  };
}

{
  const client = stubClient();
  const { start, end } = resolveWindow("2026-08-10", "2026-08-12");
  await getRentalHolds(client, "shop-1", { start, end });
  const where = client.calls[0].where;

  assert.equal(where.shopId, "shop-1", "holds are always scoped to one shop");
  assert.equal(where.deletedAt, null, "a deleted booking holds nothing");
  assert.deepEqual(where.status, { in: ACTIVE_STATUSES }, "only open bookings hold stock");
  assert.ok(!ACTIVE_STATUSES.includes("returned"), "a returned outfit is back on the rack");
  assert.ok(!ACTIVE_STATUSES.includes("cancelled"), "a cancelled booking frees its items");

  // Overlap is "starts on or before my last day AND ends on or after my first" —
  // the only test that catches a booking sitting entirely inside the window.
  const [overlap, overdue] = where.OR;
  assert.deepEqual(overlap.AND[0].fromDate, { lte: end }, "a hold must start by the end of the window");
  assert.deepEqual(overlap.AND[1].toDate, { gte: start }, "a hold must run to at least the start of the window");

  // Past its due date and never brought back: the customer still has it, so no
  // future window can offer it either.
  assert.deepEqual(overdue.AND[0], { status: "picked_up" }, "only a collected outfit holds past its due date");
  assert.deepEqual(overdue.AND[1], { returnedAt: null });
  assert.deepEqual(overdue.AND[2], { toDate: { lt: start } });
}

{
  // A booking being edited must not count as competition against itself, or every
  // edit to an existing booking would report its own items as unavailable.
  const client = stubClient();
  const { start, end } = resolveWindow("2026-08-10", "2026-08-12");
  await getRentalHolds(client, "shop-1", { start, end, excludeBookingId: "bk-9" });
  assert.deepEqual(client.calls[0].where.id, { not: "bk-9" }, "the booking under edit is excluded");

  const plain = stubClient();
  await getRentalHolds(plain, "shop-1", { start, end });
  assert.equal(plain.calls[0].where.id, undefined, "nothing is excluded when no id is given");
}

/* ── Aggregating holds ─────────────────────────────────────────────────────── */

{
  const client = stubClient([
    { items: [{ productId: "lehenga", qty: 1 }, { productId: "sherwani", qty: 2 }] },
    { items: [{ productId: "lehenga", qty: 2 }] },
    // A free-text line ("mum's own dupatta") has nothing in the catalogue to hold.
    { items: [{ productId: null, qty: 5 }] },
  ]);
  const { start, end } = resolveWindow("2026-08-10", "2026-08-12");
  const holds = await getRentalHolds(client, "shop-1", { start, end });

  assert.equal(holds.get("lehenga"), 3, "quantities add up across separate bookings");
  assert.equal(holds.get("sherwani"), 2);
  assert.equal(holds.get(null), undefined, "an uncatalogued line holds nothing");
  assert.equal(holds.size, 2);
}

/* ── What customers are not allowed to see ─────────────────────────────────── */

const products = [
  { id: "lehenga", stockBaseQty: 3 },
  { id: "sherwani", stockBaseQty: 1 },
  { id: "saree", stockBaseQty: 4 },
  { id: "kurta", stockBaseQty: 0 },
];

{
  const blocked = blockedProductIds(products, new Map([["lehenga", 3], ["sherwani", 1], ["saree", 1]]));
  assert.ok(blocked.has("lehenga"), "all 3 booked -> hidden from customers");
  assert.ok(blocked.has("sherwani"), "the only one booked -> hidden");
  assert.ok(!blocked.has("saree"), "1 of 4 booked -> 3 still on offer");
  assert.ok(!blocked.has("kurta"), "nothing booked is never blocked by rentals");
}

{
  // Overbooked (stock corrected downward after a booking) must still hide, not go negative.
  const blocked = blockedProductIds(products, new Map([["sherwani", 4]]));
  assert.ok(blocked.has("sherwani"), "held beyond what is owned still hides the product");
}

{
  // The day after the last rented day, and the moment a booking is returned or
  // cancelled, the holds map is empty again and the outfit is back on the storefront.
  assert.equal(blockedProductIds(products, new Map()).size, 0, "no bookings means nothing is hidden");
}

/* ── The storefront actually applies it ────────────────────────────────────── */

// The catalogue is shared code, so it must not import clothing to ask about
// rentals. It asks the availability registry, and the rental service registers
// itself into that registry — check both halves, because an unregistered filter
// would leave the storefront silently showing garments that are already out.
const publicService = fs.readFileSync(new URL("../src/modules/public/public.service.js", import.meta.url), "utf8");
const rentalService = fs.readFileSync(new URL("../src/verticals/clothing/rentals/rentals.service.js", import.meta.url), "utf8");
assert.ok(
  publicService.includes("unavailableProductIds"),
  "the public catalog must consult the availability registry",
);
assert.ok(
  !/verticals\//.test(publicService),
  "the public catalog must not import a vertical directly",
);
assert.ok(
  rentalService.includes("registerCatalogAvailabilityFilter"),
  "the rental service must register itself as an availability filter",
);
// Both doors: the catalogue a customer browses, and the order they submit from a
// phone that may still be showing a catalogue cached before the outfit went out.
assert.equal(
  (publicService.match(/unavailableProductIds\(/g) || []).length,
  2,
  "both the catalog read and the order submission must check rental holds",
);
assert.ok(
  /bookedOut\.has\(p\.id\)/.test(publicService),
  "the catalog must drop fully-booked products",
);
assert.ok(
  /bookedOut\.has\(productId\)/.test(publicService),
  "an order for a fully-booked product must not be accepted",
);

/* ── Routing order ─────────────────────────────────────────────────────────── */

const routes = fs.readFileSync(new URL("../src/verticals/clothing/rentals/rentals.routes.js", import.meta.url), "utf8");
assert.ok(
  routes.indexOf('router.get("/availability"') < routes.indexOf('router.get("/:id"'),
  '"/availability" must be registered before "/:id" or it is read as a booking id',
);
assert.ok(routes.includes("requireAuth, requireShop"), "rental data is per-shop and must never be public");

console.log("✅ rental-availability: date windows, overlap rule, holds and the customer blackout all hold");

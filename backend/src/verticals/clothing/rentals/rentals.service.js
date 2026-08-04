import db from "../../../db.js";
import { AppError } from "../../../middleware/error.js";
import { round2 } from "../../../utils/money.js";
import { dateRangeForDateOnly, formatDateInTimeZone } from "../../../utils/dates.js";
import { listProducts } from "../../../modules/products/products.service.js";
import { registerCatalogAvailabilityFilter } from "../../../shared/catalog-availability.js";

/**
 * Cloth rental bookings.
 *
 * A booking holds stock instead of moving it. The garment stays in the product
 * catalogue at its full owned count and an open booking reserves N of it for the
 * days it is promised to someone, so availability for a window is
 *
 *   owned − Σ qty held by active bookings overlapping that window
 *
 * That single rule is what keeps a booked outfit off the customer-facing
 * catalogue for exactly the days it is out and puts it back the day after it
 * returns — no stock ledger entries, no effect on sale stock or profit.
 */

// Statuses that still hold the garment. "returned" and "cancelled" release it.
export const ACTIVE_STATUSES = ["booked", "picked_up"];

/** A day string (YYYY-MM-DD) → the shop-timezone start/end instants of that day. */
function dayBounds(day, field) {
  try {
    return dateRangeForDateOnly(String(day).slice(0, 10));
  } catch {
    throw new AppError(`${field} must be a valid date (YYYY-MM-DD)`, 400);
  }
}

export function todayKey() {
  return formatDateInTimeZone(new Date());
}

/** Normalises a requested window to the inclusive [start-of-from-day, end-of-to-day]. */
export function resolveWindow(from, to) {
  const fromKey = String(from || todayKey()).slice(0, 10);
  const toKey = String(to || fromKey).slice(0, 10);
  const start = dayBounds(fromKey, "from").start;
  const end = dayBounds(toKey, "to").end;
  if (end < start) throw new AppError("Return date cannot be before the booking date", 400);
  return { start, end, fromKey, toKey };
}

/**
 * How much of each product is spoken for across a window.
 *
 * Two things hold a garment:
 *   1. an active booking whose window overlaps the one being asked about, and
 *   2. an overdue pickup — the customer has it and the due date has passed, so
 *      it is physically not on the rack no matter which future dates are asked
 *      about. A booking that was never picked up is NOT held past its due date:
 *      that outfit never left the shop.
 *
 * Returns Map<productId, qty>.
 */
export async function getRentalHolds(client, shopId, { start, end, excludeBookingId = null } = {}) {
  const bookings = await client.rentalBooking.findMany({
    where: {
      shopId,
      deletedAt: null,
      status: { in: ACTIVE_STATUSES },
      ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
      OR: [
        { AND: [{ fromDate: { lte: end } }, { toDate: { gte: start } }] },
        { AND: [{ status: "picked_up" }, { returnedAt: null }, { toDate: { lt: start } }] },
      ],
    },
    select: { items: { select: { productId: true, qty: true } } },
  });

  const holds = new Map();
  for (const booking of bookings) {
    for (const item of booking.items) {
      if (!item.productId) continue; // free-text line — nothing in the catalogue to hold
      holds.set(item.productId, (holds.get(item.productId) ?? 0) + (Number(item.qty) || 0));
    }
  }
  return holds;
}

/**
 * Whole units of a product the shop owns. Rentals are counted in physical
 * pieces — half a lehenga cannot go out — so a fractional stock figure floors.
 */
export function ownedQtyOf(product) {
  return Math.max(0, Math.floor(Number(product?.stockBaseQty) || 0));
}

/**
 * Rentable catalogue for a window: every product with what is owned, what is
 * already promised, and what is left. This is the one place availability is
 * computed, so the booking form, the conflict check and the public catalogue
 * can never disagree.
 */
export async function getAvailability(shopId, { from, to, excludeBookingId = null, locationId = null } = {}) {
  const { start, end, fromKey, toKey } = resolveWindow(from, to);
  const [products, holds] = await Promise.all([
    listProducts(shopId, { locationId }),
    getRentalHolds(db, shopId, { start, end, excludeBookingId }),
  ]);

  const items = products.map((product) => {
    const owned = ownedQtyOf(product);
    const booked = holds.get(product.id) ?? 0;
    return {
      productId: product.id,
      name: product.name,
      category: product.category ?? null,
      unit: product.displayUnit || product.rateUnit || "piece",
      imageUrl: product.imageUrl ?? null,
      pricePerDay: round2(Number(product.defaultPricePerRateUnit) || 0),
      owned,
      booked: round2(booked),
      available: round2(Math.max(0, owned - booked)),
    };
  });

  return { from: fromKey, to: toKey, items };
}

/**
 * Which of these products have nothing left to promise anyone else, given what
 * is already held. A product with no hold is never blocked, so a shop that never
 * rents anything is completely unaffected by this.
 */
export function blockedProductIds(products, holds) {
  const blocked = new Set();
  for (const product of products) {
    const booked = holds.get(product.id) ?? 0;
    if (booked > 0 && ownedQtyOf(product) - booked <= 0) blocked.add(product.id);
  }
  return blocked;
}

/**
 * Product ids that are fully spoken for on a given day. The public storefront uses
 * this to drop them from what customers can see, so a booked outfit is never shown
 * as if it were free.
 *
 * Takes the product list the caller already holds rather than re-reading it, so
 * the owned count checked here is exactly the one the caller is filtering — a
 * second read could be scoped differently and quietly disagree.
 */
export async function getFullyBookedProductIds(shopId, products, { day = null } = {}) {
  const key = day || todayKey();
  const { start, end } = resolveWindow(key, key);
  const holds = await getRentalHolds(db, shopId, { start, end });
  if (holds.size === 0) return new Set();
  return blockedProductIds(products, holds);
}

// How the shared catalogue learns about rentals without importing them. Loading
// this service is what registers the filter, and the only way to reach it is
// through the clothing pack's routes — so a shop without rentals never runs it.
registerCatalogAvailabilityFilter((shopId, products, options) =>
  getFullyBookedProductIds(shopId, products, options),
);

/* ── bookings ─────────────────────────────────────────────────────────────── */

function normalizePhone(value) {
  return String(value ?? "").replace(/[^\d]/g, "").slice(-15);
}

function serialize(booking) {
  if (!booking) return booking;
  const today = todayKey();
  const dueKey = formatDateInTimeZone(booking.toDate);
  return {
    ...booking,
    fromDateKey: formatDateInTimeZone(booking.fromDate),
    toDateKey: dueKey,
    // Overdue means the shop should be chasing it: still out, past its due day.
    isOverdue: ACTIVE_STATUSES.includes(booking.status) && !booking.returnedAt && dueKey < today,
    balanceDue: round2(
      (Number(booking.rentAmount) || 0) +
        (Number(booking.lateFee) || 0) +
        (Number(booking.damageCharge) || 0) -
        (Number(booking.advancePaid) || 0),
    ),
  };
}

/**
 * Per-shop booking number. Derived from the highest existing number rather than
 * a row count so a deleted booking can never hand its number to a new one; the
 * unique index is the real guard and the caller retries on collision.
 *
 * Six digits because the "highest" is found by sorting text: the day a shop rolls
 * past the padding width, "RNT-1000000" would sort below "RNT-999999" and every
 * new booking would collide. 999,999 rentals is beyond any shop's lifetime.
 */
async function nextBookingNumber(client, shopId) {
  const last = await client.rentalBooking.findFirst({
    where: { shopId },
    orderBy: { bookingNumber: "desc" },
    select: { bookingNumber: true },
  });
  const previous = Number(String(last?.bookingNumber ?? "").replace(/\D/g, "")) || 0;
  return `RNT-${String(previous + 1).padStart(6, "0")}`;
}

function normalizeItems(items) {
  return items.map((item) => {
    const qty = Number(item.qty) || 0;
    const ratePerDay = round2(Number(item.ratePerDay) || 0);
    return {
      productId: item.productId ? String(item.productId) : null,
      name: String(item.name).trim(),
      unit: String(item.unit || "piece").trim() || "piece",
      qty,
      ratePerDay,
      amount: round2(Number(item.amount) || 0),
    };
  });
}

/**
 * Refuses a booking that promises more of a garment than the shop owns for those
 * days. Runs inside the caller's transaction and re-runs after the write, so a
 * booking saved a moment earlier cannot slip past the check.
 */
async function assertItemsAvailable(client, shopId, { items, start, end, excludeBookingId = null }) {
  const wanted = new Map();
  for (const item of items) {
    if (!item.productId) continue;
    wanted.set(item.productId, (wanted.get(item.productId) ?? 0) + (Number(item.qty) || 0));
  }
  if (wanted.size === 0) return;

  const [products, holds] = await Promise.all([
    client.product.findMany({
      where: { id: { in: [...wanted.keys()] }, shopId, deletedAt: null },
      select: { id: true, name: true, stockBaseQty: true },
    }),
    getRentalHolds(client, shopId, { start, end, excludeBookingId }),
  ]);
  const byId = new Map(products.map((p) => [p.id, p]));

  for (const [productId, qty] of wanted) {
    const product = byId.get(productId);
    if (!product) throw new AppError("One of the items is no longer in your catalogue", 404, "RENTAL_ITEM_MISSING");
    const owned = ownedQtyOf(product);
    const free = owned - (holds.get(productId) ?? 0);
    if (qty > free) {
      throw new AppError(
        owned === 0
          ? `"${product.name}" has no stock to rent out. Add it to stock first.`
          : `"${product.name}" is already booked for these dates — only ${round2(Math.max(0, free))} of ${owned} free.`,
        409,
        "RENTAL_NOT_AVAILABLE",
      );
    }
  }
}

export async function listRentals(shopId, { status, from, to, search, includeDeleted = false } = {}) {
  const where = {
    shopId,
    ...(includeDeleted ? {} : { deletedAt: null }),
    ...(status && status !== "all" ? { status } : {}),
    ...(search
      ? {
          OR: [
            { customerName: { contains: search } },
            { customerPhone: { contains: search } },
            { bookingNumber: { contains: search } },
          ],
        }
      : {}),
  };

  // A date filter asks "which bookings touch these days", not "which start in them".
  if (from || to) {
    const { start, end } = resolveWindow(from || to, to || from);
    where.fromDate = { lte: end };
    where.toDate = { gte: start };
  }

  const rows = await db.rentalBooking.findMany({
    where,
    orderBy: [{ fromDate: "desc" }, { createdAt: "desc" }],
    include: { items: true },
    take: 500,
  });
  return rows.map(serialize);
}

export async function getRental(shopId, id) {
  const booking = await db.rentalBooking.findFirst({
    where: { id, shopId, deletedAt: null },
    include: { items: true },
  });
  if (!booking) throw new AppError("Booking not found", 404);
  return serialize(booking);
}

export async function createRental(shopId, data, { userId = null } = {}) {
  const { start, end } = resolveWindow(data.fromDate, data.toDate);
  const items = normalizeItems(data.items);

  const create = () =>
    db.$transaction(async (tx) => {
      await assertItemsAvailable(tx, shopId, { items, start, end });

      const booking = await tx.rentalBooking.create({
        data: {
          shopId,
          bookingNumber: await nextBookingNumber(tx, shopId),
          customerId: data.customerId || null,
          customerName: String(data.customerName).trim(),
          customerPhone: normalizePhone(data.customerPhone),
          customerAddress: String(data.customerAddress).trim(),
          idProofType: data.idProofType || null,
          idProofNumber: data.idProofNumber ? String(data.idProofNumber).trim() : null,
          fromDate: start,
          toDate: end,
          rentAmount: round2(Number(data.rentAmount) || 0),
          depositAmount: round2(Number(data.depositAmount) || 0),
          advancePaid: round2(Number(data.advancePaid) || 0),
          notes: data.notes ? String(data.notes).trim() : null,
          createdByUserId: userId,
          items: { create: items },
        },
        include: { items: true },
      });

      // Re-check with the new booking now visible. A booking saved between the
      // first check and this write turns into a rejection instead of a garment
      // promised to two customers.
      await assertItemsAvailable(tx, shopId, { items, start, end, excludeBookingId: booking.id });
      return booking;
    });

  // Two counters booking at the same instant can pick the same number; the
  // unique index catches it and the retry takes the next one.
  try {
    return serialize(await create());
  } catch (err) {
    if (err?.code === "P2002") return serialize(await create());
    throw err;
  }
}

export async function updateRental(shopId, id, data) {
  return db.$transaction(async (tx) => {
    const existing = await tx.rentalBooking.findFirst({ where: { id, shopId, deletedAt: null }, include: { items: true } });
    if (!existing) throw new AppError("Booking not found", 404);
    if (existing.status === "returned" || existing.status === "cancelled") {
      throw new AppError(`A ${existing.status} booking can no longer be edited`, 409, "RENTAL_CLOSED");
    }

    const fromKey = data.fromDate ?? formatDateInTimeZone(existing.fromDate);
    const toKey = data.toDate ?? formatDateInTimeZone(existing.toDate);
    const { start, end } = resolveWindow(fromKey, toKey);
    const items = data.items ? normalizeItems(data.items) : existing.items;

    // Its own held stock must not count against it, hence the exclusion.
    await assertItemsAvailable(tx, shopId, { items, start, end, excludeBookingId: existing.id });

    const patch = {
      fromDate: start,
      toDate: end,
      ...(data.customerId !== undefined ? { customerId: data.customerId || null } : {}),
      ...(data.customerName !== undefined ? { customerName: String(data.customerName).trim() } : {}),
      ...(data.customerPhone !== undefined ? { customerPhone: normalizePhone(data.customerPhone) } : {}),
      ...(data.customerAddress !== undefined ? { customerAddress: String(data.customerAddress).trim() } : {}),
      ...(data.idProofType !== undefined ? { idProofType: data.idProofType || null } : {}),
      ...(data.idProofNumber !== undefined ? { idProofNumber: data.idProofNumber ? String(data.idProofNumber).trim() : null } : {}),
      ...(data.rentAmount !== undefined ? { rentAmount: round2(Number(data.rentAmount) || 0) } : {}),
      ...(data.depositAmount !== undefined ? { depositAmount: round2(Number(data.depositAmount) || 0) } : {}),
      ...(data.advancePaid !== undefined ? { advancePaid: round2(Number(data.advancePaid) || 0) } : {}),
      ...(data.notes !== undefined ? { notes: data.notes ? String(data.notes).trim() : null } : {}),
      ...(data.items ? { items: { deleteMany: {}, create: items } } : {}),
    };

    const updated = await tx.rentalBooking.update({ where: { id: existing.id }, data: patch, include: { items: true } });
    return serialize(updated);
  });
}

export async function markPickedUp(shopId, id) {
  const booking = await db.rentalBooking.findFirst({ where: { id, shopId, deletedAt: null } });
  if (!booking) throw new AppError("Booking not found", 404);
  if (booking.status !== "booked") throw new AppError(`This booking is already ${booking.status}`, 409, "RENTAL_BAD_STATUS");
  const updated = await db.rentalBooking.update({
    where: { id: booking.id },
    data: { status: "picked_up" },
    include: { items: true },
  });
  return serialize(updated);
}

export async function markReturned(shopId, id, { lateFee = 0, damageCharge = 0, notes } = {}) {
  const booking = await db.rentalBooking.findFirst({ where: { id, shopId, deletedAt: null } });
  if (!booking) throw new AppError("Booking not found", 404);
  if (!ACTIVE_STATUSES.includes(booking.status)) {
    throw new AppError(`This booking is already ${booking.status}`, 409, "RENTAL_BAD_STATUS");
  }
  const updated = await db.rentalBooking.update({
    where: { id: booking.id },
    data: {
      status: "returned",
      returnedAt: new Date(),
      lateFee: round2(Number(lateFee) || 0),
      damageCharge: round2(Number(damageCharge) || 0),
      ...(notes !== undefined && notes !== null ? { notes: String(notes).trim() } : {}),
    },
    include: { items: true },
  });
  return serialize(updated);
}

export async function cancelRental(shopId, id, { reason } = {}) {
  const booking = await db.rentalBooking.findFirst({ where: { id, shopId, deletedAt: null } });
  if (!booking) throw new AppError("Booking not found", 404);
  if (booking.status === "returned") throw new AppError("A returned booking cannot be cancelled", 409, "RENTAL_BAD_STATUS");
  const updated = await db.rentalBooking.update({
    where: { id: booking.id },
    data: {
      status: "cancelled",
      ...(reason ? { notes: [booking.notes, `Cancelled: ${String(reason).trim()}`].filter(Boolean).join("\n") } : {}),
    },
    include: { items: true },
  });
  return serialize(updated);
}

export async function softDeleteRental(shopId, id) {
  const booking = await db.rentalBooking.findFirst({ where: { id, shopId, deletedAt: null } });
  if (!booking) throw new AppError("Booking not found", 404);
  const deleted = await db.rentalBooking.update({
    where: { id: booking.id },
    data: { deletedAt: new Date() },
    include: { items: true },
  });
  return serialize(deleted);
}

export async function restoreRental(shopId, id) {
  const booking = await db.rentalBooking.findFirst({ where: { id, shopId, deletedAt: { not: null } } });
  if (!booking) throw new AppError("Deleted booking not found in recycle bin", 404);
  const restored = await db.rentalBooking.update({
    where: { id: booking.id },
    data: { deletedAt: null },
    include: { items: true },
  });
  return serialize(restored);
}

/** Counter-side headline numbers: what is out, what is due back, what is late. */
export async function getRentalSummary(shopId) {
  const key = todayKey();
  const { start, end } = resolveWindow(key, key);
  const open = await db.rentalBooking.findMany({
    where: { shopId, deletedAt: null, status: { in: ACTIVE_STATUSES } },
    include: { items: true },
  });

  let outNow = 0;
  let dueToday = 0;
  let overdue = 0;
  let upcoming = 0;
  let depositHeld = 0;
  let pendingCollection = 0;

  for (const booking of open) {
    const row = serialize(booking);
    depositHeld += Number(booking.depositAmount) || 0;
    pendingCollection += Math.max(0, row.balanceDue);
    if (row.isOverdue) overdue += 1;
    else if (row.toDateKey === key) dueToday += 1;
    if (booking.status === "picked_up") outNow += 1;
    if (booking.fromDate > end) upcoming += 1;
  }

  const bookedTodayCount = open.filter((b) => b.fromDate <= end && b.toDate >= start).length;

  return {
    today: key,
    outNow,
    dueToday,
    overdue,
    upcoming,
    activeToday: bookedTodayCount,
    depositHeld: round2(depositHeld),
    pendingCollection: round2(pendingCollection),
  };
}

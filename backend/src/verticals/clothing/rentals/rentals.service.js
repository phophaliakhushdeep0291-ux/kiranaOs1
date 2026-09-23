import { createHash } from "node:crypto";
import { resolveOperationalLocation, getLocationQuantitiesByProduct } from "../../../modules/stores/location-context.service.js";
import { requireRentalAccounting, rentalTender, postRentalEvent, matchesRentalTender } from "./rental-finance.js";
import db from "../../../db.js";
import { AppError } from "../../../middleware/error.js";
import { round2 } from "../../../utils/money.js";
import { dateRangeForDateOnly, formatDateInTimeZone } from "../../../utils/dates.js";
import { listProducts } from "../../../modules/products/products.service.js";
import { registerCatalogAvailabilityFilter } from "../../../shared/catalog-availability.js";
import { serializableTransaction } from "../../../lib/transactions.js";
import { createAuditLog } from "../../../modules/audit/audit.service.js";

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
export async function getRentalHolds(client, shopId, { start, end, excludeBookingId = null, locationId = null } = {}) {
  const bookings = await client.rentalBooking.findMany({
    where: {
      shopId,
      deletedAt: null,
      status: { in: ACTIVE_STATUSES },
      ...rentalLocationWhere(locationId),
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
    getRentalHolds(db, shopId, { start, end, excludeBookingId, locationId }),
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

function rentalLocationWhere(locationId, includeLegacy = true) {
  return locationId ? { AND: [{ OR: [{ locationId }, ...(includeLegacy ? [{ locationId: null }] : [])] }] } : {};
}

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
    depositHeld: booking.financialVersion === 1 ? round2(booking.depositAmount - booking.depositRefunded) : null,
    balanceDue: booking.status === "cancelled" ? 0 : round2(
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
async function assertItemsAvailable(client, shopId, { items, start, end, excludeBookingId = null, locationId = null }) {
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
    getRentalHolds(client, shopId, { start, end, excludeBookingId, locationId }),
  ]);
  const byId = new Map(products.map((p) => [p.id, p]));

  const location = await resolveOperationalLocation(shopId, locationId, client);
  const quantities = await getLocationQuantitiesByProduct(client, shopId, location, products);
  for (const product of products) product.stockBaseQty = quantities.get(product.id) ?? 0;

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

export async function listRentals(shopId, { status, from, to, search, includeDeleted = false, locationId = null, includeLegacy = true } = {}) {
  const where = {
    shopId,
    ...rentalLocationWhere(locationId, includeLegacy),
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

/** Dated tender events for the cash/UPI/bank statement, including refunds. */
export async function listRentalPayments(shopId, { from, to, locationId } = {}) {
  const { start, end } = resolveWindow(from, to);
  const rows = await db.financialLedger.findMany({
    where: { shopId, sourceType: "rental", entryType: { in: ["rental_cash", "rental_upi", "rental_bank"] }, businessDate: { gte: start, lte: end } },
    orderBy: [{ businessDate: "desc" }, { id: "desc" }], take: 5001,
    select: { id: true, sourceId: true, amountPaise: true, businessDate: true, paymentMode: true, evidenceJson: true },
  });
  // Never present a truncated financial statement as complete.
  if (rows.length > 5000) throw new AppError("Select a shorter date range to load every rental payment", 422, "RENTAL_PAYMENT_RANGE_TOO_LARGE");
  const bookings = await db.rentalBooking.findMany({
    where: { shopId, id: { in: [...new Set(rows.map((row) => row.sourceId))] }, ...(locationId ? { locationId } : {}) },
    select: { id: true, bookingNumber: true, customerName: true, customerPhone: true },
  });
  const byId = new Map(bookings.map((booking) => [booking.id, booking]));
  return rows.filter((row) => byId.has(row.sourceId)).map((row) => {
    const booking = byId.get(row.sourceId);
    const evidence = JSON.parse(row.evidenceJson);
    return { id: row.id, bookingNumber: booking.bookingNumber, customerName: booking.customerName, customerPhone: booking.customerPhone,
      businessDate: row.businessDate, paymentMode: row.paymentMode, amount: Number(row.amountPaise) / 100,
      reference: evidence.reference || evidence.reason || null };
  });
}

export async function createRental(shopId, data, { userId = null, req = null, locationId = null } = {}) {
  const { start, end } = resolveWindow(data.fromDate, data.toDate);
  const items = normalizeItems(data.items);

  const advance = round2(data.advancePaid || 0);
  const deposit = round2(data.depositAmount || 0);
  if (advance > round2(data.rentAmount || 0)) throw new AppError("Advance cannot exceed the rent", 400);
  if (advance + deposit > 0 && !data.clientRequestId) throw new AppError("A payment request reference is required", 400);
  if (advance + deposit > 0) rentalTender(data.paymentMode);
  const requestFingerprint = createHash("sha256").update(JSON.stringify({
    ...data, items, fromDate: start.toISOString(), toDate: end.toISOString(), locationId,
  })).digest("hex");
  const create = () =>
    serializableTransaction(async (tx) => {
      const location = await resolveOperationalLocation(shopId, locationId, tx);
      if (data.clientRequestId) {
        const previous = await tx.rentalBooking.findUnique({ where: { shopId_clientRequestId: { shopId, clientRequestId: data.clientRequestId } }, include: { items: true } });
        if (previous) {
          const audit = await tx.auditLog.findFirst({ where: { shopId, entityId: previous.id, action: "RENTAL_BOOKED" } });
          if (JSON.parse(audit?.metadataJson || "{}").requestFingerprint !== requestFingerprint) throw new AppError("This booking reference was already used for different details", 409, "RENTAL_REQUEST_CHANGED");
          return previous;
        }
      }
      await assertItemsAvailable(tx, shopId, { items, start, end, locationId: location.id });

      const booking = await tx.rentalBooking.create({
        data: {
          shopId,
          bookingNumber: await nextBookingNumber(tx, shopId),
          financialVersion: 1, locationId: location.id, clientRequestId: data.clientRequestId || null,
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
      await assertItemsAvailable(tx, shopId, { items, start, end, excludeBookingId: booking.id, locationId: location.id });
      await postRentalEvent(tx, booking, "booked", {
        ...(advance + deposit > 0 ? { [rentalTender(data.paymentMode)]: round2(advance + deposit) } : {}),
        rental_advance: advance, rental_deposit: deposit,
      }, { userId, req, paymentMode: data.paymentMode, requestFingerprint });
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
  return serializableTransaction(async (tx) => {
    const existing = await tx.rentalBooking.findFirst({ where: { id, shopId, deletedAt: null }, include: { items: true } });
    if (!existing) throw new AppError("Booking not found", 404);
    if (existing.status === "returned" || existing.status === "cancelled") {
      throw new AppError(`A ${existing.status} booking can no longer be edited`, 409, "RENTAL_CLOSED");
    }

    requireRentalAccounting(existing);
    if ((data.advancePaid !== undefined && round2(data.advancePaid) !== round2(existing.advancePaid)) ||
        (data.depositAmount !== undefined && round2(data.depositAmount) !== round2(existing.depositAmount))) {
      throw new AppError("Received money cannot be changed by editing a booking", 409, "RENTAL_MONEY_IMMUTABLE");
    }
    if (data.rentAmount !== undefined && round2(data.rentAmount) < round2(existing.advancePaid)) throw new AppError("Rent cannot be less than the advance already received", 409);
    const fromKey = data.fromDate ?? formatDateInTimeZone(existing.fromDate);
    const toKey = data.toDate ?? formatDateInTimeZone(existing.toDate);
    const { start, end } = resolveWindow(fromKey, toKey);
    const items = data.items ? normalizeItems(data.items) : existing.items;

    // Its own held stock must not count against it, hence the exclusion.
    await assertItemsAvailable(tx, shopId, { items, start, end, excludeBookingId: existing.id, locationId: existing.locationId });

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
  return serializableTransaction(async (tx) => {
    const booking = await tx.rentalBooking.findFirst({ where: { id, shopId, deletedAt: null }, include: { items: true } });
    if (!booking) throw new AppError("Booking not found", 404);
    requireRentalAccounting(booking);
    if (booking.status === "picked_up") return serialize(booking);
    if (booking.status !== "booked") throw new AppError(`This booking is already ${booking.status}`, 409, "RENTAL_BAD_STATUS");
    return serialize(await tx.rentalBooking.update({ where: { id }, data: { status: "picked_up" }, include: { items: true } }));
  });
}

export async function markReturned(shopId, id, { lateFee = 0, damageCharge = 0, notes } = {}, context = {}) {
  return serializableTransaction(async (tx) => {
    const booking = await tx.rentalBooking.findFirst({ where: { id, shopId, deletedAt: null }, include: { items: true } });
    if (!booking) throw new AppError("Booking not found", 404);
    requireRentalAccounting(booking);
    if (booking.status === "returned" && round2(booking.lateFee) === round2(lateFee) && round2(booking.damageCharge) === round2(damageCharge)) return serialize(booking);
    if (!ACTIVE_STATUSES.includes(booking.status)) throw new AppError(`This booking is already ${booking.status}`, 409, "RENTAL_BAD_STATUS");
    const updated = await tx.rentalBooking.update({ where: { id }, data: {
      status: "returned", returnedAt: new Date(), lateFee: round2(lateFee), damageCharge: round2(damageCharge),
      ...(notes != null ? { notes: String(notes).trim() } : {}),
    }, include: { items: true } });
    const income = round2(updated.rentAmount + updated.lateFee + updated.damageCharge);
    await postRentalEvent(tx, updated, "returned", {
      rental_income: income, rental_receivable: round2(income - updated.advancePaid), rental_advance: -updated.advancePaid,
    }, context);
    return serialize(updated);
  });
}

export async function cancelRental(shopId, id, { reason } = {}, context = {}) {
  return serializableTransaction(async (tx) => {
    const booking = await tx.rentalBooking.findFirst({ where: { id, shopId, deletedAt: null }, include: { items: true } });
    if (!booking) throw new AppError("Booking not found", 404);
    requireRentalAccounting(booking);
    if (booking.status === "cancelled") return serialize(booking);
    if (booking.status !== "booked") throw new AppError("Only a booking that has not been picked up can be cancelled", 409, "RENTAL_BAD_STATUS");
    const updated = await tx.rentalBooking.update({ where: { id }, data: {
      status: "cancelled", ...(reason ? { notes: [booking.notes, `Cancelled: ${String(reason).trim()}`].filter(Boolean).join("\n") } : {}),
    }, include: { items: true } });
    // Cancellation releases the reservation. Cash only leaves when the refund is recorded.
    await postRentalEvent(tx, updated, "cancelled", {}, { ...context, reason });
    return serialize(updated);
  });
}

/** Close a returned booking's remaining rent/fees without reopening its stock hold. */
export async function settleRental(shopId, id, data, { userId = null, req = null } = {}) {
  return serializableTransaction(async (tx) => {
    const booking = await tx.rentalBooking.findFirst({ where: { id, shopId, deletedAt: null }, include: { items: true } });
    if (!booking) throw new AppError("Booking not found", 404);
    if (booking.status !== "returned") throw new AppError("Return the items before recording final collection", 409, "RENTAL_BAD_STATUS");
    requireRentalAccounting(booking);
    const due = serialize(booking).balanceDue;
    const amount = round2(data.amount);
    const targetPaid = round2(data.expectedAdvancePaid + amount);
    // An absolute target makes a retry after a lost response harmless. Returned
    // bookings cannot be edited, so neither their charges nor their advance can
    // change underneath a completed settlement.
    if (due === 0 && round2(booking.advancePaid) === targetPaid &&
        await matchesRentalTender(tx, booking, "collected", amount, data.paymentMode, data.reference)) return serialize(booking);
    if (round2(booking.advancePaid) !== round2(data.expectedAdvancePaid) || due !== amount) {
      throw new AppError("The balance changed. Refresh the booking before recording collection.", 409, "RENTAL_BALANCE_CHANGED");
    }
    const updated = await tx.rentalBooking.update({ where: { id: booking.id }, data: { advancePaid: targetPaid }, include: { items: true } });
    await postRentalEvent(tx, updated, "collected", { [rentalTender(data.paymentMode)]: amount, rental_receivable: -amount }, { userId, req, paymentMode: data.paymentMode, reference: data.reference });
    const audit = await createAuditLog({
      shopId, userId, req, client: tx, module: "payments", action: "RENTAL_BALANCE_COLLECTED",
      entityType: "RentalBooking", entityId: booking.id,
      before: { advancePaid: booking.advancePaid, balanceDue: due },
      after: { advancePaid: targetPaid, balanceDue: 0 },
      metadata: { amount, paymentMode: data.paymentMode, reference: data.reference || null, bookingNumber: booking.bookingNumber },
    });
    if (!audit) throw new AppError("Collection was not saved because its audit record could not be stored", 503, "RENTAL_COLLECTION_AUDIT_FAILED");
    return serialize(updated);
  });
}

export async function refundRental(shopId, id, data, context = {}) {
  return serializableTransaction(async (tx) => {
    const booking = await tx.rentalBooking.findFirst({ where: { id, shopId, deletedAt: null }, include: { items: true } });
    if (!booking) throw new AppError("Booking not found", 404);
    requireRentalAccounting(booking);
    if (!["returned", "cancelled"].includes(booking.status)) throw new AppError("Return or cancel the booking before refunding", 409, "RENTAL_BAD_STATUS");
    const held = round2(booking.depositAmount - booking.depositRefunded);
    const advance = booking.status === "cancelled" ? booking.advancePaid : 0;
    const amount = round2(held + advance);
    if (amount === 0 && await matchesRentalTender(tx, booking, "refunded", -data.amount, data.paymentMode)) return serialize(booking);
    if (amount <= 0 || amount !== round2(data.amount)) throw new AppError("The refund balance changed. Refresh before refunding.", 409, "RENTAL_BALANCE_CHANGED");
    const updated = await tx.rentalBooking.update({ where: { id }, data: {
      depositRefunded: booking.depositAmount, ...(booking.status === "cancelled" ? { advancePaid: 0 } : {}),
    }, include: { items: true } });
    await postRentalEvent(tx, updated, "refunded", {
      [rentalTender(data.paymentMode)]: -amount, rental_deposit: -held, rental_advance: -advance,
    }, { ...context, paymentMode: data.paymentMode, reason: data.reason });
    return serialize(updated);
  });
}

export async function softDeleteRental(shopId, id) {
  return serializableTransaction(async (tx) => {
    const booking = await tx.rentalBooking.findFirst({ where: { id, shopId, deletedAt: null } });
    if (!booking) throw new AppError("Booking not found", 404);
    if (booking.status !== "cancelled" || booking.advancePaid > 0 || booking.depositAmount > 0 ||
        await tx.financialLedger.count({ where: { shopId, sourceType: "rental", sourceId: id } })) {
      throw new AppError("Keep bookings with financial history. Return or cancel them instead.", 409, "RENTAL_HISTORY_REQUIRED");
    }
    return serialize(await tx.rentalBooking.update({ where: { id }, data: { deletedAt: new Date() }, include: { items: true } }));
  });
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
export async function getRentalSummary(shopId, { locationId = null, includeLegacy = true } = {}) {
  const key = todayKey();
  const { start, end } = resolveWindow(key, key);
  const collectible = await db.rentalBooking.findMany({
    where: { shopId, deletedAt: null, ...rentalLocationWhere(locationId, includeLegacy) },
    include: { items: true },
  });
  const open = collectible.filter((booking) => ACTIVE_STATUSES.includes(booking.status));

  let outNow = 0;
  let dueToday = 0;
  let overdue = 0;
  let upcoming = 0;
  const depositHeld = collectible.reduce((sum, booking) => sum + (serialize(booking).depositHeld ?? 0), 0);
  const pendingCollection = collectible.reduce((sum, booking) => sum + Math.max(0, serialize(booking).balanceDue), 0);

  for (const booking of open) {
    const row = serialize(booking);

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

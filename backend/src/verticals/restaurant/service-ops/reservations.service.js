import db from "../../../db.js";
import { AppError } from "../../../middleware/error.js";
import { createAuditLog } from "../../../modules/audit/audit.service.js";
import { findOverlap, intervalEnd } from "./intervals.js";

// A reservation only holds a table while it is still live. Cancelling or closing
// one frees the slot immediately, which is the behaviour a host expects when a
// party rings to cancel and the next caller wants the same hour.
export const OPEN_RESERVATION_STATUSES = Object.freeze(["booked", "seated"]);
const ALL_STATUSES = new Set([...OPEN_RESERVATION_STATUSES, "completed", "cancelled", "no_show"]);

async function loadReservation(shopId, id) {
  const reservation = await db.tableReservation.findFirst({ where: { id, shopId }, include: { table: true } });
  if (!reservation) throw new AppError("Reservation not found", 404, "RESERVATION_NOT_FOUND");
  return reservation;
}

/**
 * The guard the whole feature rests on: a table cannot be promised to two parties
 * whose sittings overlap. Only open reservations are considered, and only when a
 * table has actually been assigned — an unassigned booking holds nothing yet, so
 * it cannot collide with anything.
 */
async function assertTableFree(shopId, { tableId, reservedFor, durationMinutes, excludeId = null }) {
  if (!tableId) return;
  const windowStart = new Date(new Date(reservedFor).getTime() - 24 * 60 * 60 * 1000);
  const windowEnd = intervalEnd(reservedFor, durationMinutes + 24 * 60);
  const existing = await db.tableReservation.findMany({
    where: {
      shopId,
      tableId,
      status: { in: OPEN_RESERVATION_STATUSES },
      reservedFor: { gte: windowStart, lte: windowEnd },
    },
    orderBy: { reservedFor: "asc" },
  });
  const clash = findOverlap(
    { startsAt: reservedFor, durationMinutes, excludeId },
    existing.map((row) => ({ id: row.id, startsAt: row.reservedFor, durationMinutes: row.durationMinutes, guestName: row.guestName })),
  );
  if (!clash) return;
  const error = new AppError(
    `That table is already held for ${clash.guestName} at ${new Date(clash.startsAt).toISOString().slice(11, 16)}`,
    409,
    "RESERVATION_TABLE_CONFLICT",
  );
  error.publicData = { conflictingReservationId: clash.id, tableId };
  throw error;
}

export async function listReservations(shopId, query = {}) {
  const where = { shopId };
  if (query.from || query.to) {
    where.reservedFor = {
      ...(query.from && { gte: new Date(query.from) }),
      ...(query.to && { lte: new Date(query.to) }),
    };
  }
  if (query.status) where.status = query.status;
  if (query.tableId) where.tableId = query.tableId;
  if (query.locationId) where.locationId = query.locationId;

  const rows = await db.tableReservation.findMany({
    where,
    orderBy: [{ reservedFor: "asc" }, { createdAt: "asc" }],
    take: Math.min(Number(query.limit) || 200, 500),
    include: { table: { select: { id: true, code: true, name: true, section: true, seats: true } } },
  });
  return rows.map((row) => ({ ...row, endsAt: intervalEnd(row.reservedFor, row.durationMinutes) }));
}

export async function createReservation(shopId, input, actor = {}, req = null) {
  const reservedFor = new Date(input.reservedFor);
  if (Number.isNaN(reservedFor.getTime())) throw new AppError("Enter a valid reservation time", 422, "RESERVATION_TIME_INVALID");

  if (input.tableId) {
    const table = await db.restaurantTable.findFirst({ where: { id: input.tableId, shopId, deletedAt: null } });
    if (!table) throw new AppError("Table not found", 404, "TABLE_NOT_FOUND");
    // Squeezing an extra chair or two onto a table is normal, so this allows up to
    // double the nominal seats and only refuses the genuinely impossible — a party
    // of ten onto a two-top is a typo, not a tight fit.
    if (input.partySize > table.seats * 2) {
      throw new AppError(`${table.name} seats ${table.seats}; a party of ${input.partySize} will not fit`, 422, "RESERVATION_PARTY_TOO_LARGE");
    }
  }

  await assertTableFree(shopId, { tableId: input.tableId, reservedFor, durationMinutes: input.durationMinutes });

  const reservation = await db.tableReservation.create({
    data: {
      shopId,
      locationId: input.locationId ?? null,
      tableId: input.tableId ?? null,
      guestName: input.guestName,
      guestPhone: input.guestPhone ?? null,
      partySize: input.partySize,
      reservedFor,
      durationMinutes: input.durationMinutes,
      source: input.source,
      note: input.note ?? null,
    },
  });
  await createAuditLog({
    shopId, userId: actor.userId ?? null, module: "restaurant", action: "RESERVATION_CREATED",
    entityType: "TableReservation", entityId: reservation.id, after: reservation, req,
  });
  return { ...reservation, endsAt: intervalEnd(reservation.reservedFor, reservation.durationMinutes) };
}

export async function updateReservation(shopId, id, input, actor = {}, req = null) {
  const before = await loadReservation(shopId, id);
  if (!OPEN_RESERVATION_STATUSES.includes(before.status)) {
    throw new AppError("A closed reservation cannot be edited", 409, "RESERVATION_CLOSED");
  }

  const reservedFor = input.reservedFor ? new Date(input.reservedFor) : before.reservedFor;
  const durationMinutes = input.durationMinutes ?? before.durationMinutes;
  const tableId = input.tableId === undefined ? before.tableId : input.tableId;
  // Re-checked on every edit, not only on create: moving a booking an hour later
  // or onto a different table is exactly how a double-booking gets made.
  await assertTableFree(shopId, { tableId, reservedFor, durationMinutes, excludeId: id });

  const updated = await db.tableReservation.update({
    where: { id },
    data: {
      ...(input.guestName !== undefined && { guestName: input.guestName }),
      ...(input.guestPhone !== undefined && { guestPhone: input.guestPhone }),
      ...(input.partySize !== undefined && { partySize: input.partySize }),
      ...(input.reservedFor !== undefined && { reservedFor }),
      ...(input.durationMinutes !== undefined && { durationMinutes }),
      ...(input.tableId !== undefined && { tableId: input.tableId }),
      ...(input.note !== undefined && { note: input.note }),
    },
  });
  await createAuditLog({
    shopId, userId: actor.userId ?? null, module: "restaurant", action: "RESERVATION_UPDATED",
    entityType: "TableReservation", entityId: id, before, after: updated, req,
  });
  return { ...updated, endsAt: intervalEnd(updated.reservedFor, updated.durationMinutes) };
}

const STATUS_FLOW = {
  booked: new Set(["seated", "cancelled", "no_show"]),
  seated: new Set(["completed", "cancelled"]),
  completed: new Set(),
  cancelled: new Set(),
  no_show: new Set(),
};

export async function setReservationStatus(shopId, id, status, actor = {}, req = null) {
  if (!ALL_STATUSES.has(status)) throw new AppError("Unknown reservation status", 422, "RESERVATION_STATUS_INVALID");
  const before = await loadReservation(shopId, id);
  // A closed booking stays closed. Without this a completed sitting could be
  // walked back to "booked" and would start holding a table it no longer occupies.
  if (!STATUS_FLOW[before.status]?.has(status)) {
    throw new AppError(`A ${before.status} reservation cannot become ${status}`, 409, "RESERVATION_TRANSITION_INVALID");
  }

  const updated = await db.tableReservation.update({
    where: { id },
    data: {
      status,
      ...(status === "seated" && { seatedAt: new Date() }),
      ...(["completed", "cancelled", "no_show"].includes(status) && { closedAt: new Date() }),
    },
  });
  await createAuditLog({
    shopId, userId: actor.userId ?? null, module: "restaurant", action: "RESERVATION_STATUS_CHANGED",
    entityType: "TableReservation", entityId: id, before, after: updated, req,
  });
  return updated;
}

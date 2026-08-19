import db from "../../../db.js";
import { AppError } from "../../../middleware/error.js";
import { createAuditLog } from "../../../modules/audit/audit.service.js";
import { findOverlap } from "./intervals.js";

// A cancelled shift stops holding the person, exactly as a cancelled reservation
// stops holding the table.
const BLOCKING_SHIFT_STATUSES = Object.freeze(["scheduled", "published"]);
const SHIFT_STATUSES = new Set([...BLOCKING_SHIFT_STATUSES, "cancelled"]);

/**
 * One person cannot be rostered in two places at once. Same rule shape as a table
 * reservation, same reason it lives in code: an overlap is not something a unique
 * index can express.
 */
async function assertStaffFree(shopId, { userId, startsAt, endsAt, excludeId = null }) {
  const windowStart = new Date(new Date(startsAt).getTime() - 7 * 24 * 60 * 60 * 1000);
  const windowEnd = new Date(new Date(endsAt).getTime() + 7 * 24 * 60 * 60 * 1000);
  const existing = await db.staffShift.findMany({
    where: { shopId, userId, status: { in: BLOCKING_SHIFT_STATUSES }, startsAt: { gte: windowStart, lte: windowEnd } },
    orderBy: { startsAt: "asc" },
    include: { user: { select: { name: true } } },
  });
  const clash = findOverlap(
    { startsAt, durationMinutes: (new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60_000, excludeId },
    existing.map((row) => ({ id: row.id, startsAt: row.startsAt, endsAt: row.endsAt, name: row.user?.name })),
  );
  if (!clash) return;
  const error = new AppError(
    `${clash.name || "That person"} is already rostered from ${new Date(clash.startsAt).toISOString().slice(11, 16)}`,
    409,
    "SHIFT_OVERLAP",
  );
  error.publicData = { conflictingShiftId: clash.id, userId };
  throw error;
}

export async function listShifts(shopId, query = {}) {
  const where = { shopId };
  if (query.from || query.to) {
    where.startsAt = { ...(query.from && { gte: new Date(query.from) }), ...(query.to && { lte: new Date(query.to) }) };
  }
  if (query.userId) where.userId = query.userId;
  if (query.status) where.status = query.status;
  if (query.locationId) where.locationId = query.locationId;

  return db.staffShift.findMany({
    where,
    orderBy: [{ startsAt: "asc" }],
    take: Math.min(Number(query.limit) || 200, 500),
    include: { user: { select: { id: true, name: true, role: true } } },
  });
}

function assertSaneInterval(startsAt, endsAt) {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new AppError("Enter a valid shift start and end", 422, "SHIFT_TIME_INVALID");
  }
  if (end.getTime() <= start.getTime()) {
    throw new AppError("A shift must end after it starts", 422, "SHIFT_TIME_INVALID");
  }
  // A roster line longer than a day is almost always a date typo, and it would
  // block every other shift for that person for the whole period.
  if (end.getTime() - start.getTime() > 24 * 60 * 60 * 1000) {
    throw new AppError("A single shift cannot run longer than 24 hours", 422, "SHIFT_TOO_LONG");
  }
  return { start, end };
}

export async function createShift(shopId, input, actor = {}, req = null) {
  const { start, end } = assertSaneInterval(input.startsAt, input.endsAt);
  // Scoped to the shop, so one tenant can never roster another tenant's staff.
  const user = await db.user.findFirst({ where: { id: input.userId, shopId }, select: { id: true, name: true } });
  if (!user) throw new AppError("Staff member not found", 404, "STAFF_NOT_FOUND");

  await assertStaffFree(shopId, { userId: input.userId, startsAt: start, endsAt: end });

  const shift = await db.staffShift.create({
    data: {
      shopId,
      locationId: input.locationId ?? null,
      userId: input.userId,
      startsAt: start,
      endsAt: end,
      position: input.position ?? null,
      note: input.note ?? null,
    },
  });
  await createAuditLog({
    shopId, userId: actor.userId ?? null, module: "restaurant", action: "STAFF_SHIFT_CREATED",
    entityType: "StaffShift", entityId: shift.id, after: shift, req,
  });
  return shift;
}

export async function updateShift(shopId, id, input, actor = {}, req = null) {
  const before = await db.staffShift.findFirst({ where: { id, shopId } });
  if (!before) throw new AppError("Shift not found", 404, "SHIFT_NOT_FOUND");
  if (input.status && !SHIFT_STATUSES.has(input.status)) throw new AppError("Unknown shift status", 422, "SHIFT_STATUS_INVALID");

  const startsAt = input.startsAt ? new Date(input.startsAt) : before.startsAt;
  const endsAt = input.endsAt ? new Date(input.endsAt) : before.endsAt;
  const nextStatus = input.status ?? before.status;
  assertSaneInterval(startsAt, endsAt);
  // A cancelled shift holds nobody, so it does not need to clear the overlap check
  // — and re-checking it would block cancelling a shift that already overlaps.
  if (BLOCKING_SHIFT_STATUSES.includes(nextStatus)) {
    await assertStaffFree(shopId, { userId: before.userId, startsAt, endsAt, excludeId: id });
  }

  const updated = await db.staffShift.update({
    where: { id },
    data: {
      ...(input.startsAt !== undefined && { startsAt }),
      ...(input.endsAt !== undefined && { endsAt }),
      ...(input.position !== undefined && { position: input.position }),
      ...(input.note !== undefined && { note: input.note }),
      ...(input.status !== undefined && { status: input.status }),
    },
  });
  await createAuditLog({
    shopId, userId: actor.userId ?? null, module: "restaurant", action: "STAFF_SHIFT_UPDATED",
    entityType: "StaffShift", entityId: id, before, after: updated, req,
  });
  return updated;
}

/**
 * Weekly roster grouped per person. The manager's actual question is "is Friday
 * night covered?", which a flat list of shifts does not answer.
 */
export async function getRoster(shopId, query = {}) {
  const shifts = await listShifts(shopId, { ...query, limit: 500 });
  const byUser = new Map();
  for (const shift of shifts) {
    if (!byUser.has(shift.userId)) {
      byUser.set(shift.userId, { userId: shift.userId, name: shift.user?.name ?? "", role: shift.user?.role ?? "", shifts: [], totalMinutes: 0 });
    }
    const entry = byUser.get(shift.userId);
    entry.shifts.push(shift);
    if (shift.status !== "cancelled") {
      entry.totalMinutes += Math.round((new Date(shift.endsAt).getTime() - new Date(shift.startsAt).getTime()) / 60_000);
    }
  }
  return {
    from: query.from ?? null,
    to: query.to ?? null,
    // Scheduled hours, explicitly not hours worked — nobody has clocked in yet.
    basis: "scheduled",
    staff: [...byUser.values()].sort((left, right) => left.name.localeCompare(right.name)),
  };
}

import db from "../../../db.js";
import { AppError } from "../../../middleware/error.js";
import { resolveOperationalLocation } from "../../../modules/stores/location-context.service.js";
import { KOT_STATUSES } from "./kot.schema.js";

/**
 * Kitchen tickets.
 *
 * The one thing to understand about this module is why it exists at all, given
 * that `tables.service.js` deliberately leaves a table's running order on the
 * device that took it. The order stays local because it is settled at the
 * counter that opened it, and pushing it through the server would make a
 * waiter's tablet useless the moment the Wi-Fi dropped.
 *
 * A kitchen ticket is the opposite case. It is written by the till and read by
 * a screen across the room — a different device, always. Held locally it
 * reached nobody. So the ticket is a shop record even though the bill it came
 * from is not, and `billId` is carried as an opaque string rather than a
 * foreign key: the server groups by it and never resolves it.
 *
 * Two more things only the server can settle, both of which were silently wrong
 * while tickets were device-local:
 *
 * - the ticket NUMBER, which two tills firing at once would both claim;
 * - the "already fired" tally, which a second till could not see and would
 *   therefore re-send in full.
 */

/** A day-old ticket is history, not work — the kitchen rail defaults to this window. */
export const KOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** How many times a ticket-number collision is retried before giving up. */
const NUMBER_RETRIES = 5;

function parseLines(json) {
  try {
    const rows = JSON.parse(json ?? "[]");
    return Array.isArray(rows) ? rows : [];
  } catch {
    // A ticket whose lines cannot be read is still a ticket the kitchen should
    // see; losing the row entirely would hide work in progress.
    return [];
  }
}

export function serializeTicket(ticket) {
  if (!ticket) return ticket;
  return {
    id: ticket.id,
    ticketNo: ticket.ticketNo,
    tableId: ticket.tableId,
    tableName: ticket.tableName,
    billId: ticket.billId,
    status: ticket.status,
    lines: parseLines(ticket.linesJson),
    createdAt: ticket.firedAt,
    firedAt: ticket.firedAt,
    servedAt: ticket.servedAt ?? null,
    locationId: ticket.locationId ?? null,
  };
}

/**
 * Per-shop ticket number, derived from the highest existing one rather than a
 * row count so a deleted ticket can never hand its number to a new one.
 *
 * This is the read half of a read-then-write race: two tills firing in the same
 * moment both see the same highest number. The unique index on
 * (shopId, ticketNo) is the real guard — this only has to be right often enough
 * that the retry in `fireTicket` rarely runs.
 */
export async function nextTicketNumber(client, shopId) {
  const last = await client.kitchenTicket.findFirst({
    where: { shopId },
    orderBy: { ticketNo: "desc" },
    select: { ticketNo: true },
  });
  return (Number(last?.ticketNo) || 0) + 1;
}

function normalizeLines(lines) {
  return (lines ?? []).map((line) => ({
    key: String(line.key),
    name: String(line.name).trim(),
    // Millesimal, matching how quantities are stored everywhere else.
    qty: Math.round((Number(line.qty) || 0) * 1000) / 1000,
    unit: String(line.unit ?? "piece"),
    note: line.note ? String(line.note).trim() : undefined,
  }));
}

export async function listTickets(shopId, filters = {}) {
  const since = filters.since ? new Date(filters.since) : new Date(Date.now() - KOT_MAX_AGE_MS);
  const where = {
    shopId,
    deletedAt: null,
    firedAt: { gte: since },
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.billId ? { billId: filters.billId } : {}),
  };
  // A screen showing only outstanding work is the default: "served" is the one
  // state the pass has finished with, and leaving it on the rail buries the
  // tickets that still need cooking.
  if (!filters.status && !filters.includeServed && !filters.billId) where.status = { not: "served" };

  const rows = await db.kitchenTicket.findMany({
    where,
    // Oldest first: a kitchen works the rail in the order it was fired, and the
    // ticket that has been waiting longest is the one that matters.
    orderBy: { firedAt: "asc" },
    take: 500,
  });
  return rows.map(serializeTicket);
}

export async function getTicket(shopId, id) {
  const ticket = await db.kitchenTicket.findFirst({ where: { id, shopId, deletedAt: null } });
  if (!ticket) throw new AppError("Kitchen ticket not found", 404);
  return serializeTicket(ticket);
}

/**
 * Send lines to the kitchen.
 *
 * Idempotent on `idempotencyKey`: the till sends its own ticket id, so a fire
 * retried after a dropped connection returns the ticket already standing rather
 * than putting the dish on the pass a second time.
 */
export async function fireTicket(shopId, input, context = {}) {
  if (input.idempotencyKey) {
    const existing = await db.kitchenTicket.findFirst({
      where: { shopId, idempotencyKey: input.idempotencyKey },
    });
    // Returned whether or not it was soft-deleted: a retry must not resurrect a
    // ticket the kitchen has since voided, and must not create a second one.
    if (existing) return { ticket: serializeTicket(existing), created: false };
  }

  // Always resolved through the helper, never taken from the body as given: it
  // is what checks the location belongs to THIS shop. Trusting a client-sent id
  // would let one shop file a ticket against another's location.
  const requested = input.locationId ?? context.locationId ?? null;
  const location = await resolveOperationalLocation(shopId, requested).catch(() => null);
  const locationId = location?.id ?? null;
  const lines = normalizeLines(input.lines);

  for (let attempt = 0; attempt < NUMBER_RETRIES; attempt += 1) {
    const ticketNo = await nextTicketNumber(db, shopId);
    try {
      const ticket = await db.kitchenTicket.create({
        data: {
          shopId,
          locationId,
          ticketNo,
          tableId: input.tableId,
          tableName: input.tableName,
          billId: input.billId,
          status: "new",
          linesJson: JSON.stringify(lines),
          idempotencyKey: input.idempotencyKey ?? null,
        },
      });
      return { ticket: serializeTicket(ticket), created: true };
    } catch (err) {
      if (err?.code !== "P2002") throw err;
      const target = String(err?.meta?.target ?? "");
      // Two tills raced for the same number: read the highest again and retry.
      if (target.includes("ticketNo")) continue;
      // Two tills raced on the SAME ticket — the idempotency key collided, so
      // the other one won and its ticket is the answer.
      if (target.includes("idempotencyKey") && input.idempotencyKey) {
        const winner = await db.kitchenTicket.findFirst({
          where: { shopId, idempotencyKey: input.idempotencyKey },
        });
        if (winner) return { ticket: serializeTicket(winner), created: false };
      }
      throw err;
    }
  }
  throw new AppError("Could not assign a kitchen ticket number — try again.", 409);
}

export async function setTicketStatus(shopId, id, status) {
  if (!KOT_STATUSES.includes(status)) throw new AppError("Unknown kitchen ticket status", 400);
  const existing = await db.kitchenTicket.findFirst({ where: { id, shopId, deletedAt: null } });
  if (!existing) throw new AppError("Kitchen ticket not found", 404);

  const ticket = await db.kitchenTicket.update({
    where: { id: existing.id },
    data: {
      status,
      // Stamped when it reaches the pass and cleared if it is moved back, so the
      // time is never a claim about a ticket that is cooking again.
      servedAt: status === "served" ? (existing.servedAt ?? new Date()) : null,
    },
  });
  return serializeTicket(ticket);
}

/**
 * Void a ticket. Soft, because a kitchen record is evidence of what was cooked:
 * "we never fired that" and "we fired it and cancelled it" are different
 * answers when a guest disputes the bill.
 */
export async function removeTicket(shopId, id) {
  const existing = await db.kitchenTicket.findFirst({ where: { id, shopId, deletedAt: null } });
  if (!existing) throw new AppError("Kitchen ticket not found", 404);
  await db.kitchenTicket.update({ where: { id: existing.id }, data: { deletedAt: new Date() } });
  return { id: existing.id, deleted: true };
}

import { z } from "zod";

/**
 * The four states a ticket moves through, in order. Mirrors KOT_STATUS_FLOW in
 * frontend/src/features/verticals/restaurant/service/table-store.ts — the
 * kitchen screen draws its rail from the same list, so the two must agree.
 */
export const KOT_STATUSES = ["new", "preparing", "ready", "served"];

const kotLine = z.object({
  /**
   * `cartItemKey` of the cart line this came from. It is what "already fired"
   * is counted against, so a ticket without it would make the till re-send the
   * whole order every time a waiter added one more dish.
   */
  key: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1, "A kitchen ticket line needs something to cook").max(200),
  // Millesimal, matching how quantities are stored everywhere else (0.005 kg = 5 g).
  qty: z.coerce.number().positive().max(10_000),
  unit: z.string().trim().min(1).max(24).default("piece"),
  note: z.string().trim().max(300).nullish(),
});

export const fireTicketSchema = z.object({
  tableId: z.string().trim().min(1).max(120),
  tableName: z.string().trim().min(1).max(120),
  /**
   * The sitting, not the table. A table is reused all evening, so counting
   * "already fired" against the table alone would tell a fresh party's two naan
   * that they had been sent — because the previous party's ticket had two.
   */
  billId: z.string().trim().min(1).max(120),
  lines: z.array(kotLine).min(1, "Nothing to send to the kitchen").max(200),
  /**
   * Durable create idempotency. The till sends its own ticket id, so a fire
   * that is retried after a dropped connection lands once rather than putting
   * the dish on the pass twice.
   */
  idempotencyKey: z.string().trim().min(1).max(120).optional(),
  locationId: z.string().trim().min(1).nullish(),
});

export const updateTicketStatusSchema = z.object({
  // Any state in the flow, not only the next one: a ticket marked ready by
  // mistake has to be movable back, and a kitchen will not tolerate a screen
  // that refuses to correct itself mid-service.
  status: z.enum(KOT_STATUSES),
});

export const listTicketsQuerySchema = z.object({
  status: z.enum(KOT_STATUSES).optional(),
  billId: z.string().trim().min(1).max(120).optional(),
  /** ISO instant. Defaults to the last 24 hours — a day-old ticket is history, not work. */
  since: z.string().trim().datetime().optional(),
  includeServed: z.coerce.boolean().optional(),
});

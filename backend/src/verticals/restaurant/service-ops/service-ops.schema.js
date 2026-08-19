import { z } from "zod";

const isoDateTime = z.string().trim().min(1).refine((value) => !Number.isNaN(new Date(value).getTime()), "Enter a valid date and time");

export const reservationListQuery = z.object({
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
  status: z.enum(["booked", "seated", "completed", "cancelled", "no_show"]).optional(),
  tableId: z.string().trim().min(1).optional(),
  locationId: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export const createReservationSchema = z.object({
  guestName: z.string().trim().min(1).max(120),
  guestPhone: z.string().trim().max(20).optional().nullable(),
  partySize: z.coerce.number().int().min(1).max(200).default(2),
  reservedFor: isoDateTime,
  // 90 minutes is a normal sitting. Capped at a day because a longer hold is a
  // typo that would block the table for every other booking.
  durationMinutes: z.coerce.number().int().min(15).max(1440).default(90),
  tableId: z.string().trim().min(1).optional().nullable(),
  locationId: z.string().trim().min(1).optional().nullable(),
  source: z.enum(["phone", "walk_in", "online"]).default("phone"),
  note: z.string().trim().max(300).optional().nullable(),
}).strict();

export const updateReservationSchema = z.object({
  guestName: z.string().trim().min(1).max(120).optional(),
  guestPhone: z.string().trim().max(20).optional().nullable(),
  partySize: z.coerce.number().int().min(1).max(200).optional(),
  reservedFor: isoDateTime.optional(),
  durationMinutes: z.coerce.number().int().min(15).max(1440).optional(),
  tableId: z.string().trim().min(1).optional().nullable(),
  note: z.string().trim().max(300).optional().nullable(),
}).strict();

export const reservationStatusSchema = z.object({
  status: z.enum(["seated", "completed", "cancelled", "no_show"]),
}).strict();

export const shiftListQuery = z.object({
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
  userId: z.string().trim().min(1).optional(),
  status: z.enum(["scheduled", "published", "cancelled"]).optional(),
  locationId: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export const createShiftSchema = z.object({
  userId: z.string().trim().min(1),
  startsAt: isoDateTime,
  endsAt: isoDateTime,
  position: z.string().trim().max(60).optional().nullable(),
  locationId: z.string().trim().min(1).optional().nullable(),
  note: z.string().trim().max(300).optional().nullable(),
}).strict();

export const updateShiftSchema = z.object({
  startsAt: isoDateTime.optional(),
  endsAt: isoDateTime.optional(),
  position: z.string().trim().max(60).optional().nullable(),
  status: z.enum(["scheduled", "published", "cancelled"]).optional(),
  note: z.string().trim().max(300).optional().nullable(),
}).strict();

export const createKioskSchema = z.object({
  code: z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9_-]+$/, "Use letters, numbers, hyphen or underscore"),
  name: z.string().trim().min(1).max(80).optional(),
  locationId: z.string().trim().min(1).optional().nullable(),
  requirePrepay: z.boolean().default(false),
}).strict();

export const updateKioskSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  locationId: z.string().trim().min(1).optional().nullable(),
  requirePrepay: z.boolean().optional(),
  active: z.boolean().optional(),
}).strict();

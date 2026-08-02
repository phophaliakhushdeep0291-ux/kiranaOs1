import { z } from "zod";
import { ACTIVITY_EVENT_TYPES } from "./activity.events.js";

const optionalString = (max) => z.string().trim().max(max).optional();

/**
 * One activity event as the client sends it.
 *
 * Deliberately NOT accepted from the client: shopId, userId and orgId. Those are
 * read from the JWT server-side, so a device can never write activity into
 * another tenant's history — the same rule the diagnostics ingest follows.
 * deviceId is accepted only as a fallback and is overridden by the session's
 * verified device when there is one.
 *
 * `metadata` is a free-form bag on purpose (the spec's "Event-specific
 * metadata"), but it is sanitized and byte-capped before it is persisted.
 */
export const activityEventSchema = z.object({
  // Client-generated idempotency key. Required: without it a retried offline
  // batch double-counts, which is exactly the failure that makes behavioural
  // analytics untrustworthy.
  eventId: z.string().trim().min(8).max(80),
  eventType: z.enum(ACTIVITY_EVENT_TYPES),
  // ISO-8601 instant the action happened on the device.
  occurredAt: z.string().datetime().optional(),
  sessionId: optionalString(80),
  deviceId: optionalString(120),
  screen: optionalString(200),
  module: optionalString(40),
  appVersion: optionalString(60),
  networkStatus: z.enum(["online", "offline"]).optional(),
  durationMs: z.number().int().nonnegative().max(86_400_000).optional(),
  metadata: z.record(z.any()).optional(),
});

/**
 * Events arrive in batches — a POS on a slow rural connection should pay one
 * request per flush interval, not one per keystroke. The cap matches the
 * client's flush size with headroom; anything larger is a misbehaving client.
 *
 * The batch is validated LOOSELY on purpose, with `activityEventSchema` applied
 * per event inside the service. Validating the array strictly here would make a
 * single bad event throw away the other 99: a client one release ahead sends one
 * new event type and loses that user's whole batch. Per-event parsing drops the
 * unusable event, counts it as `rejected`, and keeps the rest.
 */
export const activityBatchSchema = z.object({
  events: z.array(z.record(z.any())).min(1).max(100),
});

const rangeSchema = z.object({
  days: z.coerce.number().int().min(1).max(365).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const recentActivityQuerySchema = rangeSchema;
export const personalizationQuerySchema = rangeSchema;
export const analyticsQuerySchema = rangeSchema;

export const insightsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).optional(),
  question: optionalString(500),
});

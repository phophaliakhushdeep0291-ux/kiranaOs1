import crypto from "node:crypto";
import { env } from "../config/env.js";
import { getRedisClient, isRedisConfigured } from "./redis.js";

/**
 * Platform event bus (§11 "Kafka compatibility in the future for event streaming").
 *
 * This is the seam, not the broker. Domain code calls `publishEvent(...)` and
 * stays unaware of what is behind it; today that is a no-op or a Redis Stream,
 * and moving to Kafka later means adding one provider here rather than editing
 * every call site.
 *
 * The record shape is deliberately Kafka's — topic, key, value, headers,
 * timestamp — so the migration is a transport swap:
 *   - **topic**    maps to a Kafka topic (Redis Stream key today).
 *   - **key**      is the partition key. It is ALWAYS the shopId, so all events
 *                  for one store land on one partition and stay ordered
 *                  relative to each other — the ordering guarantee that matters
 *                  for a per-shop timeline. It also keeps a hot store from
 *                  spraying across every partition.
 *   - **headers**  carry routing/tracing metadata, not business data.
 *
 * Fault tolerance: publishing is fire-and-forget and NEVER throws into the
 * caller. Telemetry must not be able to fail a bill. When no provider is
 * configured (the default), this degrades to a counted no-op.
 */

export const EVENT_TOPICS = Object.freeze({
  ERROR_RECORDED: "artha.diagnostics.error",
  SUPPORT_REQUESTED: "artha.support.request",
  SYNC_FAILED: "artha.sync.failed",
  SYNC_COMPLETED: "artha.sync.completed",
  DEVICE_HEALTH: "artha.device.health",
  AUDIT_EVENT: "artha.audit.event",
  ACTIVITY_EVENT: "artha.activity.event",
});

const VALID_TOPICS = new Set(Object.values(EVENT_TOPICS));

/** Trim the stream so a Redis-backed bus cannot grow without bound. */
const STREAM_MAX_LEN = 10000;

const stats = {
  published: 0,
  dropped: 0,
  failed: 0,
  lastError: null,
  lastPublishedAt: null,
};

/**
 * Which transport is active. `none` is the safe default: the platform runs
 * exactly as before until an operator opts in.
 */
export function getEventBusProvider() {
  const configured = String(env.EVENT_BUS_PROVIDER ?? "none").toLowerCase();
  // Gate on REDIS_URL only. `isRedisEnabled()` additionally requires
  // QUEUES_ENABLED, which is about BullMQ job queues — an unrelated concern.
  // Tying the two together meant an operator who set EVENT_BUS_PROVIDER=redis
  // and REDIS_URL got silent no-ops until they also turned on job queues.
  if (configured === "redis" && !isRedisConfigured()) return "none";
  return configured;
}

export function isEventBusEnabled() {
  return getEventBusProvider() !== "none";
}

/**
 * publishEvent — emit one domain event.
 *
 * @param {string} topic one of EVENT_TOPICS
 * @param {string|null} shopId partition key; null for platform-wide events
 * @param {object} payload JSON-serializable body
 * @param {object} [headers] routing/tracing metadata
 * @returns {Promise<{published: boolean, reason?: string, id?: string}>}
 */
export async function publishEvent(topic, shopId, payload = {}, headers = {}) {
  const record = buildRecord(topic, shopId, payload, headers);

  if (!VALID_TOPICS.has(topic)) {
    // An unknown topic is a programming error, but it must not throw here —
    // surface it in stats and drop the record.
    stats.dropped += 1;
    return { published: false, reason: "UNKNOWN_TOPIC" };
  }

  const provider = getEventBusProvider();
  if (provider === "none") {
    stats.dropped += 1;
    return { published: false, reason: "BUS_DISABLED" };
  }

  try {
    if (provider === "redis") {
      const result = await publishToRedisStream(record);
      stats.published += 1;
      stats.lastPublishedAt = new Date().toISOString();
      return { published: true, id: result };
    }
    if (provider === "kafka") {
      // Intentionally not implemented: adding a broker dependency before the
      // platform needs one is the wrong trade. The contract above is what a
      // Kafka producer takes, so this becomes a ~20-line adapter.
      stats.dropped += 1;
      return { published: false, reason: "KAFKA_PROVIDER_NOT_INSTALLED" };
    }
    stats.dropped += 1;
    return { published: false, reason: "UNKNOWN_PROVIDER" };
  } catch (error) {
    stats.failed += 1;
    stats.lastError = String(error?.message ?? error).slice(0, 200);
    return { published: false, reason: "PUBLISH_FAILED" };
  }
}

/**
 * The Kafka-shaped record. Keeping this pure (and exported) means the envelope
 * can be asserted in tests without a broker.
 */
export function buildRecord(topic, shopId, payload = {}, headers = {}) {
  return {
    topic,
    // Kafka partitions by key; shopId keeps a store's events ordered together.
    key: shopId ?? "platform",
    value: payload,
    headers: {
      eventId: `evt_${crypto.randomUUID().replaceAll("-", "")}`,
      source: "artha-backend",
      version: process.env.APP_VERSION || "1.0.0",
      ...headers,
    },
    timestamp: Date.now(),
  };
}

/**
 * Redis Streams are the closest thing to a Kafka topic available here: an
 * append-only log with ids, ranges and consumer groups. One stream per topic,
 * with the partition key stored on the entry so a future Kafka producer can
 * map it straight across.
 */
async function publishToRedisStream(record) {
  const client = await getRedisClient();
  if (!client) throw new Error("Redis client unavailable");
  return client.xadd(
    record.topic,
    "MAXLEN",
    "~",
    STREAM_MAX_LEN,
    "*",
    "key",
    record.key,
    "value",
    JSON.stringify(record.value),
    "headers",
    JSON.stringify(record.headers),
    "ts",
    String(record.timestamp),
  );
}

/** Operational counters for the admin dashboard (§10) and health checks. */
export function getEventBusStatus() {
  return {
    provider: getEventBusProvider(),
    enabled: isEventBusEnabled(),
    topics: Object.values(EVENT_TOPICS),
    ...stats,
  };
}

/** Test seam — reset counters between assertions. */
export function resetEventBusStats() {
  stats.published = 0;
  stats.dropped = 0;
  stats.failed = 0;
  stats.lastError = null;
  stats.lastPublishedAt = null;
}

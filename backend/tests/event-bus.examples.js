import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  EVENT_TOPICS,
  buildRecord,
  publishEvent,
  getEventBusProvider,
  isEventBusEnabled,
  getEventBusStatus,
  resetEventBusStats,
} from "../src/lib/eventBus.js";

// Proves §11's event-streaming seam: the record envelope is Kafka-shaped (so the
// future migration is a transport swap, not a rewrite), the bus is OFF by default
// so nothing changes for existing deployments, and publishing can never throw
// into the business flow that emitted the event.

// 1) Default posture — disabled, and disabled means "drop", not "crash".
assert.equal(getEventBusProvider(), "none", "the bus must be off unless explicitly configured");
assert.equal(isEventBusEnabled(), false);

resetEventBusStats();
const off = await publishEvent(EVENT_TOPICS.SYNC_FAILED, "shop-1", { failed: 3 });
assert.equal(off.published, false, "nothing is published while disabled");
assert.equal(off.reason, "BUS_DISABLED", "the reason is explicit, not a silent swallow");
assert.equal(getEventBusStatus().dropped, 1, "drops are counted so the dashboard can show them");

// 2) The envelope matches Kafka's producer record.
const record = buildRecord(EVENT_TOPICS.ERROR_RECORDED, "shop-42", { title: "boom" }, { deviceId: "dev-7" });
assert.equal(record.topic, "artha.diagnostics.error", "topic is a stable, namespaced string");
assert.equal(record.key, "shop-42", "shopId is the partition key so a shop's events stay ordered");
assert.deepEqual(record.value, { title: "boom" }, "payload travels as the record value");
assert.equal(record.headers.deviceId, "dev-7", "caller headers are preserved");
assert.equal(record.headers.source, "artha-backend", "provenance header is always set");
assert.match(record.headers.eventId, /^evt_[0-9a-f]{32}$/, "every record gets a unique id");
assert.ok(typeof record.timestamp === "number", "timestamp is epoch millis, like Kafka");

// Platform-wide events (no shop) still need a partition key.
assert.equal(buildRecord(EVENT_TOPICS.AUDIT_EVENT, null, {}).key, "platform");

// Two records must never share an id (dedupe depends on it downstream).
const ids = new Set(Array.from({ length: 200 }, () => buildRecord(EVENT_TOPICS.AUDIT_EVENT, "s", {}).headers.eventId));
assert.equal(ids.size, 200, "event ids are unique");

// 3) Topics are a closed set — a typo must not create a phantom stream.
resetEventBusStats();
const bogus = await publishEvent("artha.made.up", "shop-1", {});
assert.equal(bogus.published, false);
assert.equal(bogus.reason, "UNKNOWN_TOPIC");

// 4) Publishing must not throw even when the payload is hostile.
const circular = { name: "loop" };
circular.self = circular;
await assert.doesNotReject(
  () => publishEvent(EVENT_TOPICS.DEVICE_HEALTH, "shop-1", circular),
  "a bad payload must never propagate into the caller",
);

// 5) Status is dashboard-ready.
const status = getEventBusStatus();
assert.equal(status.provider, "none");
assert.ok(Array.isArray(status.topics) && status.topics.length >= 6, "topics are enumerable for docs/monitoring");
assert.ok(Number.isInteger(status.published) && Number.isInteger(status.failed), "counters are numeric");

// 6) All declared topics are distinct and namespaced.
const topics = Object.values(EVENT_TOPICS);
assert.equal(new Set(topics).size, topics.length, "no duplicate topic strings");
for (const topic of topics) {
  assert.match(topic, /^artha\.[a-z]+\.[a-z]+$/, `${topic} must follow artha.<domain>.<event>`);
}

// 7) A production process must never claim an unavailable transport. Redis
// needs a real URL and Kafka remains a reserved contract, not a working broker.
const productionEnv = {
  ...process.env,
  NODE_ENV: "production",
  // This block proves the event-bus transport contract in isolation. A release
  // runner may itself enable BullMQ; inheriting that unrelated flag makes the
  // child fail the queue prerequisite before it reaches the event-bus check.
  QUEUES_ENABLED: "false",
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  JWT_SECRET: "event-bus-test-jwt-secret-long-enough-1234567890",
  OWNER_PIN_REQUIRED: "true",
  LICENSE_SIGNING_SECRET: "event-bus-license-secret-long-enough-1234567890",
  INTEGRATION_SIGNING_SECRET: "event-bus-integration-secret-long-enough-12345",
  ALLOWED_ORIGINS: "https://pos.example.com",
  METRICS_ENABLED: "false",
};
function boot(overrides) {
  return spawnSync(process.execPath, ["-e", "import('./src/config/env.js').then(() => console.log('BOOTED'))"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...productionEnv, ...overrides },
    timeout: 30_000,
  });
}

const redisWithoutUrl = boot({ EVENT_BUS_PROVIDER: "redis", REDIS_URL: "" });
assert.match(`${redisWithoutUrl.stdout}${redisWithoutUrl.stderr}`, /REDIS_URL is required when EVENT_BUS_PROVIDER=redis/);
assert.doesNotMatch(redisWithoutUrl.stdout, /BOOTED/);

const kafkaWithoutAdapter = boot({ EVENT_BUS_PROVIDER: "kafka" });
assert.match(`${kafkaWithoutAdapter.stdout}${kafkaWithoutAdapter.stderr}`, /kafka cannot run in production/);
assert.doesNotMatch(kafkaWithoutAdapter.stdout, /BOOTED/);

const redisConfigured = boot({ EVENT_BUS_PROVIDER: "redis", REDIS_URL: "redis:\/\/127.0.0.1:6379" });
assert.match(redisConfigured.stdout, /BOOTED/, "configured Redis is accepted without requiring BullMQ queues");

console.log("event-bus.examples.js OK");

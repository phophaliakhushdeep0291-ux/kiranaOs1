import { env } from "../config/env.js";

let redisClient = null;
let redisModuleLoadError = null;

function maskRedisUrl(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = "***";
    if (parsed.username) parsed.username = "***";
    return parsed.toString();
  } catch {
    return "[invalid-redacted-redis-url]";
  }
}

export function isRedisConfigured() {
  return Boolean(env.REDIS_URL);
}

export function isRedisEnabled() {
  return Boolean(env.QUEUES_ENABLED && env.REDIS_URL);
}

export async function getRedisClient() {
  if (!isRedisEnabled()) {
    return null;
  }
  if (redisClient) return redisClient;

  try {
    const { default: IORedis } = await import("ioredis");
    redisClient = new IORedis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
    });
    redisClient.on("connect", () => {
      console.log(JSON.stringify({ type: "redis_connected", url: maskRedisUrl(env.REDIS_URL), time: new Date().toISOString() }));
    });
    redisClient.on("error", (error) => {
      console.error(JSON.stringify({ type: "redis_error", errorMessage: error?.message, time: new Date().toISOString() }));
    });
    await redisClient.connect();
    return redisClient;
  } catch (error) {
    redisModuleLoadError = error;
    if (env.NODE_ENV === "production" && env.QUEUES_ENABLED) {
      throw error;
    }
    console.warn(JSON.stringify({
      type: "redis_disabled",
      reason: "REDIS_CLIENT_UNAVAILABLE",
      errorMessage: error?.message,
      time: new Date().toISOString(),
    }));
    return null;
  }
}

export function getRedisStatus() {
  return {
    configured: isRedisConfigured(),
    enabled: isRedisEnabled(),
    connected: redisClient?.status === "ready" || redisClient?.status === "connect",
    status: redisClient?.status ?? (isRedisEnabled() ? "not_connected" : "disabled"),
    moduleError: redisModuleLoadError?.message ?? null,
  };
}

export async function closeRedis() {
  if (!redisClient) return;
  const client = redisClient;
  redisClient = null;
  await client.quit().catch(() => client.disconnect());
}

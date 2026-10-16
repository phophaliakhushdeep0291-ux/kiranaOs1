import Redis from "ioredis";
import { env } from "../../config/env.js";
import { AppError } from "../../middleware/error.js";

const PREFIX = "kirana:native-login:v1:";
const SWAP = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
if ARGV[2] == '' then redis.call('DEL', KEYS[1])
else redis.call('SET', KEYS[1], ARGV[2], 'KEEPTTL') end
return 1`;
let client;
let connecting;
const unavailable = () => new AppError("App sign-in is temporarily unavailable. Please try again shortly.", 503, "NATIVE_LOGIN_UNAVAILABLE");
async function connection() {
  if (!env.REDIS_URL) throw unavailable();
  if (client?.status === "ready") return client;
  if (connecting) return connecting;
  connecting = (async () => {
    client?.disconnect();
    client = new Redis(env.REDIS_URL, {
      lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 1,
      connectTimeout: 2500, commandTimeout: 3000, retryStrategy: () => null,
    });
    client.on("error", () => {}); // Never log credentials or pending requests.
    await client.connect();
    return client;
  })();
  try { return await connecting; } finally { connecting = null; }
}

export function createMemoryNativeLoginStore(now = Date.now) {
  const rows = new Map();
  const get = key => {
    const row = rows.get(key);
    if (row && row.expiresAt > now()) return row.value;
    rows.delete(key);
    return null;
  };
  return {
    async get(key) { return get(key); },
    async put(key, value, ttl) {
      for (const id of rows.keys()) get(id);
      if (rows.size >= 1000) throw unavailable();
      rows.set(key, { value, expiresAt: now() + ttl });
    },
    async swap(key, oldValue, value) {
      if (get(key) !== oldValue) return false;
      if (value === null) rows.delete(key);
      else rows.set(key, { ...rows.get(key), value });
      return true;
    },
  };
}

// Production cannot fall back to per-process memory: multiple replicas could
// redeem an approval twice. Development/test can work without local Redis.
const memory = createMemoryNativeLoginStore();
async function run(method, args) {
  if (!env.REDIS_URL && env.NODE_ENV !== "production") return memory[method](...args);
  try {
    const redis = await connection();
    const [id, ...rest] = args;
    if (method === "get") return await redis.get(PREFIX + id);
    if (method === "put") return await redis.set(PREFIX + id, rest[0], "PX", rest[1], "NX");
    return (await redis.eval(SWAP, 1, PREFIX + id, rest[0], rest[1] ?? "")) === 1;
  } catch { throw unavailable(); }
}
export const nativeLoginStore = Object.fromEntries(["get", "put", "swap"].map(method => [method, (...args) => run(method, args)]));

export function closeNativeLoginStore() {
  client?.disconnect();
  client = null;
}

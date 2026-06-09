// Redacts JWT, passwords, PINs, refresh tokens, API keys, and provider secrets.
const SENSITIVE_KEY_PATTERN = /password|pin|ownerPin|token|jwt|secret|signature|authorization|apiKey|accessKey|refresh|razorpay|redis_url|database_url|storage_secret|phone|mobile|email/i;
const SECRET_VALUE_PATTERN = /(bearer\s+)[A-Za-z0-9._-]+|([?&]?(?:password|pin|token|secret|signature|authorization)=)[^\s&]+/gi;

export function redactSensitive(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > 8) return "[REDACTED_DEPTH]";
  if (typeof value === "string") {
    return value.replace(SECRET_VALUE_PATTERN, (_match, bearerPrefix, paramPrefix) => {
      if (bearerPrefix) return `${bearerPrefix}[REDACTED]`;
      return `${paramPrefix}[REDACTED]`;
    });
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => redactSensitive(item, depth + 1));

  const safe = {};
  for (const [key, raw] of Object.entries(value)) {
    safe[key] = SENSITIVE_KEY_PATTERN.test(key) ? "[REDACTED]" : redactSensitive(raw, depth + 1);
  }
  return safe;
}

function normalizeLevel(level) {
  return ["debug", "info", "warn", "error"].includes(level) ? level : "info";
}

export function log(level, payload = {}) {
  const normalizedLevel = normalizeLevel(level);
  const safePayload = redactSensitive({
    level: normalizedLevel,
    time: new Date().toISOString(),
    ...payload,
  });
  const line = JSON.stringify(safePayload);
  if (normalizedLevel === "error") console.error(line);
  else if (normalizedLevel === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (payload) => log("debug", payload),
  info: (payload) => log("info", payload),
  warn: (payload) => log("warn", payload),
  error: (payload) => log("error", payload),
};

export const __loggerInternals = { SENSITIVE_KEY_PATTERN, SECRET_VALUE_PATTERN };

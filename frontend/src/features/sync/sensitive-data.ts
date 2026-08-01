const SENSITIVE_SYNC_KEY = /ownerpin|pinhash|password|authorization|cookie|apikey|secret|token$/;

function normalizedKey(key: string) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function isSensitiveSyncKey(key: string) {
  const normalized = normalizedKey(key);
  return normalized !== "ownerpinprovided" && SENSITIVE_SYNC_KEY.test(normalized);
}

/**
 * Conflict snapshots are durable and may be rendered in owner-facing diagnostics.
 * Strip credentials recursively before persistence, reporting, or display while
 * retaining non-secret evidence such as `ownerPinProvided: true`.
 */
export function sanitizeSyncDiagnostic(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitizeSyncDiagnostic(item));
  if (typeof value !== "object" || value === null) return value;

  const safe: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveSyncKey(key)) continue;
    safe[key] = sanitizeSyncDiagnostic(nested);
  }
  return safe;
}

export function sanitizeSyncRecord(value: unknown): Record<string, unknown> | null {
  const sanitized = sanitizeSyncDiagnostic(value);
  return typeof sanitized === "object" && sanitized !== null && !Array.isArray(sanitized)
    ? sanitized as Record<string, unknown>
    : null;
}

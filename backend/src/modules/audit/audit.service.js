import db from "../../db.js";

/**
 * createAuditLog — central audit trail helper for sensitive shop actions.
 *
 * Keep this helper intentionally small: callers provide before/after/metadata
 * objects and this service serializes them safely. Audit logging should never
 * break the main business flow, so callers may decide whether to await it or
 * catch errors depending on context.
 */
export async function createAuditLog({
  shopId,
  userId = null,
  action,
  entityType = null,
  entityId = null,
  before = undefined,
  after = undefined,
  metadata = undefined,
  req = null,
}) {
  if (!shopId || !action) return null;

  try {
    return await db.auditLog.create({
      data: {
        shopId,
        userId: userId ?? null,
        action,
        entityType,
        entityId,
        beforeJson: serializeOptional(before),
        afterJson: serializeOptional(after),
        metadataJson: serializeOptional(metadata),
        ipAddress: getRequestIp(req),
        userAgent: getUserAgent(req),
      },
    });
  } catch (error) {
    // Audit failures should be visible to operators but must not make an
    // already-completed business action look failed to the user.
    console.error("Audit log failed", error);
    return null;
  }
}

function serializeOptional(value) {
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ serializationError: true });
  }
}

function getRequestIp(req) {
  if (!req) return null;
  const forwarded = req.headers?.["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded.length) {
    return String(forwarded[0]).split(",")[0].trim();
  }
  return req.ip ?? req.socket?.remoteAddress ?? null;
}

function getUserAgent(req) {
  if (!req) return null;
  return req.headers?.["user-agent"] ? String(req.headers["user-agent"]) : null;
}

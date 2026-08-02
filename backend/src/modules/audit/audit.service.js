import db from "../../db.js";

/**
 * Audit trail (§2 "Complete Audit Log").
 *
 * The spec requires every meaningful action to be reconstructable, so each entry
 * carries: timestamp, user, shop, device, module, previous value, new value,
 * result and duration. `createAuditLog` stays intentionally small — callers pass
 * before/after/metadata objects and this service serializes them safely.
 *
 * Audit logging must never break the main business flow, so failures are
 * swallowed and logged rather than thrown.
 */

/**
 * Canonical module names. Keeping this list closed means the admin dashboard and
 * incident report can group a timeline by module without inventing buckets.
 */
export const AUDIT_MODULES = Object.freeze({
  AUTH: "auth",
  BILLING: "billing",
  PAYMENTS: "payments",
  INVENTORY: "inventory",
  CUSTOMERS: "customers",
  SUPPLIERS: "suppliers",
  DEVICES: "devices",
  SYNC: "sync",
  SETTINGS: "settings",
  REPORTS: "reports",
  EXPENSES: "expenses",
  FINANCE: "finance",
  OFFERS: "offers",
  LOYALTY: "loyalty",
  BACKUP: "backup",
  ASSURANCE: "assurance",
  SUPPORT: "support",
  ORDERS: "orders",
  OTHER: "other",
});

export const AUDIT_RESULTS = Object.freeze({
  SUCCESS: "success",
  FAILURE: "failure",
});

/**
 * Action-name → module rules, checked in order. Actions are SCREAMING_SNAKE_CASE
 * (`BILL_CANCELLED`, `DEVICE_REMOVED`, …), so prefix/substring matching lets the
 * ~35 existing call sites gain a module without each one being edited.
 */
const MODULE_RULES = [
  [/^(LOGIN|LOGOUT|AUTH_|PASSWORD_|OTP_|SESSION_|USER_|STAFF_|PIN_)/, AUDIT_MODULES.AUTH],
  [/(^|_)(LOGIN|LOGOUT)($|_)/, AUDIT_MODULES.AUTH],
  [/^(BILL_|CREATE_BILL|EDIT_BILL|DELETE_BILL|RESTORE_BILL|INVOICE_|RECEIPT_|ESTIMATE_)/, AUDIT_MODULES.BILLING],
  [/^(PAYMENT_|UDHAR_|REFUND_|SETTLEMENT_|COLLECTION_)/, AUDIT_MODULES.PAYMENTS],
  [/^(INVENTORY_|STOCK_|PRODUCT_|PURCHASE_|HSN_|BARCODE_|LOT_)/, AUDIT_MODULES.INVENTORY],
  [/^(CUSTOMER_)/, AUDIT_MODULES.CUSTOMERS],
  [/^(SUPPLIER_|VENDOR_)/, AUDIT_MODULES.SUPPLIERS],
  [/^(DEVICE_)/, AUDIT_MODULES.DEVICES],
  [/^(SYNC_|OFFLINE_SYNC|CONFLICT_)/, AUDIT_MODULES.SYNC],
  [/^(SETTINGS_|SHOP_|STORE_|LOCATION_|TAX_|GST_|PREFERENCE_)/, AUDIT_MODULES.SETTINGS],
  [/^(REPORT_|EXPORT_|DATA_EXPORT|DAILY_CLOSING)/, AUDIT_MODULES.REPORTS],
  [/^(EXPENSE_)/, AUDIT_MODULES.EXPENSES],
  [/^(BANK_|LEDGER_|RECONCIL)/, AUDIT_MODULES.FINANCE],
  [/^(OFFER_|DISCOUNT_|COUPON_)/, AUDIT_MODULES.OFFERS],
  [/^(LOYALTY_|GIFT_CARD_)/, AUDIT_MODULES.LOYALTY],
  [/^(BACKUP_|RESTORE_|SNAPSHOT_)/, AUDIT_MODULES.BACKUP],
  [/^(AUDIT_|ASSURANCE_)/, AUDIT_MODULES.ASSURANCE],
  [/^(SUPPORT_|DIAGNOSTIC|ERROR_|INCIDENT_)/, AUDIT_MODULES.SUPPORT],
  [/^(ORDER_|CUSTOMER_ORDER|FULFILMENT_|FULFILLMENT_)/, AUDIT_MODULES.ORDERS],
];

/** Actions whose name already says the attempt did not succeed. */
const FAILURE_PATTERN = /(FAILED|FAILURE|BLOCKED|REJECTED|DENIED|MISMATCH|INVALID|UNAUTHORIZED|CONFLICT|ERROR|EXPIRED)/;

/**
 * inferAuditModule — best-effort module for an action name.
 * Explicit `module` from the caller always wins; this is the fallback so that
 * every row lands in a bucket the dashboard can filter on.
 */
export function inferAuditModule(action) {
  if (!action) return AUDIT_MODULES.OTHER;
  const name = String(action).toUpperCase();
  for (const [pattern, moduleName] of MODULE_RULES) {
    if (pattern.test(name)) return moduleName;
  }
  return AUDIT_MODULES.OTHER;
}

/**
 * inferAuditResult — audit rows are conventionally written after an action has
 * completed, so "success" is the right default; action names that describe a
 * rejection are recorded as failures.
 */
export function inferAuditResult(action) {
  if (action && FAILURE_PATTERN.test(String(action).toUpperCase())) {
    return AUDIT_RESULTS.FAILURE;
  }
  return AUDIT_RESULTS.SUCCESS;
}

export async function createAuditLog({
  shopId,
  userId = null,
  deviceId = undefined,
  module = undefined,
  action,
  entityType = null,
  entityId = null,
  before = undefined,
  after = undefined,
  metadata = undefined,
  result = undefined,
  durationMs = undefined,
  req = null,
  client = db,
}) {
  if (!shopId || !action) return null;

  try {
    return await client.auditLog.create({
      data: {
        shopId,
        userId: userId ?? null,
        deviceId: deviceId === undefined ? getRequestDeviceId(req) : (deviceId ?? null),
        module: module ?? inferAuditModule(action),
        action,
        entityType,
        entityId,
        beforeJson: serializeOptional(before),
        afterJson: serializeOptional(after),
        metadataJson: serializeOptional(metadata),
        result: result ?? inferAuditResult(action),
        durationMs: normalizeDuration(durationMs),
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

/**
 * withAudit — run an operation, time it, and audit the outcome either way.
 *
 * Use this where the spec's Result/Duration matter (sync runs, exports, restores,
 * anything slow or fallible). Success writes `result: "success"` with the measured
 * duration; a throw writes `result: "failure"` with the error in metadata and then
 * rethrows, so control flow is unchanged.
 *
 *   const bill = await withAudit(
 *     { shopId, userId, action: "CREATE_BILL", req, after: (b) => ({ id: b.id }) },
 *     () => billsService.create(input),
 *   );
 */
export async function withAudit(entry, operation) {
  const startedAt = Date.now();
  try {
    const value = await operation();
    await createAuditLog({
      ...entry,
      after: resolveOutcomeField(entry.after, value),
      metadata: resolveOutcomeField(entry.metadata, value),
      result: AUDIT_RESULTS.SUCCESS,
      durationMs: Date.now() - startedAt,
    });
    return value;
  } catch (error) {
    await createAuditLog({
      ...entry,
      after: undefined,
      metadata: {
        ...(typeof entry.metadata === "object" && entry.metadata !== null ? entry.metadata : {}),
        error: error?.message ? String(error.message).slice(0, 500) : "Unknown error",
        errorCode: error?.code ?? null,
      },
      result: AUDIT_RESULTS.FAILURE,
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}

/**
 * Lets callers pass `after`/`metadata` as a function of the operation's return
 * value, since the new state usually is not known until the work has run.
 */
function resolveOutcomeField(field, value) {
  if (typeof field !== "function") return field;
  try {
    return field(value);
  } catch {
    return undefined;
  }
}

function normalizeDuration(durationMs) {
  if (durationMs === undefined || durationMs === null) return null;
  const numeric = Number(durationMs);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Math.round(numeric);
}

function serializeOptional(value) {
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ serializationError: true });
  }
}

/**
 * The device that performed the action — the spec's "Device" column. Every
 * authenticated client sends `x-device-id`; activated devices also land on
 * `req.device`/`req.user`.
 */
function getRequestDeviceId(req) {
  if (!req) return null;
  const header = req.headers?.["x-device-id"];
  const raw =
    (Array.isArray(header) ? header[0] : header) ??
    req.device?.deviceId ??
    req.user?.deviceId ??
    null;
  if (!raw) return null;
  const text = String(raw).trim();
  return text ? text.slice(0, 128) : null;
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

import { classifySyncError } from "../../utils/syncRules.js";

// Turns a failed/conflicted sync record into a plain-language explanation so the
// user (and support) see "Inventory update failed because the product no longer
// exists" instead of "Sync Error" (Diagnostics §3). Pure and dependency-light so
// it can be unit tested and reused by the diagnostics endpoint + AI incident report.

const OPERATION_LABELS = [
  [/RETURN/, "Processing a return"],
  [/BILL/, "Saving a bill"],
  [/PRODUCT/, "Updating a product"],
  [/STOCK|DAMAGE|INVENTORY/, "Updating inventory"],
  [/UDHAR/, "Updating customer credit"],
  [/SUPPLIER_PAYMENT/, "Recording a supplier payment"],
  [/SUPPLIER/, "Saving a supplier"],
  [/PAYMENT/, "Recording a payment"],
  [/CUSTOMER/, "Saving a customer"],
  [/LEDGER/, "Recording a ledger entry"],
];

function operationLabel(type = "") {
  const upper = String(type ?? "").toUpperCase();
  for (const [pattern, label] of OPERATION_LABELS) if (pattern.test(upper)) return label;
  return "A change";
}

// Friendly cause per classifier/reason code (see utils/syncRules.js classifySyncError
// + getConflictCodeFromMessage).
const CAUSE_BY_CODE = {
  INVALID_PRODUCT_ID: "the product no longer exists",
  PRODUCT_DELETED: "the product was deleted",
  STOCK_INSUFFICIENT: "there isn't enough stock",
  BILL_ALREADY_CANCELLED: "the bill was already cancelled",
  BILL_ALREADY_RESTORED: "the bill was already restored or was never cancelled",
  CUSTOMER_MOBILE_DUPLICATE: "a customer with this mobile number already exists",
  PAYMENT_EXCEEDS_DUE: "the payment is more than the amount due",
  PAYMENT_ALREADY_REVERSED: "the payment was already reversed",
  UDHAR_ADJUSTMENT_NEGATIVE_BALANCE: "it would make the customer's balance negative",
  NOT_FOUND: "a record it refers to no longer exists",
  CONFLICT: "it was changed on another device first",
  PERMISSION_DENIED: "this device doesn't have permission for it",
  INVALID_EVENT: "the data did not pass validation",
  SYNC_DEPENDENCY_PENDING: "it depends on an earlier change that hasn't synced yet",
  SYNC_EVENT_IN_PROGRESS: "it is still being processed",
  DEVICE_NOT_FOUND: "this device is not registered",
  DEVICE_REQUIRED: "a registered device is required",
  SERVER_ERROR: "of a temporary server problem",
  // 4xx business rules. These reached the owner as "a temporary server problem"
  // until classifySyncError stopped treating every non-[400/404/409] status as a
  // 5xx — each one names something only the owner can fix, so say what it is.
  SUBSCRIPTION_REQUIRED: "this store's subscription is not active",
  BUSINESS_RULE_FAILED: "it breaks a business rule",
  SELLER_GSTIN_REQUIRED: "this location needs a GSTIN before it can issue a GST invoice",
  OFFER_REFERENCE_REQUIRED: "the coupon discount is missing its offer reference",
  OFFER_DISCOUNT_CHANGED: "the coupon value changed — reapply the coupon",
  OFFER_DISCOUNT_MISMATCH: "the bill discount is lower than the validated coupon value",
  PACKAGING_MODE_STOCK_MIGRATION_REQUIRED: "the product still has stock; count it to zero before changing pack-level tracking",
};

// The stored OfflineSyncEvent.error is just a string (no statusCode), so we also
// pattern-match the message to recover the friendly code the classifier would have
// produced when the original error still carried its HTTP status.
function codeFromMessage(message) {
  const m = String(message ?? "").toLowerCase();
  if (!m) return null;
  if (m.includes("insufficient stock") || m.includes("not enough stock")) return "STOCK_INSUFFICIENT";
  if (m.includes("already cancelled")) return "BILL_ALREADY_CANCELLED";
  if (m.includes("already restored") || m.includes("not cancelled")) return "BILL_ALREADY_RESTORED";
  if (m.includes("mobile already exists") || m.includes("customer with this mobile")) return "CUSTOMER_MOBILE_DUPLICATE";
  if (m.includes("product deleted") || m.includes("product is deleted")) return "PRODUCT_DELETED";
  if (m.includes("product not found") || m.includes("invalid product")) return "INVALID_PRODUCT_ID";
  if (m.includes("already reversed")) return "PAYMENT_ALREADY_REVERSED";
  if (m.includes("exceeds") && m.includes("due")) return "PAYMENT_EXCEEDS_DUE";
  if (m.includes("negative balance")) return "UDHAR_ADJUSTMENT_NEGATIVE_BALANCE";
  if (m.includes("depends on") || m.includes("dependency")) return "SYNC_DEPENDENCY_PENDING";
  if (m.includes("permission") || m.includes("forbidden") || m.includes("not allowed")) return "PERMISSION_DENIED";
  if (m.includes("count stock to zero") && m.includes("pack-level inventory")) return "PACKAGING_MODE_STOCK_MIGRATION_REQUIRED";
  if (m.includes("no longer exists") || m.includes("not found")) return "NOT_FOUND";
  return null;
}

const RETRYABLE_CODES = new Set(["SYNC_DEPENDENCY_PENDING", "SYNC_EVENT_IN_PROGRESS", "SERVER_ERROR"]);

function truncate(value, max) {
  const s = String(value ?? "");
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function shortId(id) {
  const s = String(id ?? "");
  return s.length > 12 ? `${s.slice(0, 8)}…` : s;
}

function safeParse(json) {
  if (!json || typeof json !== "string") return {};
  try {
    return JSON.parse(json) ?? {};
  } catch {
    return {};
  }
}

// Best-effort human reference to the affected record, e.g. `Product "Doodh"` or
// `Bill EST-12`, pulled from the (already PII-stripped) request/local snapshot.
function entityRef(type, json) {
  const payload = safeParse(json);
  const p = payload?.payload ?? payload ?? {};
  const nested = p.product ?? p.customer ?? p.bill ?? p.supplier ?? {};
  const upper = String(type ?? "").toUpperCase();

  if (/PRODUCT|STOCK|DAMAGE|INVENTORY/.test(upper)) {
    const name = nested.name ?? p.productName;
    const id = p.productId ?? p.localProductId ?? nested.id ?? nested.localId;
    if (name) return `Product "${truncate(name, 40)}"`;
    if (id) return `Product ${shortId(id)}`;
  }
  if (/CUSTOMER|UDHAR/.test(upper)) {
    const name = nested.name ?? p.customerName;
    if (name) return `Customer "${truncate(name, 40)}"`;
  }
  if (/BILL|RETURN/.test(upper)) {
    const number = p.billNumber ?? p.bill_number ?? nested.billNumber ?? nested.bill_number;
    if (number) return `Bill ${truncate(number, 24)}`;
  }
  if (/SUPPLIER/.test(upper)) {
    const name = nested.name ?? p.supplierName;
    if (name) return `Supplier "${truncate(name, 40)}"`;
  }
  return null;
}

/**
 * explainSyncFailure — accepts either a failed OfflineSyncEvent
 * ({ type, error, requestJson, statusCode? }) or a SyncConflict
 * ({ entityType, reasonCode, message, localSnapshotJson }) and returns a
 * plain-language explanation, the resolved code, and a retry hint.
 */
export function explainSyncFailure(input = {}) {
  const rawMessage = input.error ?? input.message ?? "";
  // Resolve a code. Priority: explicit conflict reasonCode > friendly message
  // patterns > the classifier (which needs a statusCode we usually don't have once
  // only the stored error string survives).
  const messageCode = codeFromMessage(rawMessage);
  const classified = classifySyncError({ message: rawMessage, statusCode: input.statusCode, code: input.code });
  const code = input.reasonCode ?? input.code ?? messageCode ?? classified.code;

  const retryable = input.reasonCode ? false : RETRYABLE_CODES.has(code);

  const knownCause = CAUSE_BY_CODE[code];
  const cause = knownCause
    ? knownCause
    : (rawMessage ? `of an error: ${truncate(rawMessage, 160)}` : "of an unexpected error");

  const typeForLabel = input.type ?? input.entityType;
  const operation = operationLabel(typeForLabel);
  const ref = entityRef(typeForLabel, input.requestJson ?? input.localSnapshotJson);
  const explanation = ref
    ? `${operation} failed because ${cause} (${ref}).`
    : `${operation} failed because ${cause}.`;

  return {
    code,
    explanation,
    retryable,
    action: retryable
      ? "This will retry automatically when the connection is healthy."
      : "This needs attention — fix the cause, then make the change again.",
  };
}

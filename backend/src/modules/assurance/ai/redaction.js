// Redaction layer — runs on EVERY payload before it can leave the process.
//
// The deterministic engine needs amounts, rule codes and comparisons to explain
// itself; it never needs to know who the customer is. This module strips or
// masks identity while keeping the audit facts intact. Nothing here is
// optional: audit-ai.service.js redacts before any provider call, including the
// mock provider, so tests exercise the same path as production.

const PHONE_PATTERN = /(?:\+?91[\-\s]?)?\b[6-9]\d{9}\b/g;
const GSTIN_PATTERN = /\b\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}\b/gi;
const UPI_ID_PATTERN = /\b[\w.\-]{2,}@[a-z]{2,}\b/gi;
const ACCOUNT_PATTERN = /\b\d{9,18}\b/g;
const TOKEN_PATTERN = /\b(?:eyJ[\w-]+\.[\w-]+\.[\w-]+|sk-[A-Za-z0-9]{16,}|Bearer\s+[A-Za-z0-9._-]{16,})/gi;
const EMAIL_PATTERN = /\b[\w.+-]+@[\w-]+\.[\w.]{2,}\b/gi;

// Keys whose values are identity, not audit facts. Dropped entirely.
const DROP_KEYS = new Set([
  "customername",
  "buyeraddress",
  "address",
  "mobile",
  "phone",
  "email",
  "buyergstin",
  "gstnumber",
  "gstin",
  "providerreference",
  "upiid",
  "accountnumber",
  "ifsc",
  "password",
  "passwordhash",
  "pinhash",
  "token",
  "authorization",
  "apikey",
  "secret",
  "referencevalue",
  "storagekey",
  "originalfilename",
]);

// Keys that identify a record but not a person. Replaced with a stable
// pseudonym so the model can refer to them without receiving real ids.
const PSEUDONYMIZE_KEYS = new Set([
  "customerid",
  "supplierid",
  "userid",
  "createdbyuserid",
  "assignedreviewerid",
  "reviewerid",
  "deviceid",
  "sourcedeviceid",
  "shopid",
  "billid",
  "productid",
  "findingid",
  "entityid",
  "sourceentityid",
  "evidenceid",
  "movementid",
  "ledgerid",
  "paymentid",
  "expenseid",
  "requirementid",
  "billitemid",
  "closingsnapshotid",
  "evaluationid",
  "runid",
  "auditrunid",
]);

export function maskText(value) {
  if (typeof value !== "string") return value;
  return value
    .replace(TOKEN_PATTERN, "[redacted-token]")
    .replace(EMAIL_PATTERN, "[redacted-email]")
    .replace(GSTIN_PATTERN, "[redacted-gstin]")
    .replace(PHONE_PATTERN, "[redacted-phone]")
    .replace(UPI_ID_PATTERN, "[redacted-upi]")
    .replace(ACCOUNT_PATTERN, (match) => `[redacted-number:${match.length}digits]`);
}

/**
 * Deterministic per-call pseudonyms: the same id maps to the same label inside
 * one payload, and never leaves the process in raw form.
 */
function createPseudonymizer() {
  const assigned = new Map();
  const counters = new Map();
  return (key, value) => {
    if (typeof value !== "string" || !value) return value;
    if (assigned.has(value)) return assigned.get(value);
    const kind = key.replace(/id$/i, "").toUpperCase() || "ENTITY";
    const next = (counters.get(kind) ?? 0) + 1;
    counters.set(kind, next);
    const label = `${kind}_${next}`;
    assigned.set(value, label);
    return label;
  };
}

/**
 * Redact an arbitrary structure. Returns { payload, report } where report lists
 * what was removed so the behaviour is testable and auditable.
 */
export function redactForExternalAi(input, { allowAttachments = false } = {}) {
  const pseudonymize = createPseudonymizer();
  const report = { droppedKeys: [], pseudonymizedKeys: [], maskedStrings: 0, attachmentsAllowed: allowAttachments };

  const walk = (value, keyPath = "") => {
    if (value === null || value === undefined) return value;
    if (Array.isArray(value)) return value.map((item, index) => walk(item, `${keyPath}[${index}]`));
    if (typeof value === "bigint") return Number(value);
    if (typeof value === "object") {
      const output = {};
      for (const [key, raw] of Object.entries(value)) {
        const normalized = key.toLowerCase();
        if (DROP_KEYS.has(normalized)) {
          report.droppedKeys.push(key);
          continue;
        }
        if (!allowAttachments && (normalized === "filebase64" || normalized === "attachment" || normalized === "filebytes")) {
          report.droppedKeys.push(key);
          continue;
        }
        if (PSEUDONYMIZE_KEYS.has(normalized)) {
          report.pseudonymizedKeys.push(key);
          output[key] = pseudonymize(key, raw);
          continue;
        }
        output[key] = walk(raw, key);
      }
      return output;
    }
    if (typeof value === "string") {
      const masked = maskText(value);
      if (masked !== value) report.maskedStrings += 1;
      return masked;
    }
    return value;
  };

  return { payload: walk(input), report };
}

/** Cheap guard used in tests and before dispatch: does a payload still look identifying? */
export function containsLikelyPii(value) {
  const serialized = typeof value === "string" ? value : JSON.stringify(value ?? "", (_key, raw) => (typeof raw === "bigint" ? Number(raw) : raw));
  return (
    PHONE_PATTERN.test(serialized) ||
    GSTIN_PATTERN.test(serialized) ||
    TOKEN_PATTERN.test(serialized) ||
    EMAIL_PATTERN.test(serialized)
  );
}

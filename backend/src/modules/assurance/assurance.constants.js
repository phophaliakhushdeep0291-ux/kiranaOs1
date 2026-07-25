// Financial Assurance Engine — shared constants.
// The engine is strictly read-only toward canonical financial records: it may
// only ever write to the Audit* tables. Bump ENGINE_VERSION when scoring or
// evaluation semantics change so historical findings stay traceable.

export const ENGINE_VERSION = "assurance-engine-1.0.0";

export const RUN_TYPES = Object.freeze({
  TRANSACTION_TRIGGERED: "TRANSACTION_TRIGGERED",
  SCHEDULED: "SCHEDULED",
  MANUAL: "MANUAL",
});

export const RUN_STATUS = Object.freeze({
  RUNNING: "RUNNING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  PARTIAL: "PARTIAL",
});

// Entity types the evaluator can audit. sourceEntityId meaning per type:
//   BILL → Bill.id            CUSTOMER → Customer.id     PRODUCT → Product.id
//   PURCHASE → PurchaseReceipt.id or PurchaseHistory.id (quick purchase)
//   EXPENSE → Expense.id      DAILY_CLOSING → DailyClosingSnapshot.id
//   SYNC_EVENT → OfflineSyncEvent.id
export const ENTITY_TYPES = Object.freeze({
  BILL: "BILL",
  CUSTOMER: "CUSTOMER",
  PRODUCT: "PRODUCT",
  PURCHASE: "PURCHASE",
  EXPENSE: "EXPENSE",
  DAILY_CLOSING: "DAILY_CLOSING",
  SYNC_EVENT: "SYNC_EVENT",
});

export const EVENT_TYPES = Object.freeze({
  SALE_CREATED: "SALE_CREATED",
  SALE_CANCELLED: "SALE_CANCELLED",
  SALE_RETURNED: "SALE_RETURNED",
  PAYMENT_RECEIVED: "PAYMENT_RECEIVED",
  CUSTOMER_CREDIT_CREATED: "CUSTOMER_CREDIT_CREATED",
  CUSTOMER_CREDIT_ADJUSTED: "CUSTOMER_CREDIT_ADJUSTED",
  PURCHASE_CREATED: "PURCHASE_CREATED",
  PURCHASE_PAYMENT_CREATED: "PURCHASE_PAYMENT_CREATED",
  PURCHASE_RETURNED: "PURCHASE_RETURNED",
  EXPENSE_CREATED: "EXPENSE_CREATED",
  STOCK_INCREASED: "STOCK_INCREASED",
  STOCK_DECREASED: "STOCK_DECREASED",
  STOCK_CORRECTED: "STOCK_CORRECTED",
  DISCOUNT_APPLIED: "DISCOUNT_APPLIED",
  DAILY_CLOSING_COMPLETED: "DAILY_CLOSING_COMPLETED",
  RECORD_EDITED: "RECORD_EDITED",
  OFFLINE_EVENT_SYNCED: "OFFLINE_EVENT_SYNCED",
  SYNC_CONFLICT_DETECTED: "SYNC_CONFLICT_DETECTED",
});

export const RULE_CATEGORIES = Object.freeze({
  BILLING: "BILLING",
  RECONCILIATION: "RECONCILIATION",
  CUSTOMER_CREDIT: "CUSTOMER_CREDIT",
  INVENTORY: "INVENTORY",
  PURCHASE: "PURCHASE",
  EXPENSE: "EXPENSE",
  CASH_CLOSING: "CASH_CLOSING",
  SYNC_INTEGRITY: "SYNC_INTEGRITY",
  AUTHORIZATION: "AUTHORIZATION",
});

export const SEVERITY = Object.freeze({
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
  CRITICAL: "CRITICAL",
});

// Multiplier applied to a rule's defaultWeight when it triggers. The full
// breakdown is persisted, never inferred.
export const SEVERITY_MULTIPLIER = Object.freeze({
  LOW: 0.5,
  MEDIUM: 1,
  HIGH: 1.5,
  CRITICAL: 2,
});

// A single rule can contribute at most this many points so one noisy rule
// cannot saturate the score on its own.
export const MAX_RULE_CONTRIBUTION = 60;

export const RISK_LEVELS = Object.freeze({
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
  CRITICAL: "CRITICAL",
});

// Final score → level thresholds (documented in docs/AUDIT_RISK_SCORING.md).
export const RISK_LEVEL_THRESHOLDS = Object.freeze([
  { level: RISK_LEVELS.CRITICAL, min: 80 },
  { level: RISK_LEVELS.HIGH, min: 55 },
  { level: RISK_LEVELS.MEDIUM, min: 30 },
  { level: RISK_LEVELS.LOW, min: 0 },
]);

export const FINDING_STATUS = Object.freeze({
  OPEN: "OPEN",
  EVIDENCE_REQUESTED: "EVIDENCE_REQUESTED",
  UNDER_REVIEW: "UNDER_REVIEW",
  CONFIRMED_ISSUE: "CONFIRMED_ISSUE",
  FALSE_POSITIVE: "FALSE_POSITIVE",
  CORRECTED: "CORRECTED",
  ACCEPTED_RISK: "ACCEPTED_RISK",
  CLOSED: "CLOSED",
});

// Legal lifecycle transitions. Findings are never deleted; terminal statuses
// can only move to CLOSED (bookkeeping) — anything else needs a reopen, which
// the evaluator performs with full history when a new rule signature fires.
export const FINDING_STATUS_TRANSITIONS = Object.freeze({
  OPEN: ["EVIDENCE_REQUESTED", "UNDER_REVIEW", "CONFIRMED_ISSUE", "FALSE_POSITIVE", "CORRECTED", "ACCEPTED_RISK", "CLOSED"],
  EVIDENCE_REQUESTED: ["UNDER_REVIEW", "OPEN", "CONFIRMED_ISSUE", "FALSE_POSITIVE", "CORRECTED", "ACCEPTED_RISK"],
  UNDER_REVIEW: ["CONFIRMED_ISSUE", "FALSE_POSITIVE", "CORRECTED", "ACCEPTED_RISK", "EVIDENCE_REQUESTED", "OPEN"],
  CONFIRMED_ISSUE: ["CORRECTED", "ACCEPTED_RISK", "CLOSED", "UNDER_REVIEW"],
  FALSE_POSITIVE: ["CLOSED", "UNDER_REVIEW"],
  CORRECTED: ["CLOSED", "UNDER_REVIEW"],
  ACCEPTED_RISK: ["CLOSED", "UNDER_REVIEW"],
  CLOSED: ["UNDER_REVIEW"],
});

// Statuses in which a re-evaluation may refresh the finding's rules and score.
export const ACTIVE_FINDING_STATUSES = Object.freeze([
  FINDING_STATUS.OPEN,
  FINDING_STATUS.EVIDENCE_REQUESTED,
  FINDING_STATUS.UNDER_REVIEW,
]);

// Resolutions that must NOT be reopened by the same rule signature — the
// reviewer explicitly judged this exact signal.
export const SUPPRESSING_STATUSES = Object.freeze([
  FINDING_STATUS.FALSE_POSITIVE,
  FINDING_STATUS.ACCEPTED_RISK,
]);

export const EVIDENCE_TYPES = Object.freeze({
  SALES_INVOICE: "SALES_INVOICE",
  PURCHASE_INVOICE: "PURCHASE_INVOICE",
  PAYMENT_RECEIPT: "PAYMENT_RECEIPT",
  UPI_REFERENCE: "UPI_REFERENCE",
  BANK_TRANSACTION: "BANK_TRANSACTION",
  SUPPLIER_INVOICE_NUMBER: "SUPPLIER_INVOICE_NUMBER",
  GOODS_RECEIPT_CONFIRMATION: "GOODS_RECEIPT_CONFIRMATION",
  CUSTOMER_CONFIRMATION: "CUSTOMER_CONFIRMATION",
  STOCK_COUNT_CONFIRMATION: "STOCK_COUNT_CONFIRMATION",
  EXPENSE_RECEIPT: "EXPENSE_RECEIPT",
  STAFF_EXPLANATION: "STAFF_EXPLANATION",
  OWNER_APPROVAL: "OWNER_APPROVAL",
  CANCELLATION_REASON: "CANCELLATION_REASON",
  CORRECTION_REASON: "CORRECTION_REASON",
  DEVICE_TIMESTAMP_METADATA: "DEVICE_TIMESTAMP_METADATA",
});

export const EVIDENCE_STATUS = Object.freeze({
  REQUESTED: "REQUESTED",
  PROVIDED: "PROVIDED",
  VERIFIED: "VERIFIED",
  REJECTED: "REJECTED",
  INSUFFICIENT: "INSUFFICIENT",
  NOT_APPLICABLE: "NOT_APPLICABLE",
});

export const BASELINE_STATUS = Object.freeze({
  OK: "OK",
  INSUFFICIENT_DATA: "INSUFFICIENT_DATA",
});

export const BASELINE_MINIMUM_SAMPLES = 30;

// Money comparisons tolerate one paisa of Float rounding drift.
export const MONEY_EPSILON = 0.011;

export function riskLevelForScore(score) {
  for (const { level, min } of RISK_LEVEL_THRESHOLDS) {
    if (score >= min) return level;
  }
  return RISK_LEVELS.LOW;
}

export function dedupeKeyFor(entityType, entityId) {
  return `${entityType}:${entityId}`;
}

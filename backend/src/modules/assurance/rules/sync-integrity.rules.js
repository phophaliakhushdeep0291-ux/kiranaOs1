// G. SYNC AND DATA-INTEGRITY RULES.
//
// Two groups live here:
//   * SYNC_EVENT-scoped rules over OfflineSyncEvent / SyncConflict
//   * cross-cutting integrity rules that are only visible on the entity that
//     owns the child rows (orphaned payments, missing children, cross-shop
//     references, missing audit trail)
import {
  ENTITY_TYPES,
  EVENT_TYPES,
  EVIDENCE_TYPES,
  RULE_CATEGORIES,
  SEVERITY,
} from "../assurance.constants.js";
import { defineRule, money, passed, triggered } from "../rule.interface.js";

const SYNC_EVENT = [ENTITY_TYPES.SYNC_EVENT];
const BILL = [ENTITY_TYPES.BILL];

export const syncIntegrityRules = [
  defineRule({
    ruleCode: "SYNC_DUPLICATE_OFFLINE_EVENT",
    name: "Duplicate offline sync event",
    description: "The same offline operation was submitted more than once — either under a repeated event id, or re-queued under a fresh event id with an identical request payload.",
    category: RULE_CATEGORIES.SYNC_INTEGRITY,
    severity: SEVERITY.HIGH,
    defaultWeight: 28,
    version: 1,
    applicableEntityTypes: SYNC_EVENT,
    applicableEventTypes: [EVENT_TYPES.OFFLINE_EVENT_SYNCED],
    evidenceTypes: [EVIDENCE_TYPES.DEVICE_TIMESTAMP_METADATA],
    remediation: "Verify the underlying transaction exists exactly once. Idempotency keys should have collapsed the retry.",
    evaluate(ctx) {
      const sameId = ctx.sameEventId ?? [];
      const samePayload = ctx.sameRequestPayload ?? [];
      if (!sameId.length && !samePayload.length) return passed;
      return triggered({
        eventId: ctx.syncEvent.eventId,
        type: ctx.syncEvent.type,
        // `same_event_id` means the uniqueness guard was bypassed; `same_payload`
        // means the client re-queued the same operation under a new id.
        duplicateKind: sameId.length ? "same_event_id" : "same_request_payload",
        duplicateRowIds: [...sameId, ...samePayload].map((row) => row.id),
        duplicateCount: sameId.length + samePayload.length,
        statuses: [...new Set([ctx.syncEvent.status, ...sameId.map((r) => r.status), ...samePayload.map((r) => r.status)])],
      });
    },
  }),

  defineRule({
    ruleCode: "SYNC_FAILED_EVENT_MARKED_SUCCESS",
    name: "Sync event marked synced but carries an error",
    description: "The event's status says it synced successfully while an error message is still recorded against it.",
    category: RULE_CATEGORIES.SYNC_INTEGRITY,
    severity: SEVERITY.HIGH,
    defaultWeight: 28,
    version: 1,
    applicableEntityTypes: SYNC_EVENT,
    applicableEventTypes: [EVENT_TYPES.OFFLINE_EVENT_SYNCED],
    evidenceTypes: [EVIDENCE_TYPES.DEVICE_TIMESTAMP_METADATA, EVIDENCE_TYPES.STAFF_EXPLANATION],
    remediation: "Confirm whether the transaction actually landed. A success flag over an error is how silent data loss happens.",
    evaluate(ctx) {
      const { syncEvent } = ctx;
      if (syncEvent.status !== "synced") return passed;
      const error = syncEvent.error && String(syncEvent.error).trim();
      if (!error) return passed;
      return triggered({
        eventId: syncEvent.eventId,
        status: syncEvent.status,
        attempts: syncEvent.attempts,
        errorPresent: true,
        errorPreview: error.slice(0, 200),
      });
    },
  }),

  defineRule({
    ruleCode: "SYNC_EVENT_STUCK_PROCESSING",
    name: "Sync event stuck mid-processing",
    description: "The event is still marked processing after several attempts, so a financial operation may have been applied only partially.",
    category: RULE_CATEGORIES.SYNC_INTEGRITY,
    severity: SEVERITY.HIGH,
    defaultWeight: 26,
    version: 1,
    applicableEntityTypes: SYNC_EVENT,
    applicableEventTypes: [EVENT_TYPES.OFFLINE_EVENT_SYNCED],
    evidenceTypes: [EVIDENCE_TYPES.DEVICE_TIMESTAMP_METADATA],
    remediation: "Check whether the bill, payment and ledger rows for this operation all exist. Replay or repair through the sync tools.",
    evaluate(ctx) {
      const { syncEvent } = ctx;
      const isUnfinished = syncEvent.status === "processing" || syncEvent.status === "failed";
      if (!isUnfinished) return passed;
      if (Number(syncEvent.attempts ?? 0) < 3) return passed;
      return triggered({
        eventId: syncEvent.eventId,
        status: syncEvent.status,
        attempts: syncEvent.attempts,
        type: syncEvent.type,
        firstSeenAt: new Date(syncEvent.createdAt).toISOString(),
        lastUpdatedAt: new Date(syncEvent.updatedAt).toISOString(),
      });
    },
  }),

  defineRule({
    ruleCode: "SYNC_SYNCED_WITHOUT_RESULT",
    name: "Sync event reported success with no result recorded",
    description: "The event is marked synced but stores no result payload, so what the server actually applied cannot be verified.",
    category: RULE_CATEGORIES.SYNC_INTEGRITY,
    severity: SEVERITY.MEDIUM,
    defaultWeight: 16,
    version: 1,
    applicableEntityTypes: SYNC_EVENT,
    applicableEventTypes: [EVENT_TYPES.OFFLINE_EVENT_SYNCED],
    evidenceTypes: [EVIDENCE_TYPES.DEVICE_TIMESTAMP_METADATA],
    remediation: "Confirm the target record exists. Result payloads are what make an offline replay auditable.",
    evaluate(ctx) {
      const { syncEvent } = ctx;
      if (syncEvent.status !== "synced") return passed;
      const result = syncEvent.resultJson && String(syncEvent.resultJson).trim();
      if (result && result !== "{}" && result !== "null") return passed;
      return triggered({ eventId: syncEvent.eventId, type: syncEvent.type, resultRecorded: false });
    },
  }),

  defineRule({
    ruleCode: "SYNC_CONFLICT_UNRESOLVED",
    name: "Unresolved sync conflict",
    description: "A cross-device conflict was detected for this event and is still open, so two devices disagree about a financial record.",
    category: RULE_CATEGORIES.SYNC_INTEGRITY,
    severity: SEVERITY.HIGH,
    defaultWeight: 28,
    version: 1,
    applicableEntityTypes: SYNC_EVENT,
    applicableEventTypes: [EVENT_TYPES.SYNC_CONFLICT_DETECTED],
    evidenceTypes: [EVIDENCE_TYPES.DEVICE_TIMESTAMP_METADATA, EVIDENCE_TYPES.OWNER_APPROVAL],
    remediation: "Resolve the conflict in the sync screen and record which version is correct.",
    evaluate(ctx) {
      const open = (ctx.conflicts ?? []).filter((conflict) => conflict.status === "open");
      if (!open.length) return passed;
      return triggered({
        eventId: ctx.syncEvent.eventId,
        openConflicts: open.slice(0, 10).map((conflict) => ({
          conflictId: conflict.id,
          entityType: conflict.entityType,
          entityId: conflict.entityId,
          reasonCode: conflict.reasonCode,
          deviceId: conflict.deviceId,
          detectedAt: new Date(conflict.detectedAt).toISOString(),
        })),
        openConflictCount: open.length,
        distinctDevices: [...new Set(open.map((c) => c.deviceId).filter(Boolean))].length,
      });
    },
  }),

  // ── cross-cutting integrity rules on the BILL entity ──
  defineRule({
    ruleCode: "BILL_CROSS_SHOP_REFERENCE",
    name: "Bill references an entity from another shop",
    description: "The bill's customer or one of its products belongs to a different shop, which would break tenant isolation.",
    category: RULE_CATEGORIES.SYNC_INTEGRITY,
    severity: SEVERITY.CRITICAL,
    defaultWeight: 45,
    // Tenant isolation does not depend on the amount: a ₹50 cross-shop reference
    // is as serious as a ₹50,000 one, so this rule declares a CRITICAL floor.
    minimumRiskScore: 85,
    version: 1,
    applicableEntityTypes: BILL,
    applicableEventTypes: [EVENT_TYPES.SALE_CREATED, EVENT_TYPES.OFFLINE_EVENT_SYNCED],
    evidenceTypes: [EVIDENCE_TYPES.STAFF_EXPLANATION, EVIDENCE_TYPES.DEVICE_TIMESTAMP_METADATA],
    remediation: "Escalate immediately: a cross-tenant reference is a data-isolation defect, not a bookkeeping mistake.",
    evaluate(ctx) {
      const violations = [];
      if (ctx.customer && ctx.customer.shopId !== ctx.shopId) {
        violations.push({ reference: "customer", referencedId: ctx.customer.id, belongsToOtherShop: true });
      }
      for (const item of ctx.bill.items ?? []) {
        if (!item.productId) continue;
        const product = ctx.products?.get(item.productId);
        if (!product) {
          violations.push({ reference: "product", referencedId: item.productId, resolvable: false });
          continue;
        }
        if (product.shopId !== ctx.shopId) {
          violations.push({ reference: "product", referencedId: item.productId, belongsToOtherShop: true });
        }
      }
      if (!violations.length) return passed;
      // Never leak the other tenant's shopId or names into the finding.
      return triggered({ violations: violations.slice(0, 20), violationCount: violations.length });
    },
  }),

  defineRule({
    ruleCode: "BILL_ORPHANED_PAYMENT_SCOPE",
    name: "Payment row has a wrong or missing shop scope",
    description: "A payment attached to this bill carries no shopId, or one that differs from the bill's shop.",
    category: RULE_CATEGORIES.SYNC_INTEGRITY,
    severity: SEVERITY.HIGH,
    defaultWeight: 26,
    version: 1,
    applicableEntityTypes: BILL,
    applicableEventTypes: [EVENT_TYPES.PAYMENT_RECEIVED],
    evidenceTypes: [EVIDENCE_TYPES.PAYMENT_RECEIPT],
    remediation: "Backfill the payment's shop scope. Payments are shop-scoped through their bill, so unscoped rows escape shop-level queries.",
    evaluate(ctx) {
      const offenders = (ctx.bill.payments ?? [])
        .filter((payment) => !payment.shopId || payment.shopId !== ctx.shopId)
        .map((payment) => ({
          paymentId: payment.id,
          mode: payment.mode,
          amountRupees: money(payment.amount),
          shopScope: payment.shopId ? "mismatched" : "missing",
        }));
      if (!offenders.length) return passed;
      return triggered({ unscopedPayments: offenders.slice(0, 20), offenderCount: offenders.length });
    },
  }),

  defineRule({
    ruleCode: "BILL_MISSING_CHILD_ROWS",
    name: "Bill has no line items",
    description: "The bill carries a value but has no line items, so it is a partial financial record.",
    category: RULE_CATEGORIES.SYNC_INTEGRITY,
    severity: SEVERITY.HIGH,
    defaultWeight: 30,
    version: 1,
    applicableEntityTypes: BILL,
    applicableEventTypes: [EVENT_TYPES.SALE_CREATED, EVENT_TYPES.OFFLINE_EVENT_SYNCED],
    evidenceTypes: [EVIDENCE_TYPES.SALES_INVOICE],
    remediation: "Establish what was sold. A valued bill with no items usually means a sync applied only part of the operation.",
    evaluate(ctx) {
      const itemCount = (ctx.bill.items ?? []).length;
      if (itemCount > 0) return passed;
      if (Math.abs(money(ctx.bill.grandTotal)) <= 0.011) return passed;
      return triggered({
        itemCount: 0,
        grandTotalRupees: money(ctx.bill.grandTotal),
        paymentRowCount: (ctx.bill.payments ?? []).length,
      });
    },
  }),

  defineRule({
    ruleCode: "BILL_CANCELLED_WITHOUT_AUDIT_LOG",
    name: "Bill cancelled without an audit-log entry",
    description: "The bill is cancelled but no BILL_CANCELLED audit-log row exists, so who cancelled it is not recorded.",
    category: RULE_CATEGORIES.SYNC_INTEGRITY,
    severity: SEVERITY.MEDIUM,
    defaultWeight: 20,
    version: 1,
    applicableEntityTypes: BILL,
    applicableEventTypes: [EVENT_TYPES.SALE_CANCELLED],
    evidenceTypes: [EVIDENCE_TYPES.CANCELLATION_REASON, EVIDENCE_TYPES.STAFF_EXPLANATION],
    remediation: "Ask who cancelled the bill and why. Offline-replayed cancellations legitimately arrive without a log — record the explanation.",
    evaluate(ctx) {
      const { bill } = ctx;
      if (bill.status !== "cancelled") return passed;
      const hasLog = (ctx.auditLogs ?? []).some((log) => log.action === "BILL_CANCELLED");
      if (hasLog) return passed;
      return triggered({
        cancelledAt: bill.cancelledAt ? new Date(bill.cancelledAt).toISOString() : null,
        cancelledReason: bill.cancelledReason ?? null,
        auditLogCount: (ctx.auditLogs ?? []).length,
      });
    },
  }),
];

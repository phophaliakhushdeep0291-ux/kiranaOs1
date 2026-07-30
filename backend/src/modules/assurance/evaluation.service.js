// The deterministic evaluation engine (Layers 1–3 orchestration).
//
// Safety contract: this service reads canonical financial tables and writes
// ONLY Audit* tables. It never opens a transaction that includes a canonical
// write, and every entry point is safe to call again — evaluations are unique
// per (run, entity) and findings are unique per (shop, entity).
import crypto from "node:crypto";
import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { baseQtyToRateQty } from "../../utils/units.js";
import {
  ACTIVE_FINDING_STATUSES,
  ENGINE_VERSION,
  ENTITY_TYPES,
  FINDING_STATUS,
  RUN_STATUS,
  RUN_TYPES,
  SUPPRESSING_STATUSES,
  dedupeKeyFor,
} from "./assurance.constants.js";
import { AuditContextError, buildContext } from "./context.service.js";
import { RULESET_VERSION, rulesForEntityType } from "./rules/index.js";
import { scoreFinding } from "./risk-scoring.service.js";

const MAX_RANGE_ENTITIES = 2000;

/**
 * Normalized canonical audit events (Layer 1). Events are derived at
 * evaluation time and stored inside the evaluation result rather than in a
 * separate event store, so canonical financial data is never duplicated.
 */
export function materializeEvents(ctx) {
  const base = {
    shopId: ctx.shopId,
    sourceEntityType: ctx.entityType,
    sourceEntityId: ctx.entityId,
    currency: "INR",
  };
  const meta = entityMetadata(ctx);
  return (ctx.events ?? []).map((eventType) => ({
    ...base,
    eventId: crypto
      .createHash("sha256")
      .update(`${ctx.shopId}:${ctx.entityType}:${ctx.entityId}:${eventType}`)
      .digest("hex")
      .slice(0, 32),
    eventType,
    occurredAt: meta.occurredAt,
    recordedAt: meta.recordedAt,
    createdByUserId: meta.createdByUserId,
    deviceId: meta.deviceId,
    amountPaise: meta.amountPaise,
    metadata: meta.metadata,
    sourceVersion: 1,
  }));
}

function entityMetadata(ctx) {
  const iso = (value) => (value ? new Date(value).toISOString() : null);
  switch (ctx.entityType) {
    case ENTITY_TYPES.BILL:
      return {
        occurredAt: iso(ctx.bill.createdAt),
        recordedAt: iso(ctx.bill.createdAt),
        createdByUserId: ctx.bill.createdByUserId ?? null,
        deviceId: ctx.bill.deviceId ?? ctx.bill.sourceDeviceId ?? null,
        amountPaise: toPaise(ctx.bill.grandTotal),
        metadata: { billNo: ctx.bill.billNo, billType: ctx.bill.billType, status: ctx.bill.status },
      };
    case ENTITY_TYPES.CUSTOMER:
      return {
        occurredAt: iso(ctx.customer.updatedAt),
        recordedAt: iso(ctx.customer.updatedAt),
        createdByUserId: null,
        deviceId: null,
        amountPaise: toPaise(ctx.customer.udharAmount),
        metadata: { ledgerRows: (ctx.ledger ?? []).length },
      };
    case ENTITY_TYPES.PRODUCT:
      return {
        occurredAt: iso(ctx.product.updatedAt),
        recordedAt: iso(ctx.product.updatedAt),
        createdByUserId: null,
        deviceId: ctx.product.sourceDeviceId ?? null,
        // Inventory findings are quantified in stock value at recorded cost.
        amountPaise: toPaise(Number(ctx.product.stockBaseQty ?? 0) * Number(ctx.product.costPerRateUnit ?? 0)),
        metadata: { baseUnit: ctx.product.baseUnit, movements: (ctx.movements ?? []).length },
      };
    case ENTITY_TYPES.PURCHASE: {
      const record = ctx.receipt ?? ctx.history;
      return {
        occurredAt: iso(record?.createdAt),
        recordedAt: iso(record?.createdAt),
        createdByUserId: ctx.receipt?.receivedByUserId ?? null,
        deviceId: null,
        amountPaise: toPaise(ctx.receipt?.totalAmount ?? ctx.history?.billAmount),
        metadata: { purchaseKind: ctx.purchaseKind, supplierId: record?.supplierId ?? null },
      };
    }
    case ENTITY_TYPES.EXPENSE:
      return {
        occurredAt: iso(ctx.expense.spentAt),
        recordedAt: iso(ctx.expense.createdAt),
        createdByUserId: null,
        deviceId: null,
        amountPaise: toPaise(ctx.expense.amount),
        metadata: { category: ctx.expense.category, paymentMode: ctx.expense.paymentMode },
      };
    case ENTITY_TYPES.DAILY_CLOSING:
      return {
        occurredAt: iso(ctx.snapshot.date),
        recordedAt: iso(ctx.snapshot.generatedAt),
        createdByUserId: ctx.snapshot.generatedByUserId ?? null,
        deviceId: null,
        amountPaise: Number(ctx.snapshot.totalSalesPaise ?? 0),
        metadata: { locked: Boolean(ctx.snapshot.lockedAt), source: ctx.snapshot.source },
      };
    case ENTITY_TYPES.SYNC_EVENT:
      return {
        occurredAt: iso(ctx.syncEvent.createdAt),
        recordedAt: iso(ctx.syncEvent.updatedAt),
        createdByUserId: null,
        deviceId: null,
        amountPaise: 0,
        metadata: { type: ctx.syncEvent.type, status: ctx.syncEvent.status, attempts: ctx.syncEvent.attempts },
      };
    default:
      return { occurredAt: null, recordedAt: null, createdByUserId: null, deviceId: null, amountPaise: 0, metadata: {} };
  }
}

// Magnitude, always. A sales return is stored with a negative total by design,
// and a finding that reads "₹-118" is meaningless to a shopkeeper — worse,
// summing signed amounts made dashboard totals arithmetically wrong.
function toPaise(rupees) {
  const value = Number(rupees ?? 0);
  return Number.isFinite(value) ? Math.abs(Math.round(value * 100)) : 0;
}

// ── how much money is actually in question ────────────────────
//
// `amountPaise` is the size of the record a finding is about, which is the
// right input for materiality banding but the WRONG thing to total on a
// dashboard: summing a bill total, a whole day's sales and a product's entire
// stock valuation counts the same rupee several times and can exceed a shop's
// lifetime turnover. Rules already measure the actual gap — the shortfall, the
// drift, the difference — so this lifts that number out of their details.
//
// The maximum across triggered rules is used rather than the sum: several rules
// often measure the same underlying gap from different angles, and adding them
// would inflate it again.
const DISCREPANCY_RUPEE_KEYS = [
  "shortfallRupees",
  "differenceRupees",
  "excessRupees",
  "overstatedRupees",
  "overCollectedRupees",
  "worstDifferenceRupees",
  "agedOutstandingRupees",
  "cashExpensesRupees",
  "missingCreditTotal",
  "manualDiscountRupees",
  "discountRupees",
];
const DISCREPANCY_PAISE_KEYS = ["differencePaise", "cashDifferencePaise", "salesDifferencePaise"];

// Rules whose gap is real but not expressible as a plain "differenceRupees".
// Each entry says, explicitly, what money is in question — no generic guessing.
//
// The line drawn here is between money that went MISSING and paperwork that is
// missing. A purchase that never became stock is a shortfall and belongs in the
// total; a purchase whose invoice was not filed is a control weakness, and
// folding its full value in would tell a shopkeeper that ordinary undocumented
// spend had vanished. Those rules deliberately stay unquantified — the evidence
// queue already counts them.
const DISCREPANCY_BY_RULE = {
  // Unexplained stock movement: the goods that moved without a reason, at cost.
  STOCK_DECREASE_WITHOUT_SOURCE: (d) => ({ baseQty: d.totalUnexplainedBaseQty }),
  STOCK_INCREASE_WITHOUT_SOURCE: (d) => ({ baseQty: sumBaseQty(d.unexplainedIncreases) }),
  STOCK_NEGATIVE_BALANCE: (d) => ({ baseQty: d.shortfallBaseQty }),
  STOCK_UNUSUAL_SHRINKAGE: (d) => ({ baseQty: d.shrinkageBaseQty }),
  STOCK_SALE_EXCEEDED_AVAILABLE: (d) => ({ baseQty: sumBaseQty(d.oversoldMovements, "soldBaseQty") }),
  STOCK_SOLD_WHILE_ARCHIVED: (d) => ({ baseQty: sumBaseQty(d.salesAfterArchive) }),
  STOCK_DUPLICATE_MOVEMENT: (d) => ({ baseQty: sumBaseQty(d.duplicatePairs) }),
  STOCK_LARGE_MANUAL_CORRECTION: (d) => ({ baseQty: sumBaseQty(d.corrections) }),
  // Stock a cancellation should have put back and didn't, valued at cost.
  STOCK_CANCELLED_SALE_NOT_RESTORED: (d) => ({ baseQty: sumBaseQty(d.unrestoredBills, "netBaseQty") }),
  // Same gap seen from the bill side, where each line is a different product.
  CANCELLED_BILL_STOCK_NOT_RESTORED: (d, ctx) => ({ paise: valueByProduct(d.unrestoredProducts, ctx, "netBaseQty") }),
  // Credit that never reached the khata: the part that went missing.
  UDHAR_BILL_MISSING_LEDGER_DEBIT: (d) => ({ rupees: Math.abs(Number(d.billCreditAmount ?? 0) - Number(d.ledgerDebitSum ?? 0)) }),
  // A duplicate is money charged or paid twice — the duplicate itself is at risk.
  EXPENSE_DUPLICATE: (d) => ({ rupees: d.amountRupees }),
  BILL_NEAR_DUPLICATE: (d) => ({ rupees: d.grandTotal }),
  PURCHASE_REPEATED_SAME_DAY_AMOUNT: (d) => ({ rupees: d.amountRupees }),
  PURCHASE_DUPLICATE_INVOICE_NUMBER: (d) => ({ rupees: d.amountRupees }),
  // Money left the shop but no goods arrived: the whole purchase is the gap.
  PURCHASE_WITHOUT_STOCK_RECEIPT: (d) => ({ rupees: d.amountRupees }),
  PURCHASE_PAYMENT_WITHOUT_GOODS: (d) => ({ rupees: Number(d.paidAmountRupees ?? 0) - Number(d.goodsValueRupees ?? 0) }),
  // Goods returned to the supplier that were never credited back.
  PURCHASE_RETURN_NOT_CREDITED: (d) => ({ rupees: sumRupees(d.uncreditedReturns, "totalAmountRupees") }),
  // Purchased-vs-stocked quantity gap, valued at the purchase's own cost basis.
  PURCHASE_STOCK_QUANTITY_MISMATCH: (d, ctx) =>
    d.purchaseKind === "receipt"
      ? { paise: valueAtPurchaseCost(d.mismatches, ctx) }
      : { paise: valueAtPurchaseCost([{ differenceBaseQty: d.differenceBaseQty }], ctx) },
  // Only the amount above the normal range is unusual — not the whole expense.
  EXPENSE_UNUSUALLY_HIGH_FOR_CATEGORY: (d) => ({ rupees: Number(d.amountRupees ?? 0) - Number(d.upperFenceRupees ?? 0) }),
};

function sumBaseQty(rows, key = "changeBaseQty") {
  if (!Array.isArray(rows)) return 0;
  return rows.reduce((total, row) => total + Math.abs(Number(row?.[key]) || 0), 0);
}

function sumRupees(rows, key) {
  if (!Array.isArray(rows)) return 0;
  return rows.reduce((total, row) => total + Math.abs(Number(row?.[key]) || 0), 0);
}

function valueAtProductCost(baseQty, product) {
  const qty = Math.abs(Number(baseQty) || 0);
  const cost = Number(product?.costPerRateUnit ?? 0);
  if (!qty || cost <= 0) return 0;
  try {
    const rateQty = baseQtyToRateQty(qty, product.rateUnit, product.baseUnit);
    return Math.round(Math.abs(rateQty * cost) * 100);
  } catch {
    return 0; // unsupported unit pair: no figure beats a wrong figure
  }
}

function valueStockAtCost(baseQty, ctx) {
  return valueAtProductCost(baseQty, ctx.product);
}

/** Bill contexts carry a products map: value every line at its own product's cost. */
function valueByProduct(rows, ctx, key) {
  if (!Array.isArray(rows)) return 0;
  return rows.reduce((paise, row) => paise + valueAtProductCost(row?.[key], ctx.products?.get(row?.productId)), 0);
}

/**
 * A purchase states what it paid per unit, so its own lines are a better cost
 * basis than the product's running average — and need no unit conversion.
 */
function purchaseCostPerBaseUnit(ctx) {
  const totals = new Map();
  for (const item of ctx.receipt?.items ?? []) {
    const qty = Math.abs(Number(item.quantityBaseQty) || 0);
    const amount = Math.abs(Number(item.lineAmount) || 0);
    if (!qty || !amount) continue;
    const prev = totals.get(item.productId) ?? { qty: 0, amount: 0 };
    totals.set(item.productId, { qty: prev.qty + qty, amount: prev.amount + amount });
  }
  if (!totals.size && ctx.history) {
    const qty = Math.abs(Number(ctx.history.qtyBase) || 0);
    const amount = Math.abs(Number(ctx.history.totalCost) || 0);
    if (qty && amount) totals.set(ctx.history.productId, { qty, amount });
  }
  const rates = new Map();
  for (const [productId, { qty, amount }] of totals) rates.set(productId, amount / qty);
  return rates;
}

function valueAtPurchaseCost(rows, ctx) {
  if (!Array.isArray(rows) || !rows.length) return 0;
  const rates = purchaseCostPerBaseUnit(ctx);
  const fallback = rates.size === 1 ? [...rates.values()][0] : 0;
  return rows.reduce((paise, row) => {
    const qty = Math.abs(Number(row?.differenceBaseQty) || 0);
    const rate = rates.get(row?.productId) ?? fallback;
    return paise + (qty && rate > 0 ? Math.round(qty * rate * 100) : 0);
  }, 0);
}

function ruleDiscrepancyPaise(rule, details, ctx) {
  if (!details || typeof details !== "object") return 0;

  const explicit = DISCREPANCY_BY_RULE[rule.ruleCode];
  if (explicit) {
    const { baseQty, rupees, paise } = explicit(details, ctx) ?? {};
    if (paise !== undefined) return Math.abs(Math.round(Number(paise) || 0));
    if (baseQty !== undefined) return valueStockAtCost(baseQty, ctx);
    if (rupees !== undefined) return Math.abs(Math.round((Number(rupees) || 0) * 100));
    return 0;
  }

  // Stock gaps are measured in base units; value them at the product's own cost.
  if (details.differenceBaseQty !== undefined && ctx.product) {
    return valueStockAtCost(details.differenceBaseQty, ctx);
  }

  for (const key of DISCREPANCY_PAISE_KEYS) {
    if (details[key] !== undefined) return Math.abs(Math.round(Number(details[key]) || 0));
  }
  for (const key of DISCREPANCY_RUPEE_KEYS) {
    if (details[key] !== undefined) return Math.abs(Math.round((Number(details[key]) || 0) * 100));
  }

  // Nested per-row gaps (over-payments, split-payment mismatches): total the rows.
  for (const key of ["overPayments", "mismatchedBills", "cancelledDebits"]) {
    if (Array.isArray(details[key])) {
      const total = details[key].reduce((sum, row) => {
        const value = row?.excessRupees ?? row?.differenceRupees ?? row?.amount ?? 0;
        return sum + Math.abs(Number(value) || 0);
      }, 0);
      if (total > 0) return Math.round(total * 100);
    }
  }
  return 0;
}

/** Largest quantified gap across the triggered rules, or null if none measured one. */
export function extractDiscrepancyPaise(triggeredRules, ctx) {
  let largest = 0;
  let measured = false;
  for (const { rule, details } of triggeredRules) {
    const value = ruleDiscrepancyPaise(rule, details, ctx);
    if (value > 0) {
      measured = true;
      largest = Math.max(largest, value);
    }
  }
  return measured ? largest : null;
}

function findingTitle(ctx, triggeredRules) {
  const label = entityLabel(ctx);
  if (!triggeredRules.length) return `${label}: no issues detected`;
  if (triggeredRules.length === 1) return `${label}: ${triggeredRules[0].rule.name}`;
  return `${label}: ${triggeredRules[0].rule.name} (+${triggeredRules.length - 1} more)`;
}

function entityLabel(ctx) {
  switch (ctx.entityType) {
    case ENTITY_TYPES.BILL:
      return `Bill ${ctx.bill.billNo}`;
    case ENTITY_TYPES.CUSTOMER:
      return `Customer khata`;
    case ENTITY_TYPES.PRODUCT:
      return `Product ${ctx.product.name}`;
    case ENTITY_TYPES.PURCHASE:
      return `Purchase ${ctx.receipt?.receiptNumber ?? ctx.history?.invoiceNumber ?? ""}`.trim();
    case ENTITY_TYPES.EXPENSE:
      return `Expense ${ctx.expense.title}`;
    case ENTITY_TYPES.DAILY_CLOSING:
      return `Daily closing ${new Date(ctx.snapshot.date).toISOString().slice(0, 10)}`;
    case ENTITY_TYPES.SYNC_EVENT:
      return `Sync event ${ctx.syncEvent.type}`;
    default:
      return ctx.entityType;
  }
}

async function loadRuleOverrides(shopId, client) {
  const rows = await client.auditRule.findMany({ where: { shopId } });
  const enabled = new Map();
  const weights = new Map();
  for (const row of rows) {
    enabled.set(row.ruleCode, row.enabled);
    if (row.weightOverride !== null && row.weightOverride !== undefined) {
      weights.set(row.ruleCode, row.weightOverride);
    }
  }
  return { enabled, weights };
}

/**
 * Evaluate one entity. Returns the deterministic result plus what was
 * persisted. Never throws for rule bugs — a failing rule is recorded as a
 * ruleError and the rest of the evaluation continues.
 */
export async function evaluateEntity(shopId, entityType, entityId, options = {}) {
  // `rules` lets a caller evaluate an explicit subset (targeted re-checks, and
  // fault-isolation tests) instead of the whole registry for the entity type.
  const { runId = null, client = db, overrides = null, actorUserId = null, rules = null } = options;
  const normalizedType = String(entityType || "").toUpperCase();
  if (!Object.values(ENTITY_TYPES).includes(normalizedType)) {
    throw new AppError(`Unsupported audit entity type: ${entityType}`, 400, "UNSUPPORTED_AUDIT_ENTITY_TYPE");
  }

  const ctx = await buildContext(shopId, normalizedType, entityId, { client });
  const ruleOverrides = overrides ?? (await loadRuleOverrides(shopId, client));
  const events = materializeEvents(ctx);

  const candidateRules = (rules ?? rulesForEntityType(normalizedType)).filter((rule) => {
    const shopEnabled = ruleOverrides.enabled.has(rule.ruleCode) ? ruleOverrides.enabled.get(rule.ruleCode) : rule.enabled;
    return shopEnabled;
  });

  const triggeredRules = [];
  const ruleErrors = [];
  for (const rule of candidateRules) {
    try {
      const verdict = await rule.evaluate(ctx);
      if (verdict && verdict.triggered) {
        triggeredRules.push({ rule, details: verdict.details ?? {} });
      }
    } catch (error) {
      // A buggy rule must never take down an audit run.
      ruleErrors.push({ ruleCode: rule.ruleCode, message: error?.message ?? String(error) });
    }
  }

  const meta = entityMetadata(ctx);
  const priorConfirmedFindings = await countPriorConfirmedFindings(shopId, normalizedType, entityId, client);
  const score = scoreFinding(triggeredRules, {
    amountPaise: meta.amountPaise,
    priorConfirmedFindings,
    weightOverrides: ruleOverrides.weights,
    offlineOrigin: Boolean(ctx.bill?.sourceDeviceId || ctx.product?.sourceDeviceId),
  });

  const result = {
    engineVersion: ENGINE_VERSION,
    rulesetVersion: RULESET_VERSION,
    shopId,
    sourceEntityType: normalizedType,
    sourceEntityId: entityId,
    evaluatedAt: new Date().toISOString(),
    inputHash: ctx.inputHash,
    events,
    rulesEvaluated: candidateRules.length,
    ruleErrors,
    triggered: triggeredRules.length > 0,
    ...score,
  };

  const persisted = await persistEvaluation({
    shopId,
    runId,
    ctx,
    result,
    triggeredRules,
    actorUserId,
    client,
  });

  return { ...result, ...persisted };
}

async function countPriorConfirmedFindings(shopId, entityType, entityId, client) {
  return client.auditFinding.count({
    where: {
      shopId,
      sourceEntityType: entityType,
      sourceEntityId: entityId,
      status: { in: [FINDING_STATUS.CONFIRMED_ISSUE, FINDING_STATUS.CORRECTED] },
    },
  });
}

async function persistEvaluation({ shopId, runId, ctx, result, triggeredRules, actorUserId, client }) {
  let evaluationId = null;
  if (runId) {
    // Unique per (run, entity): re-processing the same entity inside one run
    // updates the row instead of creating a second evaluation.
    const evaluation = await client.auditEvaluation.upsert({
      where: {
        auditRunId_sourceEntityType_sourceEntityId: {
          auditRunId: runId,
          sourceEntityType: result.sourceEntityType,
          sourceEntityId: result.sourceEntityId,
        },
      },
      update: {
        inputHash: result.inputHash,
        engineVersion: result.engineVersion,
        rulesetVersion: result.rulesetVersion,
        triggeredRuleCodesJson: JSON.stringify(triggeredRules.map((entry) => entry.rule.ruleCode)),
        riskScore: result.finalScore,
        resultJson: JSON.stringify(result),
      },
      create: {
        shopId,
        auditRunId: runId,
        sourceEntityType: result.sourceEntityType,
        sourceEntityId: result.sourceEntityId,
        inputHash: result.inputHash,
        engineVersion: result.engineVersion,
        rulesetVersion: result.rulesetVersion,
        triggeredRuleCodesJson: JSON.stringify(triggeredRules.map((entry) => entry.rule.ruleCode)),
        riskScore: result.finalScore,
        resultJson: JSON.stringify(result),
      },
    });
    evaluationId = evaluation.id;
  }

  const dedupeKey = dedupeKeyFor(result.sourceEntityType, result.sourceEntityId);
  const existing = await client.auditFinding.findUnique({
    where: { shopId_dedupeKey: { shopId, dedupeKey } },
    include: { rules: true },
  });

  if (!triggeredRules.length) {
    const cleared = await autoResolveClearedFinding({ existing, shopId, runId, evaluationId, client });
    return { evaluationId, findingId: existing?.id ?? null, findingCreated: false, findingUpdated: cleared, findingStatus: cleared ? FINDING_STATUS.CORRECTED : existing?.status ?? null };
  }

  const meta = entityMetadata(ctx);
  const discrepancyPaise = extractDiscrepancyPaise(triggeredRules, ctx);
  const findingData = {
    sourceEntityType: result.sourceEntityType,
    sourceEntityId: result.sourceEntityId,
    sourceEventType: (ctx.events ?? [])[0] ?? null,
    lastAuditRunId: runId,
    lastEvaluationId: evaluationId,
    title: findingTitle(ctx, triggeredRules),
    primaryCategory: triggeredRules[0].rule.category,
    riskScore: result.finalScore,
    riskLevel: result.riskLevel,
    confidence: result.confidence,
    amountPaise: BigInt(meta.amountPaise ?? 0),
    discrepancyPaise: discrepancyPaise === null ? null : BigInt(discrepancyPaise),
    scoreBreakdownJson: JSON.stringify({
      formula: result.formula,
      baseScore: result.baseScore,
      summedContributions: result.summedContributions,
      materialityMultiplier: result.materialityMultiplier,
      materialityBand: result.materialityBand,
      historyMultiplier: result.historyMultiplier,
      historyLabel: result.historyLabel,
      priorConfirmedFindings: result.priorConfirmedFindings,
      preClampScore: result.preClampScore,
      modifiedScore: result.modifiedScore,
      scoreFloor: result.scoreFloor,
      scoreFloorRuleCode: result.scoreFloorRuleCode,
      scoreFloorApplied: result.scoreFloorApplied,
      finalScore: result.finalScore,
      riskLevel: result.riskLevel,
      confidence: result.confidence,
      confidenceReasons: result.confidenceReasons,
      discrepancyPaise,
      triggeredRules: result.triggeredRules,
      inputHash: result.inputHash,
      engineVersion: result.engineVersion,
      rulesetVersion: result.rulesetVersion,
    }),
    occurredAt: meta.occurredAt ? new Date(meta.occurredAt) : null,
    engineVersion: result.engineVersion,
    rulesetVersion: result.rulesetVersion,
  };

  if (!existing) {
    const finding = await client.auditFinding.create({
      data: {
        shopId,
        dedupeKey,
        firstAuditRunId: runId,
        status: FINDING_STATUS.OPEN,
        ...findingData,
      },
    });
    await syncFindingRules({ shopId, findingId: finding.id, triggeredRules, scoreContributions: result.triggeredRules, client });
    await createEvidenceRequirements({ shopId, findingId: finding.id, triggeredRules, client });
    await client.auditFindingStatusHistory.create({
      data: {
        shopId,
        findingId: finding.id,
        previousStatus: null,
        newStatus: FINDING_STATUS.OPEN,
        changedByUserId: actorUserId,
        changedByRole: "system",
        comment: `Finding raised by ${result.engineVersion} (${result.rulesetVersion}); ${triggeredRules.length} rule(s) triggered.`,
      },
    });
    return { evaluationId, findingId: finding.id, findingCreated: true, findingUpdated: false, findingStatus: FINDING_STATUS.OPEN };
  }

  // Existing finding: decide whether the new evaluation may touch it.
  const previousRuleCodes = new Set(existing.rules.map((row) => row.ruleCode));
  const currentRuleCodes = new Set(triggeredRules.map((entry) => entry.rule.ruleCode));
  const newRuleCodes = [...currentRuleCodes].filter((code) => !previousRuleCodes.has(code));

  if (SUPPRESSING_STATUSES.includes(existing.status) && newRuleCodes.length === 0) {
    // A reviewer already judged this exact signature — do not resurrect it.
    await client.auditFinding.update({
      where: { id: existing.id },
      data: { lastAuditRunId: runId, lastEvaluationId: evaluationId },
    });
    return {
      evaluationId,
      findingId: existing.id,
      findingCreated: false,
      findingUpdated: false,
      findingStatus: existing.status,
      suppressedBy: existing.status,
    };
  }

  const isActive = ACTIVE_FINDING_STATUSES.includes(existing.status);
  const shouldReopen = !isActive && newRuleCodes.length > 0;

  const finding = await client.auditFinding.update({
    where: { id: existing.id },
    data: {
      ...findingData,
      ...(shouldReopen
        ? {
            status: FINDING_STATUS.OPEN,
            reopenCount: existing.reopenCount + 1,
            resolvedAt: null,
            resolutionType: null,
          }
        : {}),
    },
  });
  await syncFindingRules({ shopId, findingId: finding.id, triggeredRules, scoreContributions: result.triggeredRules, client });
  await createEvidenceRequirements({ shopId, findingId: finding.id, triggeredRules, client });

  if (shouldReopen) {
    await client.auditFindingStatusHistory.create({
      data: {
        shopId,
        findingId: finding.id,
        previousStatus: existing.status,
        newStatus: FINDING_STATUS.OPEN,
        changedByUserId: actorUserId,
        changedByRole: "system",
        comment: `Reopened: new rule(s) triggered — ${newRuleCodes.join(", ")}.`,
      },
    });
  }

  return {
    evaluationId,
    findingId: finding.id,
    findingCreated: false,
    findingUpdated: true,
    findingStatus: finding.status,
    reopened: shouldReopen,
  };
}

// A finding whose condition no longer holds is resolved as CORRECTED with an
// explicit system history row — never silently deleted or hidden.
async function autoResolveClearedFinding({ existing, shopId, runId, evaluationId, client }) {
  if (!existing) return false;
  if (!ACTIVE_FINDING_STATUSES.includes(existing.status)) {
    await client.auditFinding.update({
      where: { id: existing.id },
      data: { lastAuditRunId: runId, lastEvaluationId: evaluationId },
    });
    return false;
  }
  await client.auditFindingRule.updateMany({ where: { findingId: existing.id }, data: { active: false } });
  await client.auditFinding.update({
    where: { id: existing.id },
    data: {
      status: FINDING_STATUS.CORRECTED,
      resolvedAt: new Date(),
      resolutionType: "AUTO_RESOLVED_CONDITION_CLEARED",
      lastAuditRunId: runId,
      lastEvaluationId: evaluationId,
    },
  });
  await client.auditFindingStatusHistory.create({
    data: {
      shopId,
      findingId: existing.id,
      previousStatus: existing.status,
      newStatus: FINDING_STATUS.CORRECTED,
      changedByRole: "system",
      comment: "Re-evaluation found no triggering rules; the underlying inconsistency no longer exists.",
    },
  });
  return true;
}

async function syncFindingRules({ shopId, findingId, triggeredRules, scoreContributions, client }) {
  const contributionByCode = new Map(scoreContributions.map((entry) => [entry.ruleCode, entry]));
  const currentCodes = new Set();
  for (const { rule, details } of triggeredRules) {
    currentCodes.add(rule.ruleCode);
    const contribution = contributionByCode.get(rule.ruleCode);
    const data = {
      ruleVersion: rule.version,
      category: rule.category,
      severity: rule.severity,
      scoreContribution: contribution?.scoreContribution ?? 0,
      detailsJson: JSON.stringify(details ?? {}),
      active: true,
    };
    await client.auditFindingRule.upsert({
      where: { findingId_ruleCode: { findingId, ruleCode: rule.ruleCode } },
      update: data,
      create: { shopId, findingId, ruleCode: rule.ruleCode, ...data },
    });
  }
  // Rules that stopped triggering stay on the record but are marked inactive.
  await client.auditFindingRule.updateMany({
    where: { findingId, ruleCode: { notIn: [...currentCodes] } },
    data: { active: false },
  });
}

async function createEvidenceRequirements({ shopId, findingId, triggeredRules, client }) {
  const wanted = new Map();
  for (const { rule } of triggeredRules) {
    for (const evidenceType of rule.evidenceTypes ?? []) {
      if (!wanted.has(evidenceType)) {
        wanted.set(evidenceType, `Required to resolve ${rule.ruleCode}: ${rule.name}`);
      }
    }
  }
  if (!wanted.size) return;
  const existing = await client.auditEvidenceRequirement.findMany({
    where: { findingId },
    select: { evidenceType: true },
  });
  const existingTypes = new Set(existing.map((row) => row.evidenceType));
  const toCreate = [...wanted.entries()]
    .filter(([evidenceType]) => !existingTypes.has(evidenceType))
    .map(([evidenceType, description]) => ({ shopId, findingId, evidenceType, description }));
  for (const row of toCreate) {
    await client.auditEvidenceRequirement.create({ data: row });
  }
}

// ── audit runs ────────────────────────────────────────────────

export async function createRun(shopId, { runType, scope = {}, periodFrom = null, periodTo = null, triggeredByUserId = null }, client = db) {
  if (!Object.values(RUN_TYPES).includes(runType)) {
    throw new AppError(`Unsupported audit run type: ${runType}`, 400, "UNSUPPORTED_AUDIT_RUN_TYPE");
  }
  return client.auditRun.create({
    data: {
      shopId,
      runType,
      status: RUN_STATUS.RUNNING,
      engineVersion: ENGINE_VERSION,
      rulesetVersion: RULESET_VERSION,
      scopeJson: JSON.stringify(scope ?? {}),
      periodFrom: periodFrom ? new Date(periodFrom) : null,
      periodTo: periodTo ? new Date(periodTo) : null,
      triggeredByUserId,
    },
  });
}

export async function finishRun(runId, { status, entitiesEvaluated, findingsCreated, findingsUpdated, summary, error = null }, client = db) {
  return client.auditRun.update({
    where: { id: runId },
    data: {
      status,
      entitiesEvaluated,
      findingsCreated,
      findingsUpdated,
      summaryJson: JSON.stringify(summary ?? {}),
      error,
      completedAt: new Date(),
    },
  });
}

/**
 * Collect the entities inside a period. Returns at most MAX_RANGE_ENTITIES per
 * type so a long period cannot exhaust memory; the truncation is reported in
 * the run summary rather than hidden.
 */
export async function collectEntitiesForPeriod(shopId, { from, to, entityTypes = null, client = db }) {
  const range = { gte: new Date(from), lte: new Date(to) };
  const wanted = new Set(entityTypes && entityTypes.length ? entityTypes : Object.values(ENTITY_TYPES));
  const entities = [];
  const truncated = [];

  const push = (entityType, rows, idKey = "id") => {
    if (rows.length >= MAX_RANGE_ENTITIES) truncated.push({ entityType, cap: MAX_RANGE_ENTITIES });
    for (const row of rows) entities.push({ entityType, entityId: row[idKey] });
  };

  if (wanted.has(ENTITY_TYPES.BILL)) {
    push(ENTITY_TYPES.BILL, await client.bill.findMany({ where: { shopId, createdAt: range }, select: { id: true }, take: MAX_RANGE_ENTITIES, orderBy: { createdAt: "asc" } }));
  }
  if (wanted.has(ENTITY_TYPES.EXPENSE)) {
    push(ENTITY_TYPES.EXPENSE, await client.expense.findMany({ where: { shopId, deletedAt: null, spentAt: range }, select: { id: true }, take: MAX_RANGE_ENTITIES, orderBy: { spentAt: "asc" } }));
  }
  if (wanted.has(ENTITY_TYPES.PURCHASE)) {
    push(ENTITY_TYPES.PURCHASE, await client.purchaseReceipt.findMany({ where: { shopId, createdAt: range }, select: { id: true }, take: MAX_RANGE_ENTITIES, orderBy: { createdAt: "asc" } }));
    push(ENTITY_TYPES.PURCHASE, await client.purchaseHistory.findMany({ where: { shopId, createdAt: range, purchaseReceiptId: null }, select: { id: true }, take: MAX_RANGE_ENTITIES, orderBy: { createdAt: "asc" } }));
  }
  if (wanted.has(ENTITY_TYPES.DAILY_CLOSING)) {
    push(ENTITY_TYPES.DAILY_CLOSING, await client.dailyClosingSnapshot.findMany({ where: { shopId, date: range }, select: { id: true }, take: MAX_RANGE_ENTITIES, orderBy: { date: "asc" } }));
  }
  if (wanted.has(ENTITY_TYPES.SYNC_EVENT)) {
    push(ENTITY_TYPES.SYNC_EVENT, await client.offlineSyncEvent.findMany({ where: { shopId, createdAt: range }, select: { id: true }, take: MAX_RANGE_ENTITIES, orderBy: { createdAt: "asc" } }));
  }
  // Customers and products are evaluated when they were touched in the period:
  // their state is a running balance, so the trigger is ledger/movement activity.
  if (wanted.has(ENTITY_TYPES.CUSTOMER)) {
    const rows = await client.udharLedger.findMany({
      where: { shopId, createdAt: range },
      select: { customerId: true },
      distinct: ["customerId"],
      take: MAX_RANGE_ENTITIES,
    });
    push(ENTITY_TYPES.CUSTOMER, rows, "customerId");
  }
  if (wanted.has(ENTITY_TYPES.PRODUCT)) {
    const rows = await client.stockLedger.findMany({
      where: { shopId, createdAt: range },
      select: { productId: true },
      distinct: ["productId"],
      take: MAX_RANGE_ENTITIES,
    });
    push(ENTITY_TYPES.PRODUCT, rows, "productId");
  }

  // De-duplicate (entityType, entityId) pairs.
  const seen = new Set();
  const unique = entities.filter((entity) => {
    const key = `${entity.entityType}:${entity.entityId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { entities: unique, truncated };
}

/**
 * Run the engine over a set of entities inside one AuditRun. Individual entity
 * failures are recorded and the run continues (status PARTIAL).
 */
export async function executeRun(shopId, run, entities, { client = db, actorUserId = null } = {}) {
  const overrides = await loadRuleOverrides(shopId, client);
  let findingsCreated = 0;
  let findingsUpdated = 0;
  let evaluated = 0;
  const failures = [];
  const byCategory = {};
  const byRiskLevel = {};
  const byRuleCode = {};

  for (const entity of entities) {
    try {
      const outcome = await evaluateEntity(shopId, entity.entityType, entity.entityId, {
        runId: run.id,
        client,
        overrides,
        actorUserId,
      });
      evaluated += 1;
      if (outcome.findingCreated) findingsCreated += 1;
      if (outcome.findingUpdated) findingsUpdated += 1;
      if (outcome.triggered) {
        byRiskLevel[outcome.riskLevel] = (byRiskLevel[outcome.riskLevel] ?? 0) + 1;
        for (const entry of outcome.triggeredRules) {
          byCategory[entry.category] = (byCategory[entry.category] ?? 0) + 1;
          byRuleCode[entry.ruleCode] = (byRuleCode[entry.ruleCode] ?? 0) + 1;
        }
      }
    } catch (error) {
      const code = error instanceof AuditContextError ? error.code : error?.code ?? "EVALUATION_FAILED";
      failures.push({ entityType: entity.entityType, entityId: entity.entityId, code, message: error?.message ?? String(error) });
    }
  }

  const status = failures.length === 0 ? RUN_STATUS.COMPLETED : evaluated > 0 ? RUN_STATUS.PARTIAL : RUN_STATUS.FAILED;
  await finishRun(
    run.id,
    {
      status,
      entitiesEvaluated: evaluated,
      findingsCreated,
      findingsUpdated,
      summary: {
        requestedEntities: entities.length,
        evaluated,
        failures: failures.slice(0, 50),
        failureCount: failures.length,
        findingsByCategory: byCategory,
        findingsByRiskLevel: byRiskLevel,
        findingsByRuleCode: byRuleCode,
      },
      error: failures.length && evaluated === 0 ? "All entity evaluations failed" : null,
    },
    client
  );

  return { runId: run.id, status, evaluated, findingsCreated, findingsUpdated, failures };
}

// Findings, evidence and review lifecycle (Layers 4–5) + dashboard/report reads.
//
// Every query in this file is scoped by the shopId taken from the caller's JWT.
// A findings id from another shop resolves to a 404, never to data.
import crypto from "node:crypto";
import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import {
  ENTITY_TYPES,
  EVIDENCE_STATUS,
  FINDING_STATUS,
  FINDING_STATUS_TRANSITIONS,
  RISK_LEVELS,
  RUN_TYPES,
} from "./assurance.constants.js";
import {
  CAPABILITIES,
  assertCanSetStatus,
  assertCapability,
  findingVisibilityFilter,
} from "./assurance.permissions.js";
import { collectEntitiesForPeriod, createRun, evaluateEntity, executeRun } from "./evaluation.service.js";
import { ruleCatalog, RULES_BY_CODE, RULESET_VERSION } from "./rules/index.js";
import { ENGINE_VERSION } from "./assurance.constants.js";
import { explainFinding } from "./ai/audit-ai.service.js";

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

function parseJson(raw, fallback) {
  try {
    const parsed = JSON.parse(raw ?? "");
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function serializeFinding(finding, { includeBreakdown = false } = {}) {
  return {
    findingId: finding.id,
    shopId: finding.shopId,
    title: finding.title,
    status: finding.status,
    sourceEntityType: finding.sourceEntityType,
    sourceEntityId: finding.sourceEntityId,
    sourceEventType: finding.sourceEventType,
    primaryCategory: finding.primaryCategory,
    riskScore: finding.riskScore,
    riskLevel: finding.riskLevel,
    confidence: finding.confidence,
    amountPaise: finding.amountPaise === null || finding.amountPaise === undefined ? null : Number(finding.amountPaise),
    assignedReviewerId: finding.assignedReviewerId,
    occurredAt: finding.occurredAt,
    resolvedAt: finding.resolvedAt,
    resolutionType: finding.resolutionType,
    reopenCount: finding.reopenCount,
    engineVersion: finding.engineVersion,
    rulesetVersion: finding.rulesetVersion,
    aiExplanation: finding.aiExplanation,
    aiExplanationLang: finding.aiExplanationLang,
    createdAt: finding.createdAt,
    updatedAt: finding.updatedAt,
    ...(finding.rules
      ? {
          triggeredRules: finding.rules.map((rule) => ({
            ruleCode: rule.ruleCode,
            ruleVersion: rule.ruleVersion,
            category: rule.category,
            severity: rule.severity,
            scoreContribution: rule.scoreContribution,
            active: rule.active,
            name: RULES_BY_CODE[rule.ruleCode]?.name ?? rule.ruleCode,
            description: RULES_BY_CODE[rule.ruleCode]?.description ?? null,
            remediation: RULES_BY_CODE[rule.ruleCode]?.remediation ?? null,
            details: parseJson(rule.detailsJson, {}),
          })),
        }
      : {}),
    ...(includeBreakdown ? { scoreBreakdown: parseJson(finding.scoreBreakdownJson, {}) } : {}),
  };
}

// ── findings ──────────────────────────────────────────────────

export async function listFindings(shopId, actor, query = {}) {
  const visibility = findingVisibilityFilter(actor);
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(query.limit) || DEFAULT_PAGE_SIZE));

  const where = {
    shopId,
    ...visibility,
    ...(query.status ? { status: query.status } : {}),
    ...(query.riskLevel ? { riskLevel: query.riskLevel } : {}),
    ...(query.category ? { primaryCategory: query.category } : {}),
    ...(query.sourceEntityType ? { sourceEntityType: query.sourceEntityType } : {}),
    ...(query.sourceEntityId ? { sourceEntityId: query.sourceEntityId } : {}),
    ...(query.assignedReviewerId ? { assignedReviewerId: query.assignedReviewerId } : {}),
    ...(query.openOnly
      ? { status: { in: [FINDING_STATUS.OPEN, FINDING_STATUS.EVIDENCE_REQUESTED, FINDING_STATUS.UNDER_REVIEW] } }
      : {}),
    ...(query.from || query.to
      ? {
          createdAt: {
            ...(query.from ? { gte: new Date(query.from) } : {}),
            ...(query.to ? { lte: new Date(query.to) } : {}),
          },
        }
      : {}),
    ...(query.ruleCode ? { rules: { some: { ruleCode: query.ruleCode } } } : {}),
  };

  const [total, rows] = await Promise.all([
    db.auditFinding.count({ where }),
    db.auditFinding.findMany({
      where,
      include: { rules: true },
      orderBy: [{ riskScore: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return {
    findings: rows.map((row) => serializeFinding(row)),
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

export async function getFinding(shopId, actor, findingId) {
  const visibility = findingVisibilityFilter(actor);
  const finding = await db.auditFinding.findFirst({
    where: { id: findingId, shopId, ...visibility },
    include: {
      rules: true,
      evidence: { orderBy: { createdAt: "desc" } },
      evidenceRequirements: { orderBy: { createdAt: "asc" } },
      statusHistory: { orderBy: { createdAt: "asc" } },
      reviews: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!finding) throw new AppError("Finding not found", 404, "AUDIT_FINDING_NOT_FOUND");

  return {
    ...serializeFinding(finding, { includeBreakdown: true }),
    sourceTransaction: await loadSourceSummary(shopId, finding.sourceEntityType, finding.sourceEntityId),
    evidenceRequirements: finding.evidenceRequirements.map((requirement) => ({
      requirementId: requirement.id,
      evidenceType: requirement.evidenceType,
      description: requirement.description,
      status: requirement.status,
      requestedByUserId: requirement.requestedByUserId,
      dueAt: requirement.dueAt,
      createdAt: requirement.createdAt,
    })),
    evidence: finding.evidence.map(serializeEvidence),
    timeline: finding.statusHistory.map((row) => ({
      historyId: row.id,
      previousStatus: row.previousStatus,
      newStatus: row.newStatus,
      changedByUserId: row.changedByUserId,
      changedByRole: row.changedByRole,
      comment: row.comment,
      evidenceId: row.evidenceId,
      approvalLevel: row.approvalLevel,
      createdAt: row.createdAt,
    })),
    reviews: finding.reviews.map((review) => ({
      reviewId: review.id,
      reviewerUserId: review.reviewerUserId,
      reviewerRole: review.reviewerRole,
      decision: review.decision,
      notes: review.notes,
      createdAt: review.createdAt,
    })),
  };
}

function serializeEvidence(evidence) {
  return {
    evidenceId: evidence.id,
    findingId: evidence.findingId,
    requirementId: evidence.requirementId,
    evidenceType: evidence.evidenceType,
    referenceKind: evidence.referenceKind,
    referenceValue: evidence.referenceValue,
    originalFilename: evidence.originalFilename,
    mimeType: evidence.mimeType,
    sizeBytes: evidence.sizeBytes,
    checksumSha256: evidence.checksumSha256,
    uploadedByUserId: evidence.uploadedByUserId,
    verificationStatus: evidence.verificationStatus,
    verifiedByUserId: evidence.verifiedByUserId,
    verifiedAt: evidence.verifiedAt,
    extractedMetadata: parseJson(evidence.extractedMetadataJson, {}),
    reviewerNotes: evidence.reviewerNotes,
    createdAt: evidence.createdAt,
  };
}

/**
 * A compact, read-only summary of the underlying transaction so a reviewer can
 * see what the finding is about without leaving the module. Read-only by
 * construction: this only ever runs SELECTs.
 */
async function loadSourceSummary(shopId, entityType, entityId) {
  switch (entityType) {
    case ENTITY_TYPES.BILL: {
      const bill = await db.bill.findFirst({
        where: { id: entityId, shopId },
        select: {
          id: true, billNo: true, billType: true, status: true, customerName: true, grandTotal: true,
          paidAmount: true, creditAmount: true, discount: true, createdAt: true, createdByUserId: true,
          cancelledAt: true, cancelledReason: true,
          items: { select: { id: true, name: true, quantity: true, enteredUnit: true, lineTotal: true } },
          payments: { select: { id: true, mode: true, amount: true, status: true } },
        },
      });
      return bill ? { kind: "BILL", ...bill } : { kind: "BILL", missing: true };
    }
    case ENTITY_TYPES.CUSTOMER: {
      const customer = await db.customer.findFirst({
        where: { id: entityId, shopId },
        select: { id: true, name: true, udharAmount: true, type: true, createdAt: true },
      });
      return customer ? { kind: "CUSTOMER", ...customer } : { kind: "CUSTOMER", missing: true };
    }
    case ENTITY_TYPES.PRODUCT: {
      const product = await db.product.findFirst({
        where: { id: entityId, shopId },
        select: { id: true, name: true, stockBaseQty: true, baseUnit: true, deletedAt: true },
      });
      return product ? { kind: "PRODUCT", ...product } : { kind: "PRODUCT", missing: true };
    }
    case ENTITY_TYPES.PURCHASE: {
      const receipt = await db.purchaseReceipt.findFirst({
        where: { id: entityId, shopId },
        select: { id: true, receiptNumber: true, supplierInvoiceNumber: true, totalAmount: true, paidAmount: true, dueAmount: true, matchStatus: true, createdAt: true },
      });
      if (receipt) return { kind: "PURCHASE", purchaseKind: "receipt", ...receipt };
      const history = await db.purchaseHistory.findFirst({
        where: { id: entityId, shopId },
        select: { id: true, supplierName: true, invoiceNumber: true, billAmount: true, totalCost: true, qtyBase: true, purchasePaymentStatus: true, createdAt: true },
      });
      return history ? { kind: "PURCHASE", purchaseKind: "history", ...history } : { kind: "PURCHASE", missing: true };
    }
    case ENTITY_TYPES.EXPENSE: {
      const expense = await db.expense.findFirst({
        where: { id: entityId, shopId },
        select: { id: true, title: true, amount: true, category: true, paymentMode: true, vendor: true, spentAt: true, createdAt: true },
      });
      return expense ? { kind: "EXPENSE", ...expense } : { kind: "EXPENSE", missing: true };
    }
    case ENTITY_TYPES.DAILY_CLOSING: {
      const snapshot = await db.dailyClosingSnapshot.findFirst({
        where: { id: entityId, shopId },
        select: { id: true, date: true, totalSalesPaise: true, cashReceivedPaise: true, upiReceivedPaise: true, expectedCashPaise: true, lockedAt: true, generatedAt: true },
      });
      return snapshot ? { kind: "DAILY_CLOSING", ...snapshot } : { kind: "DAILY_CLOSING", missing: true };
    }
    case ENTITY_TYPES.SYNC_EVENT: {
      const event = await db.offlineSyncEvent.findFirst({
        where: { id: entityId, shopId },
        select: { id: true, eventId: true, type: true, status: true, attempts: true, createdAt: true, updatedAt: true },
      });
      return event ? { kind: "SYNC_EVENT", ...event } : { kind: "SYNC_EVENT", missing: true };
    }
    default:
      return { kind: entityType, unsupported: true };
  }
}

// ── status transitions ────────────────────────────────────────

export async function transitionFindingStatus(shopId, actor, findingId, { status, comment = null, evidenceId = null, approvalLevel = null, resolutionType = null }) {
  assertCanSetStatus(actor.role, status);
  const finding = await db.auditFinding.findFirst({ where: { id: findingId, shopId } });
  if (!finding) throw new AppError("Finding not found", 404, "AUDIT_FINDING_NOT_FOUND");

  const allowed = FINDING_STATUS_TRANSITIONS[finding.status] ?? [];
  if (!allowed.includes(status)) {
    throw new AppError(
      `Cannot move a finding from ${finding.status} to ${status}`,
      422,
      "AUDIT_INVALID_STATUS_TRANSITION"
    );
  }

  if (evidenceId) {
    const evidence = await db.auditEvidence.findFirst({ where: { id: evidenceId, shopId, findingId } });
    if (!evidence) throw new AppError("Evidence not found for this finding", 404, "AUDIT_EVIDENCE_NOT_FOUND");
  }

  const isResolution = [
    FINDING_STATUS.CONFIRMED_ISSUE,
    FINDING_STATUS.FALSE_POSITIVE,
    FINDING_STATUS.CORRECTED,
    FINDING_STATUS.ACCEPTED_RISK,
    FINDING_STATUS.CLOSED,
  ].includes(status);

  const [updated] = await db.$transaction([
    db.auditFinding.update({
      where: { id: finding.id },
      data: {
        status,
        ...(isResolution
          ? { resolvedAt: new Date(), resolutionType: resolutionType ?? status }
          : { resolvedAt: null, resolutionType: null }),
      },
    }),
    // Append-only trail: one row per transition, never updated or removed.
    db.auditFindingStatusHistory.create({
      data: {
        shopId,
        findingId: finding.id,
        previousStatus: finding.status,
        newStatus: status,
        changedByUserId: actor.userId,
        changedByRole: actor.role,
        comment,
        evidenceId,
        approvalLevel,
      },
    }),
  ]);

  return serializeFinding(updated);
}

export async function assignReviewer(shopId, actor, findingId, { reviewerUserId, comment = null }) {
  assertCapability(actor.role, CAPABILITIES.ASSIGN_REVIEWER);
  const finding = await db.auditFinding.findFirst({ where: { id: findingId, shopId } });
  if (!finding) throw new AppError("Finding not found", 404, "AUDIT_FINDING_NOT_FOUND");

  const reviewer = await db.user.findFirst({ where: { id: reviewerUserId, shopId, disabledAt: null }, select: { id: true, role: true, name: true } });
  if (!reviewer) throw new AppError("Reviewer not found in this shop", 404, "AUDIT_REVIEWER_NOT_FOUND");

  const [updated] = await db.$transaction([
    db.auditFinding.update({ where: { id: finding.id }, data: { assignedReviewerId: reviewer.id } }),
    db.auditFindingStatusHistory.create({
      data: {
        shopId,
        findingId: finding.id,
        previousStatus: finding.status,
        newStatus: finding.status,
        changedByUserId: actor.userId,
        changedByRole: actor.role,
        comment: comment ?? `Assigned to ${reviewer.name} (${reviewer.role}).`,
      },
    }),
  ]);
  return serializeFinding(updated);
}

export async function addReview(shopId, actor, findingId, { decision, notes = null, newStatus = null }) {
  assertCapability(actor.role, CAPABILITIES.REVIEW_FINDING);
  const finding = await db.auditFinding.findFirst({ where: { id: findingId, shopId } });
  if (!finding) throw new AppError("Finding not found", 404, "AUDIT_FINDING_NOT_FOUND");

  const review = await db.auditReview.create({
    data: {
      shopId,
      findingId: finding.id,
      reviewerUserId: actor.userId,
      reviewerRole: actor.role,
      decision,
      notes,
    },
  });

  let updatedFinding = finding;
  if (newStatus) {
    updatedFinding = await transitionFindingStatus(shopId, actor, findingId, {
      status: newStatus,
      comment: notes ? `Review (${decision}): ${notes}` : `Review decision: ${decision}`,
      resolutionType: decision,
    });
  } else if (finding.status === FINDING_STATUS.OPEN || finding.status === FINDING_STATUS.EVIDENCE_REQUESTED) {
    updatedFinding = await transitionFindingStatus(shopId, actor, findingId, {
      status: FINDING_STATUS.UNDER_REVIEW,
      comment: `Review recorded: ${decision}`,
    });
  }

  return {
    review: { reviewId: review.id, decision: review.decision, notes: review.notes, createdAt: review.createdAt },
    finding: serializeFinding(updatedFinding),
  };
}

// ── evidence ──────────────────────────────────────────────────

export async function requestEvidence(shopId, actor, findingId, { evidenceType, description, dueAt = null }) {
  assertCapability(actor.role, CAPABILITIES.REQUEST_EVIDENCE);
  const finding = await db.auditFinding.findFirst({ where: { id: findingId, shopId } });
  if (!finding) throw new AppError("Finding not found", 404, "AUDIT_FINDING_NOT_FOUND");

  const requirement = await db.auditEvidenceRequirement.create({
    data: {
      shopId,
      findingId: finding.id,
      evidenceType,
      description,
      requestedByUserId: actor.userId,
      dueAt: dueAt ? new Date(dueAt) : null,
    },
  });

  if (finding.status === FINDING_STATUS.OPEN) {
    await transitionFindingStatus(shopId, actor, findingId, {
      status: FINDING_STATUS.EVIDENCE_REQUESTED,
      comment: `Requested ${evidenceType}.`,
    });
  }

  return {
    requirementId: requirement.id,
    evidenceType: requirement.evidenceType,
    description: requirement.description,
    status: requirement.status,
    dueAt: requirement.dueAt,
  };
}

/**
 * Record evidence against a finding. Evidence is never auto-verified: it lands
 * as PROVIDED and a human must verify it. Reused checksums are surfaced in
 * extractedMetadata so "same receipt used twice" is detectable.
 */
export async function submitEvidence(shopId, actor, findingId, payload) {
  assertCapability(actor.role, CAPABILITIES.SUBMIT_EVIDENCE);
  const visibility = findingVisibilityFilter(actor);
  const finding = await db.auditFinding.findFirst({ where: { id: findingId, shopId, ...visibility } });
  if (!finding) throw new AppError("Finding not found", 404, "AUDIT_FINDING_NOT_FOUND");

  let requirement = null;
  if (payload.requirementId) {
    requirement = await db.auditEvidenceRequirement.findFirst({
      where: { id: payload.requirementId, shopId, findingId: finding.id },
    });
    if (!requirement) throw new AppError("Evidence requirement not found for this finding", 404, "AUDIT_REQUIREMENT_NOT_FOUND");
  }

  const referenceValue = String(payload.referenceValue ?? "").trim();
  if (!referenceValue) throw new AppError("Evidence reference or text is required", 400, "AUDIT_EVIDENCE_EMPTY");

  // Checksum over the supplied reference/text. For file-backed evidence the
  // caller supplies the file checksum; otherwise we hash the reference so
  // duplicate submissions are still detectable.
  const checksum = payload.checksumSha256
    ? String(payload.checksumSha256).toLowerCase()
    : crypto.createHash("sha256").update(referenceValue).digest("hex");

  const priorUses = await db.auditEvidence.findMany({
    where: { shopId, checksumSha256: checksum, findingId: { not: finding.id } },
    select: { id: true, findingId: true, evidenceType: true, createdAt: true },
    take: 10,
  });

  const evidence = await db.auditEvidence.create({
    data: {
      shopId,
      findingId: finding.id,
      requirementId: requirement?.id ?? null,
      evidenceType: payload.evidenceType,
      referenceKind: payload.referenceKind ?? "text",
      referenceValue,
      originalFilename: payload.originalFilename ?? null,
      mimeType: payload.mimeType ?? null,
      sizeBytes: payload.sizeBytes ?? null,
      checksumSha256: checksum,
      storageKey: payload.storageKey ?? null,
      uploadedByUserId: actor.userId,
      // Presence is not proof: evidence starts at PROVIDED, not VERIFIED.
      verificationStatus: EVIDENCE_STATUS.PROVIDED,
      extractedMetadataJson: JSON.stringify({
        submittedBy: actor.role,
        checksumSource: payload.checksumSha256 ? "client_supplied_file" : "reference_hash",
        reusedOnOtherFindings: priorUses.map((row) => ({ findingId: row.findingId, evidenceType: row.evidenceType, createdAt: row.createdAt })),
        reuseCount: priorUses.length,
      }),
    },
  });

  if (requirement) {
    await db.auditEvidenceRequirement.update({
      where: { id: requirement.id },
      data: { status: EVIDENCE_STATUS.PROVIDED },
    });
  }

  await db.auditFindingStatusHistory.create({
    data: {
      shopId,
      findingId: finding.id,
      previousStatus: finding.status,
      newStatus: finding.status,
      changedByUserId: actor.userId,
      changedByRole: actor.role,
      comment: `Evidence submitted: ${payload.evidenceType}${priorUses.length ? ` (warning: this reference is already used on ${priorUses.length} other finding(s))` : ""}`,
      evidenceId: evidence.id,
    },
  });

  return { ...serializeEvidence(evidence), reuseWarningCount: priorUses.length };
}

export async function verifyEvidence(shopId, actor, evidenceId, { verificationStatus, reviewerNotes = null }) {
  assertCapability(actor.role, CAPABILITIES.VERIFY_EVIDENCE);
  const evidence = await db.auditEvidence.findFirst({ where: { id: evidenceId, shopId } });
  if (!evidence) throw new AppError("Evidence not found", 404, "AUDIT_EVIDENCE_NOT_FOUND");

  const updated = await db.auditEvidence.update({
    where: { id: evidence.id },
    data: {
      verificationStatus,
      verifiedByUserId: actor.userId,
      verifiedAt: new Date(),
      reviewerNotes,
    },
  });

  if (evidence.requirementId) {
    await db.auditEvidenceRequirement.update({
      where: { id: evidence.requirementId },
      data: { status: verificationStatus },
    });
  }

  await db.auditFindingStatusHistory.create({
    data: {
      shopId,
      findingId: evidence.findingId,
      previousStatus: null,
      newStatus: `EVIDENCE_${verificationStatus}`,
      changedByUserId: actor.userId,
      changedByRole: actor.role,
      comment: reviewerNotes ?? `Evidence marked ${verificationStatus}.`,
      evidenceId: evidence.id,
    },
  });

  return serializeEvidence(updated);
}

export async function listEvidenceRequests(shopId, actor, query = {}) {
  findingVisibilityFilter(actor); // authorization check
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(query.limit) || DEFAULT_PAGE_SIZE));
  const where = {
    shopId,
    ...(query.status ? { status: query.status } : { status: { in: [EVIDENCE_STATUS.REQUESTED, EVIDENCE_STATUS.PROVIDED, EVIDENCE_STATUS.INSUFFICIENT] } }),
  };

  const [total, rows] = await Promise.all([
    db.auditEvidenceRequirement.count({ where }),
    db.auditEvidenceRequirement.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
      include: {
        finding: { select: { id: true, title: true, riskLevel: true, riskScore: true, status: true, sourceEntityType: true, sourceEntityId: true } },
        evidence: { select: { id: true, verificationStatus: true, evidenceType: true, createdAt: true } },
      },
    }),
  ]);

  return {
    requests: rows.map((row) => ({
      requirementId: row.id,
      evidenceType: row.evidenceType,
      description: row.description,
      status: row.status,
      dueAt: row.dueAt,
      createdAt: row.createdAt,
      finding: row.finding
        ? {
            findingId: row.finding.id,
            title: row.finding.title,
            riskLevel: row.finding.riskLevel,
            riskScore: row.finding.riskScore,
            status: row.finding.status,
            sourceEntityType: row.finding.sourceEntityType,
            sourceEntityId: row.finding.sourceEntityId,
          }
        : null,
      submittedEvidence: row.evidence.map((item) => ({ evidenceId: item.id, evidenceType: item.evidenceType, verificationStatus: item.verificationStatus, createdAt: item.createdAt })),
    })),
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

// ── runs ──────────────────────────────────────────────────────

export async function startRun(shopId, actor, { runType = RUN_TYPES.MANUAL, from, to, entityTypes = null, entities = null }) {
  assertCapability(actor.role, CAPABILITIES.TRIGGER_RUN);

  let targets = entities;
  let truncated = [];
  if (!targets) {
    if (!from || !to) throw new AppError("A date range (from, to) or an explicit entity list is required", 400, "AUDIT_RUN_SCOPE_REQUIRED");
    const collected = await collectEntitiesForPeriod(shopId, { from, to, entityTypes });
    targets = collected.entities;
    truncated = collected.truncated;
  }

  const run = await createRun(shopId, {
    runType,
    scope: { from: from ?? null, to: to ?? null, entityTypes, entityCount: targets.length, truncated },
    periodFrom: from ?? null,
    periodTo: to ?? null,
    triggeredByUserId: actor.userId,
  });

  const outcome = await executeRun(shopId, run, targets, { actorUserId: actor.userId });
  return { ...outcome, runType, entityCount: targets.length, truncated };
}

export async function listRuns(shopId, query = {}) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(query.limit) || DEFAULT_PAGE_SIZE));
  const where = { shopId, ...(query.runType ? { runType: query.runType } : {}), ...(query.status ? { status: query.status } : {}) };
  const [total, rows] = await Promise.all([
    db.auditRun.count({ where }),
    db.auditRun.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * limit, take: limit }),
  ]);
  return {
    runs: rows.map(serializeRun),
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

function serializeRun(run) {
  return {
    runId: run.id,
    runType: run.runType,
    status: run.status,
    engineVersion: run.engineVersion,
    rulesetVersion: run.rulesetVersion,
    scope: parseJson(run.scopeJson, {}),
    periodFrom: run.periodFrom,
    periodTo: run.periodTo,
    entitiesEvaluated: run.entitiesEvaluated,
    findingsCreated: run.findingsCreated,
    findingsUpdated: run.findingsUpdated,
    summary: parseJson(run.summaryJson, {}),
    error: run.error,
    triggeredByUserId: run.triggeredByUserId,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    createdAt: run.createdAt,
  };
}

export async function getRun(shopId, runId) {
  const run = await db.auditRun.findFirst({ where: { id: runId, shopId } });
  if (!run) throw new AppError("Audit run not found", 404, "AUDIT_RUN_NOT_FOUND");
  const evaluations = await db.auditEvaluation.findMany({
    where: { auditRunId: run.id, shopId },
    select: { id: true, sourceEntityType: true, sourceEntityId: true, riskScore: true, triggeredRuleCodesJson: true, inputHash: true, createdAt: true },
    orderBy: { riskScore: "desc" },
    take: 200,
  });
  return {
    ...serializeRun(run),
    evaluations: evaluations.map((row) => ({
      evaluationId: row.id,
      sourceEntityType: row.sourceEntityType,
      sourceEntityId: row.sourceEntityId,
      riskScore: row.riskScore,
      triggeredRuleCodes: parseJson(row.triggeredRuleCodesJson, []),
      inputHash: row.inputHash,
      createdAt: row.createdAt,
    })),
  };
}

// ── single-entity evaluation (used by the API and by transaction hooks) ──

export async function evaluateSingleEntity(shopId, actor, entityType, entityId) {
  assertCapability(actor.role, CAPABILITIES.TRIGGER_RUN);
  const run = await createRun(shopId, {
    runType: RUN_TYPES.MANUAL,
    scope: { entityType, entityId },
    triggeredByUserId: actor.userId,
  });
  const outcome = await executeRun(shopId, run, [{ entityType: String(entityType).toUpperCase(), entityId }], { actorUserId: actor.userId });
  if (outcome.failures.length) {
    const failure = outcome.failures[0];
    if (failure.code === "ENTITY_NOT_FOUND") {
      throw new AppError("Transaction not found in this shop", 404, "AUDIT_ENTITY_NOT_FOUND");
    }
    if (failure.code === "UNKNOWN_ENTITY_TYPE" || failure.code === "UNSUPPORTED_AUDIT_ENTITY_TYPE") {
      throw new AppError(`Unsupported audit entity type: ${entityType}`, 400, "UNSUPPORTED_AUDIT_ENTITY_TYPE");
    }
    throw new AppError(`Evaluation failed: ${failure.message}`, 500, "AUDIT_EVALUATION_FAILED");
  }
  const finding = await db.auditFinding.findFirst({
    where: { shopId, sourceEntityType: String(entityType).toUpperCase(), sourceEntityId: entityId },
    include: { rules: true },
  });
  return {
    runId: run.id,
    evaluated: outcome.evaluated,
    finding: finding ? serializeFinding(finding, { includeBreakdown: true }) : null,
  };
}

// ── rules ─────────────────────────────────────────────────────

export async function listRules(shopId) {
  const overrides = await db.auditRule.findMany({ where: { shopId } });
  const overrideByCode = new Map(overrides.map((row) => [row.ruleCode, row]));
  return {
    engineVersion: ENGINE_VERSION,
    rulesetVersion: RULESET_VERSION,
    rules: ruleCatalog().map((rule) => {
      const override = overrideByCode.get(rule.ruleCode);
      return {
        ...rule,
        enabled: override ? override.enabled : rule.enabledByDefault,
        effectiveWeight: override?.weightOverride ?? rule.defaultWeight,
        weightOverride: override?.weightOverride ?? null,
        thresholds: override ? parseJson(override.thresholdsJson, {}) : {},
        overrideId: override?.id ?? null,
        updatedAt: override?.updatedAt ?? null,
      };
    }),
  };
}

export async function updateRule(shopId, actor, ruleCode, { enabled, weightOverride, thresholds }) {
  assertCapability(actor.role, CAPABILITIES.CONFIGURE_RULES);
  const rule = RULES_BY_CODE[ruleCode];
  if (!rule) throw new AppError("Unknown rule code", 404, "AUDIT_RULE_NOT_FOUND");

  const data = {
    ...(enabled === undefined ? {} : { enabled }),
    ...(weightOverride === undefined ? {} : { weightOverride }),
    ...(thresholds === undefined ? {} : { thresholdsJson: JSON.stringify(thresholds) }),
    updatedByUserId: actor.userId,
  };

  const saved = await db.auditRule.upsert({
    where: { shopId_ruleCode: { shopId, ruleCode } },
    update: data,
    create: {
      shopId,
      ruleCode,
      enabled: enabled === undefined ? rule.enabled : enabled,
      weightOverride: weightOverride === undefined ? null : weightOverride,
      thresholdsJson: thresholds === undefined ? "{}" : JSON.stringify(thresholds),
      updatedByUserId: actor.userId,
    },
  });

  return {
    ruleCode: saved.ruleCode,
    enabled: saved.enabled,
    weightOverride: saved.weightOverride,
    effectiveWeight: saved.weightOverride ?? rule.defaultWeight,
    thresholds: parseJson(saved.thresholdsJson, {}),
    defaultWeight: rule.defaultWeight,
    severity: rule.severity,
    version: rule.version,
  };
}

// ── dashboard ─────────────────────────────────────────────────

export async function getDashboard(shopId, actor) {
  const visibility = findingVisibilityFilter(actor);
  const scope = { shopId, ...visibility };
  const openStatuses = [FINDING_STATUS.OPEN, FINDING_STATUS.EVIDENCE_REQUESTED, FINDING_STATUS.UNDER_REVIEW];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [
    openCount,
    criticalCount,
    highCount,
    byStatus,
    byCategory,
    byRiskLevel,
    highRiskFindings,
    openEvidenceRequests,
    latestRun,
    topRules,
    recentFindings,
    trendRows,
  ] = await Promise.all([
    db.auditFinding.count({ where: { ...scope, status: { in: openStatuses } } }),
    db.auditFinding.count({ where: { ...scope, status: { in: openStatuses }, riskLevel: RISK_LEVELS.CRITICAL } }),
    db.auditFinding.count({ where: { ...scope, status: { in: openStatuses }, riskLevel: RISK_LEVELS.HIGH } }),
    db.auditFinding.groupBy({ by: ["status"], where: scope, _count: { _all: true } }),
    db.auditFinding.groupBy({ by: ["primaryCategory"], where: { ...scope, status: { in: openStatuses } }, _count: { _all: true } }),
    db.auditFinding.groupBy({ by: ["riskLevel"], where: { ...scope, status: { in: openStatuses } }, _count: { _all: true } }),
    db.auditFinding.findMany({
      where: { ...scope, status: { in: openStatuses }, riskLevel: { in: [RISK_LEVELS.HIGH, RISK_LEVELS.CRITICAL] } },
      select: { amountPaise: true },
    }),
    db.auditEvidenceRequirement.count({ where: { shopId, status: { in: [EVIDENCE_STATUS.REQUESTED, EVIDENCE_STATUS.INSUFFICIENT] } } }),
    db.auditRun.findFirst({ where: { shopId }, orderBy: { createdAt: "desc" } }),
    db.auditFindingRule.groupBy({
      by: ["ruleCode"],
      where: { shopId, active: true },
      _count: { _all: true },
      orderBy: { _count: { ruleCode: "desc" } },
      take: 8,
    }),
    db.auditFinding.findMany({
      where: { ...scope, status: { in: openStatuses } },
      include: { rules: true },
      orderBy: [{ riskScore: "desc" }, { createdAt: "desc" }],
      take: 8,
    }),
    db.auditFinding.findMany({
      where: { ...scope, createdAt: { gte: thirtyDaysAgo } },
      select: { createdAt: true, riskLevel: true, status: true },
    }),
  ]);

  const highRiskAmountPaise = highRiskFindings.reduce((total, row) => total + Number(row.amountPaise ?? 0), 0);

  // Affected staff / customers / suppliers, derived from open findings' sources.
  const affected = await affectedParties(shopId, scope, openStatuses);

  return {
    generatedAt: new Date().toISOString(),
    engineVersion: ENGINE_VERSION,
    rulesetVersion: RULESET_VERSION,
    totals: {
      openFindings: openCount,
      criticalFindings: criticalCount,
      highFindings: highCount,
      highRiskAmountPaise,
      highRiskAmountRupees: Number((highRiskAmountPaise / 100).toFixed(2)),
      unresolvedEvidenceRequests: openEvidenceRequests,
    },
    byStatus: Object.fromEntries(byStatus.map((row) => [row.status, row._count._all])),
    byCategory: Object.fromEntries(byCategory.map((row) => [row.primaryCategory ?? "UNCATEGORIZED", row._count._all])),
    byRiskLevel: Object.fromEntries(byRiskLevel.map((row) => [row.riskLevel, row._count._all])),
    topRiskAreas: topRules.map((row) => ({
      ruleCode: row.ruleCode,
      name: RULES_BY_CODE[row.ruleCode]?.name ?? row.ruleCode,
      category: RULES_BY_CODE[row.ruleCode]?.category ?? null,
      severity: RULES_BY_CODE[row.ruleCode]?.severity ?? null,
      findingCount: row._count._all,
    })),
    latestRun: latestRun ? serializeRun(latestRun) : null,
    topFindings: recentFindings.map((row) => serializeFinding(row)),
    trend: buildTrend(trendRows),
    affected,
    disclaimer:
      "Continuous financial-control monitoring. These are potential inconsistencies for review, not statutory audit conclusions and not accusations.",
  };
}

function buildTrend(rows) {
  const byDay = new Map();
  for (const row of rows) {
    const key = new Date(row.createdAt).toISOString().slice(0, 10);
    const bucket = byDay.get(key) ?? { date: key, total: 0, critical: 0, high: 0 };
    bucket.total += 1;
    if (row.riskLevel === RISK_LEVELS.CRITICAL) bucket.critical += 1;
    if (row.riskLevel === RISK_LEVELS.HIGH) bucket.high += 1;
    byDay.set(key, bucket);
  }
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
}

async function affectedParties(shopId, scope, openStatuses) {
  const findings = await db.auditFinding.findMany({
    where: { ...scope, status: { in: openStatuses } },
    select: { sourceEntityType: true, sourceEntityId: true, riskScore: true },
    take: 500,
  });

  const billIds = findings.filter((f) => f.sourceEntityType === ENTITY_TYPES.BILL).map((f) => f.sourceEntityId);
  const customerIds = findings.filter((f) => f.sourceEntityType === ENTITY_TYPES.CUSTOMER).map((f) => f.sourceEntityId);
  const purchaseIds = findings.filter((f) => f.sourceEntityType === ENTITY_TYPES.PURCHASE).map((f) => f.sourceEntityId);

  const [bills, customers, receipts, quickPurchases] = await Promise.all([
    billIds.length
      ? db.bill.findMany({ where: { shopId, id: { in: billIds } }, select: { id: true, createdByUserId: true, customerId: true } })
      : [],
    customerIds.length
      ? db.customer.findMany({ where: { shopId, id: { in: customerIds } }, select: { id: true, name: true, udharAmount: true } })
      : [],
    purchaseIds.length
      ? db.purchaseReceipt.findMany({ where: { shopId, id: { in: purchaseIds } }, select: { id: true, supplierId: true, supplier: { select: { id: true, name: true } } } })
      : [],
    purchaseIds.length
      ? db.purchaseHistory.findMany({ where: { shopId, id: { in: purchaseIds } }, select: { id: true, supplierId: true, supplierName: true } })
      : [],
  ]);

  const staffCounts = new Map();
  for (const bill of bills) {
    if (!bill.createdByUserId) continue;
    staffCounts.set(bill.createdByUserId, (staffCounts.get(bill.createdByUserId) ?? 0) + 1);
  }
  const staffUsers = staffCounts.size
    ? await db.user.findMany({ where: { shopId, id: { in: [...staffCounts.keys()] } }, select: { id: true, name: true, role: true } })
    : [];

  const supplierCounts = new Map();
  for (const receipt of receipts) {
    const key = receipt.supplier?.id ?? receipt.supplierId;
    if (!key) continue;
    const current = supplierCounts.get(key) ?? { supplierId: key, name: receipt.supplier?.name ?? null, findingCount: 0 };
    current.findingCount += 1;
    supplierCounts.set(key, current);
  }
  for (const purchase of quickPurchases) {
    const key = purchase.supplierId ?? `name:${purchase.supplierName}`;
    const current = supplierCounts.get(key) ?? { supplierId: purchase.supplierId ?? null, name: purchase.supplierName ?? null, findingCount: 0 };
    current.findingCount += 1;
    supplierCounts.set(key, current);
  }

  const customerFindingCounts = new Map();
  for (const finding of findings) {
    if (finding.sourceEntityType !== ENTITY_TYPES.CUSTOMER) continue;
    customerFindingCounts.set(finding.sourceEntityId, (customerFindingCounts.get(finding.sourceEntityId) ?? 0) + 1);
  }

  return {
    staff: staffUsers
      .map((user) => ({ userId: user.id, name: user.name, role: user.role, findingCount: staffCounts.get(user.id) ?? 0 }))
      .sort((a, b) => b.findingCount - a.findingCount)
      .slice(0, 10),
    customers: customers
      .map((customer) => ({
        customerId: customer.id,
        name: customer.name,
        outstandingRupees: Number(customer.udharAmount ?? 0),
        findingCount: customerFindingCounts.get(customer.id) ?? 0,
      }))
      .sort((a, b) => b.findingCount - a.findingCount)
      .slice(0, 10),
    suppliers: [...supplierCounts.values()].sort((a, b) => b.findingCount - a.findingCount).slice(0, 10),
  };
}

// ── AI explanation (optional, never authoritative) ────────────

export async function generateFindingExplanation(shopId, actor, findingId, { language = "en" } = {}) {
  const visibility = findingVisibilityFilter(actor);
  const finding = await db.auditFinding.findFirst({
    where: { id: findingId, shopId, ...visibility },
    include: { rules: true },
  });
  if (!finding) throw new AppError("Finding not found", 404, "AUDIT_FINDING_NOT_FOUND");

  const explanation = await explainFinding({
    finding: serializeFinding(finding, { includeBreakdown: true }),
    language,
  });

  // The explanation is stored alongside — never instead of — the deterministic
  // breakdown, and is clearly attributed to its source (ai or fallback).
  const updated = await db.auditFinding.update({
    where: { id: finding.id },
    data: { aiExplanation: explanation.text, aiExplanationLang: explanation.language },
  });

  return {
    findingId: updated.id,
    explanation: explanation.text,
    language: explanation.language,
    source: explanation.source,
    provider: explanation.provider,
    degraded: explanation.degraded,
    suggestedEvidence: explanation.suggestedEvidence,
    disclaimer: explanation.disclaimer,
  };
}

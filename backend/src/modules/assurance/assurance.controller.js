// HTTP layer for /api/audit. Every handler:
//   * runs behind requireAuth + requireShop (shopId comes only from the JWT)
//   * takes validated input from the schema middleware
//   * writes an AuditLog row for state-changing actions
//   * returns { success, data } and lets the global error handler shape failures
import * as svc from "./assurance.service.js";
import { createAuditLog } from "../audit/audit.service.js";
import { buildAssuranceReport } from "./report.service.js";
import { recomputeShopBaselines } from "./baseline.service.js";
import { auditAiStatus } from "./ai/audit-ai.service.js";
import { CAPABILITIES, assertCapability, capabilitiesForRole } from "./assurance.permissions.js";
import * as caseSvc from "./case.service.js";
import { classifyEvidence as classifyEvidenceWithAi } from "./ai/audit-ai.service.js";
import { EVIDENCE_TYPES } from "./assurance.constants.js";

function actorFrom(req) {
  return { userId: req.user?.userId ?? null, role: req.user?.role ?? "staff" };
}

export async function listRuns(req, res, next) {
  try {
    const data = await svc.listRuns(req.shopId, req.query);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function getRun(req, res, next) {
  try {
    const data = await svc.getRun(req.shopId, req.params.id);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function createRun(req, res, next) {
  try {
    const actor = actorFrom(req);
    const data = await svc.startRun(req.shopId, actor, req.body);
    await createAuditLog({
      shopId: req.shopId,
      userId: actor.userId,
      action: "AUDIT_RUN_STARTED",
      entityType: "AuditRun",
      entityId: data.runId,
      metadata: { runType: data.runType, entityCount: data.entityCount, status: data.status, from: req.body.from, to: req.body.to },
      req,
    }).catch(() => null);
    res.status(201).json({ success: true, data });
  } catch (err) { next(err); }
}

export async function listFindings(req, res, next) {
  try {
    const data = await svc.listFindings(req.shopId, actorFrom(req), req.query);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function getFinding(req, res, next) {
  try {
    const data = await svc.getFinding(req.shopId, actorFrom(req), req.params.id);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function updateFindingStatus(req, res, next) {
  try {
    const actor = actorFrom(req);
    const data = await svc.transitionFindingStatus(req.shopId, actor, req.params.id, req.body);
    await createAuditLog({
      shopId: req.shopId,
      userId: actor.userId,
      action: "AUDIT_FINDING_STATUS_CHANGED",
      entityType: "AuditFinding",
      entityId: req.params.id,
      after: { status: data.status, resolutionType: data.resolutionType },
      metadata: { comment: req.body.comment ?? null, approvalLevel: req.body.approvalLevel ?? null },
      req,
    }).catch(() => null);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function requestEvidence(req, res, next) {
  try {
    const actor = actorFrom(req);
    const data = await svc.requestEvidence(req.shopId, actor, req.params.id, req.body);
    await createAuditLog({
      shopId: req.shopId,
      userId: actor.userId,
      action: "AUDIT_EVIDENCE_REQUESTED",
      entityType: "AuditFinding",
      entityId: req.params.id,
      metadata: { evidenceType: data.evidenceType, requirementId: data.requirementId },
      req,
    }).catch(() => null);
    res.status(201).json({ success: true, data });
  } catch (err) { next(err); }
}

export async function submitEvidence(req, res, next) {
  try {
    const actor = actorFrom(req);
    const data = await svc.submitEvidence(req.shopId, actor, req.params.id, req.body);
    await createAuditLog({
      shopId: req.shopId,
      userId: actor.userId,
      action: "AUDIT_EVIDENCE_SUBMITTED",
      entityType: "AuditEvidence",
      entityId: data.evidenceId,
      metadata: { findingId: req.params.id, evidenceType: data.evidenceType, reuseWarningCount: data.reuseWarningCount },
      req,
    }).catch(() => null);
    res.status(201).json({ success: true, data });
  } catch (err) { next(err); }
}

export async function verifyEvidence(req, res, next) {
  try {
    const actor = actorFrom(req);
    const data = await svc.verifyEvidence(req.shopId, actor, req.params.evidenceId, req.body);
    await createAuditLog({
      shopId: req.shopId,
      userId: actor.userId,
      action: "AUDIT_EVIDENCE_VERIFIED",
      entityType: "AuditEvidence",
      entityId: req.params.evidenceId,
      after: { verificationStatus: data.verificationStatus },
      req,
    }).catch(() => null);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function listEvidenceRequests(req, res, next) {
  try {
    const data = await svc.listEvidenceRequests(req.shopId, actorFrom(req), req.query);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function addReview(req, res, next) {
  try {
    const actor = actorFrom(req);
    const data = await svc.addReview(req.shopId, actor, req.params.id, req.body);
    await createAuditLog({
      shopId: req.shopId,
      userId: actor.userId,
      action: "AUDIT_FINDING_REVIEWED",
      entityType: "AuditFinding",
      entityId: req.params.id,
      metadata: { decision: req.body.decision, newStatus: req.body.newStatus ?? null },
      req,
    }).catch(() => null);
    res.status(201).json({ success: true, data });
  } catch (err) { next(err); }
}

export async function assignReviewer(req, res, next) {
  try {
    const actor = actorFrom(req);
    const data = await svc.assignReviewer(req.shopId, actor, req.params.id, req.body);
    await createAuditLog({
      shopId: req.shopId,
      userId: actor.userId,
      action: "AUDIT_FINDING_ASSIGNED",
      entityType: "AuditFinding",
      entityId: req.params.id,
      metadata: { reviewerUserId: req.body.reviewerUserId },
      req,
    }).catch(() => null);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function dashboard(req, res, next) {
  try {
    const data = await svc.getDashboard(req.shopId, actorFrom(req));
    res.json({ success: true, data: { ...data, aiStatus: auditAiStatus(), capabilities: capabilitiesForRole(req.user?.role) } });
  } catch (err) { next(err); }
}

export async function listRules(req, res, next) {
  try {
    const data = await svc.listRules(req.shopId);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function updateRule(req, res, next) {
  try {
    const actor = actorFrom(req);
    const data = await svc.updateRule(req.shopId, actor, req.params.ruleCode, req.body);
    await createAuditLog({
      shopId: req.shopId,
      userId: actor.userId,
      action: "AUDIT_RULE_UPDATED",
      entityType: "AuditRule",
      entityId: req.params.ruleCode,
      after: { enabled: data.enabled, weightOverride: data.weightOverride, thresholds: data.thresholds },
      req,
    }).catch(() => null);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function evaluateTransaction(req, res, next) {
  try {
    const actor = actorFrom(req);
    const { entityType, entityId } = req.params;
    const data = await svc.evaluateSingleEntity(req.shopId, actor, entityType, entityId);
    await createAuditLog({
      shopId: req.shopId,
      userId: actor.userId,
      action: "AUDIT_TRANSACTION_EVALUATED",
      entityType: "AuditRun",
      entityId: data.runId,
      metadata: { sourceEntityType: entityType, sourceEntityId: entityId, findingId: data.finding?.findingId ?? null },
      req,
    }).catch(() => null);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function evaluateDateRange(req, res, next) {
  try {
    const actor = actorFrom(req);
    const data = await svc.startRun(req.shopId, actor, { ...req.body, runType: req.body.runType ?? "MANUAL" });
    await createAuditLog({
      shopId: req.shopId,
      userId: actor.userId,
      action: "AUDIT_RANGE_EVALUATED",
      entityType: "AuditRun",
      entityId: data.runId,
      metadata: { from: req.body.from, to: req.body.to, entityCount: data.entityCount },
      req,
    }).catch(() => null);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function report(req, res, next) {
  try {
    assertCapability(req.user?.role, CAPABILITIES.VIEW_REPORTS);
    const data = await buildAssuranceReport(req.shopId, req.query);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function recomputeBaselines(req, res, next) {
  try {
    assertCapability(req.user?.role, CAPABILITIES.TRIGGER_RUN);
    const baselineCount = await recomputeShopBaselines(req.shopId);
    res.json({ success: true, data: { baselineCount } });
  } catch (err) { next(err); }
}

export async function explainFinding(req, res, next) {
  try {
    const data = await svc.generateFindingExplanation(req.shopId, actorFrom(req), req.params.id, req.body);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

// ── investigation cases ───────────────────────────────────────

export async function proposeCases(req, res, next) {
  try {
    const data = await caseSvc.proposeCases(req.shopId, actorFrom(req), req.query);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function listCases(req, res, next) {
  try {
    const data = await caseSvc.listCases(req.shopId, req.query);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function getCase(req, res, next) {
  try {
    const data = await caseSvc.getCase(req.shopId, actorFrom(req), req.params.id);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function createCase(req, res, next) {
  try {
    const actor = actorFrom(req);
    const data = await caseSvc.createCase(req.shopId, actor, req.body);
    await createAuditLog({
      shopId: req.shopId,
      userId: actor.userId,
      action: "AUDIT_CASE_CREATED",
      entityType: "AuditCase",
      entityId: data.caseId,
      metadata: { findingCount: data.findingCount, riskLevel: data.riskLevel },
      req,
    }).catch(() => null);
    res.status(201).json({ success: true, data });
  } catch (err) { next(err); }
}

export async function summarizeCase(req, res, next) {
  try {
    const data = await caseSvc.generateCaseSummary(req.shopId, actorFrom(req), req.params.id);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function updateCaseStatus(req, res, next) {
  try {
    const actor = actorFrom(req);
    const data = await caseSvc.closeCase(req.shopId, actor, req.params.id, req.body);
    await createAuditLog({
      shopId: req.shopId,
      userId: actor.userId,
      action: "AUDIT_CASE_STATUS_CHANGED",
      entityType: "AuditCase",
      entityId: req.params.id,
      after: { status: data.status },
      req,
    }).catch(() => null);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

// ── evidence classification (advisory; a human still verifies) ──

export async function classifyEvidence(req, res, next) {
  try {
    assertCapability(req.user?.role, CAPABILITIES.SUBMIT_EVIDENCE);
    const data = await classifyEvidenceWithAi({
      description: req.body.description,
      allowedEvidenceTypes: Object.values(EVIDENCE_TYPES),
    });
    res.json({
      success: true,
      data: {
        ...data,
        advisory: true,
        note: "Suggestion only. The evidence type you submit and its verification remain human decisions.",
      },
    });
  } catch (err) { next(err); }
}

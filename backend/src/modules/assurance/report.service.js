// Financial Assurance Report (a.k.a. Continuous Control Report).
//
// This is NOT a statutory audit report and must never be labelled as one. It
// summarizes what the deterministic engine reviewed in a period, what it
// flagged, what management did about it, and — importantly — what it could not
// check. The limitations block is not optional decoration; it is part of the
// report's meaning.
import db from "../../db.js";
import {
  ENGINE_VERSION,
  ENTITY_TYPES,
  EVIDENCE_STATUS,
  FINDING_STATUS,
  RISK_LEVELS,
  RULE_CATEGORIES,
} from "./assurance.constants.js";
import { RULES_BY_CODE, RULESET_VERSION } from "./rules/index.js";

export const REPORT_TITLE = "Financial Assurance Report";
export const REPORT_SUBTITLE = "Continuous Control Report — not a statutory audit report";

const OPEN_STATUSES = [FINDING_STATUS.OPEN, FINDING_STATUS.EVIDENCE_REQUESTED, FINDING_STATUS.UNDER_REVIEW];
const RESOLVED_STATUSES = [
  FINDING_STATUS.CONFIRMED_ISSUE,
  FINDING_STATUS.FALSE_POSITIVE,
  FINDING_STATUS.CORRECTED,
  FINDING_STATUS.ACCEPTED_RISK,
  FINDING_STATUS.CLOSED,
];

export const REPORT_LIMITATIONS = Object.freeze([
  "This is a continuous financial-control report produced by deterministic rules over KiranaOS records. It is not a statutory audit, carries no audit opinion, and does not replace a Chartered Accountant.",
  "Conclusions are limited to data recorded in KiranaOS. Cash, goods or credit that was never entered into the system cannot be detected.",
  "Physical drawer assurance depends on the operator entering an accurate count and declaring opening float and manual till movements; the system can detect variance but cannot independently observe cash outside the software.",
  "There is no bank or UPI provider feed. UPI references are operator-entered: reuse is detectable, authenticity is not.",
  "New expenses store a server-authenticated creator id and immutable role/name snapshots. Legacy or imported expenses may still lack that identity and are reported as unattributed.",
  "Stock movements carry no actor column, so stock corrections cannot be attributed to an individual staff member.",
  "Records created before the shop's ledger coverage began cannot be reconciled to movements and are reported as insufficient data rather than as violations.",
  "Behavioural baselines require a minimum sample; where history is too thin the related rules are skipped instead of guessing.",
  "Multi-location products are excluded from whole-product stock reconciliation because the primary location holds the residual balance.",
  "Evidence checksums prove a submitted reference has not changed since submission. They do not prove the underlying document is genuine.",
  "AI-generated text in this module only rephrases deterministic results. It never calculates, decides, or closes anything.",
]);

export async function buildAssuranceReport(shopId, { from, to }) {
  const periodFrom = new Date(from);
  const periodTo = new Date(to);
  const createdRange = { gte: periodFrom, lte: periodTo };

  const [
    runs,
    evaluationCount,
    findingsRaised,
    findingsResolved,
    openCritical,
    openByCategory,
    highRiskOpen,
    evidenceCounts,
    reviews,
    resolutionBreakdown,
  ] = await Promise.all([
    db.auditRun.findMany({ where: { shopId, createdAt: createdRange }, orderBy: { createdAt: "asc" } }),
    db.auditEvaluation.count({ where: { shopId, createdAt: createdRange } }),
    db.auditFinding.findMany({
      where: { shopId, createdAt: createdRange },
      include: { rules: true },
    }),
    db.auditFinding.count({ where: { shopId, resolvedAt: createdRange, status: { in: RESOLVED_STATUSES } } }),
    db.auditFinding.findMany({
      where: { shopId, status: { in: OPEN_STATUSES }, riskLevel: RISK_LEVELS.CRITICAL },
      include: { rules: true },
      orderBy: { riskScore: "desc" },
      take: 25,
    }),
    db.auditFinding.groupBy({
      by: ["primaryCategory"],
      where: { shopId, status: { in: OPEN_STATUSES } },
      _count: { _all: true },
    }),
    db.auditFinding.findMany({
      where: { shopId, status: { in: OPEN_STATUSES }, riskLevel: { in: [RISK_LEVELS.HIGH, RISK_LEVELS.CRITICAL] } },
      select: { discrepancyPaise: true, riskLevel: true },
    }),
    db.auditEvidenceRequirement.groupBy({
      by: ["status"],
      where: { shopId },
      _count: { _all: true },
    }),
    db.auditReview.findMany({
      where: { shopId, createdAt: createdRange },
      select: { decision: true, notes: true, reviewerRole: true, createdAt: true, findingId: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    db.auditFinding.groupBy({
      by: ["resolutionType"],
      where: { shopId, resolvedAt: createdRange },
      _count: { _all: true },
    }),
  ]);

  // Sum of measured gaps, not of record sizes — see assurance.service.js.
  const quantifiedExposure = highRiskOpen.filter((row) => row.discrepancyPaise !== null && row.discrepancyPaise !== undefined);
  const highRiskExposurePaise = quantifiedExposure.reduce((total, row) => total + Number(row.discrepancyPaise), 0);

  const ruleCounts = new Map();
  for (const finding of findingsRaised) {
    for (const rule of finding.rules) {
      ruleCounts.set(rule.ruleCode, (ruleCounts.get(rule.ruleCode) ?? 0) + 1);
    }
  }

  const categoryCount = (category) =>
    findingsRaised.filter((finding) => finding.rules.some((rule) => rule.category === category)).length;

  return {
    title: REPORT_TITLE,
    subtitle: REPORT_SUBTITLE,
    isStatutoryAudit: false,
    generatedAt: new Date().toISOString(),
    engineVersion: ENGINE_VERSION,
    rulesetVersion: RULESET_VERSION,
    period: { from: periodFrom.toISOString(), to: periodTo.toISOString() },

    coverage: {
      auditRuns: runs.length,
      runTypes: countBy(runs, (run) => run.runType),
      transactionsReviewed: evaluationCount,
      entitiesByType: countBy(
        findingsRaised,
        (finding) => finding.sourceEntityType
      ),
      lastRunAt: runs.length ? runs[runs.length - 1].createdAt : null,
    },

    findings: {
      raised: findingsRaised.length,
      resolved: findingsResolved,
      openCritical: openCritical.length,
      byRiskLevel: countBy(findingsRaised, (finding) => finding.riskLevel),
      byStatus: countBy(findingsRaised, (finding) => finding.status),
      byCategory: Object.fromEntries(openByCategory.map((row) => [row.primaryCategory ?? "UNCATEGORIZED", row._count._all])),
      topRules: [...ruleCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([ruleCode, count]) => ({
          ruleCode,
          name: RULES_BY_CODE[ruleCode]?.name ?? ruleCode,
          category: RULES_BY_CODE[ruleCode]?.category ?? null,
          severity: RULES_BY_CODE[ruleCode]?.severity ?? null,
          findingCount: count,
        })),
    },

    exposure: {
      highRiskAmountPaise: highRiskExposurePaise,
      highRiskAmountRupees: Number((highRiskExposurePaise / 100).toFixed(2)),
      criticalFindingCount: highRiskOpen.filter((row) => row.riskLevel === RISK_LEVELS.CRITICAL).length,
      highFindingCount: highRiskOpen.filter((row) => row.riskLevel === RISK_LEVELS.HIGH).length,
      quantifiedFindings: quantifiedExposure.length,
      unquantifiedFindings: highRiskOpen.length - quantifiedExposure.length,
      note: "Total of the gaps the rules actually measured (shortfalls, drifts, differences) across open high and critical findings. Findings where no rule could quantify a gap are counted separately and contribute nothing to this figure. It is money to investigate, not a confirmed loss.",
    },

    byArea: {
      reconciliationMismatches: categoryCount(RULE_CATEGORIES.RECONCILIATION),
      billingAnomalies: categoryCount(RULE_CATEGORIES.BILLING),
      customerCreditInconsistencies: categoryCount(RULE_CATEGORIES.CUSTOMER_CREDIT),
      inventoryInconsistencies: categoryCount(RULE_CATEGORIES.INVENTORY),
      purchaseRisks: categoryCount(RULE_CATEGORIES.PURCHASE),
      expenseRisks: categoryCount(RULE_CATEGORIES.EXPENSE),
      dailyClosingDifferences: categoryCount(RULE_CATEGORIES.CASH_CLOSING),
      syncIntegrityIssues: categoryCount(RULE_CATEGORIES.SYNC_INTEGRITY),
      authorizationGaps: categoryCount(RULE_CATEGORIES.AUTHORIZATION),
      duplicateRisks: findingsRaised.filter((finding) =>
        finding.rules.some((rule) => rule.ruleCode.includes("DUPLICATE") || rule.ruleCode.includes("NEAR_DUPLICATE"))
      ).length,
    },

    evidence: {
      byStatus: Object.fromEntries(evidenceCounts.map((row) => [row.status, row._count._all])),
      outstandingRequests:
        (evidenceCounts.find((row) => row.status === EVIDENCE_STATUS.REQUESTED)?._count._all ?? 0) +
        (evidenceCounts.find((row) => row.status === EVIDENCE_STATUS.INSUFFICIENT)?._count._all ?? 0),
      note: "Submitted evidence is not treated as valid until a reviewer verifies it.",
    },

    managementResponses: {
      reviewCount: reviews.length,
      byDecision: countBy(reviews, (review) => review.decision),
      byResolutionType: Object.fromEntries(resolutionBreakdown.map((row) => [row.resolutionType ?? "UNRESOLVED", row._count._all])),
      recent: reviews.slice(0, 20).map((review) => ({
        findingId: review.findingId,
        decision: review.decision,
        reviewerRole: review.reviewerRole,
        notes: review.notes,
        createdAt: review.createdAt,
      })),
    },

    openCriticalFindings: openCritical.map((finding) => ({
      findingId: finding.id,
      title: finding.title,
      riskScore: finding.riskScore,
      riskLevel: finding.riskLevel,
      status: finding.status,
      sourceEntityType: finding.sourceEntityType,
      sourceEntityId: finding.sourceEntityId,
      amountRupees: finding.amountPaise === null ? null : Number((Number(finding.amountPaise) / 100).toFixed(2)),
      ruleCodes: finding.rules.filter((rule) => rule.active).map((rule) => rule.ruleCode),
      createdAt: finding.createdAt,
    })),

    limitations: REPORT_LIMITATIONS,
  };
}

function countBy(rows, keyFn) {
  const counts = {};
  for (const row of rows) {
    const key = keyFn(row) ?? "UNKNOWN";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

export { ENTITY_TYPES };

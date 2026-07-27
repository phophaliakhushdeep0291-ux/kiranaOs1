// Investigation cases — grouping related findings so a reviewer works a story
// rather than a list of rows.
//
// Grouping is DETERMINISTIC: findings are linked because they share a real
// relationship in the data (the same customer, the same supplier, the same
// staff member, the same locked day, the same rule pattern). The AI layer may
// summarize a case once it exists, but it never decides what belongs in one —
// same boundary as everywhere else in this module.
import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { ENTITY_TYPES, FINDING_STATUS, RISK_LEVELS } from "./assurance.constants.js";
import { CAPABILITIES, assertCapability, findingVisibilityFilter } from "./assurance.permissions.js";
import { summarizeCase as summarizeCaseWithAi } from "./ai/audit-ai.service.js";

const OPEN_STATUSES = [FINDING_STATUS.OPEN, FINDING_STATUS.EVIDENCE_REQUESTED, FINDING_STATUS.UNDER_REVIEW];

/** Grouping strategies, in the order a reviewer would naturally think about them. */
export const GROUPING_STRATEGIES = Object.freeze({
  CUSTOMER: "CUSTOMER",
  SUPPLIER: "SUPPLIER",
  STAFF: "STAFF",
  LOCKED_DAY: "LOCKED_DAY",
  RULE_PATTERN: "RULE_PATTERN",
});

function highestRiskLevel(findings) {
  const order = [RISK_LEVELS.LOW, RISK_LEVELS.MEDIUM, RISK_LEVELS.HIGH, RISK_LEVELS.CRITICAL];
  return findings.reduce((worst, finding) => {
    return order.indexOf(finding.riskLevel) > order.indexOf(worst) ? finding.riskLevel : worst;
  }, RISK_LEVELS.LOW);
}

/**
 * Propose case groupings over the shop's open findings. Returns groups only —
 * nothing is persisted until the caller creates a case, so a reviewer always
 * decides what becomes an investigation.
 */
export async function proposeCases(shopId, actor, { minimumFindings = 2 } = {}) {
  const visibility = findingVisibilityFilter(actor);
  const findings = await db.auditFinding.findMany({
    where: { shopId, ...visibility, status: { in: OPEN_STATUSES } },
    include: { rules: { where: { active: true } } },
    orderBy: { riskScore: "desc" },
    take: 500,
  });
  if (!findings.length) return { groups: [], findingsConsidered: 0 };

  const links = await resolveFindingLinks(shopId, findings);
  const buckets = new Map();

  const addTo = (key, strategy, label, finding) => {
    const bucket = buckets.get(key) ?? { key, strategy, label, findings: [] };
    bucket.findings.push(finding);
    buckets.set(key, bucket);
  };

  for (const finding of findings) {
    const link = links.get(finding.id) ?? {};
    if (link.customerId) addTo(`CUSTOMER:${link.customerId}`, GROUPING_STRATEGIES.CUSTOMER, link.customerLabel, finding);
    if (link.supplierKey) addTo(`SUPPLIER:${link.supplierKey}`, GROUPING_STRATEGIES.SUPPLIER, link.supplierLabel, finding);
    if (link.staffUserId) addTo(`STAFF:${link.staffUserId}`, GROUPING_STRATEGIES.STAFF, link.staffLabel, finding);
    if (link.lockedDay) addTo(`DAY:${link.lockedDay}`, GROUPING_STRATEGIES.LOCKED_DAY, `Business day ${link.lockedDay}`, finding);

    // A rule firing across several unrelated records is its own story: it
    // usually means a systemic control gap rather than isolated mistakes.
    for (const rule of finding.rules) {
      addTo(`RULE:${rule.ruleCode}`, GROUPING_STRATEGIES.RULE_PATTERN, `Repeated: ${rule.ruleCode}`, finding);
    }
  }

  const groups = [...buckets.values()]
    .filter((bucket) => bucket.findings.length >= minimumFindings)
    .map((bucket) => {
      const unique = [...new Map(bucket.findings.map((finding) => [finding.id, finding])).values()];
      const totalAmountPaise = unique.reduce((sum, finding) => sum + Number(finding.amountPaise ?? 0), 0);
      return {
        key: bucket.key,
        strategy: bucket.strategy,
        label: bucket.label,
        findingCount: unique.length,
        riskLevel: highestRiskLevel(unique),
        maxRiskScore: Math.max(...unique.map((finding) => finding.riskScore)),
        totalAmountPaise,
        totalAmountRupees: Number((totalAmountPaise / 100).toFixed(2)),
        findingIds: unique.map((finding) => finding.id),
        ruleCodes: [...new Set(unique.flatMap((finding) => finding.rules.map((rule) => rule.ruleCode)))],
      };
    })
    .sort((left, right) => right.maxRiskScore - left.maxRiskScore || right.findingCount - left.findingCount);

  return { groups, findingsConsidered: findings.length };
}

/**
 * Resolve, per finding, which customer / supplier / staff member / locked day it
 * relates to. All reads are shop-scoped.
 */
async function resolveFindingLinks(shopId, findings) {
  const byType = (type) => findings.filter((finding) => finding.sourceEntityType === type).map((finding) => finding.sourceEntityId);
  const billIds = byType(ENTITY_TYPES.BILL);
  const purchaseIds = byType(ENTITY_TYPES.PURCHASE);
  const closingIds = byType(ENTITY_TYPES.DAILY_CLOSING);

  const [bills, receipts, quickPurchases, closings] = await Promise.all([
    billIds.length
      ? db.bill.findMany({
          where: { shopId, id: { in: billIds } },
          select: { id: true, customerId: true, customerName: true, createdByUserId: true },
        })
      : [],
    purchaseIds.length
      ? db.purchaseReceipt.findMany({
          where: { shopId, id: { in: purchaseIds } },
          select: { id: true, supplierId: true, supplier: { select: { name: true } } },
        })
      : [],
    purchaseIds.length
      ? db.purchaseHistory.findMany({
          where: { shopId, id: { in: purchaseIds } },
          select: { id: true, supplierId: true, supplierName: true },
        })
      : [],
    closingIds.length
      ? db.dailyClosingSnapshot.findMany({ where: { shopId, id: { in: closingIds } }, select: { id: true, date: true } })
      : [],
  ]);

  const staffIds = [...new Set(bills.map((bill) => bill.createdByUserId).filter(Boolean))];
  const staff = staffIds.length
    ? await db.user.findMany({ where: { shopId, id: { in: staffIds } }, select: { id: true, name: true, role: true } })
    : [];
  const staffById = new Map(staff.map((user) => [user.id, user]));

  const billById = new Map(bills.map((bill) => [bill.id, bill]));
  const receiptById = new Map(receipts.map((receipt) => [receipt.id, receipt]));
  const quickById = new Map(quickPurchases.map((row) => [row.id, row]));
  const closingById = new Map(closings.map((row) => [row.id, row]));

  const links = new Map();
  for (const finding of findings) {
    const link = {};
    if (finding.sourceEntityType === ENTITY_TYPES.BILL) {
      const bill = billById.get(finding.sourceEntityId);
      if (bill?.customerId) {
        link.customerId = bill.customerId;
        link.customerLabel = `Customer: ${bill.customerName}`;
      }
      if (bill?.createdByUserId) {
        const user = staffById.get(bill.createdByUserId);
        link.staffUserId = bill.createdByUserId;
        link.staffLabel = user ? `Staff: ${user.name} (${user.role})` : "Staff member";
      }
    } else if (finding.sourceEntityType === ENTITY_TYPES.CUSTOMER) {
      link.customerId = finding.sourceEntityId;
      link.customerLabel = "Customer khata";
    } else if (finding.sourceEntityType === ENTITY_TYPES.PURCHASE) {
      const receipt = receiptById.get(finding.sourceEntityId);
      const quick = quickById.get(finding.sourceEntityId);
      const supplierId = receipt?.supplierId ?? quick?.supplierId ?? null;
      const supplierName = receipt?.supplier?.name ?? quick?.supplierName ?? null;
      if (supplierId || supplierName) {
        link.supplierKey = supplierId ?? `name:${supplierName}`;
        link.supplierLabel = `Supplier: ${supplierName ?? "unnamed"}`;
      }
    } else if (finding.sourceEntityType === ENTITY_TYPES.DAILY_CLOSING) {
      const closing = closingById.get(finding.sourceEntityId);
      if (closing) link.lockedDay = new Date(closing.date).toISOString().slice(0, 10);
    }
    links.set(finding.id, link);
  }
  return links;
}

export async function createCase(shopId, actor, { title, summary = null, findingIds = [] }) {
  assertCapability(actor.role, CAPABILITIES.REVIEW_FINDING);
  const unique = [...new Set(findingIds)];
  if (unique.length < 1) throw new AppError("A case needs at least one finding", 400, "AUDIT_CASE_EMPTY");

  // Shop-scoped by construction: any id outside this shop simply will not resolve.
  const findings = await db.auditFinding.findMany({
    where: { shopId, id: { in: unique } },
    select: { id: true, riskLevel: true, riskScore: true, amountPaise: true },
  });
  if (findings.length !== unique.length) {
    throw new AppError("One or more findings were not found in this shop", 404, "AUDIT_FINDING_NOT_FOUND");
  }

  const auditCase = await db.auditCase.create({
    data: {
      shopId,
      title,
      summary,
      riskLevel: highestRiskLevel(findings),
      createdByUserId: actor.userId,
      findings: { create: findings.map((finding) => ({ shopId, findingId: finding.id })) },
    },
    include: { findings: true },
  });

  return serializeCase(auditCase, findings);
}

export async function listCases(shopId, query = {}) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 25));
  const where = { shopId, ...(query.status ? { status: query.status } : {}) };
  const [total, rows] = await Promise.all([
    db.auditCase.count({ where }),
    db.auditCase.findMany({
      where,
      include: { findings: true },
      orderBy: [{ createdAt: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);
  return {
    cases: rows.map((row) => serializeCase(row)),
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

export async function getCase(shopId, actor, caseId) {
  const visibility = findingVisibilityFilter(actor);
  const auditCase = await db.auditCase.findFirst({ where: { id: caseId, shopId }, include: { findings: true } });
  if (!auditCase) throw new AppError("Case not found", 404, "AUDIT_CASE_NOT_FOUND");

  const findings = await db.auditFinding.findMany({
    where: { shopId, ...visibility, id: { in: auditCase.findings.map((link) => link.findingId) } },
    include: { rules: { where: { active: true } } },
    orderBy: { riskScore: "desc" },
  });

  return {
    ...serializeCase(auditCase, findings),
    findings: findings.map((finding) => ({
      findingId: finding.id,
      title: finding.title,
      status: finding.status,
      riskLevel: finding.riskLevel,
      riskScore: finding.riskScore,
      sourceEntityType: finding.sourceEntityType,
      sourceEntityId: finding.sourceEntityId,
      amountPaise: finding.amountPaise === null ? null : Number(finding.amountPaise),
      ruleCodes: finding.rules.map((rule) => rule.ruleCode),
      createdAt: finding.createdAt,
    })),
  };
}

function serializeCase(auditCase, findings = null) {
  const amountPaise = findings ? findings.reduce((sum, finding) => sum + Number(finding.amountPaise ?? 0), 0) : null;
  return {
    caseId: auditCase.id,
    title: auditCase.title,
    summary: auditCase.summary,
    status: auditCase.status,
    riskLevel: auditCase.riskLevel,
    findingCount: auditCase.findings?.length ?? findings?.length ?? 0,
    totalAmountPaise: amountPaise,
    totalAmountRupees: amountPaise === null ? null : Number((amountPaise / 100).toFixed(2)),
    createdByUserId: auditCase.createdByUserId,
    closedAt: auditCase.closedAt,
    createdAt: auditCase.createdAt,
    updatedAt: auditCase.updatedAt,
  };
}

/**
 * Ask the AI layer for a case narrative. Falls back to deterministic text when
 * the provider is disabled or fails, exactly like finding explanations.
 */
export async function generateCaseSummary(shopId, actor, caseId) {
  const detail = await getCase(shopId, actor, caseId);
  const result = await summarizeCaseWithAi({
    findings: detail.findings.map((finding) => ({
      riskScore: finding.riskScore,
      riskLevel: finding.riskLevel,
      sourceEntityType: finding.sourceEntityType,
      triggeredRules: finding.ruleCodes.map((ruleCode) => ({ ruleCode })),
    })),
    totalAmountPaise: detail.totalAmountPaise ?? 0,
  });

  const updated = await db.auditCase.update({
    where: { id: caseId },
    data: { summary: result.summary },
  });

  return {
    caseId: updated.id,
    summary: result.summary,
    financialImpact: result.financialImpact,
    recommendedNextStep: result.recommendedNextStep,
    source: result.source,
    provider: result.provider,
    degraded: result.degraded,
    disclaimer: result.disclaimer,
  };
}

export async function closeCase(shopId, actor, caseId, { status }) {
  assertCapability(actor.role, CAPABILITIES.REVIEW_FINDING);
  const auditCase = await db.auditCase.findFirst({ where: { id: caseId, shopId } });
  if (!auditCase) throw new AppError("Case not found", 404, "AUDIT_CASE_NOT_FOUND");

  const updated = await db.auditCase.update({
    where: { id: auditCase.id },
    data: { status, closedAt: status === "CLOSED" ? new Date() : null },
    include: { findings: true },
  });
  // Cases are a review convenience: closing one never closes its findings, which
  // keep their own independent lifecycle and history.
  return serializeCase(updated);
}

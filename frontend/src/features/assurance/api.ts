import { apiRequest } from "@/lib/api/http";

// ── types mirroring the backend assurance module ──────────────

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type FindingStatus =
  | "OPEN"
  | "EVIDENCE_REQUESTED"
  | "UNDER_REVIEW"
  | "CONFIRMED_ISSUE"
  | "FALSE_POSITIVE"
  | "CORRECTED"
  | "ACCEPTED_RISK"
  | "CLOSED";

export type EvidenceStatus = "REQUESTED" | "PROVIDED" | "VERIFIED" | "REJECTED" | "INSUFFICIENT" | "NOT_APPLICABLE";

export type EntityType = "BILL" | "CUSTOMER" | "PRODUCT" | "PURCHASE" | "EXPENSE" | "DAILY_CLOSING" | "SYNC_EVENT";

export type TriggeredRule = {
  ruleCode: string;
  ruleVersion: number;
  category: string;
  severity: RiskLevel;
  scoreContribution: number;
  active: boolean;
  name: string;
  description: string | null;
  remediation: string | null;
  details: Record<string, unknown>;
};

export type Finding = {
  findingId: string;
  title: string;
  status: FindingStatus;
  sourceEntityType: EntityType;
  sourceEntityId: string;
  sourceEventType: string | null;
  primaryCategory: string | null;
  riskScore: number;
  riskLevel: RiskLevel;
  confidence: number;
  amountPaise: number | null;
  /** The money actually in question (shortfall/drift/difference), when a rule measured one. */
  discrepancyPaise: number | null;
  assignedReviewerId: string | null;
  occurredAt: string | null;
  resolvedAt: string | null;
  resolutionType: string | null;
  reopenCount: number;
  engineVersion: string;
  rulesetVersion: string;
  aiExplanation: string | null;
  aiExplanationLang: string | null;
  createdAt: string;
  updatedAt: string;
  triggeredRules?: TriggeredRule[];
};

export type ScoreBreakdown = {
  formula: string;
  baseScore: number;
  summedContributions: number;
  materialityMultiplier: number;
  materialityBand: string;
  historyMultiplier: number;
  historyLabel: string;
  priorConfirmedFindings: number;
  preClampScore: number;
  modifiedScore?: number;
  scoreFloor?: number | null;
  scoreFloorRuleCode?: string | null;
  scoreFloorApplied?: boolean;
  finalScore: number;
  riskLevel: RiskLevel;
  confidence: number;
  confidenceReasons: string[];
  inputHash: string;
  engineVersion: string;
  rulesetVersion: string;
  triggeredRules: Array<{
    ruleCode: string;
    severity: RiskLevel;
    weight: number;
    weightSource: string;
    severityMultiplier: number;
    rawContribution: number;
    cappedAt: number | null;
    scoreContribution: number;
  }>;
};

export type EvidenceRecord = {
  evidenceId: string;
  findingId: string;
  requirementId: string | null;
  evidenceType: string;
  referenceKind: string;
  referenceValue: string;
  originalFilename: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  checksumSha256: string | null;
  uploadedByUserId: string | null;
  verificationStatus: EvidenceStatus;
  verifiedByUserId: string | null;
  verifiedAt: string | null;
  extractedMetadata: Record<string, unknown> & { reuseCount?: number };
  reviewerNotes: string | null;
  createdAt: string;
  reuseWarningCount?: number;
};

export type EvidenceRequirement = {
  requirementId: string;
  evidenceType: string;
  description: string;
  status: EvidenceStatus;
  requestedByUserId: string | null;
  dueAt: string | null;
  createdAt: string;
};

export type TimelineEntry = {
  historyId: string;
  previousStatus: string | null;
  newStatus: string;
  changedByUserId: string | null;
  changedByRole: string | null;
  comment: string | null;
  evidenceId: string | null;
  approvalLevel: string | null;
  createdAt: string;
};

export type FindingDetail = Finding & {
  scoreBreakdown: ScoreBreakdown;
  sourceTransaction: Record<string, unknown> & { kind: string; missing?: boolean };
  evidenceRequirements: EvidenceRequirement[];
  evidence: EvidenceRecord[];
  timeline: TimelineEntry[];
  reviews: Array<{ reviewId: string; reviewerUserId: string | null; reviewerRole: string | null; decision: string; notes: string | null; createdAt: string }>;
};

export type Pagination = { page: number; limit: number; total: number; totalPages: number };

export type AuditRun = {
  runId: string;
  runType: "TRANSACTION_TRIGGERED" | "SCHEDULED" | "MANUAL";
  status: "RUNNING" | "COMPLETED" | "FAILED" | "PARTIAL";
  engineVersion: string;
  rulesetVersion: string;
  scope: Record<string, unknown>;
  periodFrom: string | null;
  periodTo: string | null;
  entitiesEvaluated: number;
  findingsCreated: number;
  findingsUpdated: number;
  summary: {
    requestedEntities?: number;
    evaluated?: number;
    failureCount?: number;
    failures?: Array<{ entityType: string; entityId: string; code: string; message: string }>;
    findingsByCategory?: Record<string, number>;
    findingsByRiskLevel?: Record<string, number>;
    findingsByRuleCode?: Record<string, number>;
  };
  error: string | null;
  triggeredByUserId: string | null;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
};

export type AuditRunDetail = AuditRun & {
  evaluations: Array<{
    evaluationId: string;
    sourceEntityType: EntityType;
    sourceEntityId: string;
    riskScore: number;
    triggeredRuleCodes: string[];
    inputHash: string;
    createdAt: string;
  }>;
};

export type Dashboard = {
  generatedAt: string;
  engineVersion: string;
  rulesetVersion: string;
  totals: {
    openFindings: number;
    criticalFindings: number;
    highFindings: number;
    highRiskAmountPaise: number;
    highRiskAmountRupees: number;
    unquantifiedHighRiskFindings: number;
    unresolvedEvidenceRequests: number;
  };
  byStatus: Record<string, number>;
  byCategory: Record<string, number>;
  byRiskLevel: Record<string, number>;
  topRiskAreas: Array<{ ruleCode: string; name: string; category: string | null; severity: RiskLevel | null; findingCount: number }>;
  latestRun: AuditRun | null;
  topFindings: Finding[];
  trend: Array<{ date: string; total: number; critical: number; high: number }>;
  affected: {
    staff: Array<{ userId: string; name: string; role: string; findingCount: number }>;
    customers: Array<{ customerId: string; name: string; outstandingRupees: number; findingCount: number }>;
    suppliers: Array<{ supplierId: string | null; name: string | null; findingCount: number }>;
  };
  disclaimer: string;
  aiStatus: { provider: string; available: boolean; requiresShopConsent: boolean; note: string };
  capabilities: string[];
};

export type RuleCatalogEntry = {
  ruleId: string;
  ruleCode: string;
  name: string;
  description: string;
  category: string;
  severity: RiskLevel;
  defaultWeight: number;
  version: number;
  effectiveFrom: string;
  applicableEntityTypes: EntityType[];
  applicableEventTypes: string[];
  evidenceTypes: string[];
  remediation: string;
  enabled: boolean;
  effectiveWeight: number;
  weightOverride: number | null;
  thresholds: Record<string, unknown>;
  updatedAt: string | null;
};

export type AssuranceReport = {
  title: string;
  subtitle: string;
  isStatutoryAudit: false;
  generatedAt: string;
  engineVersion: string;
  rulesetVersion: string;
  period: { from: string; to: string };
  coverage: { auditRuns: number; runTypes: Record<string, number>; transactionsReviewed: number; entitiesByType: Record<string, number>; lastRunAt: string | null };
  findings: {
    raised: number;
    resolved: number;
    openCritical: number;
    byRiskLevel: Record<string, number>;
    byStatus: Record<string, number>;
    byCategory: Record<string, number>;
    topRules: Array<{ ruleCode: string; name: string; category: string | null; severity: RiskLevel | null; findingCount: number }>;
  };
  exposure: { highRiskAmountPaise: number; highRiskAmountRupees: number; criticalFindingCount: number; highFindingCount: number; quantifiedFindings: number; unquantifiedFindings: number; note: string };
  byArea: Record<string, number>;
  evidence: { byStatus: Record<string, number>; outstandingRequests: number; note: string };
  managementResponses: {
    reviewCount: number;
    byDecision: Record<string, number>;
    byResolutionType: Record<string, number>;
    recent: Array<{ findingId: string; decision: string; reviewerRole: string | null; notes: string | null; createdAt: string }>;
  };
  openCriticalFindings: Array<{
    findingId: string; title: string; riskScore: number; riskLevel: RiskLevel; status: FindingStatus;
    sourceEntityType: EntityType; sourceEntityId: string; amountRupees: number | null; ruleCodes: string[]; createdAt: string;
  }>;
  limitations: string[];
};

export type Explanation = {
  findingId: string;
  explanation: string;
  language: string;
  source: "ai_provider" | "deterministic_fallback";
  provider: string;
  degraded: boolean;
  suggestedEvidence: string[];
  disclaimer: string;
};

// ── request helpers ───────────────────────────────────────────

function qs(params?: Record<string, string | number | boolean | undefined>) {
  if (!params) return "";
  const entries = Object.entries(params)
    .filter(([, value]) => value != null && value !== "")
    .map(([key, value]) => [key, String(value)]) as [string, string][];
  return entries.length ? `?${new URLSearchParams(entries).toString()}` : "";
}

export function getAssuranceDashboard() {
  return apiRequest<Dashboard>("/audit/dashboard");
}

export function listFindings(params?: {
  page?: number;
  limit?: number;
  status?: FindingStatus;
  riskLevel?: RiskLevel;
  category?: string;
  sourceEntityType?: EntityType;
  assignedReviewerId?: string;
  ruleCode?: string;
  openOnly?: boolean;
  from?: string;
  to?: string;
}) {
  return apiRequest<{ findings: Finding[]; pagination: Pagination }>(`/audit/findings${qs(params)}`);
}

export function getFinding(findingId: string) {
  return apiRequest<FindingDetail>(`/audit/findings/${findingId}`);
}

export function updateFindingStatus(
  findingId: string,
  body: { status: FindingStatus; comment?: string; evidenceId?: string; approvalLevel?: string; resolutionType?: string }
) {
  return apiRequest<Finding>(`/audit/findings/${findingId}/status`, { method: "PATCH", body: JSON.stringify(body) });
}

export function submitEvidence(
  findingId: string,
  body: { evidenceType: string; requirementId?: string; referenceKind?: string; referenceValue: string; originalFilename?: string; mimeType?: string; sizeBytes?: number; checksumSha256?: string }
) {
  return apiRequest<EvidenceRecord>(`/audit/findings/${findingId}/evidence`, { method: "POST", body: JSON.stringify(body) });
}

export function requestEvidence(findingId: string, body: { evidenceType: string; description: string; dueAt?: string }) {
  return apiRequest<EvidenceRequirement>(`/audit/findings/${findingId}/evidence-requests`, { method: "POST", body: JSON.stringify(body) });
}

export function verifyEvidence(evidenceId: string, body: { verificationStatus: EvidenceStatus; reviewerNotes?: string }) {
  return apiRequest<EvidenceRecord>(`/audit/evidence/${evidenceId}/verify`, { method: "PATCH", body: JSON.stringify(body) });
}

export function listEvidenceRequests(params?: { page?: number; limit?: number; status?: EvidenceStatus }) {
  return apiRequest<{
    requests: Array<EvidenceRequirement & {
      finding: { findingId: string; title: string; riskLevel: RiskLevel; riskScore: number; status: FindingStatus; sourceEntityType: EntityType; sourceEntityId: string } | null;
      submittedEvidence: Array<{ evidenceId: string; evidenceType: string; verificationStatus: EvidenceStatus; createdAt: string }>;
    }>;
    pagination: Pagination;
  }>(`/audit/evidence-requests${qs(params)}`);
}

export function addReview(findingId: string, body: { decision: string; notes?: string; newStatus?: FindingStatus }) {
  return apiRequest<{ review: { reviewId: string; decision: string; notes: string | null; createdAt: string }; finding: Finding }>(
    `/audit/findings/${findingId}/review`,
    { method: "POST", body: JSON.stringify(body) }
  );
}

export function assignReviewer(findingId: string, body: { reviewerUserId: string; comment?: string }) {
  return apiRequest<Finding>(`/audit/findings/${findingId}/assign`, { method: "POST", body: JSON.stringify(body) });
}

export function explainFinding(findingId: string, body: { language: "en" | "hi" | "hinglish" }) {
  return apiRequest<Explanation>(`/audit/findings/${findingId}/explain`, { method: "POST", body: JSON.stringify(body) });
}

export function listRuns(params?: { page?: number; limit?: number; runType?: string; status?: string }) {
  return apiRequest<{ runs: AuditRun[]; pagination: Pagination }>(`/audit/runs${qs(params)}`);
}

export function getRun(runId: string) {
  return apiRequest<AuditRunDetail>(`/audit/runs/${runId}`);
}

export function startRun(body: { runType?: "MANUAL" | "SCHEDULED"; from: string; to: string; entityTypes?: EntityType[] }) {
  return apiRequest<{ runId: string; status: string; evaluated: number; findingsCreated: number; findingsUpdated: number; entityCount: number; failures: unknown[] }>(
    "/audit/runs",
    { method: "POST", body: JSON.stringify(body) }
  );
}

export function listRules() {
  return apiRequest<{ engineVersion: string; rulesetVersion: string; rules: RuleCatalogEntry[] }>("/audit/rules");
}

export function updateRule(ruleCode: string, body: { enabled?: boolean; weightOverride?: number | null; thresholds?: Record<string, unknown> }) {
  return apiRequest<{ ruleCode: string; enabled: boolean; weightOverride: number | null; effectiveWeight: number; defaultWeight: number }>(
    `/audit/rules/${ruleCode}`,
    { method: "PATCH", body: JSON.stringify(body) }
  );
}

export function getAssuranceReport(params: { from: string; to: string }) {
  return apiRequest<AssuranceReport>(`/audit/report${qs(params)}`);
}

export function recomputeBaselines() {
  return apiRequest<{ baselineCount: number }>("/audit/baselines/recompute", { method: "POST" });
}

// ── investigation cases ───────────────────────────────────────

export type CaseStatus = "OPEN" | "UNDER_REVIEW" | "CLOSED";

export type CaseSummaryRow = {
  caseId: string;
  title: string;
  summary: string | null;
  status: CaseStatus;
  riskLevel: RiskLevel;
  findingCount: number;
  totalAmountPaise: number | null;
  totalAmountRupees: number | null;
  createdByUserId: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CaseDetail = CaseSummaryRow & {
  findings: Array<{
    findingId: string;
    title: string;
    status: FindingStatus;
    riskLevel: RiskLevel;
    riskScore: number;
    sourceEntityType: EntityType;
    sourceEntityId: string;
    amountPaise: number | null;
    ruleCodes: string[];
    createdAt: string;
  }>;
};

export type CaseProposal = {
  key: string;
  strategy: "CUSTOMER" | "SUPPLIER" | "STAFF" | "LOCKED_DAY" | "RULE_PATTERN";
  label: string;
  findingCount: number;
  riskLevel: RiskLevel;
  maxRiskScore: number;
  totalAmountPaise: number;
  totalAmountRupees: number;
  findingIds: string[];
  ruleCodes: string[];
};

export function listCaseProposals(params?: { minimumFindings?: number }) {
  return apiRequest<{ groups: CaseProposal[]; findingsConsidered: number }>(`/audit/cases/proposals${qs(params)}`);
}

export function listCases(params?: { page?: number; limit?: number; status?: CaseStatus }) {
  return apiRequest<{ cases: CaseSummaryRow[]; pagination: Pagination }>(`/audit/cases${qs(params)}`);
}

export function getCase(caseId: string) {
  return apiRequest<CaseDetail>(`/audit/cases/${caseId}`);
}

export function createCase(body: { title: string; summary?: string; findingIds: string[] }) {
  return apiRequest<CaseSummaryRow>("/audit/cases", { method: "POST", body: JSON.stringify(body) });
}

export function summarizeCase(caseId: string) {
  return apiRequest<{
    caseId: string;
    summary: string;
    financialImpact: string;
    recommendedNextStep: string;
    source: "ai_provider" | "deterministic_fallback";
    provider: string;
    degraded: boolean;
    disclaimer: string;
  }>(`/audit/cases/${caseId}/summary`, { method: "POST", body: JSON.stringify({}) });
}

export function updateCaseStatus(caseId: string, body: { status: CaseStatus }) {
  return apiRequest<CaseSummaryRow>(`/audit/cases/${caseId}/status`, { method: "PATCH", body: JSON.stringify(body) });
}

export function classifyEvidenceDescription(body: { description: string }) {
  return apiRequest<{
    evidenceType: string | null;
    confidence: number;
    reasoning: string;
    source: "ai_provider" | "deterministic_fallback";
    advisory: true;
    note: string;
  }>("/audit/evidence/classify", { method: "POST", body: JSON.stringify(body) });
}

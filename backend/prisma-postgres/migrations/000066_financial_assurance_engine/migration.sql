-- CreateTable
CREATE TABLE "AuditRule" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "ruleCode" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "weightOverride" INTEGER,
    "thresholdsJson" TEXT NOT NULL DEFAULT '{}',
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditRun" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "runType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "engineVersion" TEXT NOT NULL,
    "rulesetVersion" TEXT NOT NULL,
    "scopeJson" TEXT NOT NULL DEFAULT '{}',
    "periodFrom" TIMESTAMP(3),
    "periodTo" TIMESTAMP(3),
    "entitiesEvaluated" INTEGER NOT NULL DEFAULT 0,
    "findingsCreated" INTEGER NOT NULL DEFAULT 0,
    "findingsUpdated" INTEGER NOT NULL DEFAULT 0,
    "summaryJson" TEXT NOT NULL DEFAULT '{}',
    "error" TEXT,
    "triggeredByUserId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvaluation" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "auditRunId" TEXT NOT NULL,
    "sourceEntityType" TEXT NOT NULL,
    "sourceEntityId" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "rulesetVersion" TEXT NOT NULL,
    "triggeredRuleCodesJson" TEXT NOT NULL DEFAULT '[]',
    "riskScore" INTEGER NOT NULL DEFAULT 0,
    "resultJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditFinding" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "sourceEntityType" TEXT NOT NULL,
    "sourceEntityId" TEXT NOT NULL,
    "sourceEventType" TEXT,
    "firstAuditRunId" TEXT,
    "lastAuditRunId" TEXT,
    "lastEvaluationId" TEXT,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "primaryCategory" TEXT,
    "riskScore" INTEGER NOT NULL DEFAULT 0,
    "riskLevel" TEXT NOT NULL DEFAULT 'LOW',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "amountPaise" BIGINT,
    "scoreBreakdownJson" TEXT NOT NULL DEFAULT '{}',
    "aiExplanation" TEXT,
    "aiExplanationLang" TEXT,
    "assignedReviewerId" TEXT,
    "occurredAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolutionType" TEXT,
    "reopenCount" INTEGER NOT NULL DEFAULT 0,
    "engineVersion" TEXT NOT NULL,
    "rulesetVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditFindingRule" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "ruleCode" TEXT NOT NULL,
    "ruleVersion" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "scoreContribution" INTEGER NOT NULL,
    "detailsJson" TEXT NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditFindingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvidenceRequirement" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "evidenceType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "requestedByUserId" TEXT,
    "dueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditEvidenceRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvidence" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "requirementId" TEXT,
    "evidenceType" TEXT NOT NULL,
    "referenceKind" TEXT NOT NULL DEFAULT 'text',
    "referenceValue" TEXT NOT NULL,
    "originalFilename" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "checksumSha256" TEXT,
    "storageKey" TEXT,
    "uploadedByUserId" TEXT,
    "verificationStatus" TEXT NOT NULL DEFAULT 'PROVIDED',
    "verifiedByUserId" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "extractedMetadataJson" TEXT NOT NULL DEFAULT '{}',
    "reviewerNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditFindingStatusHistory" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "previousStatus" TEXT,
    "newStatus" TEXT NOT NULL,
    "changedByUserId" TEXT,
    "changedByRole" TEXT,
    "comment" TEXT,
    "evidenceId" TEXT,
    "approvalLevel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditFindingStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditReview" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "reviewerUserId" TEXT,
    "reviewerRole" TEXT,
    "decision" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditCase" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "riskLevel" TEXT NOT NULL DEFAULT 'LOW',
    "createdByUserId" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditCaseFinding" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditCaseFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditBaseline" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "metricKey" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL DEFAULT 'global',
    "windowDays" INTEGER NOT NULL DEFAULT 90,
    "sampleCount" INTEGER NOT NULL DEFAULT 0,
    "minimumSamples" INTEGER NOT NULL DEFAULT 30,
    "status" TEXT NOT NULL DEFAULT 'INSUFFICIENT_DATA',
    "median" DOUBLE PRECISION,
    "p25" DOUBLE PRECISION,
    "p75" DOUBLE PRECISION,
    "p90" DOUBLE PRECISION,
    "p99" DOUBLE PRECISION,
    "mean" DOUBLE PRECISION,
    "statsJson" TEXT NOT NULL DEFAULT '{}',
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditBaseline_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditRule_shopId_enabled_idx" ON "AuditRule"("shopId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "AuditRule_shopId_ruleCode_key" ON "AuditRule"("shopId", "ruleCode");

-- CreateIndex
CREATE INDEX "AuditRun_shopId_createdAt_idx" ON "AuditRun"("shopId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditRun_shopId_status_createdAt_idx" ON "AuditRun"("shopId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "AuditRun_shopId_runType_createdAt_idx" ON "AuditRun"("shopId", "runType", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvaluation_shopId_sourceEntityType_sourceEntityId_crea_idx" ON "AuditEvaluation"("shopId", "sourceEntityType", "sourceEntityId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvaluation_shopId_createdAt_idx" ON "AuditEvaluation"("shopId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuditEvaluation_auditRunId_sourceEntityType_sourceEntityId_key" ON "AuditEvaluation"("auditRunId", "sourceEntityType", "sourceEntityId");

-- CreateIndex
CREATE INDEX "AuditFinding_shopId_status_createdAt_idx" ON "AuditFinding"("shopId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "AuditFinding_shopId_riskLevel_status_idx" ON "AuditFinding"("shopId", "riskLevel", "status");

-- CreateIndex
CREATE INDEX "AuditFinding_shopId_sourceEntityType_sourceEntityId_idx" ON "AuditFinding"("shopId", "sourceEntityType", "sourceEntityId");

-- CreateIndex
CREATE INDEX "AuditFinding_shopId_assignedReviewerId_status_idx" ON "AuditFinding"("shopId", "assignedReviewerId", "status");

-- CreateIndex
CREATE INDEX "AuditFinding_shopId_createdAt_idx" ON "AuditFinding"("shopId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuditFinding_shopId_dedupeKey_key" ON "AuditFinding"("shopId", "dedupeKey");

-- CreateIndex
CREATE INDEX "AuditFindingRule_shopId_ruleCode_createdAt_idx" ON "AuditFindingRule"("shopId", "ruleCode", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuditFindingRule_findingId_ruleCode_key" ON "AuditFindingRule"("findingId", "ruleCode");

-- CreateIndex
CREATE INDEX "AuditEvidenceRequirement_shopId_status_createdAt_idx" ON "AuditEvidenceRequirement"("shopId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvidenceRequirement_findingId_idx" ON "AuditEvidenceRequirement"("findingId");

-- CreateIndex
CREATE INDEX "AuditEvidence_shopId_findingId_createdAt_idx" ON "AuditEvidence"("shopId", "findingId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvidence_shopId_verificationStatus_createdAt_idx" ON "AuditEvidence"("shopId", "verificationStatus", "createdAt");

-- CreateIndex
CREATE INDEX "AuditFindingStatusHistory_shopId_findingId_createdAt_idx" ON "AuditFindingStatusHistory"("shopId", "findingId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditFindingStatusHistory_shopId_createdAt_idx" ON "AuditFindingStatusHistory"("shopId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditReview_shopId_findingId_createdAt_idx" ON "AuditReview"("shopId", "findingId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditCase_shopId_status_createdAt_idx" ON "AuditCase"("shopId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "AuditCaseFinding_shopId_findingId_idx" ON "AuditCaseFinding"("shopId", "findingId");

-- CreateIndex
CREATE UNIQUE INDEX "AuditCaseFinding_caseId_findingId_key" ON "AuditCaseFinding"("caseId", "findingId");

-- CreateIndex
CREATE INDEX "AuditBaseline_shopId_computedAt_idx" ON "AuditBaseline"("shopId", "computedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuditBaseline_shopId_metricKey_scopeKey_key" ON "AuditBaseline"("shopId", "metricKey", "scopeKey");

-- AddForeignKey
ALTER TABLE "AuditRule" ADD CONSTRAINT "AuditRule_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditRun" ADD CONSTRAINT "AuditRun_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvaluation" ADD CONSTRAINT "AuditEvaluation_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvaluation" ADD CONSTRAINT "AuditEvaluation_auditRunId_fkey" FOREIGN KEY ("auditRunId") REFERENCES "AuditRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditFinding" ADD CONSTRAINT "AuditFinding_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditFindingRule" ADD CONSTRAINT "AuditFindingRule_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditFindingRule" ADD CONSTRAINT "AuditFindingRule_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "AuditFinding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvidenceRequirement" ADD CONSTRAINT "AuditEvidenceRequirement_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvidenceRequirement" ADD CONSTRAINT "AuditEvidenceRequirement_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "AuditFinding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvidence" ADD CONSTRAINT "AuditEvidence_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvidence" ADD CONSTRAINT "AuditEvidence_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "AuditFinding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvidence" ADD CONSTRAINT "AuditEvidence_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "AuditEvidenceRequirement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditFindingStatusHistory" ADD CONSTRAINT "AuditFindingStatusHistory_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditFindingStatusHistory" ADD CONSTRAINT "AuditFindingStatusHistory_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "AuditFinding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditReview" ADD CONSTRAINT "AuditReview_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditReview" ADD CONSTRAINT "AuditReview_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "AuditFinding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditCase" ADD CONSTRAINT "AuditCase_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditCaseFinding" ADD CONSTRAINT "AuditCaseFinding_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditCaseFinding" ADD CONSTRAINT "AuditCaseFinding_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "AuditCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditCaseFinding" ADD CONSTRAINT "AuditCaseFinding_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "AuditFinding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditBaseline" ADD CONSTRAINT "AuditBaseline_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;


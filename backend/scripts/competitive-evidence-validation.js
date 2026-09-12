import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value) => typeof value === "string" && value.trim().length > 0;
const positive = (value) => typeof value === "number" && Number.isFinite(value) && value > 0;
const statuses = { verified: 1, partial: 0.5, external_blocked: 0.25, absent: 0 };

export function evidenceContentSha256(report) {
  // Canonical JSON whitespace avoids platform-dependent CRLF/LF hashes.
  return crypto.createHash("sha256").update(JSON.stringify(report)).digest("hex");
}

export function validEvidenceDate(value, now = Date.now()) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
    && timestamp <= now;
}

function scopedPath(root, relative) {
  if (!text(relative) || path.isAbsolute(relative) || path.win32.isAbsolute(relative)
    || relative.split(/[\\/]/).some((part) => !part || part === "." || part === "..")) return null;
  try {
    const resolved = fs.realpathSync(path.resolve(root, relative));
    const local = path.relative(fs.realpathSync(root), resolved);
    return local && !local.startsWith(`..${path.sep}`) && local !== ".." && !path.isAbsolute(local) ? resolved : null;
  } catch { return null; }
}

function passedStages(rows, requiredIds) {
  return Array.isArray(rows) && rows.length > 0
    && rows.every((row) => record(row) && row.status === "passed")
    && requiredIds.every((id) => rows.some((row) => row.id === id));
}

export function runtimeEvidenceMatches(claimId, report) {
  if (!record(report)) return false;
  if (claimId === "local_release_certification") {
    const required = ["prisma-sqlite-validate", "prisma-postgres-validate", "prisma-postgres-generate", "migration-safety", "release-gate",
      "backend-source-db", "backend-tests", "backend-warehouse", "backend-integration-sqlite", "backend-production-check",
      "ai-safety", "api-contract", "razorpay-fixtures", "hardware-bridge-contracts", "frontend-production-check",
      "local-storage-proof", "source-snapshot-stability"];
    return report.type === "kiranaos_release_certification" && report.status === "local-passed"
      && report.mode === "local"
      && report.summary?.failed === 0 && report.summary?.blocked === 0
      && Array.isArray(report.results) && required.every((id) => report.results.some((row) => row?.id === id && row.status === "passed" && row.required === true))
      && report.results.every((row) => record(row) && (row.status === "passed" || (row.status === "skipped" && row.required === false)))
      && report.summary.passed === report.results.filter((row) => row.status === "passed").length;
  }
  if (claimId === "postgres_runtime_proof") {
    return report.type === "kiranaos_postgres_production_proof" && report.status === "passed"
      && report.database?.protocol === "postgresql" && positive(report.migrations?.directoryCount)
      && report.processEvidence?.exitCode === 0
      && passedStages(report.results, ["prisma-client", "schema-validation", "database-reset", "integration-concurrency", "payment-provider-connections", "money-paise-reconciliation", "api-contract", "production-static"]);
  }
  if (claimId === "redis_worker_proof") {
    return report.type === "kiranaos_redis_worker_production_proof" && report.status === "passed"
      && report.runtime?.databaseProvider === "postgresql"
      && report.worker?.separateProcess === true && report.worker.statusBefore === "running" && report.worker.statusAfter === "running"
      && report.worker.heartbeatFreshBefore === true && report.worker.heartbeatFreshAfter === true
      && Array.isArray(report.worker.queueNames) && report.worker.queueNames.length > 0
      && report.worker.queueNames.includes(report.job?.queueName)
      && report.job?.result?.status === "ok" && text(report.job.processedAt);
  }
  if (claimId === "live_ui_matrix") {
    const captures = report.responsiveCaptures;
    const keyboard = report.keyboardTraversal;
    return report.status === "passed-automated-without-incomplete-results"
      && /^[a-f0-9]{64}$/i.test(report.sourceArtifactSha256 || "") && report.engine?.name === "axe-core"
      && record(captures) && captures.routes >= 9 && captures.total >= 36 && captures.passed === captures.total
      && ["definiteAxeViolations", "axeIncompleteRuleOccurrences", "axeIncompleteNodes", "horizontalOverflowFindings", "undersizedTargetFindings", "customSemanticFindings", "runtimeErrors"].every((key) => captures[key] === 0)
      && record(keyboard) && keyboard.totalRoutes >= 9 && keyboard.passedRoutes === keyboard.totalRoutes
      && ["unnamedFocusStops", "invisibleFocusIndicators", "hiddenOrInertFocusLeaks", "missedSequentialControls"].every((key) => keyboard[key] === 0);
  }
  // A new runtime claim needs a validator for its actual proof format.
  return false;
}

export function validateCompetitiveEvidence(matrix, { repoRoot, now = Date.now(), readJson = (filename) => JSON.parse(fs.readFileSync(filename, "utf8")) } = {}) {
  const errors = [];
  const fail = (message) => errors.push(message);
  if (!record(matrix)) return ["matrix must be an object"];
  if (matrix.scoreScale !== 10) fail("scoreScale must be 10");
  if (!record(matrix.statusFactors) || Object.entries(statuses).some(([key, value]) => matrix.statusFactors[key] !== value)) fail("statusFactors must use the documented evidence weights");
  if (!validEvidenceDate(matrix.generatedAt, now)) fail("generatedAt must be a real non-future ISO date");
  for (const key of ["officialDomains", "domains", "claims", "caps"]) {
    if (!Array.isArray(matrix[key]) || matrix[key].length === 0) fail(`${key} must be a non-empty array`);
  }
  if (errors.length) return errors;
  if (matrix.officialDomains.some((domain) => !text(domain))) fail("officialDomains must contain hostnames");
  const domainIds = new Set();
  for (const domain of matrix.domains) {
    if (!record(domain) || !text(domain.id) || !text(domain.label) || !positive(domain.weight) || domain.weight > 100) {
      fail("domains require an id, label and positive finite numeric weight"); continue;
    }
    if (domainIds.has(domain.id)) fail(`duplicate domain: ${domain.id}`);
    domainIds.add(domain.id);
  }
  for (const cap of matrix.caps) {
    if (!record(cap) || !text(cap.domain) || typeof cap.maxScore !== "number" || !Number.isFinite(cap.maxScore)
      || !text(cap.reason) || !Array.isArray(cap.requiresVerifiedClaims) || !cap.requiresVerifiedClaims.length
      || cap.requiresVerifiedClaims.some((id) => !text(id))) fail("caps require a domain, finite numeric score, reason and non-empty claim list");
  }
  for (const claim of matrix.claims) {
    if (!record(claim)) { fail("claims must be objects"); continue; }
    const label = claim.id || "<missing claim>";
    if (!positive(claim.weight) || claim.weight > 100) fail(`${label}: weight must be a positive finite number`);
    if (!validEvidenceDate(claim.lastVerifiedAt, now)) fail(`${label}: lastVerifiedAt must be a real non-future ISO date`);
    if (!Array.isArray(claim.competitorEvidence) || claim.competitorEvidence.some((entry) => !record(entry))) fail(`${label}: competitorEvidence must contain objects`);
    const evidence = claim.kiranaEvidence;
    if (!record(evidence) || !Array.isArray(evidence.sourcePaths) || !Array.isArray(evidence.testCommands)) {
      fail(`${label}: kiranaEvidence needs sourcePaths and testCommands arrays`); continue;
    }
    for (const source of evidence.sourcePaths) if (!scopedPath(repoRoot, source)) fail(`${label}: source path must exist inside the repository`);
    for (const command of evidence.testCommands) {
      const match = typeof command === "string" && /^cd (backend|frontend|hardware-bridge) && npm (?:test|run ([\w:-]+))(?: -- [\w .\/:=-]+)?$/.exec(command);
      if (!match) { fail(`${label}: test command must name a repository npm script`); continue; }
      try {
        const pkg = readJson(path.join(repoRoot, match[1], "package.json"));
        if (!text(pkg.scripts?.[match[2] || "test"])) fail(`${label}: test command names a missing npm script`);
      } catch { fail(`${label}: could not validate npm script`); }
    }
    if (evidence.runtimeProof?.status === "verified") {
      const proof = evidence.runtimeProof;
      const filename = scopedPath(repoRoot, proof.artifact);
      if (!filename || !fs.statSync(filename).isFile()) { fail(`${label}: runtime artifact must be a repository file`); continue; }
      try {
        const report = readJson(filename);
        if (proof.contentSha256 !== evidenceContentSha256(report)) fail(`${label}: runtime artifact content checksum is missing or mismatched`);
        if (!runtimeEvidenceMatches(claim.id, report)) fail(`${label}: runtime artifact does not prove the claimed workflow`);
        const completedAt = report.completedAt || report.observedCompletedAt || report.generatedAt;
        const completed = typeof completedAt === "string" ? Date.parse(completedAt) : NaN;
        if (!Number.isFinite(completed) || completed > now || completedAt.slice(0, 10) !== claim.lastVerifiedAt) fail(`${label}: runtime verification date must match the actual completed proof`);
      } catch { fail(`${label}: runtime artifact is unreadable or invalid`); }
    }
  }
  return errors;
}

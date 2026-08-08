import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const backendDir = process.cwd();
const repoRoot = path.resolve(backendDir, "..");
const matrixPath = path.join(repoRoot, "docs", "competitive-evidence.json");
const allowedStatuses = new Set(["verified", "partial", "external_blocked", "absent"]);
const allowedProofKinds = new Set(["code_controlled", "runtime_required", "external_runtime"]);
const errors = [];

function fail(message) { errors.push(message); }
function closeTo(left, right) { return Math.abs(left - right) < 0.0001; }
function daysOld(dateText) { return Math.max(0, (Date.now() - new Date(`${dateText}T00:00:00.000Z`).getTime()) / 86_400_000); }
function freshnessFactor(dateText) {
  const age = daysOld(dateText);
  if (age <= 120) return 1;
  if (age <= 240) return 0.9;
  if (age <= 365) return 0.75;
  return 0.5;
}

if (!fs.existsSync(matrixPath)) {
  console.error(JSON.stringify({ type: "competitive_evidence", status: "failed", errors: ["docs/competitive-evidence.json is missing"] }));
  process.exit(1);
}

let matrix;
try { matrix = JSON.parse(fs.readFileSync(matrixPath, "utf8")); }
catch (error) { fail(`matrix is not valid JSON: ${error.message}`); }

if (matrix) {
  if (matrix.schemaVersion !== 1) fail("schemaVersion must be 1");
  const generatedAt = new Date(`${matrix.generatedAt}T00:00:00.000Z`);
  if (!Number.isFinite(generatedAt.getTime())) fail("generatedAt must be an ISO date");
  if (generatedAt.getTime() > Date.now() + 86_400_000) fail("generatedAt cannot be in the future");

  const officialDomains = new Set(matrix.officialDomains ?? []);
  const domains = new Map((matrix.domains ?? []).map((domain) => [domain.id, domain]));
  const claims = matrix.claims ?? [];
  const claimIds = new Set();
  const domainWeight = (matrix.domains ?? []).reduce((sum, domain) => sum + Number(domain.weight || 0), 0);
  if (!closeTo(domainWeight, 100)) fail(`domain weights must total 100; found ${domainWeight}`);

  for (const claim of claims) {
    if (!claim.id || claimIds.has(claim.id)) fail(`claim id is missing or duplicated: ${claim.id ?? "<missing>"}`);
    claimIds.add(claim.id);
    if (!domains.has(claim.domain)) fail(`${claim.id}: unknown domain ${claim.domain}`);
    if (!allowedStatuses.has(claim.status)) fail(`${claim.id}: invalid status ${claim.status}`);
    if (!allowedProofKinds.has(claim.proofKind)) fail(`${claim.id}: invalid proofKind ${claim.proofKind}`);
    if (!Number.isFinite(Number(claim.weight)) || Number(claim.weight) <= 0) fail(`${claim.id}: weight must be positive`);
    if (!claim.summary) fail(`${claim.id}: summary is required`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(claim.lastVerifiedAt ?? "")) fail(`${claim.id}: lastVerifiedAt must be YYYY-MM-DD`);
    if (new Date(`${claim.lastVerifiedAt}T00:00:00.000Z`).getTime() > Date.now() + 86_400_000) fail(`${claim.id}: proof date is in the future`);

    if (!Array.isArray(claim.competitorEvidence) || claim.competitorEvidence.length === 0) {
      fail(`${claim.id}: at least one official competitor source is required`);
    }
    for (const evidence of claim.competitorEvidence ?? []) {
      try {
        const url = new URL(evidence.url);
        if (url.protocol !== "https:") fail(`${claim.id}: competitor source must use HTTPS`);
        if (!officialDomains.has(url.hostname)) fail(`${claim.id}: ${url.hostname} is not in officialDomains`);
      } catch { fail(`${claim.id}: invalid competitor evidence URL ${evidence.url}`); }
      if (!evidence.product || !evidence.claim) fail(`${claim.id}: competitor evidence needs product and claim`);
    }

    const kirana = claim.kiranaEvidence ?? {};
    const sourcePaths = kirana.sourcePaths ?? [];
    const testCommands = kirana.testCommands ?? [];
    if (claim.status === "verified" || claim.status === "partial" || claim.status === "external_blocked") {
      if (sourcePaths.length === 0) fail(`${claim.id}: ${claim.status} claims require source paths`);
      if (testCommands.length === 0) fail(`${claim.id}: ${claim.status} claims require executable test commands`);
    }
    if (claim.status === "absent" && (sourcePaths.length > 0 || testCommands.length > 0)) {
      fail(`${claim.id}: absent claims must not imply implementation evidence`);
    }
    for (const sourcePath of sourcePaths) {
      if (!fs.existsSync(path.join(repoRoot, sourcePath))) fail(`${claim.id}: missing source path ${sourcePath}`);
    }
    for (const command of testCommands) {
      if (typeof command !== "string" || !/\bnpm\s+(?:run\s+\S+|test)\b/.test(command)) {
        fail(`${claim.id}: test command is not executable evidence: ${command}`);
      }
    }

    const runtimeStatus = kirana.runtimeProof?.status;
    if (claim.proofKind !== "code_controlled" && claim.status === "verified" && runtimeStatus !== "verified") {
      fail(`${claim.id}: runtime-dependent verified claims require a verified runtimeProof`);
    }
    if ((claim.proofKind === "runtime_required" || claim.proofKind === "external_runtime") && claim.status !== "absent" && runtimeStatus !== "verified") {
      if (!Array.isArray(kirana.externalProofRequirements) || kirana.externalProofRequirements.length === 0) {
        fail(`${claim.id}: missing runtime proof must list externalProofRequirements`);
      }
    }
    if (runtimeStatus === "verified") {
      if (!kirana.runtimeProof.artifact) fail(`${claim.id}: verified runtime proof needs an artifact`);
      else if (!fs.existsSync(path.join(repoRoot, kirana.runtimeProof.artifact))) fail(`${claim.id}: runtime artifact is missing: ${kirana.runtimeProof.artifact}`);
    }
  }

  for (const domain of matrix.domains ?? []) {
    const total = claims.filter((claim) => claim.domain === domain.id).reduce((sum, claim) => sum + Number(claim.weight || 0), 0);
    if (!closeTo(total, 100)) fail(`${domain.id}: claim weights must total 100; found ${total}`);
  }

  for (const cap of matrix.caps ?? []) {
    if (!domains.has(cap.domain)) fail(`cap references unknown domain ${cap.domain}`);
    if (!(Number(cap.maxScore) >= 0 && Number(cap.maxScore) <= matrix.scoreScale)) fail(`${cap.domain}: cap is outside score scale`);
    for (const claimId of cap.requiresVerifiedClaims ?? []) if (!claimIds.has(claimId)) fail(`${cap.domain}: cap references unknown claim ${claimId}`);
  }
}

if (errors.length) {
  console.error(JSON.stringify({ type: "competitive_evidence", status: "failed", errorCount: errors.length, errors }, null, 2));
  process.exit(1);
}

const statusFactors = matrix.statusFactors;
const domainScores = matrix.domains.map((domain) => {
  const domainClaims = matrix.claims.filter((claim) => claim.domain === domain.id);
  const raw = domainClaims.reduce((sum, claim) => {
    const factor = Number(statusFactors[claim.status]);
    return sum + Number(claim.weight) * factor * freshnessFactor(claim.lastVerifiedAt);
  }, 0) / 100 * matrix.scoreScale;
  const appliedCaps = (matrix.caps ?? []).filter((cap) => cap.domain === domain.id && !cap.requiresVerifiedClaims.every((id) => matrix.claims.find((claim) => claim.id === id)?.status === "verified"));
  const cap = appliedCaps.length ? Math.min(...appliedCaps.map((item) => Number(item.maxScore))) : matrix.scoreScale;
  return {
    id: domain.id,
    label: domain.label,
    weight: domain.weight,
    rawScore: Number(raw.toFixed(2)),
    score: Number(Math.min(raw, cap).toFixed(2)),
    cap: cap < matrix.scoreScale ? cap : null,
    capReasons: appliedCaps.map((item) => item.reason)
  };
});

const overall = domainScores.reduce((sum, domain) => sum + domain.score * domain.weight, 0) / 100;
console.log(JSON.stringify({
  type: "competitive_evidence",
  status: "passed",
  generatedAt: matrix.generatedAt,
  overallScore: Number(overall.toFixed(2)),
  domains: domainScores,
  claimCounts: Object.fromEntries([...allowedStatuses].map((status) => [status, matrix.claims.filter((claim) => claim.status === status).length])),
  wordingRule: "verified=implemented and proved; partial=incomplete; external_blocked=not production-integrated; absent=not implemented"
}, null, 2));

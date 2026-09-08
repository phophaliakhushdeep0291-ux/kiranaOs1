/** Cafe entry point for the shared snapshot-based PostgreSQL recovery proof. */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { missingRequirements, recoveryPoint } from "./restore-drill-report.js";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requiredStages = ["source-snapshot", "create-backup", "reset-restore-schema", "restore-backup", "exact-restore-fidelity", "money-paise-reconciliation"];

export function evaluateCafeProof(report, objectiveHours, now = Date.now()) {
  const fidelityVerified = report?.type === "kiranaos_disaster_recovery_proof"
    && report.status === "passed"
    && report.repository?.backendSourceStable === true
    && report.backup?.generatedByThisProof === true
    && /^[a-f0-9]{64}$/i.test(report.backup?.sha256 || "")
    && Number.isSafeInteger(report.backup?.bytes) && report.backup.bytes > 0
    && report.fidelity?.exactMatch === true
    && report.fidelity?.contentHashesMatched === true
    && report.fidelity?.businessWorkloadVerified === true
    && Array.isArray(report.stages)
    && requiredStages.every((id) => report.stages.some((stage) => stage?.id === id && stage.status === "passed"))
    && report.stages.every((stage) => stage?.status === "passed");
  // A fresh exported snapshot is taken after the proof starts. The start time
  // is a conservative lower bound; filesystem mtime is not backup provenance.
  const rpo = recoveryPoint({ backupTakenAt: report?.startedAt, objectiveHours, now });
  return {
    passed: Boolean(fidelityVerified && rpo.withinObjective),
    fidelityVerified: Boolean(fidelityVerified),
    recoveryPoint: { ...rpo, basis: "fresh-drill-start", productionBackupCadenceVerified: false },
  };
}

function launchProof(env) {
  return spawnSync(process.execPath, [path.join(backendRoot, "scripts", "disaster-recovery-proof.js")], {
    cwd: backendRoot, env, stdio: "inherit", shell: false,
  });
}

export function runCafeRestoreDrill({
  env = process.env, args = process.argv.slice(2), runProof = launchProof,
  readReport = (filename) => JSON.parse(fs.readFileSync(filename, "utf8")),
  emit = (payload) => console.log(JSON.stringify(payload, null, 2)), now = Date.now,
} = {}) {
  const flags = new Set(args);
  const objectiveHours = Number(env.RECOVERY_POINT_OBJECTIVE_HOURS || 24);
  const missing = missingRequirements(env);
  if (!Number.isFinite(objectiveHours) || objectiveHours <= 0) {
    missing.push({ key: "RECOVERY_POINT_OBJECTIVE_HOURS", reason: "must be a positive finite number", why: "A valid backup-age objective is required." });
  }
  if (flags.has("--check") || missing.length > 0) {
    const ready = missing.length === 0;
    emit({
      type: "cafe_restore_drill_check", status: ready ? "ready" : "not-configured",
      objectiveHours, connectionVerified: false, missing,
      nextStep: ready ? "Configuration passed. Run npm run drill:restore to verify actual recovery."
        : "Configure the required variables; no database connection or restore has been attempted.",
    });
    // Inspecting absent configuration is non-fatal unless explicitly required.
    // An actual drill must fail if it cannot run, including unattended runs.
    return !ready && (!flags.has("--check") || flags.has("--require")) ? 1 : 0;
  }

  const reportPath = path.join(backendRoot, "release-artifacts", `cafe-restore-drill-${crypto.randomUUID()}`, "proof.json");
  try {
    const result = runProof({
      ...env, DR_CREATE_BACKUP: "true", BACKUP_FILE: "", BACKUP_MANIFEST_FILE: "",
      PROOF_REQUIRE_DR: "true", DR_PROOF_REPORT_PATH: reportPath,
    });
    if (result?.status !== 0 || result?.error) throw new Error("Recovery proof process did not complete successfully.");
    const report = readReport(reportPath);
    const verdict = evaluateCafeProof(report, objectiveHours, now());
    emit({
      type: "cafe_restore_drill", status: verdict.passed ? "passed" : "failed", reportPath,
      ...verdict, backup: report?.backup ?? null, fidelity: report?.fidelity ?? null,
      limitations: [
        "This tests a fresh snapshot; it does not verify scheduled production backup frequency, retention, or offsite durability.",
        "Public-table content is checked; sequence state, roles, permissions, indexes, and non-public schemas are not independently compared.",
      ],
      finishedAt: new Date(now()).toISOString(),
    });
    return verdict.passed ? 0 : 1;
  } catch {
    // Child errors and arbitrary report data can contain connection secrets.
    emit({ type: "cafe_restore_drill", status: "failed", reportPath,
      message: "Recovery proof failed or did not produce a readable report. Inspect its diagnostic output.", finishedAt: new Date(now()).toISOString() });
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runCafeRestoreDrill();
}

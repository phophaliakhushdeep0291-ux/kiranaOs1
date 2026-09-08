import assert from "node:assert/strict";
import { evaluateCafeProof, runCafeRestoreDrill } from "../scripts/cafe-restore-drill.js";

const now = Date.parse("2026-09-08T12:00:00Z");
const proof = () => ({
  type: "kiranaos_disaster_recovery_proof", status: "passed", startedAt: "2026-09-08T11:55:00Z",
  repository: { backendSourceStable: true },
  backup: { generatedByThisProof: true, sha256: "a".repeat(64), bytes: 1024 },
  fidelity: { exactMatch: true, contentHashesMatched: true, businessWorkloadVerified: true },
  stages: ["source-snapshot", "create-backup", "reset-restore-schema", "restore-backup", "exact-restore-fidelity", "money-paise-reconciliation"]
    .map((id) => ({ id, status: "passed" })),
});
assert.equal(evaluateCafeProof(proof(), 24, now).passed, true);
assert.equal(evaluateCafeProof(proof(), 24, now).recoveryPoint.productionBackupCadenceVerified, false);
for (const mutate of [
  (p) => { p.status = "failed"; }, (p) => { delete p.repository; },
  (p) => { p.repository.backendSourceStable = false; }, (p) => { p.backup.generatedByThisProof = false; },
  (p) => { p.backup.sha256 = "not-a-checksum"; }, (p) => { p.backup.bytes = 0; },
  (p) => { p.fidelity.exactMatch = false; }, (p) => { p.fidelity.contentHashesMatched = false; },
  (p) => { p.fidelity.businessWorkloadVerified = false; }, (p) => { p.stages.pop(); },
  (p) => { p.stages.push({ id: "extra-check", status: "failed" }); },
  (p) => { p.startedAt = "2026-09-09T12:00:00Z"; }, (p) => { p.startedAt = "2026-09-06T12:00:00Z"; },
]) {
  const p = proof(); mutate(p); assert.equal(evaluateCafeProof(p, 24, now).passed, false);
}
for (const p of [null, {}, { status: "passed" }]) assert.equal(evaluateCafeProof(p, 24, now).passed, false);

const env = {
  DATABASE_URL: "postgresql://tester:secret@localhost/kiranaos_test?schema=public",
  RESTORE_TEST_DATABASE_URL: "postgresql://tester:secret@localhost/kiranaos_restore_test?schema=public",
  ALLOW_RESTORE_TEST_DB: "true", PG_BIN_DIR: "C:/Postgres bin",
  BACKUP_FILE: "unrelated-old.dump", BACKUP_MANIFEST_FILE: "unrelated.json", DR_CREATE_BACKUP: "false",
};
let launched = 0;
let childEnv;
let readPath;
let output;
const options = {
  env, args: [], now: () => now, emit: (payload) => { output = payload; },
  runProof: (child) => { launched++; childEnv = child; return { status: 0 }; },
  readReport: (filename) => { readPath = filename; return proof(); },
};
assert.equal(runCafeRestoreDrill({ ...options, args: ["--check"] }), 0);
assert.equal(launched, 0); assert.equal(output.connectionVerified, false);
assert.equal(runCafeRestoreDrill({ ...options, env: {} }), 1);
assert.equal(runCafeRestoreDrill({ ...options, env: {}, args: ["--check"] }), 0);
assert.equal(runCafeRestoreDrill({ ...options, env: {}, args: ["--check", "--require"] }), 1);
assert.equal(runCafeRestoreDrill({ ...options, env: { ...env, RESTORE_TEST_DATABASE_URL: env.DATABASE_URL } }), 1);
assert.equal(runCafeRestoreDrill({ ...options, env: { ...env, RECOVERY_POINT_OBJECTIVE_HOURS: "nope" } }), 1);
assert.equal(launched, 0, "unsafe or incomplete configuration must not launch recovery");
assert.equal(runCafeRestoreDrill(options), 0);
assert.equal(childEnv.PG_BIN_DIR, env.PG_BIN_DIR);
assert.equal(childEnv.DR_CREATE_BACKUP, "true");
assert.equal(childEnv.BACKUP_FILE, ""); assert.equal(childEnv.BACKUP_MANIFEST_FILE, "");
assert.equal(childEnv.PROOF_REQUIRE_DR, "true");
assert.equal(readPath, childEnv.DR_PROOF_REPORT_PATH);
const firstPath = readPath;
assert.equal(runCafeRestoreDrill(options), 0);
assert.notEqual(readPath, firstPath, "each run reads only its own proof, never a shared latest artifact");
assert.equal(runCafeRestoreDrill({ ...options, runProof: () => ({ status: 1 }) }), 1);
assert.equal(runCafeRestoreDrill({ ...options, runProof: () => ({ status: 0, error: new Error("secret") }) }), 1);
assert.equal(runCafeRestoreDrill({ ...options, readReport: () => { throw new Error(env.DATABASE_URL); } }), 1);
assert.doesNotMatch(JSON.stringify(output), /tester|secret|postgresql/);
assert.equal(runCafeRestoreDrill({ ...options, readReport: () => ({ status: "passed" }) }), 1);
console.log("cafe-restore-drill: ok (pure orchestration; no live database restore claimed)");

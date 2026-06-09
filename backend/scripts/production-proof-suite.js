import { spawnSync } from "node:child_process";
import process from "node:process";

const steps = [];
const results = [];

function boolEnv(name) {
  return String(process.env[name] || "").toLowerCase() === "true";
}

function addStep(name, command, args, options = {}) {
  steps.push({ name, command, args, ...options });
}

function runStep(step) {
  if (step.skip) {
    results.push({ name: step.name, status: "skipped", reason: step.skipReason });
    console.log(`↷ Skipped: ${step.name} — ${step.skipReason}`);
    return;
  }

  console.log(`\n▶ ${step.name}`);
  const result = spawnSync(step.command, step.args, {
    cwd: process.cwd(),
    env: { ...process.env, ...(step.env || {}) },
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.status !== 0) {
    results.push({ name: step.name, status: "failed", exitCode: result.status || 1 });
    console.error(`\n❌ Failed: ${step.name}`);
    console.error(JSON.stringify({ type: "production_proof_suite_failed", results, time: new Date().toISOString() }, null, 2));
    process.exit(result.status || 1);
  }

  results.push({ name: step.name, status: "passed" });
}

const hasLiveBaseUrl = !!(process.env.PROOF_BASE_URL || process.env.CONTRACT_SMOKE_BASE_URL || process.env.SMOKE_BASE_URL);
const hasPostgresUrl = !!(process.env.POSTGRES_TEST_DATABASE_URL || process.env.TEST_DATABASE_URL);
const hasRestoreUrl = !!process.env.RESTORE_TEST_DATABASE_URL;
const shouldCheckWorker = boolEnv("PROOF_REQUIRE_WORKER") || boolEnv("QUEUES_ENABLED") || boolEnv("SMOKE_EXPECT_WORKER");

if (boolEnv("PROOF_REQUIRE_LIVE") && !hasLiveBaseUrl) {
  console.error("PROOF_REQUIRE_LIVE=true requires PROOF_BASE_URL, CONTRACT_SMOKE_BASE_URL, or SMOKE_BASE_URL.");
  process.exit(1);
}
if (boolEnv("PROOF_REQUIRE_POSTGRES") && !hasPostgresUrl) {
  console.error("PROOF_REQUIRE_POSTGRES=true requires POSTGRES_TEST_DATABASE_URL or TEST_DATABASE_URL.");
  process.exit(1);
}
// PROOF_REQUIRE_DR also expects ALLOW_RESTORE_TEST_DB=true to allow the restore drill.
if (boolEnv("PROOF_REQUIRE_DR") && !hasRestoreUrl) {
  console.error("PROOF_REQUIRE_DR=true requires RESTORE_TEST_DATABASE_URL and ALLOW_RESTORE_TEST_DB=true.");
  process.exit(1);
}

const liveBaseUrl = process.env.PROOF_BASE_URL || process.env.CONTRACT_SMOKE_BASE_URL || process.env.SMOKE_BASE_URL || "http://localhost:3000";

addStep("Migration safety check", "npm", ["run", "migration:safety"]);
addStep("Release gate check", "npm", ["run", "release:gate"]);
addStep("Static production readiness check", "npm", ["run", "prod:check"]);
addStep("API contract check", "npm", ["run", "contract:check"]);
addStep("Offline Razorpay signature fixture proof", "npm", ["run", "razorpay:fixtures"]);
addStep("Live API contract smoke", "npm", ["run", "contract:smoke"], {
  skip: !hasLiveBaseUrl,
  skipReason: "set PROOF_BASE_URL or SMOKE_BASE_URL after starting backend",
  env: { CONTRACT_SMOKE_BASE_URL: liveBaseUrl, SMOKE_BASE_URL: liveBaseUrl },
});
addStep("Live backend smoke test", "npm", ["run", "smoke:test"], {
  skip: !hasLiveBaseUrl,
  skipReason: "set PROOF_BASE_URL or SMOKE_BASE_URL after starting backend",
  env: { SMOKE_BASE_URL: liveBaseUrl },
});
addStep("Redis worker heartbeat proof", "npm", ["run", "worker:health"], {
  skip: !shouldCheckWorker,
  skipReason: "QUEUES_ENABLED/PROOF_REQUIRE_WORKER is not true",
});
addStep("PostgreSQL migration/integration/concurrency proof", "npm", ["run", "proof:postgres"], {
  skip: !hasPostgresUrl,
  skipReason: "POSTGRES_TEST_DATABASE_URL or TEST_DATABASE_URL not set",
});
addStep("PostgreSQL backup/restore disaster recovery proof", "npm", ["run", "proof:dr"], {
  skip: !(boolEnv("PROOF_REQUIRE_DR") || hasRestoreUrl),
  skipReason: "set RESTORE_TEST_DATABASE_URL and ALLOW_RESTORE_TEST_DB=true to run restore drill",
});

console.log("Production proof suite starting...");
console.log(JSON.stringify({
  type: "production_proof_suite_plan",
  liveBaseUrl: hasLiveBaseUrl ? liveBaseUrl : null,
  postgresConfigured: hasPostgresUrl,
  workerCheckRequired: shouldCheckWorker,
  restoreDrillConfigured: hasRestoreUrl,
  time: new Date().toISOString(),
}, null, 2));

for (const step of steps) runStep(step);

console.log("\n✅ Production proof suite completed.");
console.log(JSON.stringify({ type: "production_proof_suite_passed", results, time: new Date().toISOString() }, null, 2));

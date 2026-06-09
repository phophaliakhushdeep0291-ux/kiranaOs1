import fs from "fs";
import path from "path";
import process from "process";

const root = process.cwd();
const errors = [];
const warnings = [];

function fail(message) { errors.push(message); }
function warn(message) { warnings.push(message); }
function exists(file) { return fs.existsSync(path.join(root, file)); }
function read(file) { return fs.readFileSync(path.join(root, file), "utf8"); }
function readJson(file) { return JSON.parse(read(file)); }

const pkg = exists("package.json") ? readJson("package.json") : null;
if (!pkg) fail("package.json is required for release gate");

const version = process.env.RELEASE_VERSION || pkg?.version || "";
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  fail(`Release version must be semver-like. Got: ${version || "<empty>"}`);
}
if (process.env.RELEASE_VERSION && pkg?.version && process.env.RELEASE_VERSION !== pkg.version) {
  fail(`RELEASE_VERSION (${process.env.RELEASE_VERSION}) must match package.json version (${pkg.version})`);
}

const requiredDocs = [
  "CHANGELOG.md",
  "docs/RELEASE_RUNBOOK.md",
  "docs/ROLLBACK_PLAN.md",
  "docs/PRODUCTION_LAUNCH_GATE.md",
  "docs/DISASTER_RECOVERY.md",
  "docs/OPERATIONAL_PROOF.md",
];
for (const file of requiredDocs) {
  if (!exists(file)) fail(`Missing release/rollout document: ${file}`);
}

if (exists("CHANGELOG.md")) {
  const changelog = read("CHANGELOG.md");
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const hasVersionSection = new RegExp(`^##\\s+(?:\\[${escaped}\\]|${escaped})(?:\\s|$|-)`, "m").test(changelog);
  if (!hasVersionSection) fail(`CHANGELOG.md must contain a release section for version ${version}`);
  for (const word of ["Added", "Changed", "Fixed", "Operational"]){
    if (!new RegExp(`^###\\s+${word}\\b`, "m").test(changelog)) warn(`CHANGELOG.md has no '${word}' subsection`);
  }
}

if (pkg?.scripts) {
  const requiredScripts = [
    "migration:safety",
    "release:gate",
    "proof:release",
    "proof:ops",
    "proof:postgres",
    "proof:dr",
    "prod:preflight",
    "contract:smoke",
    "worker:health",
    "money:paise:reconcile",
  ];
  for (const script of requiredScripts) {
    if (!pkg.scripts[script]) fail(`package.json missing release-critical script: ${script}`);
  }
}

if (exists(".github/workflows/backend-ci.yml")) {
  const ci = read(".github/workflows/backend-ci.yml");
  for (const snippet of ["npm run migration:safety", "npm run release:gate", "npm run proof:ops"]){
    if (!ci.includes(snippet)) fail(`Backend CI must run: ${snippet}`);
  }
}

if (exists("Dockerfile")) {
  const dockerfile = read("Dockerfile");
  for (const snippet of ["HEALTHCHECK", "npm run prisma:deploy:postgres", "COPY contracts ./contracts"]){
    if (!dockerfile.includes(snippet)) fail(`Dockerfile missing release-critical snippet: ${snippet}`);
  }
}

const releaseDocs = ["docs/RELEASE_RUNBOOK.md", "docs/ROLLBACK_PLAN.md", "docs/PRODUCTION_LAUNCH_GATE.md"].filter(exists).map(read).join("\n");
for (const phrase of [
  "backup before migration",
  "restore drill",
  "rollback image",
  "health/ready",
  "npm run proof:release",
  "Razorpay test-mode",
  "Redis worker heartbeat",
  "frontend-backend E2E",
]) {
  if (!releaseDocs.toLowerCase().includes(phrase.toLowerCase())) fail(`Release docs must mention: ${phrase}`);
}

if (process.env.RELEASE_APPROVED === "true") {
  for (const envKey of ["RELEASE_APPROVER", "RELEASE_ROLLBACK_IMAGE"]){
    if (!process.env[envKey]) fail(`${envKey} is required when RELEASE_APPROVED=true`);
  }
} else {
  warn("RELEASE_APPROVED is not true; gate is documentation/proof-only, not a human approval record");
}

for (const message of warnings) console.warn(JSON.stringify({ type: "release_gate_warning", message }));
if (errors.length) {
  for (const message of errors) console.error(JSON.stringify({ type: "release_gate_error", message }));
  console.error(JSON.stringify({ type: "release_gate", status: "failed", errorCount: errors.length }));
  process.exit(1);
}

console.log(JSON.stringify({ type: "release_gate", status: "passed", version, warningCount: warnings.length }));

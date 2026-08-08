import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const repositoryRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();

const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 })
  .split("\0")
  .filter(Boolean);
const trackedAndPresent = tracked.filter((file) => existsSync(resolve(repositoryRoot, file)));

const forbidden = [
  { pattern: /(^|\/)(node_modules|dist|build|coverage|qa-artifacts|test-results|playwright-report)(\/|$)/i, reason: "generated build or test output" },
  { pattern: /(^|\/)(hotel-demo|hotel-pitch)(\/|$)/i, reason: "unrelated prototype" },
  { pattern: /^archive\//i, reason: "local archive" },
  { pattern: /^backend\/storage\/(exports|backups)\//i, reason: "runtime shop data" },
  { pattern: /^backend\/prisma\/mnt\//i, reason: "mounted workspace output" },
  { pattern: /(^|\/)\.claude\//i, reason: "local editor/agent state" },
  { pattern: /\.(log|tmp|bak|orig|rej|zip)$/i, reason: "temporary or backup file" },
  { pattern: /(^|\/)__qa_/i, reason: "one-off QA probe" },
  { pattern: /(^|\/)patch-test\.txt$/i, reason: "patch probe" },
  { pattern: /-redeploy\.txt$/i, reason: "deployment trigger marker" },
  { pattern: /^ci\d+\//i, reason: "historical CI run artifact" },
];

const violations = trackedAndPresent.flatMap((file) => forbidden
  .filter(({ pattern }) => pattern.test(file))
  .map(({ reason }) => `${file} (${reason})`));

const requiredSeedAssets = [
  "backend/prisma/seed.js",
  "catalog/kirana-starter-catalog.csv",
  "frontend/src/features/core/products/starter-catalog/kirana-catalog.generated.ts",
  "frontend/src/features/core/products/starter-catalog/kirana-catalog-summary.generated.ts",
  "frontend/src/features/core/products/starter-catalog/load-starter-catalog.ts",
  "frontend/src/features/core/products/starter-catalog/starter-catalog.ts",
];
const trackedSet = new Set(tracked);
const missingSeedAssets = requiredSeedAssets.filter((file) => (
  !trackedSet.has(file) || !existsSync(resolve(repositoryRoot, file))
));

if (violations.length) {
  console.error("Repository hygiene check failed. Remove these tracked artifacts and rely on CI artifact storage:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

if (missingSeedAssets.length) {
  console.error("Repository hygiene check failed. New-shop seed/catalog assets must remain tracked:");
  for (const file of missingSeedAssets) console.error(`- ${file}`);
  process.exit(1);
}

console.log(`Repository hygiene check passed (${trackedAndPresent.length} tracked files inspected; ${requiredSeedAssets.length} new-shop seed assets preserved).`);

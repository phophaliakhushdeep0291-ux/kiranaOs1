import { spawnSync } from "node:child_process";

const schema = "prisma-postgres/schema.prisma";
const prismaCli = "node_modules/prisma/build/index.js";

/**
 * Migrations that may be auto-resolved after a transactional failure.
 *
 * `prisma migrate deploy` refuses to apply anything once the target database
 * holds a failed migration record (P3009), so one bad deploy leaves the service
 * unable to boot until a human intervenes — the container exits before the app
 * ever starts. For migrations that are written idempotently we can safely mark
 * the record rolled back and replay it.
 *
 * Only add a migration here after making its SQL re-runnable (IF NOT EXISTS /
 * IF EXISTS guards). Auto-resolving a non-idempotent migration would replay a
 * partially applied change and fail again, or worse, apply it twice.
 */
const RECOVERABLE_MIGRATIONS = [
  "000052_purchase_returns",
  "000070_audit_finding_discrepancy",
];

function runPrisma(args) {
  const result = spawnSync(process.execPath, [prismaCli, ...args, "--schema", schema], {
    encoding: "utf8",
    env: process.env,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result;
}

function deployOutput(result) {
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

let deploy = runPrisma(["migrate", "deploy"]);
if (deploy.status === 0) process.exit(0);

// Recover in a loop: a database can carry more than one failed record, and
// resolving only the first would still leave the next deploy blocked.
for (let attempt = 0; attempt < RECOVERABLE_MIGRATIONS.length; attempt += 1) {
  const failure = deployOutput(deploy);
  if (!failure.includes("P3009")) break;

  const blocked = RECOVERABLE_MIGRATIONS.find((name) => failure.includes(name));
  if (!blocked) {
    console.error("Migration failure is not in the recoverable list; refusing to auto-resolve it.");
    break;
  }

  console.warn(`Recovering transactionally failed migration ${blocked}; its SQL is idempotent, so it is safe to replay.`);
  const resolved = runPrisma(["migrate", "resolve", "--rolled-back", blocked]);
  if (resolved.status !== 0) process.exit(resolved.status ?? 1);

  deploy = runPrisma(["migrate", "deploy"]);
  if (deploy.status === 0) process.exit(0);
}

process.exit(deploy.status ?? 1);

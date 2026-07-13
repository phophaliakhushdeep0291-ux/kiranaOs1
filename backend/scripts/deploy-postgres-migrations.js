import { spawnSync } from "node:child_process";

const schema = "prisma-postgres/schema.prisma";
const knownFailedMigration = "000052_purchase_returns";
const prismaCli = "node_modules/prisma/build/index.js";

function runPrisma(args) {
  const result = spawnSync(process.execPath, [prismaCli, ...args, "--schema", schema], {
    encoding: "utf8",
    env: process.env,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result;
}

let deploy = runPrisma(["migrate", "deploy"]);
if (deploy.status === 0) process.exit(0);

const failure = `${deploy.stdout ?? ""}\n${deploy.stderr ?? ""}`;
if (!failure.includes("P3009") || !failure.includes(knownFailedMigration)) {
  process.exit(deploy.status ?? 1);
}

console.warn(`Recovering transactionally failed migration ${knownFailedMigration}; no other migration failures are auto-resolved.`);
const resolved = runPrisma(["migrate", "resolve", "--rolled-back", knownFailedMigration]);
if (resolved.status !== 0) process.exit(resolved.status ?? 1);

deploy = runPrisma(["migrate", "deploy"]);
process.exit(deploy.status ?? 1);

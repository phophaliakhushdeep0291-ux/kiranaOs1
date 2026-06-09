import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import {
  buildTestEnv,
  isKnownPrismaRuntimeUnavailable,
  shouldGracefullySkipPrismaRuntime,
} from "./test-db-utils.js";

const prismaCli = path.join(process.cwd(), "node_modules", "prisma", "build", "index.js");
const args = process.argv.slice(2);
if (!args.length) {
  console.error("Usage: node scripts/run-prisma-test-db.js <prisma args...>");
  process.exit(1);
}

const result = spawnSync(process.execPath, [prismaCli, ...args], {
  cwd: process.cwd(),
  env: buildTestEnv(),
  stdio: "pipe",
  encoding: "utf8",
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

if (result.status !== 0) {
  const combined = `${result.stdout || ""}\n${result.stderr || ""}`;
  if (isKnownPrismaRuntimeUnavailable(combined) && shouldGracefullySkipPrismaRuntime()) {
    console.warn(
      "Skipping Prisma test DB command because the Prisma runtime/binary is unavailable in this sandbox. " +
      "CI/real forced runs will fail instead of skipping."
    );
    process.exit(0);
  }
  process.exit(result.status || 1);
}

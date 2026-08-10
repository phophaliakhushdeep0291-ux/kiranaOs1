import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { buildTestEnv, maskDatabaseUrl } from "./test-db-utils.js";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("Usage: node scripts/run-db-example-tests.js tests/example-a.js [tests/example-b.js ...]");
  process.exit(1);
}

const backendRoot = path.resolve(process.cwd());
const testsRoot = path.resolve(backendRoot, "tests");
const resolvedFiles = files.map((file) => {
  const absolute = path.resolve(backendRoot, file);
  const relative = path.relative(testsRoot, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative) || path.extname(absolute) !== ".js") {
    throw new Error(`DB example must be a JavaScript file inside backend/tests: ${file}`);
  }
  if (!fs.existsSync(absolute)) throw new Error(`DB example does not exist: ${file}`);
  return absolute;
});

const env = buildTestEnv({
  NODE_ENV: "test",
  PRISMA_CLIENT_VARIANT: "integration",
  FORCE_DB_TESTS: "true",
});

function runNode(args, label) {
  const result = spawnSync(process.execPath, args, {
    cwd: backendRoot,
    env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status ?? "unknown"}`);
}

console.log(`Preparing guarded DB-example environment at ${maskDatabaseUrl(env.TEST_DATABASE_URL)}`);
runNode(["scripts/setup-test-db.js"], "Isolated test database setup");
for (const file of resolvedFiles) {
  console.log(`Running isolated DB example: ${path.relative(backendRoot, file)}`);
  runNode([file], path.basename(file));
}


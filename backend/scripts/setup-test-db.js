import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  buildTestEnv,
  getTestDatabaseUrl,
  isKnownPrismaRuntimeUnavailable,
  isPostgresTestDatabaseUrl,
  maskDatabaseUrl,
  shouldGracefullySkipPrismaRuntime,
} from "./test-db-utils.js";

const env = buildTestEnv();
const prismaCli = path.join(process.cwd(), "node_modules", "prisma", "build", "index.js");
const isPostgres = isPostgresTestDatabaseUrl(getTestDatabaseUrl());
const schemaArgs = isPostgres ? ["--schema", "prisma-postgres/schema.prisma"] : [];
const skipGenerate = process.env.SKIP_PRISMA_GENERATE === "true";

function assertCompatibleGeneratedClient() {
  const generatedSchemaPath = path.join(process.cwd(), "node_modules", ".prisma", "client", "schema.prisma");
  if (!fs.existsSync(generatedSchemaPath)) {
    throw new Error(
      "SKIP_PRISMA_GENERATE=true requires an existing generated Prisma client. Run npm run prisma:generate first."
    );
  }

  const generatedSchema = fs.readFileSync(generatedSchemaPath, "utf8");
  const expectedProvider = isPostgres ? "postgresql" : "sqlite";
  const providerPattern = new RegExp(`datasource\\s+db\\s*\\{[\\s\\S]*?provider\\s*=\\s*[\"']${expectedProvider}[\"']`);
  if (!providerPattern.test(generatedSchema)) {
    throw new Error(
      `SKIP_PRISMA_GENERATE=true found an incompatible Prisma client; expected ${expectedProvider}. Regenerate the client first.`
    );
  }
}

function ensureSqliteDatabaseFile() {
  const databaseUrl = getTestDatabaseUrl();
  const rawPath = decodeURIComponent(databaseUrl.slice("file:".length).split("?")[0]);
  const databasePath = path.isAbsolute(rawPath) || /^[A-Za-z]:[\\/]/.test(rawPath)
    ? path.normalize(rawPath)
    : path.resolve(process.cwd(), "prisma", rawPath);

  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  if (!fs.existsSync(databasePath)) {
    fs.closeSync(fs.openSync(databasePath, "a"));
  }
}

function runPrisma(args) {
  const result = spawnSync(process.execPath, [prismaCli, ...args], {
    cwd: process.cwd(),
    env,
    stdio: "pipe",
    encoding: "utf8",
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.status !== 0) {
    const combined = `${result.stdout || ""}\n${result.stderr || ""}`;
    if (isKnownPrismaRuntimeUnavailable(combined) && shouldGracefullySkipPrismaRuntime()) {
      console.warn(
        "Skipping test DB setup because the Prisma runtime/binary is unavailable in this sandbox. " +
        "On a real machine/CI, rerun after `npm install`/`npm run prisma:generate`; CI will fail instead of skipping."
      );
      process.exit(0);
    }
    process.exit(result.status || 1);
  }
}

fs.mkdirSync(path.join(process.cwd(), "prisma"), { recursive: true });
console.log(`Using isolated TEST_DATABASE_URL=${maskDatabaseUrl(getTestDatabaseUrl())}`);

if (skipGenerate) {
  assertCompatibleGeneratedClient();
  console.log("Reusing the existing compatible Prisma client (generation explicitly skipped).");
}

if (isPostgres) {
  console.log("Preparing PostgreSQL integration test database with prisma-postgres/schema.prisma");
  if (!skipGenerate) runPrisma(["generate", ...schemaArgs]);
  // migrate reset is destructive, so test-db-utils only allows clear test/CI DB names
  // and requires ALLOW_POSTGRES_TEST_DB=true before this path can run.
  runPrisma(["migrate", "reset", "--force", "--skip-seed", ...(skipGenerate ? ["--skip-generate"] : []), ...schemaArgs]);
} else {
  ensureSqliteDatabaseFile();
  if (!skipGenerate) runPrisma(["generate"]);
  runPrisma(["db", "push", "--force-reset", "--accept-data-loss", ...(skipGenerate ? ["--skip-generate"] : [])]);
}

console.log("Test database is ready.");

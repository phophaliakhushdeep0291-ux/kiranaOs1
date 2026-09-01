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
  prismaSchemasEquivalent,
  shouldGracefullySkipPrismaRuntime,
} from "./test-db-utils.js";

const env = buildTestEnv();
const prismaCli = path.join(process.cwd(), "node_modules", "prisma", "build", "index.js");
const isPostgres = isPostgresTestDatabaseUrl(getTestDatabaseUrl());
const schemaArgs = isPostgres ? ["--schema", "prisma-postgres/schema.prisma"] : [];
const skipGenerate = process.env.SKIP_PRISMA_GENERATE === "true";
const sqliteClientVariants = {
  integration: { directory: "integration-prisma-client", generator: "integrationClient" },
  certification: { directory: "certification-prisma-client", generator: "certificationClient" },
};
const isolatedClient = !isPostgres
  ? sqliteClientVariants[process.env.PRISMA_CLIENT_VARIANT]
  : null;
const useIsolatedClient = Boolean(isolatedClient);

function assertCompatibleGeneratedClient() {
  const generatedSchemaPath = useIsolatedClient
    ? path.join(process.cwd(), "generated", isolatedClient.directory, "schema.prisma")
    : path.join(process.cwd(), "node_modules", ".prisma", "client", "schema.prisma");
  if (!fs.existsSync(generatedSchemaPath)) {
    throw new Error(
      `SKIP_PRISMA_GENERATE=true requires an existing ${useIsolatedClient ? process.env.PRISMA_CLIENT_VARIANT : "default"} Prisma client. Generate that client first.`
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

  if (useIsolatedClient) {
    const sourceSchemaPath = path.join(process.cwd(), "prisma", "schema.prisma");
    const sourceSchema = fs.readFileSync(sourceSchemaPath, "utf8");
    if (!prismaSchemasEquivalent(generatedSchema, sourceSchema)) {
      throw new Error(
        `SKIP_PRISMA_GENERATE=true found a stale ${process.env.PRISMA_CLIENT_VARIANT} Prisma client. Regenerate it from prisma/schema.prisma first.`
      );
    }
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
  // migrate reset is destructive, so test-db-utils only allows clear test/CI DB names
  // and requires ALLOW_POSTGRES_TEST_DB=true before this path can run.
  runPrisma(["migrate", "reset", "--force", "--skip-seed", "--skip-generate", ...schemaArgs]);
  if (!skipGenerate) runPrisma(["generate", ...schemaArgs]);
} else {
  ensureSqliteDatabaseFile();
  if (!skipGenerate) {
    // Generate only the client this caller will use. An unqualified `generate`
    // rewrites integration + certification clients too; another live suite can
    // require one while Prisma is midway through replacing it and observe an
    // incomplete module (`PrismaClient is not a constructor`).
    runPrisma(["generate", "--generator", useIsolatedClient ? isolatedClient.generator : "client"]);
  }
  // Generation is handled explicitly above. Never let db push regenerate every
  // declared client, because a live Windows dev server can hold the canonical
  // engine DLL open while the isolated integration client remains available.
  runPrisma(["db", "push", "--force-reset", "--accept-data-loss", "--skip-generate"]);
  const triggerInstall = spawnSync(process.execPath, ["scripts/install-sqlite-sync-triggers.js"], {
    cwd: process.cwd(), env, stdio: "pipe", encoding: "utf8",
  });
  if (triggerInstall.stdout) process.stdout.write(triggerInstall.stdout);
  if (triggerInstall.stderr) process.stderr.write(triggerInstall.stderr);
  if (triggerInstall.status !== 0) process.exit(triggerInstall.status || 1);
}

console.log("Test database is ready.");

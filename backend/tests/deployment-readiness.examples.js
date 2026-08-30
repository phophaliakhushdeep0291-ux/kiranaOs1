import assert from "assert";
import fs from "fs";

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function hasDatasourceProvider(schema, provider) {
  const datasource = schema.match(/\bdatasource\s+\w+\s*\{[\s\S]*?\}/)?.[0] ?? "";
  return new RegExp(`\\bprovider\\s*=\\s*["']${provider}["']`).test(datasource);
}

assert.ok(fs.existsSync("Dockerfile"), "Dockerfile must exist");
assert.ok(fs.existsSync("docker-compose.yml"), "docker-compose.yml must exist");
assert.ok(fs.existsSync(".dockerignore"), ".dockerignore must exist");
assert.ok(fs.existsSync("scripts/backup-postgres.sh"), "PostgreSQL backup script must exist");
assert.ok(fs.existsSync("prisma-postgres/schema.prisma"), "PostgreSQL Prisma schema must exist");
assert.ok(fs.existsSync("prisma-postgres/migrations/000001_init/migration.sql"), "PostgreSQL initial migration must exist");
assert.ok(fs.existsSync("scripts/production-check.js"), "production check script must exist");
assert.ok(fs.existsSync("src/modules/backups/backup.service.js"), "backup service imported by jobs and workers must ship");

const pkg = JSON.parse(read("package.json"));
for (const scriptName of [
  "dev",
  "start",
  "start:runtime",
  "prisma:generate",
  "prisma:migrate",
  "prisma:deploy",
  "prisma:generate:postgres",
  "prisma:deploy:postgres",
  "verify:product-schema",
  "deploy:migrate",
  "deploy:migrate:postgres",
  "test",
  "seed",
  "prod:check",
]) {
  assert.ok(pkg.scripts[scriptName], `package.json script ${scriptName} is required`);
}

const app = read("src/app.js");
assert.ok(app.includes('app.get("/api/health"'), "API health endpoint is required");
assert.ok(app.includes('app.get("/health"'), "container health endpoint is required");
assert.ok(app.includes('app.get("/health/ready"'), "database readiness endpoint is required");
assert.ok(app.includes("requestId"), "request ID middleware must be wired");
assert.ok(app.includes("apiLimiter"), "normal API rate limiter must be wired");
assert.ok(app.includes("authLimiter"), "auth rate limiter must be wired");
assert.ok(app.includes("aiLimiter"), "AI rate limiter must be wired");
assert.ok(app.includes("securityHeaders"), "security headers middleware must be wired");
assert.ok(app.includes("requestLogger"), "request logging middleware must be wired");

const dockerfile = read("Dockerfile");
assert.ok(dockerfile.includes("npm run deploy:migrate:postgres"), "Dockerfile must run Postgres prisma deploy helper before start");
assert.ok(dockerfile.includes("npm run prisma:generate:postgres"), "Dockerfile must generate Prisma client before/after migration");
assert.ok(dockerfile.includes("npm run deploy:migrate:postgres") && dockerfile.includes("npm run start:runtime"), "Dockerfile must deploy migrations, verify schema, and start the supervised API/worker runtime");
assert.ok(dockerfile.includes("HEALTHCHECK"), "Dockerfile must include health check");

const compose = read("docker-compose.yml");
assert.ok(compose.includes("postgres:16-alpine"), "docker-compose must include Postgres");
assert.ok(compose.includes("DATABASE_URL"), "docker-compose must configure DATABASE_URL");

const pgSchema = read("prisma-postgres/schema.prisma");
assert.ok(hasDatasourceProvider(pgSchema, "postgresql"), "PostgreSQL schema must use postgresql provider");
const pgMigration = read("prisma-postgres/migrations/000001_init/migration.sql");
assert.ok(pgMigration.includes('CREATE TABLE "Shop"'), "PostgreSQL migration must create Shop table");
assert.ok(pgMigration.includes('CREATE TABLE "OfflineSyncEvent"'), "PostgreSQL migration must include sync idempotency table");

const dockerignore = read(".dockerignore");
for (const forbidden of ["node_modules", ".env", "prisma/dev.db", "dev.db"]) {
  assert.ok(dockerignore.includes(forbidden), `.dockerignore must exclude ${forbidden}`);
}

const gitignore = read(".gitignore").split(/\r?\n/).map((line) => line.trim());
assert.ok(!gitignore.includes("backups"), "unanchored backups ignore rule must not hide src/modules/backups");
assert.ok(gitignore.includes("/backups/"), "runtime backup artifacts must use an anchored ignore rule");

const envExample = read(".env.example");
for (const key of ["DATABASE_URL", "JWT_SECRET", "ALLOWED_ORIGINS", "API_RATE_LIMIT_MAX", "AUTH_RATE_LIMIT_MAX", "AI_RATE_LIMIT_MAX", "LOG_LEVEL"]) {
  assert.ok(envExample.includes(key), `.env.example must document ${key}`);
}

console.log("Deployment readiness examples passed");

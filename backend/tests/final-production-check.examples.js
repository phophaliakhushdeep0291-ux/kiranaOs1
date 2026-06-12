import assert from "assert";
import fs from "fs";

function read(file) {
  return fs.readFileSync(file, "utf8");
}

assert.ok(fs.existsSync("scripts/production-check.js"), "production-check script must exist");
const productionCheck = read("scripts/production-check.js");

for (const required of [
  ".env.example",
  ".gitignore",
  ".dockerignore",
  "package-lock.json",
  "Dockerfile",
  "docker-compose.yml",
  "DEPLOY.md",
  "README.md",
  "prisma-postgres/schema.prisma",
  "prisma-postgres/migrations",
]) {
  assert.ok(productionCheck.includes(required), `production-check must verify ${required}`);
}

for (const unsafe of [".env", "prisma/dev.db", "dev.db-journal", "node_modules", "uploads", "logs", "*.zip"]) {
  assert.ok(productionCheck.includes(unsafe), `production-check must protect against ${unsafe}`);
}

for (const table of ["BillCounter", "AuditLog", "Session", "OfflineSyncEvent"]) {
  assert.ok(productionCheck.includes(table), `production-check must verify production migration includes ${table}`);
}

for (const command of ["npm ci", "prisma:generate:postgres", "prisma:deploy:postgres", "deploy:migrate:postgres", "verify:product-schema"]) {
  assert.ok(productionCheck.includes(command), `production-check must verify ${command}`);
}

assert.ok(productionCheck.includes("internal registry URLs"), "production-check must reject internal registry lockfile URLs");
assert.ok(productionCheck.includes("package-lock root dependency"), "production-check must verify package-lock sync");
assert.ok(productionCheck.includes("health/ready"), "production-check must verify readiness endpoint docs");

const pkg = JSON.parse(read("package.json"));
assert.ok(pkg.scripts.test, "npm test must exist");
assert.ok(pkg.scripts["prod:check"], "prod:check script must exist");
assert.ok(pkg.scripts["test:billing"].includes("final-production-check.examples.js"), "test:billing must include final production checks");

const deploy = read("DEPLOY.md");
assert.ok(deploy.includes("npm run prisma:deploy:postgres"), "DEPLOY.md must document PostgreSQL migrations");
assert.ok(deploy.includes("npm run deploy:migrate:postgres"), "DEPLOY.md must document one-command PostgreSQL migration deployment");
assert.ok(deploy.includes("npx prisma migrate deploy"), "DEPLOY.md must document migrate deploy");
assert.ok(deploy.includes("npx prisma generate"), "DEPLOY.md must document prisma generate");
assert.ok(deploy.includes("verify-product-schema"), "DEPLOY.md must document product schema verification");
assert.ok(deploy.includes("/health/ready"), "DEPLOY.md must document readiness endpoint");

console.log("Final production check examples passed");

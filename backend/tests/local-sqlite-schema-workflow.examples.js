import assert from "node:assert/strict";
import fs from "node:fs";

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const updater = fs.readFileSync("scripts/update-local-sqlite-schema.js", "utf8");
const resetter = fs.readFileSync("scripts/reset-local-sqlite-schema.js", "utf8");

for (const script of ["db:migrate", "db:push", "prisma:push", "prisma:migrate"]) {
  assert.match(pkg.scripts[script] ?? "", /update-local-sqlite-schema\.js/, `${script} must use the safe SQLite updater`);
  assert.doesNotMatch(pkg.scripts[script], /migrate dev/, `${script} must not invoke the unbootstrapped legacy SQLite migration chain`);
}
assert.match(pkg.scripts["prisma:deploy:postgres"] ?? "", /deploy-postgres-migrations\.js/, "production must retain the guarded PostgreSQL migration chain");
assert.match(pkg.scripts["prisma:generate:postgres"] ?? "", /prisma-postgres\/schema\.prisma/, "production must generate from the PostgreSQL schema");
assert.match(pkg.scripts["db:reset"] ?? "", /reset-local-sqlite-schema\.js/, "db:reset must use the guarded resetter");
assert.match(pkg.scripts["prisma:deploy"] ?? "", /prisma:deploy:postgres/, "the generic deploy alias must never use the broken SQLite migration chain");
assert.match(pkg.scripts["deploy:migrate"] ?? "", /deploy:migrate:postgres/, "the generic deploy helper must route to PostgreSQL");
assert.match(updater, /databaseUrl\.startsWith\("file:"\)/, "the local updater must reject non-SQLite URLs");
assert.match(updater, /db", "push", "--skip-generate"/, "the local updater must use Prisma schema push");
assert.doesNotMatch(updater, /accept-data-loss/, "the local updater must never auto-accept destructive changes");
assert.match(updater, /filename\.includes\("prod"\)/, "the local updater must reject production-looking files");
assert.match(resetter, /NODE_ENV === "production"/, "the resetter must refuse production mode");
assert.match(resetter, /\["dev\.db", "test\.db"\]/, "the resetter must allow only explicit local database names");
assert.match(resetter, /"--force-reset"/, "the explicit reset command must actually rebuild the local schema");
assert.match(resetter, /"--accept-data-loss"/, "only the explicitly named reset command may accept data loss");

console.log("local-sqlite-schema-workflow.examples.js OK");

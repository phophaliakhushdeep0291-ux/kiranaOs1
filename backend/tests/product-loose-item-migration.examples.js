import assert from "assert";
import fs from "fs";

function read(file) {
  return fs.readFileSync(file, "utf8");
}

const sqliteSchema = read("prisma/schema.prisma");
const pgSchema = read("prisma-postgres/schema.prisma");
const migration = read("prisma-postgres/migrations/000020_add_product_loose_item_fields/migration.sql");
const pkg = JSON.parse(read("package.json"));
const dockerfile = read("Dockerfile");
const deployDocs = read("DEPLOY.md");
const productionCheck = read("scripts/production-check.js");

const productFieldsThatCanBreakFindMany = [
  "brand",
  "mrp",
  "reorderLevel",
  "description",
  "imageUrl",
  "isLooseItem",
  "lowStockThreshold",
  "hsn",
  "costPerRateUnitPaise",
  "minPricePerRateUnitPaise",
  "defaultPricePerRateUnitPaise",
];

for (const field of productFieldsThatCanBreakFindMany) {
  assert.ok(sqliteSchema.includes(field), `SQLite Product schema must include ${field}`);
  assert.ok(pgSchema.includes(field), `PostgreSQL Product schema must include ${field}`);
  assert.ok(migration.includes(`"${field}"`), `repair migration must include Product.${field}`);
}

for (const field of [
  "brand",
  "mrp",
  "reorderLevel",
  "description",
  "imageUrl",
  "isLooseItem",
  "lowStockThreshold",
  "hsn",
  "costPerRateUnitPaise",
  "minPricePerRateUnitPaise",
  "defaultPricePerRateUnitPaise",
]) {
  assert.ok(
    migration.includes(`ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "${field}"`),
    `repair migration must safely add ${field} without dropping data`
  );
}

for (const snippet of [
  'ALTER TABLE "Product" ALTER COLUMN "isLooseItem" SET DEFAULT false',
  'ALTER TABLE "Product" ALTER COLUMN "isLooseItem" SET NOT NULL',
  '"mrp" = COALESCE("mrp", 0)',
  '"lowStockThreshold" = COALESCE("lowStockThreshold", 0)',
  'ROUND((COALESCE("defaultPricePerRateUnit", 0)::numeric * 100))::bigint',
]) {
  assert.ok(migration.includes(snippet), `repair migration must include ${snippet}`);
}

assert.ok(!/DROP\s+TABLE|DROP\s+COLUMN|TRUNCATE|DELETE\s+FROM/i.test(migration), "repair migration must be non-destructive");

assert.ok(pkg.scripts["deploy:migrate"], "package.json must expose deploy:migrate");
assert.ok(pkg.scripts["deploy:migrate:postgres"], "package.json must expose deploy:migrate:postgres");
assert.ok(pkg.scripts["deploy:migrate"].includes("npx prisma migrate deploy"), "deploy:migrate must run npx prisma migrate deploy");
assert.ok(pkg.scripts["deploy:migrate"].includes("npx prisma generate"), "deploy:migrate must run npx prisma generate");
assert.ok(pkg.scripts["deploy:migrate:postgres"].includes("npx prisma migrate deploy --schema prisma-postgres/schema.prisma"), "Postgres deploy helper must run migrate deploy with the Postgres schema");
assert.ok(pkg.scripts["deploy:migrate:postgres"].includes("npx prisma generate --schema prisma-postgres/schema.prisma"), "Postgres deploy helper must generate with the Postgres schema");

assert.ok(dockerfile.includes("npm run prisma:deploy:postgres && npm run prisma:generate:postgres"), "Dockerfile must deploy migrations and regenerate Prisma client at startup");
assert.ok(deployDocs.includes("npm run deploy:migrate:postgres"), "DEPLOY.md must document the one-command migration helper");
assert.ok(deployDocs.includes("npx prisma migrate deploy"), "DEPLOY.md must document migrate deploy");
assert.ok(deployDocs.includes("npx prisma generate"), "DEPLOY.md must document prisma generate");
assert.ok(productionCheck.includes("000020_add_product_loose_item_fields"), "production-check must require the repair migration");

console.log("Product loose item migration examples passed");

import assert from "assert";
import fs from "fs";

function read(file) {
  return fs.readFileSync(file, "utf8");
}

const sqliteSchema = read("prisma/schema.prisma");
const postgresSchema = read("prisma-postgres/schema.prisma");
const sqliteMigration = read("prisma/migrations/20260620170000_add_bill_return_reference/migration.sql");
const postgresMigration = read("prisma-postgres/migrations/000025_add_bill_return_reference/migration.sql");
const verifier = read("scripts/verify-product-schema.js");
const pkg = JSON.parse(read("package.json"));

for (const schema of [sqliteSchema, postgresSchema]) {
  assert.match(schema, /returnOfBillId\s+String\?/, "Bill.returnOfBillId must remain optional for existing bills");
  assert.ok(schema.includes("@@index([shopId, returnOfBillId])"), "Bill return lookup must be indexed per shop");
}

assert.ok(sqliteMigration.includes('ALTER TABLE "Bill" ADD COLUMN "returnOfBillId" TEXT'), "SQLite migration must add Bill.returnOfBillId");
assert.ok(postgresMigration.includes('ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "returnOfBillId" TEXT'), "PostgreSQL repair migration must safely add Bill.returnOfBillId");
assert.ok(postgresMigration.includes('CREATE INDEX IF NOT EXISTS "Bill_shopId_returnOfBillId_idx"'), "PostgreSQL migration must add the return lookup index");

for (const migration of [sqliteMigration, postgresMigration]) {
  assert.ok(!/DROP\s+TABLE|DROP\s+COLUMN|TRUNCATE|DELETE\s+FROM/i.test(migration), "Bill repair migration must preserve existing data");
}

for (const snippet of ["REQUIRED_BILL_COLUMNS", "returnOfBillId", 'PRAGMA table_info("Bill")', "db.bill.findMany({ take: 1 })"]) {
  assert.ok(verifier.includes(snippet), `startup schema verification must include ${snippet}`);
}

assert.ok(pkg.scripts["prisma:deploy"].includes("prisma:deploy:postgres"), "the generic production deploy script must route to PostgreSQL");
assert.ok(pkg.scripts["prisma:deploy:postgres"], "PostgreSQL migration deployment script must exist");
assert.ok(pkg.scripts["prisma:generate"], "Prisma generation script must exist");

console.log("Bill return reference migration examples passed");

import assert from "assert";
import fs from "fs";

function read(file) {
  return fs.readFileSync(file, "utf8");
}

const sqliteSchema = read("prisma/schema.prisma");
const pgSchema = read("prisma-postgres/schema.prisma");
const migration = read("prisma-postgres/migrations/000009_money_paise_shadow_columns/migration.sql");
const money = read("src/utils/money.js");
const app = read("src/app.js");
const billsService = read("src/modules/bills/bills.service.js");
const customersService = read("src/modules/customers/customers.service.js");
const productsService = read("src/modules/products/products.service.js");
const inventoryService = read("src/modules/inventory/inventory.service.js");
const reconciliation = read("scripts/money-paise-reconciliation.js");
const pgProof = read("scripts/postgres-production-proof.js");
const pkg = JSON.parse(read("package.json"));
const docs = read("docs/PAISE_SHADOW_COLUMNS.md") + "\n" + read("docs/MONEY_MIGRATION.md");

const requiredShadowFields = [
  "costPerRateUnitPaise",
  "minPricePerRateUnitPaise",
  "defaultPricePerRateUnitPaise",
  "udharAmountPaise",
  "subtotalPaise",
  "discountPaise",
  "gstPaise",
  "grandTotalPaise",
  "actualAmountPaise",
  "buyerPaidAmountPaise",
  "waivedAmountPaise",
  "grossProfitPaise",
  "paidAmountPaise",
  "creditAmountPaise",
  "ratePerRateUnitPaise",
  "lineTotalPaise",
  "lineCostPaise",
  "lineProfitPaise",
  "amountPaise",
  "purchaseBillAmountPaise",
  "calculatedBuyRatePaise",
  "damageLossValuePaise",
  "pricePerRateUnitPaise",
  "totalCostPaise",
  "billAmountPaise",
];

for (const field of requiredShadowFields) {
  assert.ok(sqliteSchema.includes(field), `SQLite schema must include ${field}`);
  assert.ok(pgSchema.includes(field), `PostgreSQL schema must include ${field}`);
  assert.ok(migration.includes(`"${field}"`), `Phase 27 migration must add/backfill ${field}`);
  assert.ok(reconciliation.includes(field), `reconciliation script must check ${field}`);
}

for (const snippet of [
  "export function toPaiseBigInt",
  "export function moneyShadow",
  "export function moneyShadows",
]) {
  assert.ok(money.includes(snippet), `money utils must include ${snippet}`);
}

assert.ok(app.includes('app.set("json replacer"'), "Express must serialize BigInt shadow columns safely");
assert.ok(app.includes('typeof value !== "bigint"'), "JSON replacer must explicitly handle BigInt");

assert.ok(billsService.includes("moneyShadows({ subtotal"), "bill create must write bill paise shadow fields");
assert.ok(billsService.includes("payments: { create: paymentRows }"), "bill payments must use paise-aware paymentRows");
assert.ok(billsService.includes("syncCustomerUdharPaise"), "bill udhar changes must refresh customer paise balance");
assert.ok(customersService.includes("moneyShadows({ udharAmount"), "customer create/update must write udharAmountPaise");
assert.ok(customersService.includes("udharAmountPaise: toPaiseBigInt"), "manual udhar payment must refresh udharAmountPaise");
assert.ok(productsService.includes("moneyShadows({") && productsService.includes("defaultPricePerRateUnit"), "products must write price paise fields");
assert.ok(inventoryService.includes("purchaseBillAmount") && inventoryService.includes("damageLossValue"), "inventory ledgers must write money paise fields");

assert.ok(pkg.scripts["money:paise:reconcile"], "package.json must expose money:paise:reconcile");
assert.ok(pkg.scripts["money:paise:backfill"], "package.json must expose money:paise:backfill");
assert.ok(pgProof.includes("money:paise:reconcile"), "PostgreSQL proof must run money paise reconciliation");

for (const snippet of [
  "ALLOW_MONEY_PAISE_BACKFILL",
  "--write",
  "information_schema.columns",
  "ROUND((COALESCE",
  "Run npm run prisma:deploy:postgres before reconciliation",
]) {
  assert.ok(reconciliation.includes(snippet), `reconciliation script must include ${snippet}`);
}

for (const phrase of ["paise shadow columns", "npm run money:paise:reconcile", "npm run money:paise:backfill", "Do not remove the old Float columns yet"]) {
  assert.ok(docs.includes(phrase), `paise migration docs must mention ${phrase}`);
}

console.log("Phase 27 money paise migration examples passed");

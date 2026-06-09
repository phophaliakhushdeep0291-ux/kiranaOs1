import assert from "node:assert/strict";
import fs from "node:fs";

const supplierRoutes = fs.readFileSync("src/modules/suppliers/suppliers.routes.js", "utf8");
const supplierService = fs.readFileSync("src/modules/suppliers/suppliers.service.js", "utf8");
const supplierController = fs.readFileSync("src/modules/suppliers/suppliers.controller.js", "utf8");
const sqliteSchema = fs.readFileSync("prisma/schema.prisma", "utf8");
const postgresSchema = fs.readFileSync("prisma-postgres/schema.prisma", "utf8");
const syncRules = fs.readFileSync("src/utils/syncRules.js", "utf8");
const syncService = fs.readFileSync("src/modules/sync/sync.service.js", "utf8");
const permissions = fs.readFileSync("src/middleware/permissions.js", "utf8");
const contract = fs.readFileSync("contracts/api-contract.v1.json", "utf8");

assert.match(supplierRoutes, /import \{ requireOwnerPin, requireShop \}/, "supplier routes must import requireOwnerPin");
assert.match(supplierRoutes, /router\.delete\("\/\:id",\s*requireFeature\("supplier_entry"\),\s*requireOwnerPin,\s*ctrl\.remove\)/, "supplier delete must require feature and owner PIN");
assert.match(supplierRoutes, /router\.post\("\/\:id\/restore",\s*requireFeature\("supplier_entry"\),\s*requireOwnerPin,\s*ctrl\.restore\)/, "supplier restore must require feature and owner PIN");

assert.match(supplierService, /where:\s*\{ shopId, deletedAt: null \}/, "supplier list must exclude soft-deleted suppliers");
assert.match(supplierService, /export async function softDeleteSupplier/, "supplier service must expose soft delete");
assert.match(supplierService, /deletedAt:\s*new Date\(\)/, "supplier soft delete must set deletedAt");
assert.match(supplierService, /export async function restoreSupplier/, "supplier service must expose restore");
assert.match(supplierController, /SUPPLIER_DELETED/, "supplier delete must create an audit log");
assert.match(supplierController, /SUPPLIER_RESTORED/, "supplier restore must create an audit log");

for (const schema of [sqliteSchema, postgresSchema]) {
  assert.match(schema, /model Supplier[\s\S]*deletedAt\s+DateTime\?/, "Supplier must have deletedAt in both Prisma schemas");
  assert.match(schema, /@@index\(\[shopId, deletedAt\]\)/, "Supplier must have shopId+deletedAt index");
  assert.match(schema, /@@index\(\[shopId, updatedAt, id\]\)/, "Supplier must support sync keyset pagination");
  assert.match(schema, /model PurchaseHistory[\s\S]*@@index\(\[shopId, updatedAt, id\]\)/, "PurchaseHistory must support sync keyset pagination");
}

for (const type of ["CREATE_SUPPLIER", "UPDATE_SUPPLIER", "DELETE_SUPPLIER", "RESTORE_SUPPLIER"]) {
  assert.ok(syncRules.includes(type), `${type} must be a supported sync event type`);
  assert.ok(syncService.includes(`SYNC_EVENT_TYPES.${type}`), `${type} must be handled by sync.service`);
}
assert.match(syncService, /db\.supplier\.findMany\(\{ where: buildWhere\("suppliers"\)/, "sync pull must include suppliers");
assert.match(syncService, /db\.purchaseHistory\.findMany\(\{ where: buildWhere\("purchaseHistory"\)/, "sync pull must include purchaseHistory");
assert.match(syncService, /const grouped = \{ products: \{\}, customers: \{\}, bills: \{\}, suppliers: \{\}(?:, ledgerEntries: \{\})? \}/, "sync id mappings response must include suppliers");

assert.match(permissions, /OWNER_PIN_REQUIRED/, "owner PIN middleware must honor OWNER_PIN_REQUIRED");
assert.doesNotMatch(permissions, /Owner token is enough for owner-only actions/, "production default must not silently bypass PIN for owner JWTs");
assert.ok(contract.includes('"path": "/api/suppliers/:id"'), "API contract must document supplier delete");
assert.ok(contract.includes('"path": "/api/suppliers/:id/restore"'), "API contract must document supplier restore");

console.log("Phase 47 supplier sync/soft-delete examples passed");

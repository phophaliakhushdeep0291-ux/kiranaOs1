import assert from 'node:assert/strict';
import fs from 'node:fs';

const sqliteSchema = fs.readFileSync('prisma/schema.prisma', 'utf8');
const postgresSchema = fs.readFileSync('prisma-postgres/schema.prisma', 'utf8');
const postgresMigration = fs.readFileSync('prisma-postgres/migrations/000001_init/migration.sql', 'utf8');
const auditService = fs.readFileSync('src/modules/audit/audit.service.js', 'utf8');
const billsService = fs.readFileSync('src/modules/bills/bills.service.js', 'utf8');
const productsService = fs.readFileSync('src/modules/products/products.service.js', 'utf8');
const reportsController = fs.readFileSync('src/modules/reports/reports.controller.js', 'utf8');
const regressionTest = fs.readFileSync('tests/backend-regression.examples.js', 'utf8');

for (const schema of [sqliteSchema, postgresSchema]) {
  assert.match(schema, /model AuditLog \{/, 'AuditLog model must exist');
  assert.match(schema, /shopId\s+String/, 'AuditLog must store shopId');
  assert.match(schema, /userId\s+String\?/, 'AuditLog must optionally store userId');
  assert.match(schema, /action\s+String/, 'AuditLog must store action');
  assert.match(schema, /beforeJson\s+String\?/, 'AuditLog must support beforeJson');
  assert.match(schema, /afterJson\s+String\?/, 'AuditLog must support afterJson');
  assert.match(schema, /metadataJson\s+String\?/, 'AuditLog must support metadataJson');
  assert.match(schema, /ipAddress\s+String\?/, 'AuditLog must store IP when available');
  assert.match(schema, /userAgent\s+String\?/, 'AuditLog must store user agent when available');
  assert.match(schema, /auditLogs\s+AuditLog\[\]/, 'Shop/User relations must include audit logs');
  // §2 requires every event to carry device, module, result and duration so the
  // timeline can be reconstructed and filtered.
  assert.match(schema, /deviceId\s+String\?/, 'AuditLog must store the device that acted');
  assert.match(schema, /module\s+String\?/, 'AuditLog must store the owning module');
  assert.match(schema, /result\s+String\?/, 'AuditLog must store the action result');
  assert.match(schema, /durationMs\s+Int\?/, 'AuditLog must store how long the action took');
}

const auditModuleMigration = fs.readFileSync(
  'prisma-postgres/migrations/000079_audit_log_module_result_duration/migration.sql',
  'utf8',
);
for (const column of ['deviceId', 'module', 'result', 'durationMs']) {
  assert.match(
    auditModuleMigration,
    new RegExp(`ADD COLUMN IF NOT EXISTS "${column}"`),
    `postgres migration must add ${column} idempotently`,
  );
}

assert.match(postgresMigration, /CREATE TABLE "AuditLog"/, 'PostgreSQL migration must create AuditLog');
assert.match(postgresMigration, /AuditLog_shopId_fkey/, 'PostgreSQL migration must add AuditLog shop FK');
assert.match(postgresMigration, /AuditLog_userId_fkey/, 'PostgreSQL migration must add AuditLog user FK');

assert.match(auditService, /export async function createAuditLog/, 'audit service must expose createAuditLog');
assert.match(auditService, /export async function withAudit/, 'audit service must expose the timing wrapper');
assert.match(auditService, /export function inferAuditModule/, 'audit service must infer a module for legacy call sites');

// §2's explicitly listed events that had no coverage before.
const authService = fs.readFileSync('src/modules/auth/auth.service.js', 'utf8');
assert.match(authService, /action: "LOGIN"/, 'sign-in must be audited');
assert.match(authService, /action: "LOGOUT"/, 'sign-out must be audited');
const syncService = fs.readFileSync('src/modules/sync/sync.service.js', 'utf8');
assert.match(syncService, /SYNC_COMPLETED/, 'a finished sync run must be audited');
assert.match(syncService, /SYNC_FAILED/, 'a failed sync run must be audited');
const shopsService = fs.readFileSync('src/modules/shops/shops.service.js', 'utf8');
assert.match(shopsService, /action: "SETTINGS_CHANGED"/, 'settings changes must be audited');
const customersService = fs.readFileSync('src/modules/customers/customers.service.js', 'utf8');
assert.match(customersService, /action: "CUSTOMER_CREATED"/, 'customer creation must be audited');
assert.match(customersService, /action: "UDHAR_PAYMENT_RECEIVED"/, 'payments received must be audited');
const suppliersController = fs.readFileSync('src/modules/suppliers/suppliers.controller.js', 'utf8');
assert.match(suppliersController, /action: "SUPPLIER_CREATED"/, 'supplier creation must be audited');
assert.match(auditService, /client = db/, 'audit service must default to the app Prisma client');
assert.match(auditService, /client\.auditLog\.create/, 'audit service must write to AuditLog through the active client/transaction');
assert.match(auditService, /JSON\.stringify/, 'audit service must serialize audit payloads');

assert.match(billsService, /writeRequiredBillAudit/, 'bill service must use required audit writes');
assert.match(billsService, /BILL_CANCELLED[\s\S]*?\}, tx\);/, 'bill cancellation audit must commit in the bill transaction');
assert.match(productsService, /PRODUCT_DELETED[\s\S]*?\}, tx\);/, 'product deletion audit must commit in the product transaction');
assert.match(reportsController, /DATA_EXPORTED/, 'report exports must log DATA_EXPORTED');
assert.match(reportsController, /exportType/, 'report export audit log must include export type metadata');
assert.match(regressionTest, /tx\.auditLog\.deleteMany/, 'regression cleanup must delete audit logs before shops/users');

console.log('Audit log examples passed');

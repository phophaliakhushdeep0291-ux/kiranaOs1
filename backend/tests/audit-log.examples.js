import assert from 'node:assert/strict';
import fs from 'node:fs';

const sqliteSchema = fs.readFileSync('prisma/schema.prisma', 'utf8');
const postgresSchema = fs.readFileSync('prisma-postgres/schema.prisma', 'utf8');
const postgresMigration = fs.readFileSync('prisma-postgres/migrations/000001_init/migration.sql', 'utf8');
const auditService = fs.readFileSync('src/modules/audit/audit.service.js', 'utf8');
const billsController = fs.readFileSync('src/modules/bills/bills.controller.js', 'utf8');
const productsController = fs.readFileSync('src/modules/products/products.controller.js', 'utf8');
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
}

assert.match(postgresMigration, /CREATE TABLE "AuditLog"/, 'PostgreSQL migration must create AuditLog');
assert.match(postgresMigration, /AuditLog_shopId_fkey/, 'PostgreSQL migration must add AuditLog shop FK');
assert.match(postgresMigration, /AuditLog_userId_fkey/, 'PostgreSQL migration must add AuditLog user FK');

assert.match(auditService, /export async function createAuditLog/, 'audit service must expose createAuditLog');
assert.match(auditService, /db\.auditLog\.create/, 'audit service must write to AuditLog');
assert.match(auditService, /JSON\.stringify/, 'audit service must serialize audit payloads');

assert.match(billsController, /createAuditLog/, 'bill controller must use audit service');
assert.match(billsController, /BILL_CANCELLED/, 'bill cancel must log BILL_CANCELLED');
assert.match(productsController, /PRODUCT_DELETED/, 'product delete must log PRODUCT_DELETED');
assert.match(reportsController, /DATA_EXPORTED/, 'report exports must log DATA_EXPORTED');
assert.match(reportsController, /exportType/, 'report export audit log must include export type metadata');
assert.match(regressionTest, /tx\.auditLog\.deleteMany/, 'regression cleanup must delete audit logs before shops/users');

console.log('Audit log examples passed');

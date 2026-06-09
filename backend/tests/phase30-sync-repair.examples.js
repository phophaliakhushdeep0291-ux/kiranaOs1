import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifySyncError } from '../src/utils/syncRules.js';

function mustContain(file, text, message) {
  const source = readFileSync(file, 'utf8');
  assert.ok(source.includes(text), message ?? `${file} must contain ${text}`);
}

function run() {
  const syncService = readFileSync('src/modules/sync/sync.service.js', 'utf8');
  const syncController = readFileSync('src/modules/sync/sync.controller.js', 'utf8');
  const pgSchema = readFileSync('prisma-postgres/schema.prisma', 'utf8');
  const sqliteSchema = readFileSync('prisma/schema.prisma', 'utf8');
  const migration = readFileSync('prisma-postgres/migrations/000010_sync_id_mapping/migration.sql', 'utf8');

  assert.ok(syncService.includes('claimSyncEventForProcessing'), 'sync push must claim event before applying business logic');
  assert.ok(syncService.includes('db.offlineSyncEvent.create'), 'sync claim must create event row first, not upsert-before-apply');
  assert.ok(syncService.includes('SYNC_EVENT_IN_PROGRESS'), 'concurrent duplicate push must return retryable in-progress result');
  assert.ok(syncService.includes('SYNC_PROCESSING_STALE_MS'), 'stale processing sync events must be reclaimable');
  assert.ok(syncService.includes('rememberMappingsFromResult'), 'sync must persist localId to serverId mappings');
  assert.ok(syncService.includes('resolveBillBodyReferences'), 'CREATE_BILL sync must resolve local product/customer ids before confirming bill');
  assert.ok(syncService.includes('resolveEntityReference(shopId, SYNC_ENTITY_TYPES.PRODUCT'), 'product local ids must resolve for updates/deletes/stock/bills');
  assert.ok(syncService.includes('resolveEntityReference(shopId, SYNC_ENTITY_TYPES.CUSTOMER'), 'customer local ids must resolve for customer update/udhar/bills');
  assert.ok(syncService.includes('idMappings: exportContextMappings(context)'), 'push response must include idMappings for frontend reconciliation');
  assert.ok(syncController.includes('idMappings: data.idMappings'), 'controller must expose idMappings at top level');
  assert.ok(syncController.includes('deviceId: req.device?.deviceId'), 'sync context must capture active device id for mapping audit');

  for (const schema of [pgSchema, sqliteSchema]) {
    assert.ok(schema.includes('model SyncIdMapping'), 'schema must define SyncIdMapping');
    assert.ok(schema.includes('@@unique([shopId, entityType, localId])'), 'SyncIdMapping must be unique by shop/entity/localId');
    assert.ok(schema.includes('syncIdMappings   SyncIdMapping[]'), 'Shop must relate to SyncIdMapping');
  }

  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS "SyncIdMapping"'), 'PostgreSQL migration must create SyncIdMapping');
  assert.ok(migration.includes('SyncIdMapping_shopId_entityType_localId_key'), 'migration must enforce unique local id mapping');

  const dependency = classifySyncError({ statusCode: 425, code: 'SYNC_DEPENDENCY_PENDING', message: 'local id not mapped yet' });
  assert.equal(dependency.resultStatus, 'failed');
  assert.equal(dependency.retryable, true);
  assert.equal(dependency.code, 'SYNC_DEPENDENCY_PENDING');

  const inProgress = classifySyncError({ statusCode: 409, code: 'SYNC_EVENT_IN_PROGRESS', message: 'already processing' });
  assert.equal(inProgress.resultStatus, 'failed');
  assert.equal(inProgress.retryable, true);
  assert.equal(inProgress.code, 'SYNC_EVENT_IN_PROGRESS');

  mustContain('docs/SYNC.md', 'localId → serverId mapping');
  mustContain('docs/SYNC.md', 'idMappings');

  console.log('Phase 30 sync repair examples passed');
}

run();

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SYNC_EVENT_TYPES, isSupportedSyncEventType, OWNER_SYNC_EVENT_TYPES } from '../src/utils/syncRules.js';

function mustContain(file, text, message) {
  const source = readFileSync(file, 'utf8');
  assert.ok(source.includes(text), message ?? `${file} must contain ${text}`);
}

function run() {
  const syncService = readFileSync('src/modules/sync/sync.service.js', 'utf8');
  const syncRules = readFileSync('src/utils/syncRules.js', 'utf8');

  for (const type of [
    'CREATE_LEDGER_ADJUSTMENT',
    'DELETE_CUSTOMER',
    'RESTORE_CUSTOMER',
    'STOCK_PURCHASE',
    'STOCK_SALE',
  ]) {
    assert.equal(isSupportedSyncEventType(type), true, `${type} must be accepted by sync push schema`);
    assert.ok(syncRules.includes(`${type}: '${type}'`), `${type} must be present in sync rules`);
  }

  assert.equal(SYNC_EVENT_TYPES.UDHAR_PAYMENT, 'UDHAR_PAYMENT', 'frontend RECORD_PAYMENT must normalize to UDHAR_PAYMENT');
  assert.equal(OWNER_SYNC_EVENT_TYPES.has(SYNC_EVENT_TYPES.DELETE_CUSTOMER), true, 'customer delete must still be owner-gated');
  assert.equal(OWNER_SYNC_EVENT_TYPES.has(SYNC_EVENT_TYPES.RESTORE_CUSTOMER), true, 'customer restore must still be owner-gated');
  assert.equal(OWNER_SYNC_EVENT_TYPES.has(SYNC_EVENT_TYPES.CREATE_LEDGER_ADJUSTMENT), true, 'manual ledger adjustments must remain owner-gated during offline replay');
  assert.equal(OWNER_SYNC_EVENT_TYPES.has(SYNC_EVENT_TYPES.STOCK_PURCHASE), false, 'stock purchase sync should not be blocked by owner-gate set before service handling');
  assert.equal(OWNER_SYNC_EVENT_TYPES.has(SYNC_EVENT_TYPES.STOCK_SALE), false, 'stock sale sync should not be blocked by owner-gate set before service handling');

  for (const prefix of ['customer_', 'product_', 'bill_', 'payment_', 'ledger_', 'stock_']) {
    assert.ok(syncService.includes(`normalized.startsWith("${prefix}")`), `${prefix} local ids must be treated as local sync dependencies`);
  }

  mustContain('src/modules/sync/sync.service.js', 'case SYNC_EVENT_TYPES.CREATE_LEDGER_ADJUSTMENT');
  mustContain('src/modules/sync/sync.service.js', 'case SYNC_EVENT_TYPES.DELETE_CUSTOMER');
  mustContain('src/modules/sync/sync.service.js', 'case SYNC_EVENT_TYPES.RESTORE_CUSTOMER');
  mustContain('src/modules/sync/sync.service.js', 'case SYNC_EVENT_TYPES.STOCK_PURCHASE');
  mustContain('src/modules/sync/sync.service.js', 'case SYNC_EVENT_TYPES.STOCK_SALE');
  mustContain('src/modules/sync/sync.service.js', 'applyLedgerAdjustment');
  mustContain('src/modules/sync/sync.service.js', 'applyStockSale');

  console.log('Phase 31 sync status repair examples passed');
}

run();

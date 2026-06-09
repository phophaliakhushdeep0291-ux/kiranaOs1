import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  OWNER_SYNC_EVENT_TYPES,
  SYNC_EVENT_TYPES,
  buildSyncResult,
  classifySyncError,
  getClientEventId,
  isSupportedSyncEventType,
} from '../src/utils/syncRules.js';

function mustContain(file, text, message) {
  const source = readFileSync(file, 'utf8');
  assert.ok(source.includes(text), message ?? `${file} must contain ${text}`);
}

function run() {
  const requiredTypes = [
    'CREATE_BILL',
    'CANCEL_BILL',
    'RESTORE_BILL',
    'CREATE_PRODUCT',
    'UPDATE_PRODUCT',
    'DELETE_PRODUCT',
    'RESTORE_PRODUCT',
    'ADJUST_STOCK',
    'CREATE_CUSTOMER',
    'UPDATE_CUSTOMER',
    'UDHAR_PAYMENT',
  ];

  for (const type of requiredTypes) {
    assert.equal(SYNC_EVENT_TYPES[type], type, `${type} must be declared`);
    assert.equal(isSupportedSyncEventType(type), true, `${type} must be supported`);
    mustContain('src/modules/sync/sync.service.js', `case SYNC_EVENT_TYPES.${type}`, `${type} must be handled in sync.service.js`);
  }

  assert.equal(getClientEventId({ eventId: 'old_evt' }), 'old_evt');
  assert.equal(getClientEventId({ clientEventId: 'client_evt' }), 'client_evt');
  assert.equal(getClientEventId({ eventId: 'old_evt', clientEventId: 'client_evt' }), 'client_evt');

  assert.equal(OWNER_SYNC_EVENT_TYPES.has(SYNC_EVENT_TYPES.CANCEL_BILL), true);
  assert.equal(OWNER_SYNC_EVENT_TYPES.has(SYNC_EVENT_TYPES.RESTORE_BILL), true);
  assert.equal(OWNER_SYNC_EVENT_TYPES.has(SYNC_EVENT_TYPES.DELETE_PRODUCT), true);
  assert.equal(OWNER_SYNC_EVENT_TYPES.has(SYNC_EVENT_TYPES.RESTORE_PRODUCT), true,
    'RESTORE_PRODUCT must be in OWNER_SYNC_EVENT_TYPES — service switch owner-gates it');
  assert.equal(OWNER_SYNC_EVENT_TYPES.has(SYNC_EVENT_TYPES.ADJUST_STOCK), true);

  const success = buildSyncResult({
    clientEventId: 'evt_product_create',
    type: SYNC_EVENT_TYPES.CREATE_PRODUCT,
    status: 'synced',
    success: true,
    result: { productId: 'prod_123' },
  });
  assert.equal(success.clientEventId, 'evt_product_create');
  assert.equal(success.eventId, 'evt_product_create');
  assert.equal(success.serverId, 'prod_123');
  assert.equal(success.error, null);

  const conflict = buildSyncResult({
    clientEventId: 'evt_conflict',
    type: SYNC_EVENT_TYPES.CREATE_BILL,
    status: 'conflict',
    success: false,
    code: 'CONFLICT',
    error: 'stock insufficient',
  });
  assert.equal(conflict.status, 'conflict');
  assert.equal(conflict.success, false);
  assert.equal(conflict.error, 'stock insufficient');

  mustContain('src/modules/sync/sync.schema.js', 'eventId or clientEventId required');
  mustContain('src/modules/sync/sync.service.js', 'OFFLINE_SYNC_CONFLICT');
  mustContain('src/modules/sync/sync.service.js', 'applyCreateProduct');
  mustContain('src/modules/sync/sync.service.js', 'applyDeleteProduct');
  mustContain('src/modules/sync/sync.service.js', 'applyRestoreProduct');
  mustContain('src/modules/sync/sync.service.js', 'applyUpdateCustomer');
  const stockConflict = classifySyncError({ statusCode: 400, message: 'Insufficient stock for Sugar' });
  assert.equal(stockConflict.resultStatus, 'conflict');
  assert.equal(stockConflict.code, 'STOCK_INSUFFICIENT');

  const mobileConflict = classifySyncError({ statusCode: 409, message: 'Customer with this mobile already exists' });
  assert.equal(mobileConflict.code, 'CUSTOMER_MOBILE_DUPLICATE');

  const restoredConflict = classifySyncError({ statusCode: 409, message: 'Bill is already restored or not cancelled' });
  assert.equal(restoredConflict.code, 'BILL_ALREADY_RESTORED');

  mustContain('src/modules/sync/sync.service.js', 'applyRestoreBill');
  mustContain('src/modules/bills/bills.service.js', 'restoreCancelledBill');
  mustContain('src/modules/bills/bills.service.js', 'restore_reversal');

  console.log('Offline sync hardening examples passed');
}

run();

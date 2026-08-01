import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildSyncResult,
  classifySyncError,
  getEventOwnerPin,
  isDuplicateSyncedEvent,
  isSupportedSyncEventType,
  removeSensitiveSyncFields,
  SYNC_EVENT_STATUSES,
  SYNC_EVENT_TYPES,
} from '../src/utils/syncRules.js';

function run() {
  assert.equal(isSupportedSyncEventType(SYNC_EVENT_TYPES.CREATE_BILL), true);
  assert.equal(isSupportedSyncEventType(SYNC_EVENT_TYPES.CANCEL_BILL), true);
  assert.equal(isSupportedSyncEventType(SYNC_EVENT_TYPES.RESTORE_BILL), true);
  assert.equal(isSupportedSyncEventType(SYNC_EVENT_TYPES.CREATE_PRODUCT), true);
  assert.equal(isSupportedSyncEventType(SYNC_EVENT_TYPES.UPDATE_PRODUCT), true);
  assert.equal(isSupportedSyncEventType(SYNC_EVENT_TYPES.DELETE_PRODUCT), true);
  assert.equal(isSupportedSyncEventType(SYNC_EVENT_TYPES.RESTORE_PRODUCT), true);
  assert.equal(isSupportedSyncEventType(SYNC_EVENT_TYPES.ADJUST_STOCK), true);
  assert.equal(isSupportedSyncEventType(SYNC_EVENT_TYPES.CREATE_CUSTOMER), true);
  assert.equal(isSupportedSyncEventType(SYNC_EVENT_TYPES.UPDATE_CUSTOMER), true);
  assert.equal(isSupportedSyncEventType(SYNC_EVENT_TYPES.UDHAR_PAYMENT), true);
  assert.equal(isSupportedSyncEventType('DELETE_ALL_DATA'), false);

  assert.equal(
    isDuplicateSyncedEvent({ status: SYNC_EVENT_STATUSES.SYNCED }),
    true,
    'already-synced events must not be applied twice'
  );
  assert.equal(isDuplicateSyncedEvent({ status: SYNC_EVENT_STATUSES.FAILED }), false);

  const sanitized = removeSensitiveSyncFields({
    eventId: 'evt_1',
    ownerPin: '1234',
    payload: { name: 'Sugar', nestedPin: '9999', nested: { ownerPin: '0000', ok: true } },
  });
  assert.equal(sanitized.ownerPin, undefined);
  assert.equal(sanitized.payload.nestedPin, undefined);
  assert.equal(sanitized.payload.nested.ownerPin, undefined);
  assert.equal(sanitized.payload.nested.ok, true);
  assert.equal(removeSensitiveSyncFields({ amountPaise: 9007199254740993n }).amountPaise, '9007199254740993');

  assert.equal(getEventOwnerPin({ payload: { ownerPin: 1234 } }), '1234');
  assert.equal(getEventOwnerPin({ ownerPin: '4321', payload: { ownerPin: '1234' } }), '4321');

  const conflict = classifySyncError({ statusCode: 409, message: 'Customer mobile duplicate' });
  assert.equal(conflict.resultStatus, 'conflict');
  assert.equal(conflict.retryable, false);

  const invalid = classifySyncError({ name: 'ZodError' });
  assert.equal(invalid.code, 'INVALID_EVENT');
  assert.equal(invalid.resultStatus, 'conflict');

  const result = buildSyncResult({
    eventId: 'evt_1',
    type: SYNC_EVENT_TYPES.CREATE_BILL,
    status: 'synced',
    success: true,
    result: { billId: 'bill_1' },
  });
  assert.deepEqual(result, {
    clientEventId: 'evt_1',
    eventId: 'evt_1',
    type: SYNC_EVENT_TYPES.CREATE_BILL,
    status: 'synced',
    success: true,
    serverId: 'bill_1',
    error: null,
    result: { billId: 'bill_1' },
  });

  const resultFromClientEventId = buildSyncResult({
    clientEventId: 'client_evt_1',
    type: SYNC_EVENT_TYPES.CREATE_PRODUCT,
    status: 'synced',
    success: true,
    result: { productId: 'prod_1' },
  });
  assert.equal(resultFromClientEventId.eventId, 'client_evt_1');
  assert.equal(resultFromClientEventId.clientEventId, 'client_evt_1');
  assert.equal(resultFromClientEventId.serverId, 'prod_1');

  const syncService = fs.readFileSync(new URL('../src/modules/sync/sync.service.js', import.meta.url), 'utf8');
  const billsService = fs.readFileSync(new URL('../src/modules/bills/bills.service.js', import.meta.url), 'utf8');
  assert.match(syncService, /getCreateBillCreditLedgerClientId\(payload, billBody\)/, 'CREATE_BILL sync must retain the optimistic ledger identity');
  assert.match(syncService, /localLedgerEntryId/, 'CREATE_BILL response must return the local ledger identity');
  assert.match(billsService, /actor\?\.creditLedgerClientId \?\? buildChildIdempotencyKey/, 'server udhar ledger must reuse the client ledger identity when supplied');

  console.log('Sync push examples passed');
}

run();

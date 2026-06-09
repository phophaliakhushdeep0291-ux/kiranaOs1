import assert from 'assert';
import {
  STORE_NAMES,
  LOCAL_BILL_STATUS,
  SYNC_EVENT_TYPES,
  createPendingSyncEvent,
  normalizeLocalBillForCache,
} from '../public/js/offline-db.js';

const requiredStores = [
  'PRODUCTS',
  'CUSTOMERS',
  'STOCK_SNAPSHOT',
  'BILLS_30_DAYS',
  'UDHAR_LEDGER_30_DAYS',
  'STOCK_LEDGER_30_DAYS',
  'PENDING_SYNC_QUEUE',
  'USER_SETTINGS',
];

for (const storeKey of requiredStores) {
  assert.ok(STORE_NAMES[storeKey], `${storeKey} store is defined`);
}

assert.deepStrictEqual(Object.values(LOCAL_BILL_STATUS), [
  'local_only',
  'pending_sync',
  'synced',
  'sync_failed',
]);

const requiredEvents = [
  'CREATE_BILL',
  'CANCEL_BILL',
  'UPDATE_PRODUCT',
  'ADJUST_STOCK',
  'CREATE_CUSTOMER',
  'UDHAR_PAYMENT',
];

for (const eventKey of requiredEvents) {
  assert.strictEqual(SYNC_EVENT_TYPES[eventKey], eventKey);
}

const pendingBill = normalizeLocalBillForCache({ grandTotal: 80 }, LOCAL_BILL_STATUS.PENDING_SYNC);
assert.ok(pendingBill.localId, 'offline bill gets localId');
assert.strictEqual(pendingBill.localStatus, 'pending_sync');
assert.strictEqual(pendingBill.serverId, null);

const event = createPendingSyncEvent(SYNC_EVENT_TYPES.CREATE_BILL, { bill: pendingBill });
assert.ok(event.eventId, 'sync event gets eventId');
assert.strictEqual(event.type, 'CREATE_BILL');
assert.strictEqual(event.status, 'pending_sync');
assert.strictEqual(event.attempts, 0);

assert.throws(
  () => createPendingSyncEvent('DELETE_ALL_DATA', {}),
  /Unsupported sync event type/,
  'unknown sync events are blocked'
);

console.log('Offline queue examples passed');

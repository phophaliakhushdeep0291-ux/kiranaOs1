/**
 * KiranaOS IndexedDB offline cache foundation.
 *
 * Step 7 scope:
 * - Adds IndexedDB storage and pending sync queue for frontend use.
 * - Does not change UI.
 * - Does not auto-call backend sync endpoints yet.
 * - Safe to import from the existing frontend when ready.
 */

export const KIRANAOS_DB_NAME = 'kiranaos-offline-db';
export const KIRANAOS_DB_VERSION = 1;

export const STORE_NAMES = Object.freeze({
  PRODUCTS: 'products',
  CUSTOMERS: 'customers',
  STOCK_SNAPSHOT: 'stockSnapshot',
  BILLS_30_DAYS: 'bills30Days',
  UDHAR_LEDGER_30_DAYS: 'udharLedger30Days',
  STOCK_LEDGER_30_DAYS: 'stockLedger30Days',
  PENDING_SYNC_QUEUE: 'pendingSyncQueue',
  USER_SETTINGS: 'userSettings',
});

export const LOCAL_BILL_STATUS = Object.freeze({
  LOCAL_ONLY: 'local_only',
  PENDING_SYNC: 'pending_sync',
  SYNCED: 'synced',
  SYNC_FAILED: 'sync_failed',
});

export const SYNC_EVENT_TYPES = Object.freeze({
  CREATE_BILL: 'CREATE_BILL',
  CANCEL_BILL: 'CANCEL_BILL',
  UPDATE_PRODUCT: 'UPDATE_PRODUCT',
  ADJUST_STOCK: 'ADJUST_STOCK',
  CREATE_CUSTOMER: 'CREATE_CUSTOMER',
  UDHAR_PAYMENT: 'UDHAR_PAYMENT',
});

const STORE_CONFIGS = [
  {
    name: STORE_NAMES.PRODUCTS,
    keyPath: 'id',
    indexes: [
      ['by_updated_at', 'updatedAt', { unique: false }],
      ['by_deleted_at', 'deletedAt', { unique: false }],
      ['by_name', 'name', { unique: false }],
    ],
  },
  {
    name: STORE_NAMES.CUSTOMERS,
    keyPath: 'id',
    indexes: [
      ['by_updated_at', 'updatedAt', { unique: false }],
      ['by_mobile', 'mobile', { unique: false }],
    ],
  },
  {
    name: STORE_NAMES.STOCK_SNAPSHOT,
    keyPath: 'productId',
    indexes: [['by_updated_at', 'updatedAt', { unique: false }]],
  },
  {
    name: STORE_NAMES.BILLS_30_DAYS,
    keyPath: 'localId',
    indexes: [
      ['by_server_id', 'serverId', { unique: false }],
      ['by_created_at', 'createdAt', { unique: false }],
      ['by_local_status', 'localStatus', { unique: false }],
    ],
  },
  {
    name: STORE_NAMES.UDHAR_LEDGER_30_DAYS,
    keyPath: 'id',
    indexes: [
      ['by_customer_id', 'customerId', { unique: false }],
      ['by_created_at', 'createdAt', { unique: false }],
    ],
  },
  {
    name: STORE_NAMES.STOCK_LEDGER_30_DAYS,
    keyPath: 'id',
    indexes: [
      ['by_product_id', 'productId', { unique: false }],
      ['by_created_at', 'createdAt', { unique: false }],
    ],
  },
  {
    name: STORE_NAMES.PENDING_SYNC_QUEUE,
    keyPath: 'eventId',
    indexes: [
      ['by_type', 'type', { unique: false }],
      ['by_status', 'status', { unique: false }],
      ['by_created_at', 'createdAt', { unique: false }],
    ],
  },
  {
    name: STORE_NAMES.USER_SETTINGS,
    keyPath: 'key',
  },
];

let dbPromise = null;

function assertIndexedDbAvailable() {
  if (!globalThis.indexedDB) {
    throw new Error('IndexedDB is not available in this browser/context');
  }
}

function createStoreIfMissing(db, storeConfig) {
  if (db.objectStoreNames.contains(storeConfig.name)) return;

  const store = db.createObjectStore(storeConfig.name, { keyPath: storeConfig.keyPath });
  for (const [indexName, keyPath, options] of storeConfig.indexes || []) {
    store.createIndex(indexName, keyPath, options);
  }
}

export function openKiranaDb() {
  assertIndexedDbAvailable();
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(KIRANAOS_DB_NAME, KIRANAOS_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      for (const storeConfig of STORE_CONFIGS) {
        createStoreIfMissing(db, storeConfig);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('IndexedDB upgrade blocked. Close other KiranaOS tabs and retry.'));
  });

  return dbPromise;
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getStore(storeName, mode = 'readonly') {
  const db = await openKiranaDb();
  return db.transaction(storeName, mode).objectStore(storeName);
}

export async function putRecord(storeName, record) {
  const store = await getStore(storeName, 'readwrite');
  return requestToPromise(store.put(record));
}

export async function addRecord(storeName, record) {
  const store = await getStore(storeName, 'readwrite');
  return requestToPromise(store.add(record));
}

export async function getRecord(storeName, key) {
  const store = await getStore(storeName, 'readonly');
  return requestToPromise(store.get(key));
}

export async function getAllRecords(storeName) {
  const store = await getStore(storeName, 'readonly');
  return requestToPromise(store.getAll());
}

export async function deleteRecord(storeName, key) {
  const store = await getStore(storeName, 'readwrite');
  return requestToPromise(store.delete(key));
}

export async function clearStore(storeName) {
  const store = await getStore(storeName, 'readwrite');
  return requestToPromise(store.clear());
}

export function makeLocalId(prefix = 'local') {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${random}`;
}

export function makeIsoNow() {
  return new Date().toISOString();
}

export function normalizeLocalBillForCache(bill, status = LOCAL_BILL_STATUS.PENDING_SYNC) {
  const now = makeIsoNow();
  return {
    ...bill,
    localId: bill.localId || bill.id || makeLocalId('bill'),
    serverId: bill.serverId || (bill.id && !String(bill.id).startsWith('local_') ? bill.id : null),
    localStatus: status,
    createdAt: bill.createdAt || now,
    updatedAt: now,
  };
}

export function createPendingSyncEvent(type, payload, options = {}) {
  if (!Object.values(SYNC_EVENT_TYPES).includes(type)) {
    throw new Error(`Unsupported sync event type: ${type}`);
  }

  const now = makeIsoNow();
  return {
    eventId: options.eventId || makeLocalId('sync'),
    type,
    payload,
    status: LOCAL_BILL_STATUS.PENDING_SYNC,
    attempts: 0,
    lastError: null,
    createdAt: options.createdAt || now,
    updatedAt: now,
  };
}

export async function cacheProducts(products) {
  await Promise.all(products.map((product) => putRecord(STORE_NAMES.PRODUCTS, product)));
}

export async function cacheCustomers(customers) {
  await Promise.all(customers.map((customer) => putRecord(STORE_NAMES.CUSTOMERS, customer)));
}

export async function cacheStockSnapshot(stockRows) {
  await Promise.all(stockRows.map((row) => putRecord(STORE_NAMES.STOCK_SNAPSHOT, row)));
}

export async function cacheBill(bill, status = LOCAL_BILL_STATUS.SYNCED) {
  return putRecord(STORE_NAMES.BILLS_30_DAYS, normalizeLocalBillForCache(bill, status));
}

export async function cacheUdharLedger(rows) {
  await Promise.all(rows.map((row) => putRecord(STORE_NAMES.UDHAR_LEDGER_30_DAYS, row)));
}

export async function cacheStockLedger(rows) {
  await Promise.all(rows.map((row) => putRecord(STORE_NAMES.STOCK_LEDGER_30_DAYS, row)));
}

export async function setUserSetting(key, value) {
  return putRecord(STORE_NAMES.USER_SETTINGS, {
    key,
    value,
    updatedAt: makeIsoNow(),
  });
}

export async function getUserSetting(key) {
  const setting = await getRecord(STORE_NAMES.USER_SETTINGS, key);
  return setting?.value;
}

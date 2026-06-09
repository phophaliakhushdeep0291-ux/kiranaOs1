/**
 * KiranaOS backend-connected frontend modules.
 *
 * Step 9 scope:
 * - A UI-agnostic API layer for the existing backend.
 * - No HTML/CSS/layout changes.
 * - Existing frontend can import only the module it needs.
 */

import { apiClient, saveAuthToken, clearAuthToken } from './api-client.js';
import {
  cacheProducts,
  cacheCustomers,
  cacheStockSnapshot,
  cacheBill,
  cacheUdharLedger,
  cacheStockLedger,
  LOCAL_BILL_STATUS,
} from './offline-db.js';
import { saveBillOffline, flushPendingSyncQueue } from './offline-sync-queue.js';

export function createBackendModules(client = apiClient) {
  const auth = {
    async register(payload) {
      const data = await client.post('/auth/register', payload);
      if (data?.token) saveAuthToken(data.token);
      return data;
    },
    async login(payload) {
      const data = await client.post('/auth/login', payload);
      if (data?.token) saveAuthToken(data.token);
      return data;
    },
    logout() {
      clearAuthToken();
      return { success: true };
    },
    me: () => client.get('/auth/me'),
    setPin: (pin) => client.post('/auth/pin/set', { pin }),
    verifyPin: (pin) => client.post('/auth/pin/verify', { pin }),
    checkPin: () => client.get('/auth/pin/check'),
    listStaff: () => client.get('/auth/staff'),
    inviteStaff: (payload) => client.post('/auth/staff', payload),
    updateStaffRole: (id, role) => client.patch(`/auth/staff/${id}/role`, { role }),
    removeStaff: (id) => client.delete(`/auth/staff/${id}`),
    changePassword: (payload) => client.post('/auth/change-password', payload),
  };

  const products = {
    list: (query) => client.get('/products', { query }),
    get: (id) => client.get(`/products/${id}`),
    create: (payload) => client.post('/products', payload),
    update: (id, payload, options = {}) => client.patch(`/products/${id}`, payload, options),
    delete: (id, options = {}) => client.delete(`/products/${id}`, options),
    listRecycleBin: (query) => client.get('/products/recycle-bin', { query }),
    restore: (id) => client.post(`/products/${id}/restore`, {}),
    permanentlyDelete: (id, options = {}) => client.delete(`/products/${id}/permanent`, options),
    emptyRecycleBin: (options = {}) => client.delete('/products/recycle-bin/empty', options),
  };

  const customers = {
    list: () => client.get('/customers'),
    get: (id) => client.get(`/customers/${id}`),
    create: (payload) => client.post('/customers', payload),
    update: (id, payload) => client.patch(`/customers/${id}`, payload),
    delete: (id) => client.delete(`/customers/${id}`),
    khata: (id) => client.get(`/customers/${id}/khata`),
    udharPayment: (id, payload) => client.post(`/customers/${id}/udhar-payment`, payload),
  };

  const bills = {
    list: (query) => client.get('/bills', { query }),
    get: (id) => client.get(`/bills/${id}`),
    confirm: (payload) => client.post('/bills/confirm', payload),
    cancel: (id, payload = {}, options = {}) => client.post(`/bills/${id}/cancel`, payload, options),
  };

  const inventory = {
    current: () => client.get('/inventory'),
    lowStock: () => client.get('/inventory/low-stock'),
    ledger: (query) => client.get('/inventory/ledger', { query }),
    purchase: (payload, options = {}) => client.post('/inventory/purchase', payload, options),
    damage: (payload, options = {}) => client.post('/inventory/damage', payload, options),
    correction: (payload, options = {}) => client.post('/inventory/correction', payload, options),
  };

  const reports = {
    pnl: (query) => client.get('/reports/pnl', { query }),
    monthlyBreakdown: (query) => client.get('/reports/monthly-breakdown', { query }),
    topProducts: (query) => client.get('/reports/top-products', { query }),
    paymentSummary: () => client.get('/reports/payment-summary'),
    exportBills: (query) => client.get('/reports/export/bills', { query }),
    exportStock: (query) => client.get('/reports/export/stock', { query }),
    exportUdhar: (query) => client.get('/reports/export/udhar', { query }),
  };

  const udhar = {
    ledger: (query) => client.get('/udhar', { query }),
    summary: () => client.get('/udhar/summary'),
  };

  const suppliers = {
    list: () => client.get('/suppliers'),
    bestPrice: (productId) => client.get(`/suppliers/best-price/${productId}`),
    create: (payload) => client.post('/suppliers', payload),
    update: (id, payload) => client.patch(`/suppliers/${id}`, payload),
  };

  const shop = {
    get: () => client.get('/shop'),
    update: (payload, options = {}) => client.patch('/shop', payload, options),
  };

  const sync = {
    pull: (since) => client.get('/sync/pull', { query: since ? { since } : undefined }),
    push: (events) => client.post('/sync/push', { events }),
    flushPending: ({ token } = {}) => flushPendingSyncQueue({ token }),
  };

  return { auth, products, customers, bills, inventory, reports, udhar, suppliers, shop, sync };
}

export const backend = createBackendModules(apiClient);

export async function hydrateFrontendCache(modules = backend) {
  const [products, customers, inventoryRows, udharRows, stockLedgerRows] = await Promise.all([
    modules.products.list().catch(() => []),
    modules.customers.list().catch(() => []),
    modules.inventory.current().catch(() => []),
    modules.udhar.ledger().catch(() => []),
    modules.inventory.ledger().catch(() => []),
  ]);

  await Promise.all([
    Array.isArray(products) ? cacheProducts(products) : Promise.resolve(),
    Array.isArray(customers) ? cacheCustomers(customers) : Promise.resolve(),
    Array.isArray(inventoryRows) ? cacheStockSnapshot(inventoryRows) : Promise.resolve(),
    Array.isArray(udharRows) ? cacheUdharLedger(udharRows) : Promise.resolve(),
    Array.isArray(stockLedgerRows) ? cacheStockLedger(stockLedgerRows) : Promise.resolve(),
  ]);

  return { products, customers, inventoryRows, udharRows, stockLedgerRows };
}

export async function confirmBillOnlineFirst(billPayload, modules = backend) {
  if (!globalThis.navigator?.onLine) {
    return saveBillOffline(billPayload);
  }

  try {
    const savedBill = await modules.bills.confirm(billPayload);
    await cacheBill(savedBill, LOCAL_BILL_STATUS.SYNCED);
    return { status: LOCAL_BILL_STATUS.SYNCED, bill: savedBill };
  } catch (error) {
    const offlineResult = await saveBillOffline(billPayload);
    return { ...offlineResult, error: error?.message || String(error) };
  }
}

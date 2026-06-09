import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const apiClientSource = readFileSync(new URL('../public/js/api-client.js', import.meta.url), 'utf8');
const modulesSource = readFileSync(new URL('../public/js/backend-modules.js', import.meta.url), 'utf8');

const requiredRoutes = [
  '/auth/login',
  '/auth/register',
  '/auth/me',
  '/products',
  '/products/recycle-bin',
  '/customers',
  '/bills/confirm',
  '/inventory',
  '/inventory/ledger',
  '/reports/pnl',
  '/reports/top-products',
  '/udhar',
  '/sync/pull',
  '/sync/push',
];

for (const route of requiredRoutes) {
  assert.ok(modulesSource.includes(route), `Expected backend module route ${route}`);
}

assert.ok(apiClientSource.includes('Authorization: `Bearer ${token}`'), 'API client must attach bearer token');
assert.ok(apiClientSource.includes("'x-owner-pin': ownerPin"), 'API client must support owner PIN header');
assert.ok(apiClientSource.includes('makeQueryString'), 'API client must support query params');
assert.ok(modulesSource.includes('confirmBillOnlineFirst'), 'Bill confirm helper must exist');
assert.ok(modulesSource.includes('saveBillOffline'), 'Bill confirm helper must fallback to offline queue');
assert.ok(modulesSource.includes('hydrateFrontendCache'), 'Frontend cache hydration helper must exist');
assert.ok(modulesSource.includes('cacheProducts'), 'Products must cache to IndexedDB');
assert.ok(modulesSource.includes('cacheCustomers'), 'Customers must cache to IndexedDB');
assert.ok(modulesSource.includes('cacheStockSnapshot'), 'Inventory must cache to IndexedDB');
assert.ok(!modulesSource.includes('document.querySelector'), 'Step 9 must not manipulate UI directly');
assert.ok(!modulesSource.includes('innerHTML'), 'Step 9 must not rewrite UI');

console.log('Frontend-backend connection examples passed');

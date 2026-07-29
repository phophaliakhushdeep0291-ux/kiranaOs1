import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { purchaseSchema } from '../src/modules/inventory/inventory.schema.js';

const SYNC_SERVICE = 'src/modules/sync/sync.service.js';

// Regression: STOCK_PURCHASE parsed the payload with purchaseSchema BEFORE deriving
// identity. purchaseSchema is the REST contract and mandates an explicit idempotencyKey,
// but an offline purchase identifies itself by movementId instead. Every synced purchase
// was rejected with a permanent CONFLICT: local stock rose while the server never moved,
// and the supplier's outstanding due was never recorded.
function identityIsDerivedBeforeParse() {
  const source = readFileSync(SYNC_SERVICE, 'utf8');
  const body = source.slice(source.indexOf('async function applyStockPurchase'));
  const fn = body.slice(0, body.indexOf('\n}'));
  const identityAt = fn.indexOf('getPurchaseIdentity(');
  const parseAt = fn.indexOf('stockPurchasePayloadSchema.parse(');
  assert.ok(identityAt !== -1, 'applyStockPurchase must derive purchase identity');
  assert.ok(parseAt !== -1, 'applyStockPurchase must parse the purchase payload');
  assert.ok(
    identityAt < parseAt,
    'purchase identity must be derived BEFORE the schema parse, or offline purchases CONFLICT forever',
  );
  assert.ok(
    fn.includes('idempotencyKey: identity.idempotencyKey'),
    'the derived identity must be fed into the parsed payload',
  );
}

// The contract the fix relies on: a payload carrying only movementId (what an offline
// client sends) must validate once the derived key is supplied.
function derivedKeySatisfiesSchema() {
  const offlinePayload = {
    movementId: 'stock_purchase_4a1b6569-2bb9-4f0b-b5e8-7e7a04b9fef3',
    productId: 'cms4htdw2001i44l8xr1vr42e',
    supplierName: 'Sharma Distributors',
    quantity: 20,
    enteredUnit: 'piece',
    billAmount: 160,
    purchasePaymentStatus: 'partial',
    purchasePaidAmount: 100,
    purchaseDueAmount: 60,
  };

  assert.throws(
    () => purchaseSchema.parse(offlinePayload),
    'a purchase with no idempotencyKey must still be rejected by the REST schema',
  );

  const parsed = purchaseSchema.parse({ ...offlinePayload, idempotencyKey: offlinePayload.movementId });
  assert.equal(parsed.idempotencyKey, offlinePayload.movementId);
  assert.equal(parsed.billAmount, 160);
  assert.equal(parsed.purchaseDueAmount, 60);
}

function run() {
  identityIsDerivedBeforeParse();
  derivedKeySatisfiesSchema();
  console.log('stock-purchase-sync-identity: all checks passed');
}

run();

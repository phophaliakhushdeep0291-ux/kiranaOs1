import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const INVENTORY_SERVICE = fileURLToPath(new URL('../src/modules/inventory/inventory.service.js', import.meta.url));
const INVENTORY_SCHEMA = fileURLToPath(new URL('../src/modules/inventory/inventory.schema.js', import.meta.url));
const LOTS_SERVICE = fileURLToPath(new URL('../src/modules/inventory-lots/inventoryLots.service.js', import.meta.url));

// The gap this closes: lot capture at receiving existed only on the purchase
// ORDER path. The day-to-day purchase-bills screen is the offline-first one and
// the one most shops actually use, and it recorded stock with no batch at all —
// so a chemist doing its receiving there built up batch-tracked inventory that
// FEFO could never allocate and a recall could never find.
function recordPurchaseBody() {
  const source = readFileSync(INVENTORY_SERVICE, 'utf8');
  const start = source.indexOf('export async function recordPurchase');
  assert.ok(start !== -1, 'recordPurchase must exist');
  const next = source.indexOf('\nexport ', start + 10);
  return source.slice(start, next === -1 ? source.length : next);
}

function purchaseRecordsTheLot() {
  const body = recordPurchaseBody();
  assert.ok(body.includes('recordReceiptLot('), 'a purchase must be able to record the lot it received');
  assert.ok(
    body.includes('batchNumber, manufacturedOn, expiresOn, batchMrp'),
    'recordPurchase must read the batch fields off the payload',
  );
  // The lot has to be written inside the same transaction as the stock movement,
  // or a crash between them leaves stock on hand with no batch behind it.
  const ledgerAt = body.indexOf('tx.stockLedger.create');
  const lotAt = body.indexOf('recordReceiptLot(');
  assert.ok(ledgerAt !== -1 && lotAt !== -1, 'both writes must be present');
  assert.ok(lotAt > ledgerAt, 'the lot is recorded after the movement it belongs to');
  assert.ok(body.includes('recordReceiptLot(tx,'), 'the lot must be written on the same transaction handle');
}

function lotIsOnlyAttemptedWhenOneWasSupplied() {
  const body = recordPurchaseBody();
  // Deliberately NOT "whenever the product is batch-tracked". recordReceiptLot
  // throws for a batch-tracked product with no lot details, and a device can
  // hold a purchase queued before these fields existed — failing it on the
  // server would leave an outbox event that can never succeed, which stops that
  // device syncing everything behind it. The receiving screen enforces instead.
  assert.ok(
    body.includes('batchNumber || expiresOn'),
    'the lot write must be guarded on the batch details actually being supplied',
  );
  assert.ok(
    !body.includes('product.batchTrackingEnabled\n      ? await recordReceiptLot'),
    'the guard must not be the product flag, or a queued legacy purchase becomes unsyncable',
  );
}

function schemaAcceptsTheLotOptionally() {
  const schema = readFileSync(INVENTORY_SCHEMA, 'utf8');
  for (const field of ['batchNumber', 'manufacturedOn', 'expiresOn', 'batchMrp']) {
    assert.ok(schema.includes(field), `purchaseSchema must accept ${field}`);
  }
  // Every one optional, for the same queued-event reason as above.
  assert.match(schema, /batchNumber: z\.string\(\)\.trim\(\)\.min\(1\)\.max\(80\)\.optional\(\)/);
  assert.match(schema, /batchMrp: moneyAmount\(\{ positive: true \}\)\.optional\(\)/);
  // Dates are day-precision strings off a printed strip, same contract the
  // purchase-order receive path already uses.
  assert.match(schema, /Batch date must be YYYY-MM-DD/);
}

function theLotServiceStillGuardsWhatItAlwaysGuarded() {
  // recordPurchase leans on these rather than re-checking them, so they have to
  // stay where they are.
  const lots = readFileSync(LOTS_SERVICE, 'utf8');
  assert.ok(lots.includes('BATCH_TRACKING_NOT_ENABLED'), 'batch details on a non-batch product must still be refused');
  assert.ok(lots.includes('BATCH_DETAILS_REQUIRED'), 'a batch-tracked product must still require number + expiry');
  assert.ok(lots.includes('BATCH_ALREADY_EXPIRED'), 'expired stock must still be refused as saleable');
  assert.ok(lots.includes('INVENTORY_LOT_DATE_INVALID'), 'expiry must still have to follow manufacture');
}

const cases = [
  ['a purchase records the lot it received', purchaseRecordsTheLot],
  ['the lot write is guarded on details, not on the product flag', lotIsOnlyAttemptedWhenOneWasSupplied],
  ['purchaseSchema accepts the lot, all fields optional', schemaAcceptsTheLotOptionally],
  ['the lot service keeps its own guards', theLotServiceStillGuardsWhatItAlwaysGuarded],
];

let failed = 0;
for (const [name, run] of cases) {
  try { run(); console.log(`  ok  ${name}`); }
  catch (error) { failed += 1; console.error(`  FAIL ${name}\n       ${error.message}`); }
}
console.log(`\npurchase lot capture: ${cases.length - failed}/${cases.length} passed`);
if (failed > 0) process.exit(1);

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const INVENTORY_SERVICE = fileURLToPath(new URL('../src/modules/inventory/inventory.service.js', import.meta.url));
const AUDIT_CONTEXT = fileURLToPath(new URL('../src/modules/assurance/context.service.js', import.meta.url));

// Regression: a quick purchase wrote its StockLedger row with sourceId = productId while
// sourceType said "purchase". The assurance context matches on
// { sourceType: "purchase", sourceId: history.id } with a fallback arm that only accepts
// sourceId === null, so a non-null-but-wrong id matched NEITHER arm. Every purchase looked
// like it had moved no stock and raised a false HIGH "Purchase did not increase stock"
// finding — the fastest way to teach an owner to ignore the audit screen.
function purchaseBody() {
  const source = readFileSync(INVENTORY_SERVICE, 'utf8');
  const start = source.indexOf('export async function recordPurchase');
  assert.ok(start !== -1, 'recordPurchase must exist');
  const next = source.indexOf('\nexport ', start + 10);
  return source.slice(start, next === -1 ? source.length : next);
}

function stockRowPointsAtThePurchase() {
  const body = purchaseBody();
  assert.ok(
    body.includes('sourceId: idempotencyKey ? purchaseHistory.id : null'),
    'the purchase stock movement must point at the purchase document, not the product',
  );
  assert.ok(
    !body.includes('sourceId: idempotencyKey ? productId : null'),
    'sourceId must never be set to the productId for a purchase stock row',
  );
}

function purchaseRowIsWrittenFirst() {
  const body = purchaseBody();
  const historyAt = body.indexOf('tx.purchaseHistory.create');
  const ledgerAt = body.indexOf('tx.stockLedger.create');
  assert.ok(historyAt !== -1 && ledgerAt !== -1, 'both rows must be written');
  assert.ok(
    historyAt < ledgerAt,
    'purchaseHistory must be created BEFORE stockLedger so its id can be referenced',
  );
}

// Both sides of the contract have to agree, so a future edit to either file breaks loudly.
function auditStillMatchesOnTheHistoryId() {
  const context = readFileSync(AUDIT_CONTEXT, 'utf8');
  assert.ok(
    context.includes('{ sourceType: "purchase", sourceId: history.id }'),
    'the assurance context must keep matching purchase stock rows on the purchase id',
  );
}

function run() {
  stockRowPointsAtThePurchase();
  purchaseRowIsWrittenFirst();
  auditStillMatchesOnTheHistoryId();
  console.log('purchase-stock-source-link: all checks passed');
}

run();

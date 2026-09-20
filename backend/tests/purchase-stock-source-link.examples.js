import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import db from '../src/db.js';
import { recordPurchase } from '../src/modules/inventory/inventory.service.js';
import { createProduct } from '../src/modules/products/products.service.js';

// Regression: a quick purchase wrote its StockLedger row with sourceId = productId while
// sourceType said "purchase". The assurance context matches on
// { sourceType: "purchase", sourceId: history.id } with a fallback arm that only accepts
// sourceId === null, so a non-null-but-wrong id matched NEITHER arm. Every purchase looked
// like it had moved no stock and raised a false HIGH "Purchase did not increase stock"
// finding — the fastest way to teach an owner to ignore the audit screen.
//
// This used to grep recordPurchase for the literal
// `sourceId: idempotencyKey ? purchaseHistory.id : null`. That assertion went stale the
// moment the code improved on it — the link is now written unconditionally — and because
// nothing in package.json ran this file, the failure sat unseen. Asserting the row that
// comes out survives the next refactor and covers the case the literal never could: a
// purchase with no idempotency key, which the old form deliberately left unlinked.

const AUDIT_CONTEXT = fileURLToPath(new URL('../src/modules/assurance/context.service.js', import.meta.url));

const shop = await db.shop.create({
  data: { name: 'Purchase source link proof', ownerName: 'Owner', city: 'Indore', address: '1 Test Road' },
});
const owner = await db.user.create({
  data: {
    shopId: shop.id, name: 'Owner', mobile: '9000000701', role: 'owner',
    passwordHash: await bcrypt.hash('password', 10), pinHash: await bcrypt.hash('4242', 10),
  },
});

const product = await createProduct(shop.id, {
  name: 'Traceable Salt', category: 'Grocery',
  displayUnit: 'piece', baseUnit: 'piece', rateUnit: 'piece',
  defaultPricePerRateUnit: 28, costPerRateUnit: 22, mrp: 30,
  stockBaseQty: 0, gstRate: 0, isLooseItem: false,
}, { actor: { userId: owner.id } });

const purchase = {
  productId: product.id, supplierName: 'Sharma Traders',
  quantity: 100, enteredUnit: 'piece', billAmount: 2200,
};

async function ledgerRowFor(result) {
  const row = await db.stockLedger.findUnique({ where: { id: result.stockLedgerId } });
  assert.ok(row, 'the purchase must write a stock movement');
  return row;
}

/* ------------- the movement points at the purchase, both ways in ----------- */

for (const identity of [
  { label: 'with an idempotency key', value: { idempotencyKey: 'purchase-source-link-1', userId: owner.id } },
  // The old literal wrote null here. A purchase entered on a device that sends no
  // key is still a purchase, and the audit screen still has to find its stock.
  { label: 'without one', value: { userId: owner.id } },
]) {
  const result = await recordPurchase(shop.id, purchase, identity.value);
  const row = await ledgerRowFor(result);

  assert.equal(row.sourceType, 'purchase', `sourceType ${identity.label}`);
  assert.equal(
    row.sourceId, result.purchaseHistoryId,
    `the stock movement must point at the purchase document ${identity.label}`,
  );
  assert.notEqual(row.sourceId, row.productId, `sourceId must never be the productId ${identity.label}`);
  assert.equal(row.action, 'purchase');
  assert.equal(row.changeBaseQty, 100, 'and must record the stock it actually moved');
}

/* ------------- which is exactly what the audit screen looks for ------------ */

// Both sides of the contract have to agree, so a future edit to either breaks loudly.
const context = readFileSync(AUDIT_CONTEXT, 'utf8');
assert.ok(
  context.includes('{ sourceType: "purchase", sourceId: history.id }'),
  'the assurance context must keep matching purchase stock rows on the purchase id',
);

// And prove the join the audit performs actually finds them, rather than trusting
// that the two string literals agree.
const histories = await db.purchaseHistory.findMany({ where: { shopId: shop.id } });
assert.equal(histories.length, 2, 'both purchases must be on file');
for (const history of histories) {
  const matched = await db.stockLedger.findFirst({
    where: { shopId: shop.id, sourceType: 'purchase', sourceId: history.id },
  });
  assert.ok(matched, `the audit query must find the stock moved by purchase ${history.id}`);
}

console.log('purchase-stock-source-link: all checks passed');

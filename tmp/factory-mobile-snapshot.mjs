import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import db from '../backend/src/db.js';
if (process.env.DATABASE_URL !== 'file:C:/Users/phoph/Desktop/app/output/factory-ui-isolated.db') throw Error('Isolated QA database required');
try {
  const owner = await db.user.findFirst({ where: { mobile: '8779091001' } });
  const shopId = owner.shopId;
  const order = await db.tradeOrder.findFirst({ where: { shopId, orderNumber: 'QA-MOBILE-INVOICE-02' }, include: { items: true } });
  assert.ok(order);
  const product = await db.product.findFirst({ where: { shopId, name: 'QA Finished spice' }, select: { id: true, name: true, stockBaseQty: true } });
  const packs = await db.productSellingUnit.findMany({ where: { productId: product.id }, select: { name: true, onHandQty: true } });
  const lots = await db.inventoryLot.findMany({ where: { shopId, productId: product.id }, select: { batchNumber: true, availableBaseQty: true, status: true } });
  const bill = order.billId ? await db.bill.findUnique({ where: { id: order.billId }, select: { id: true, billNo: true, grandTotal: true, paidAmount: true, creditAmount: true, payments: true } }) : null;
  const credit = bill ? await db.bill.findMany({ where: { shopId, returnOfBillId: bill.id }, select: { id: true, billNo: true, grandTotal: true } }) : [];
  const result = { checkedAt: new Date().toISOString(), method: 'Read-only database snapshot after browser UI actions', order: { id: order.id, number: order.orderNumber, status: order.status }, product, packs, lots, bill, credit, stockLedger: await db.stockLedger.findMany({ where: { shopId, OR: [{ sourceId: order.id }, { billId: { in: credit.map(row => row.id) } }] } }), financialLedger: bill ? await db.financialLedger.findMany({ where: { shopId, billId: { in: [bill.id, ...credit.map(row => row.id)] } } }) : [] };
  if (order.status === 'returned') {
    assert.equal(product.stockBaseQty, 20);
    assert.equal(packs.find(row => row.name === 'Finished bag 2 units').onHandQty, 5);
    assert.equal(packs.find(row => row.name === 'Finished carton 5 units').onHandQty, 2);
    assert.equal(lots.find(row => row.batchNumber === 'QA-SPLIT-FINISHED-01').availableBaseQty, 20);
    assert.equal(bill.grandTotal, 180); assert.equal(credit.length, 1); assert.equal(credit[0].grandTotal, -180);
    assert.equal(result.stockLedger.length, 4);
    for (const type of ['sale', 'bank_in', 'cost_of_goods_sold', 'inventory_sale']) {
      const entries = result.financialLedger.filter(row => row.entryType === type);
      assert.equal(entries.length, 2, type);
      assert.equal(entries.reduce((sum, row) => sum + BigInt(row.amountPaise), 0n), 0n, type);
    }
  }
  await fs.writeFile(`docs/evidence/shop-type-audit-2026-09-08/manufacturing-mobile-${order.status}.json`, JSON.stringify(result, (_, value) => typeof value === 'bigint' ? String(value) : value, 2));
  console.log(JSON.stringify({ status: order.status, stock: product.stockBaseQty, packs, invoice: bill?.grandTotal, credit: credit.map(row => row.grandTotal) }));
} finally { await db.$disconnect(); }

import db from '../backend/src/db.js';
const shop = await db.shop.findFirst({ where: { name: 'QA manufacturing Workflow', phone: '8778090810' }, select: { id: true } });
if (!shop) throw new Error('QA manufacturing shop missing');
const run = await db.productionRun.findFirst({ where: { shopId: shop.id, runNumber: 'QA-RUN-01', status: 'planned' } });
const material = await db.product.findFirst({ where: { shopId: shop.id, name: 'QA raw material' } });
if (!run || !material) throw new Error('QA fixture no longer matches');
await db.$transaction(async tx => {
  const previous = await tx.inventoryLot.findFirst({ where: { shopId: shop.id, productId: material.id } });
  if (previous) throw new Error('Source lot already configured; do not seed twice');
  await tx.product.update({ where: { id: material.id }, data: { batchTrackingEnabled: true } });
  await tx.inventoryLot.create({ data: { shopId: shop.id, locationId: run.locationId, productId: material.id, batchNumber: 'QA-SOURCE-01', expiresOn: new Date('2027-09-09'), receivedBaseQty: material.stockBaseQty, availableBaseQty: material.stockBaseQty, costPerRateUnit: material.costPerRateUnit, note: 'QA fixture: track existing stock without adding inventory' } });
});
console.log('Configured source-batch selection for the QA planned run; inventory total unchanged.');
await db.$disconnect();

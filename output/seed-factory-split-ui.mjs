import db from '../backend/src/db.js';
import { createTenant, createProduct } from '../backend/tests/integration/factories.js';
import { settingsForBusinessType } from '../backend/src/verticals/registry.js';
import * as production from '../backend/src/verticals/manufacturing/manufacturing.service.js';
if (!String(process.env.DATABASE_URL).endsWith('/factory-ui-isolated.db')) throw new Error('Isolated factory UI database required');
try {
  const tenant = await createTenant(db, { shopName: 'Factory split QA', ownerMobile: '8779091001', password: 'QaFlow@2026', ownerPin: '2468' });
  const shopId = tenant.shop.id;
  await db.shop.update({ where: { id: shopId }, data: { settingsJson: JSON.stringify(settingsForBusinessType('manufacturing')) } });
  const raw = await createProduct(db, shopId, { name: 'QA Raw spice', stockBaseQty: 100 });
  const label = await createProduct(db, shopId, { name: 'QA Labels', stockBaseQty: 50 });
  const finished = await createProduct(db, shopId, { name: 'QA Finished spice', stockBaseQty: 0 });
  for (const product of [raw, finished]) await db.product.update({ where: { id: product.id }, data: { batchTrackingEnabled: true, packagingMode: 'per_pack' } });
  const pack = (productId, name, conversionToBase, onHandQty) => db.productSellingUnit.create({ data: { shopId, productId, name, unitType: 'pack', unitCode: name.toLowerCase().replaceAll(' ', '-'), conversionToBase, onHandQty, defaultPrice: 20 } });
  const rawPack = await pack(raw.id, 'Raw bag 2 units', 2, 50);
  await pack(finished.id, 'Finished bag 2 units', 2, 0);
  await pack(finished.id, 'Finished carton 5 units', 5, 0);
  const bom = await production.createBom(shopId, { finishedProductId: finished.id, name: 'QA Split recipe', outputQuantityBaseQty: 10, items: [{ materialProductId: raw.id, quantityBaseQty: 10, wastagePercent: 0 }, { materialProductId: label.id, quantityBaseQty: 5, wastagePercent: 0 }] });
  const run = await production.createRun(shopId, { bomId: bom.id, runNumber: 'QA-SPLIT-RUN-01', plannedOutputBaseQty: 20 });
  for (const [batchNumber, qty] of [['QA-RAW-A', 60], ['QA-RAW-B', 40]]) await db.inventoryLot.create({ data: { shopId, locationId: run.locationId, productId: raw.id, sellingUnitId: rawPack.id, batchNumber, expiresOn: new Date('2027-09-09'), receivedBaseQty: qty, availableBaseQty: qty, costPerRateUnit: 10 } });
  console.log('Isolated split-source and mixed-pack fixture ready.');
} finally { await db.$disconnect(); }

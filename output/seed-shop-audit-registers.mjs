import { readFile } from 'node:fs/promises';
import dotenv from '../backend/node_modules/dotenv/lib/main.js';
dotenv.config({ path: new URL('../backend/.env', import.meta.url) });
process.env.DATABASE_URL = 'file:C:/Users/phoph/Desktop/app/backend/prisma/dev.db';
process.env.NODE_ENV = 'development';
const { default: db } = await import('../backend/src/db.js');
const rows = JSON.parse(await readFile(new URL('./shop-audit-tenants.json', import.meta.url), 'utf8'));
const day = new Date().toISOString().slice(0, 10);
try {
  for (const row of rows) {
    const shop = await db.shop.findFirst({ where: { id: row.shopId, name: `QA ${row.trade} Workflow` } });
    if (!shop) throw new Error('QA shop identity mismatch');
    const product = await db.product.findFirst({ where: { shopId: shop.id, name: `QA ${row.trade} item`, deletedAt: null } });
    if (!product) throw new Error('QA product missing');
    if (row.trade === 'footwear') {
      await db.product.update({ where: { id: product.id }, data: { variantAxesJson: JSON.stringify([{ name: 'Size', values: ['7', '8', '9'] }]), packagingMode: 'per_pack' } });
      for (const [size, qty] of [['7', 5], ['8', 10], ['9', 5]]) {
        await db.productSellingUnit.upsert({ where: { shopId_productId_unitCode: { shopId: shop.id, productId: product.id, unitCode: `qa_size_${size}` } }, update: {}, create: { shopId: shop.id, productId: product.id, name: `UK ${size}`, unitType: 'variant', unitCode: `qa_size_${size}`, conversionToBase: 1, defaultPrice: 20, onHandQty: qty, variantValue1: size } });
      }
      const svc = await import('../backend/src/verticals/footwear/sizes/sizes.service.js');
      await svc.setSizeProfile(shop.id, product.id, { sizeSystem: 'uk', gender: 'mens' });
    }
    if (row.trade === 'auto_parts' && !(await db.partFitment.count({ where: { shopId: shop.id } }))) {
      const svc = await import('../backend/src/verticals/auto-parts/fitment/fitment.service.js');
      await svc.createFitment(shop.id, { productId: product.id, make: 'QA Make', model: 'QA Model', yearFrom: 2020, yearTo: 2026 });
      await svc.createCrossReference(shop.id, { productId: product.id, partNumber: 'QA-OEM-01', kind: 'oem' });
    }
    if (row.trade === 'electronics' && !(await db.productUnit.count({ where: { shopId: shop.id } }))) {
      const svc = await import('../backend/src/verticals/electronics/units/units.service.js');
      await svc.receiveUnits(shop.id, { productId: product.id, warrantyMonths: 12, units: [{ serialNumber: 'QA-SERIAL-01' }] });
    }
    if (row.trade === 'pharmacy' && !(await db.prescription.count({ where: { shopId: shop.id } }))) {
      const svc = await import('../backend/src/verticals/pharmacy/prescriptions/prescriptions.service.js');
      await svc.createPrescription(shop.id, { doctorName: 'QA Doctor', patientName: 'QA Patient', scheduleType: 'otc', prescribedOn: day, items: [{ productId: product.id, name: product.name, qty: 1 }], refillsAllowed: 1 });
    }
    if (row.trade === 'stationery' && !(await db.bookList.count({ where: { shopId: shop.id } }))) {
      const svc = await import('../backend/src/verticals/stationery-books/book-lists/book-lists.service.js');
      await svc.createBookList(shop.id, { schoolName: 'QA School', className: '6', academicYear: '2026-27', items: [{ productId: product.id, name: product.name, qty: 2 }] });
    }
    if (row.trade === 'furniture' && !(await db.furnitureOrder.count({ where: { shopId: shop.id } }))) {
      const svc = await import('../backend/src/verticals/furniture-home/orders/orders.service.js');
      const order = await svc.createOrder(shop.id, { customerName: 'QA Buyer', status: 'confirmed', items: [{ productId: product.id, name: product.name, qty: 1, rate: 100 }], deliveryCharge: 20 });
      await svc.addPayment(shop.id, order.id, { amount: 40, mode: 'cash' });
    }
    if (row.trade === 'cosmetics' && !(await db.testerUnit.count({ where: { shopId: shop.id } }))) {
      const svc = await import('../backend/src/verticals/beauty-cosmetics/testers/testers.service.js');
      await svc.openTester(shop.id, { productId: product.id, variant: 'QA Red', moveStock: true });
    }
    if (row.trade === 'restaurant' && !(await db.restaurantTable.count({ where: { shopId: shop.id } }))) {
      const tables = await import('../backend/src/verticals/restaurant/tables/tables.service.js');
      const kitchen = await import('../backend/src/verticals/restaurant/kot/kot.service.js');
      const table = await tables.createTable(shop.id, { name: 'QA Table', seats: 2, selfOrderEnabled: false });
      await kitchen.fireTicket(shop.id, { tableId: table.id, tableName: table.name, billId: `qa-sitting-${table.id}`, lines: [{ key: product.id, name: product.name, qty: 1 }], idempotencyKey: `qa-kot-${table.id}` });
    }
    if (row.trade === 'manufacturing' && !(await db.manufacturingBom.count({ where: { shopId: shop.id } }))) {
      const svc = await import('../backend/src/verticals/manufacturing/manufacturing.service.js');
      await db.product.update({ where: { id: product.id }, data: { batchTrackingEnabled: true } });
      const material = await db.product.create({ data: { shopId: shop.id, name: 'QA raw material', category: 'general', baseUnit: 'piece', rateUnit: 'piece', displayUnit: 'piece', stockBaseQty: 100, costPerRateUnit: 10, defaultPricePerRateUnit: 20 } });
      const bom = await svc.createBom(shop.id, { name: 'QA recipe', finishedProductId: product.id, outputQuantityBaseQty: 10, items: [{ materialProductId: material.id, quantityBaseQty: 12 }] });
      await svc.createRun(shop.id, { bomId: bom.id, runNumber: 'QA-RUN-01', plannedOutputBaseQty: 10 });
    }
    console.log(`Prepared ${row.trade}`);
  }
} finally { await db.$disconnect(); }

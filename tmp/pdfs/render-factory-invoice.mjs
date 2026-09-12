import db from '../../backend/src/db.js';
import fs from 'node:fs/promises';
import { buildTradePdf } from '../../backend/src/verticals/manufacturing/trade-documents.service.js';
if (process.env.DATABASE_URL !== 'file:C:/Users/phoph/Desktop/app/output/factory-ui-isolated.db') throw Error('Isolated QA database required');
try {
  const shop = await db.shop.findFirst({ where: { name: 'Factory split QA' } });
  const order = await db.tradeOrder.findFirst({ where: { orderNumber: 'QA-SPLIT-ORDER-01', shopId: shop.id } });
  await fs.writeFile('output/pdf/manufacturing-dispatch-invoice.pdf', await buildTradePdf(order.shopId, order.id, 'tax-invoice'));
} finally { await db.$disconnect(); }

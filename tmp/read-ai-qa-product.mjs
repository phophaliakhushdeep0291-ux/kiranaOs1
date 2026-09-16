import db from '../backend/src/db.js';
import { listProducts } from '../backend/src/modules/products/products.service.js';
import { CORE_WRITE_TOOLS } from '../backend/src/modules/ai/agent/tools/core-write.js';
if (process.env.DATABASE_URL !== 'file:C:/Users/phoph/Desktop/app/output/factory-ui-isolated.db') throw Error('QA only');
try {
  const owner = await db.user.findFirst({ where: { mobile: '8779091001' }, select: { shopId: true } });
  const products = await listProducts(owner.shopId, { search: 'QA Labels' });
  console.log(JSON.stringify(products.map(row => ({ id: row.id, name: row.name, baseUnit: row.baseUnit, rateUnit: row.rateUnit, defaultPricePerRateUnit: row.defaultPricePerRateUnit, defaultPricePerRateUnitPaise: row.defaultPricePerRateUnitPaise, sellingUnits: row.sellingUnits })), (_, value) => typeof value === 'bigint' ? String(value) : value));
  const result = await CORE_WRITE_TOOLS.find(tool => tool.name === 'add_items_to_bill').handler({ items: [{ query: 'QA Labels', quantity: 2, unit: 'piece' }] }, { shopId: owner.shopId });
  console.log(JSON.stringify(result));
} finally { await db.$disconnect(); }

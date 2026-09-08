import { writeFile } from "node:fs/promises";
process.env.DATABASE_URL = 'file:C:/Users/phoph/Desktop/app/backend/prisma/dev.db';
process.env.NODE_ENV = 'development';
const { default: db } = await import('../backend/src/db.js');
const { createTenant, createProduct } = await import('../backend/tests/integration/factories.js');
const { settingsForBusinessType, BUSINESS_TYPES } = await import('../backend/src/verticals/registry.js');
const rows = [];
try {
  for (const [index, trade] of BUSINESS_TYPES.entries()) {
    const mobile = String(8778090800 + index);
    const existing = await db.user.findFirst({ where: { mobile }, select: { shopId: true } });
    if (existing) { rows.push({ trade, mobile, shopId: existing.shopId }); continue; }
    const tenant = await createTenant(db, { shopName: `QA ${trade} Workflow`, ownerName: 'QA Owner', ownerMobile: mobile, password: 'QaFlow@2026', ownerPin: '2468', planCode: 'pro' });
    await db.shop.update({ where: { id: tenant.shop.id }, data: { settingsJson: JSON.stringify(settingsForBusinessType(trade)) } });
    const product = await createProduct(db, tenant.shop.id, { name: `QA ${trade} item`, stockBaseQty: 20 });
    rows.push({ trade, mobile, shopId: tenant.shop.id, productId: product.id });
  }
  await writeFile(new URL('./shop-audit-tenants.json', import.meta.url), JSON.stringify(rows, null, 2));
  console.log(`Created or reused ${rows.length} local QA tenants. Manifest saved.`);
} finally { await db.$disconnect(); }

import assert from "node:assert/strict";
import db from "../src/db.js";

const suffix = `change-log-cascade-${Date.now()}`;

async function rowsReferencingShop(shopId) {
  const tables = await db.$queryRawUnsafe(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`);
  const references = [];
  for (const { name } of tables) {
    const columns = await db.$queryRawUnsafe(`PRAGMA table_info("${String(name).replaceAll('"', '""')}")`);
    if (!columns.some((column) => column.name === "shopId")) continue;
    const [{ count }] = await db.$queryRawUnsafe(
      `SELECT COUNT(*) AS count FROM "${String(name).replaceAll('"', '""')}" WHERE "shopId" = ?`,
      shopId,
    );
    if (Number(count) > 0) references.push({ table: name, count: Number(count) });
  }
  return references;
}

const shop = await db.shop.create({
  data: { name: suffix, ownerName: "QA", city: "Jaipur", address: "Isolated test" },
});

try {
  const product = await db.product.create({
    data: {
      shopId: shop.id,
      name: "Cascade proof product",
      category: "test",
      baseUnit: "piece",
      displayUnit: "piece",
      rateUnit: "piece",
      defaultPricePerRateUnit: 10,
    },
  });
  assert.ok(
    await db.changeLog.count({ where: { shopId: shop.id } }) > 0,
    "the installed sync trigger must create a change-feed row",
  );

  // Core business rows are deliberately cleaned up through their own domain
  // paths. Their delete trigger must retain a tombstone while the shop exists.
  await db.product.delete({ where: { id: product.id } });
  assert.ok(
    await db.changeLog.count({ where: { shopId: shop.id, entityId: product.id, operation: "delete" } }) > 0,
    "a normal product deletion must retain its sync tombstone",
  );

  try {
    await db.shop.delete({ where: { id: shop.id } });
  } catch (error) {
    error.message = `${error.message}\nRows still scoped to the shop: ${JSON.stringify(await rowsReferencingShop(shop.id))}`;
    throw error;
  }
  assert.equal(await db.changeLog.count({ where: { shopId: shop.id } }), 0, "shop deletion must remove its sync feed");
  assert.equal(await db.product.count({ where: { shopId: shop.id } }), 0, "the cleaned-up product must stay removed");
  console.log("change-log-shop-cascade.examples.js OK");
} finally {
  await db.changeLog.deleteMany({ where: { shopId: shop.id } }).catch(() => {});
  await db.product.deleteMany({ where: { shopId: shop.id } }).catch(() => {});
  await db.shop.deleteMany({ where: { id: shop.id } }).catch(() => {});
  await db.$disconnect();
}

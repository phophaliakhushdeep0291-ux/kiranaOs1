import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import db from "../src/db.js";
import { productData } from "./integration/factories.js";

/**
 * Existing restaurant dishes were created through the shared product screen.
 * They have no menuCourse, so the previous menu-course migration could not see
 * the exact rows that were visible as negative stock in the live Store Room.
 */
const SQLITE_MIGRATION = path.resolve(
  import.meta.dirname, "..", "prisma", "migrations",
  "20260829063000_restaurant_existing_dishes_not_stock", "migration.sql",
);
const POSTGRES_MIGRATION = path.resolve(
  import.meta.dirname, "..", "prisma-postgres", "migrations",
  "000126_restaurant_existing_dishes_not_stock", "migration.sql",
);

const sqliteStatement = fs.readFileSync(SQLITE_MIGRATION, "utf8")
  .split("\n").filter((line) => !line.trim().startsWith("--")).join("\n").trim();
const postgresStatement = fs.readFileSync(POSTGRES_MIGRATION, "utf8");

for (const source of [sqliteStatement, postgresStatement]) {
  assert.match(source, /businessProfile[,.]businessType|businessProfile,businessType/);
  assert.match(source, /restaurant/);
  assert.match(source, /stockBaseQty/);
  assert.match(source, /costPerRateUnit/);
  assert.match(source, /reorderLevel/);
  assert.match(source, /updatedAt/);
}

const restaurant = await db.shop.create({ data: {
  name: `Legacy restaurant ${Date.now()}`, ownerName: "Owner", city: "City", address: "Address",
  settingsJson: JSON.stringify({ businessProfile: { businessType: "restaurant" } }),
} });
const kirana = await db.shop.create({ data: {
  name: `Control kirana ${Date.now()}`, ownerName: "Owner", city: "City", address: "Address",
  settingsJson: JSON.stringify({ businessProfile: { businessType: "kirana" } }),
} });

const add = (shopId, name, over = {}) => db.product.create({
  data: productData(shopId, { name, ...over }),
});
const dal = await add(restaurant.id, "Dal Fry", { stockBaseQty: -3, costPerRateUnit: 0 });
const tea = await add(restaurant.id, "Tea", { stockBaseQty: 0, costPerRateUnit: 0 });
const rice = await add(restaurant.id, "Basmati Rice", { stockBaseQty: 25, costPerRateUnit: 70 });
const kiranaZero = await add(kirana.id, "New Biscuit", { stockBaseQty: 0, costPerRateUnit: 0 });

const old = new Date("2020-01-01T00:00:00.000Z");
await db.product.updateMany({
  where: { id: { in: [dal.id, tea.id, rice.id, kiranaZero.id] } },
  data: { updatedAt: old },
});

await db.$executeRawUnsafe(sqliteStatement);
await db.$executeRawUnsafe(sqliteStatement);

for (const id of [dal.id, tea.id]) {
  const row = await db.product.findUniqueOrThrow({ where: { id } });
  assert.equal(row.stockTrackingEnabled, false, `${row.name} is a dish, not a stocked plate`);
  assert.ok(row.updatedAt > old, `${row.name} must be pulled by an existing offline till`);
}
assert.equal((await db.product.findUniqueOrThrow({ where: { id: rice.id } })).stockTrackingEnabled, true,
  "an ingredient with real stock/cost stays counted");
assert.equal((await db.product.findUniqueOrThrow({ where: { id: kiranaZero.id } })).stockTrackingEnabled, true,
  "the same empty row in another trade is untouched");

console.log("restaurant-existing-dish-backfill: ok");

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import db from "../src/db.js";
import { productData } from "./integration/factories.js";
import { getInventory } from "../src/modules/inventory/inventory.service.js";

/**
 * The correction that has to reach a restaurant already in business.
 *
 * 000124 added `stockTrackingEnabled` and backfilled it, but keyed "is this
 * stock" on the dish having a recipe. On a real menu that matched nothing: a
 * kitchen puts dishes up long before anybody writes the recipes down. So every
 * dish stayed tracked, every sale drove its count one lower, and the store room
 * filled with rows at -1 and -2 that no purchase order can ever put back.
 *
 * Fixing the SQL inside 000124 would have been invisible — Prisma never re-runs
 * a recorded migration, so the edit ships, deploys green, and changes nothing.
 * 000125 exists because a correction to an applied migration is not a
 * correction. This reads that file from disk rather than restating its SQL, so
 * the test breaks if the shipped statement drifts from what it proves.
 */

const MIGRATION = path.resolve(
  import.meta.dirname, "..", "prisma-postgres", "migrations",
  "000125_menu_dishes_are_not_stock", "migration.sql",
);

const statement = fs.readFileSync(MIGRATION, "utf8")
  .split("\n").filter((line) => !line.trim().startsWith("--")).join("\n").trim()
  .replace(/;\s*$/, "")
  // SQLite stores booleans as 0/1, has no IS DISTINCT FROM on older engines, and
  // spells the clock differently. The shipped Postgres statement is the subject
  // of this test; only its dialect is translated, never its meaning.
  .replace(/"stockTrackingEnabled" IS DISTINCT FROM false/, '"stockTrackingEnabled" <> 0')
  .replaceAll("NOW()", "CURRENT_TIMESTAMP");

assert.match(statement, /UPDATE "Product"/, "000125 must still be the backfill this test proves");
assert.match(statement, /"menuCourse" IS NOT NULL/, "being on the menu is the signal, not having a recipe");
assert.match(statement, /"updatedAt"/, "the correction has to move the timestamp or the till never pulls it");

const shop = await db.shop.create({ data: {
  name: `Dish backfill ${Date.now()}`, ownerName: "Owner", city: "City", address: "Address",
  settingsJson: JSON.stringify({ businessProfile: { businessType: "restaurant" } }),
} });

// A menu that predates the column: dishes with no recipes, already negative.
const dish = (name, course, qty) => db.product.create({
  data: { ...productData(shop.id, { name, stockBaseQty: qty }), menuCourse: course },
});
await dish("Fresh Lime Soda", "Beverages", -1);
await dish("French Fries", "Starters", -2);
await dish("Dal Fry", "Main Course", -1);
const rice = await db.product.create({ data: productData(shop.id, { name: "Basmati Rice", stockBaseQty: 25 }) });

// The till pulls incrementally on `updatedAt >= since`, so park every row in
// the past first: a correction that does not move the timestamp is a correction
// the device never receives.
const SINCE = new Date("2020-01-01T00:00:00.000Z");
await db.product.updateMany({ where: { shopId: shop.id }, data: { updatedAt: SINCE } });

const scoped = `${statement} AND "shopId" = '${shop.id}'`;
assert.equal(await db.$executeRawUnsafe(scoped), 3, "every dish on the menu is corrected, recipe or no recipe");
assert.equal(await db.$executeRawUnsafe(scoped), 0, "and replaying the migration is a no-op");

for (const name of ["Fresh Lime Soda", "French Fries", "Dal Fry"]) {
  const row = await db.product.findFirstOrThrow({ where: { shopId: shop.id, name } });
  assert.equal(row.stockTrackingEnabled, false, `${name} is cooked to order, not counted on a shelf`);
}

assert.equal(
  (await db.product.findUniqueOrThrow({ where: { id: rice.id } })).stockTrackingEnabled, true,
  "the ingredients a dish is made from are real stock and keep counting",
);

/* ------------- and the till actually pulls the correction down to its cache */

// This is the half that decides what the shopkeeper sees. The store room renders
// from an offline copy of these products, and the pull is incremental, so a row
// whose timestamp never moved is a row that stays wrong on screen however right
// the server is. `updatedAt` is @updatedAt — Prisma maintains it from the client
// and raw SQL leaves it alone unless the migration says otherwise.
const resynced = await db.product.findMany({
  where: { shopId: shop.id, updatedAt: { gt: SINCE } },
  select: { name: true },
  orderBy: { name: "asc" },
});
assert.deepEqual(
  resynced.map((row) => row.name),
  ["Dal Fry", "French Fries", "Fresh Lime Soda"],
  "the next incremental pull carries exactly the corrected dishes, and nothing else",
);

const storeRoom = await getInventory(shop.id);
assert.deepEqual(
  storeRoom.filter((row) => row.stockTrackingEnabled !== false).map((row) => row.name),
  ["Basmati Rice"],
  "so the store room lists what the shop actually buys and stores, and nothing else",
);

console.log("menu-dish-backfill: ok");

import assert from "node:assert/strict";
import db from "../src/db.js";
import { listProducts } from "../src/modules/products/products.service.js";
import { getLocationQuantity, getLocationQuantitiesByProduct } from "../src/modules/stores/location-context.service.js";

const shop = await db.shop.create({ data: { name: "Stock scale test", ownerName: "Test", city: "Test", address: "Test" } });
try {
  const primary = await db.storeLocation.create({ data: { shopId: shop.id, code: "MAIN", name: "Main", isPrimary: true } });
  const branch = await db.storeLocation.create({ data: { shopId: shop.id, code: "B1", name: "Branch" } });
  const other = await db.storeLocation.create({ data: { shopId: shop.id, code: "B2", name: "Other" } });
  const product = await db.product.create({ data: { shopId: shop.id, name: "Rice", stockBaseQty: 100, lowStockThreshold: 5 } });
  const empty = await db.product.create({ data: { shopId: shop.id, name: "Salt", stockBaseQty: 20 } });
  for (const [location, qty, threshold] of [[branch, 12.25, 3], [other, 17.75, 9]]) {
    await db.locationStock.create({ data: { shopId: shop.id, locationId: location.id, productId: product.id, stockBaseQty: qty, lowStockThreshold: threshold } });
  }
  const unit = await db.productSellingUnit.create({ data: { shopId: shop.id, productId: product.id, name: "Bag", unitType: "bag", unitCode: "bag", defaultPrice: 10 } });
  await db.locationStock.create({ data: { shopId: shop.id, locationId: branch.id, productId: product.id, sellingUnitId: unit.id, stockBaseQty: 999 } });
  for (const location of [primary, branch, other]) {
    const batched = await getLocationQuantitiesByProduct(db, shop.id, location, [product, empty]);
    for (const row of [product, empty]) assert.equal(batched.get(row.id), await getLocationQuantity(db, shop.id, location, row));
    const listed = await listProducts(shop.id, { locationId: location.id });
    assert.equal(listed.find((row) => row.id === product.id).stockBaseQty, batched.get(product.id));
    assert.equal(listed.find((row) => row.id === empty.id).stockBaseQty, batched.get(empty.id));
    assert.equal(listed.find((row) => row.id === product.id).lowStockThreshold, location.isPrimary ? 5 : location.id === branch.id ? 3 : 9);
  }
  assert.equal((await getLocationQuantitiesByProduct(db, shop.id, primary, [product])).get(product.id), 70);
  console.log("Location stock scale integration passed: branch/primary parity, thresholds, missing stock and variant exclusion");
} finally {
  await db.locationStock.deleteMany({ where: { shopId: shop.id } });
  await db.productSellingUnit.deleteMany({ where: { shopId: shop.id } });
  await db.product.deleteMany({ where: { shopId: shop.id } });
  await db.storeLocation.deleteMany({ where: { shopId: shop.id } });
  await db.shop.delete({ where: { id: shop.id } });
  await db.$disconnect();
}

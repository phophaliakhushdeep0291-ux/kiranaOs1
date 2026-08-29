import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import db from "../src/db.js";
import "../src/verticals/restaurant/recipes/recipes.guard.js";
import { productData } from "./integration/factories.js";
import { resolveOperationalLocation } from "../src/modules/stores/location-context.service.js";
import { saveRecipe } from "../src/verticals/restaurant/recipes/recipes.service.js";
import { confirmBill } from "../src/modules/bills/bills.service.js";

/**
 * A cooked dish is not a thing anybody stocks.
 *
 * Nobody buys, stores or counts a plate of paneer tikka. The paneer is what
 * leaves the fridge, and `recipes.guard.js` is what moves it. But billing also
 * decremented the DISH, because a dish is an ordinary Product and the shared
 * stock path has no idea it is different — so one sale moved stock twice: once
 * against an ingredient that is real, and once against a number that means
 * nothing.
 *
 * Nothing ever puts that number back. There is no purchase order for cooked
 * paneer tikka, so a busy kitchen's dishes march further negative every service
 * and the store room fills with rows a shopkeeper cannot act on. The dish's own
 * availability already ignores that number — `dishIsOrderable` treats a
 * cooked-to-order dish as having no stock of its own — so the decrement side
 * was the half that disagreed.
 *
 * A menu item WITHOUT a recipe is a different thing and is deliberately left
 * alone: a bottled drink sold off the menu really is bought, stored and counted.
 * Having a recipe is what says "this is assembled here", and that is the line.
 */

const shop = await db.shop.create({ data: {
  name: `Dish stock ${Date.now()}`, ownerName: "Owner", city: "City", address: "Address",
  settingsJson: JSON.stringify({ businessProfile: { businessType: "restaurant" } }),
} });
const location = await resolveOperationalLocation(shop.id);

async function sellable(name, price, stock) {
  const product = await db.product.create({ data: productData(shop.id, { name, defaultPricePerRateUnit: price, stockBaseQty: stock }) });
  await db.productSellingUnit.create({ data: {
    shopId: shop.id, productId: product.id, name: "piece", unitType: "piece", unitCode: `piece-${product.id}`,
    conversionToBase: 1, defaultPrice: price, isDefault: true,
  } });
  return product;
}

const paneer = await db.product.create({ data: productData(shop.id, { name: "Paneer", defaultPricePerRateUnit: 400, stockBaseQty: 1000 }) });
const tikka = await sellable("Paneer tikka", 260, 10);
const cola = await sellable("Bottled cola", 40, 24);

// One portion of tikka takes 100g of paneer.
await saveRecipe(shop.id, tikka.id, [{ ingredientProductId: paneer.id, qtyBase: 100 }]);

const sell = (product, quantity, price) => confirmBill(shop.id, {
  clientBillId: randomUUID(), billType: "normal_sale", gstMode: "none", customerName: "Walk-in",
  discount: 0, locationId: location.id,
  items: [{ productId: product.id, name: product.name, quantity, enteredUnit: "piece", ratePerRateUnit: price, gstRate: 0, lineDiscount: 0 }],
  payments: [{ mode: "cash", amount: quantity * price }],
}, { deviceId: "test-till", allowStockShortfall: true });

/* ------------------------------------------- a dish assembled from a recipe */

await sell(tikka, 2, 260);

const paneerAfter = await db.product.findUniqueOrThrow({ where: { id: paneer.id } });
assert.equal(paneerAfter.stockBaseQty, 800, "two portions take 200g of paneer out of the fridge");

const tikkaAfter = await db.product.findUniqueOrThrow({ where: { id: tikka.id } });
assert.equal(
  tikkaAfter.stockBaseQty, 10,
  "the dish itself is untouched — its ingredients were consumed, and nothing stocks a cooked plate",
);

/* ------------- and no phantom ledger row claiming a plate left the store room */

const dishLedger = await db.stockLedger.findMany({ where: { shopId: shop.id, productId: tikka.id } });
assert.deepEqual(dishLedger, [], "a dish movement in the stock ledger is a movement that never happened");

const paneerLedger = await db.stockLedger.findMany({ where: { shopId: shop.id, productId: paneer.id } });
assert.ok(paneerLedger.length > 0, "the ingredient's movement is real and is recorded");

/* --------------------------------- a menu item with no recipe is still stock */

await sell(cola, 3, 40);
const colaAfter = await db.product.findUniqueOrThrow({ where: { id: cola.id } });
assert.equal(
  colaAfter.stockBaseQty, 21,
  "a bottled drink off the menu is bought, stored and counted like any other product",
);

/* ------------------------------------------------- selling twice is additive */

await sell(tikka, 1, 260);
assert.equal(
  (await db.product.findUniqueOrThrow({ where: { id: paneer.id } })).stockBaseQty, 700,
  "a third portion takes another 100g",
);
assert.equal(
  (await db.product.findUniqueOrThrow({ where: { id: tikka.id } })).stockBaseQty, 10,
  "and the dish still never moves",
);

/* ------------------------------------- the flag the store room already reads */

// The inventory screen has always hidden untracked rows and left them out of
// its totals; nothing could set the column, so it never fired. Writing a recipe
// is what sets it, because writing a recipe is the statement that this thing is
// assembled here rather than bought in.
assert.equal(
  (await db.product.findUniqueOrThrow({ where: { id: tikka.id } })).stockTrackingEnabled, false,
  "a dish with a recipe is not tracked as stock",
);
assert.equal(
  (await db.product.findUniqueOrThrow({ where: { id: cola.id } })).stockTrackingEnabled, true,
  "a bottled drink with no recipe is still counted",
);

/* ---------------- stale clients cannot manually move a cooked dish as stock */

const { recordPurchase, recordDamage, correctStock } = await import("../src/modules/inventory/inventory.service.js");
for (const action of [
  () => recordPurchase(shop.id, { productId: tikka.id, quantity: 1, enteredUnit: "piece", billAmount: 260 }),
  () => recordDamage(shop.id, { productId: tikka.id, quantity: 1, enteredUnit: "piece", note: "test" }),
  () => correctStock(shop.id, { productId: tikka.id, newStockBaseQty: 12, note: "test" }),
]) {
  await assert.rejects(action, (error) => error?.code === "PRODUCT_STOCK_NOT_TRACKED");
}
assert.equal(
  (await db.product.findUniqueOrThrow({ where: { id: tikka.id } })).stockBaseQty,
  10,
  "manual stock endpoints cannot restore the fictitious plate balance",
);

const { getInventory } = await import("../src/modules/inventory/inventory.service.js");
const storeRoom = await getInventory(shop.id);
const shelved = storeRoom.map((row) => row.name);
assert.ok(shelved.includes("Bottled cola"), "the store room lists what the shop actually stocks");
assert.ok(shelved.includes("Paneer"), "including the ingredients a dish is made from");
const dishRow = storeRoom.find((row) => row.name === "Paneer tikka");
assert.equal(
  dishRow?.stockTrackingEnabled, false,
  "and marks the cooked dish untracked, so the screen leaves it out of the shelf and its totals",
);

/* ------------------------------- clearing the recipe hands the stock back */

const { deleteRecipe } = await import("../src/verticals/restaurant/recipes/recipes.service.js");
await deleteRecipe(shop.id, tikka.id);
assert.equal(
  (await db.product.findUniqueOrThrow({ where: { id: tikka.id } })).stockTrackingEnabled, true,
  "nobody assembles it here any more, so it goes back to being an ordinary counted product",
);

/* ------------------ a dish with NO recipe: the live store room's actual case */

// This is what the Krish Store screenshot showed: Dal Fry, Gulab Jamun and
// Coffee sitting in the store room at -1 and -2, none of them carrying a
// recipe because nobody had written one yet. Keying "is this stock" on recipes
// missed every one of them — a kitchen puts dishes on the menu long before it
// writes them down, and Dal Fry is no more stock on day one than on day thirty.
const { updateDishMenu } = await import("../src/verticals/restaurant/menu/menu.service.js");

const dalFry = await sellable("Dal Fry", 180, 0);
assert.equal(
  (await db.product.findUniqueOrThrow({ where: { id: dalFry.id } })).stockTrackingEnabled, true,
  "an ordinary product starts tracked, whatever trade the shop is in",
);

await updateDishMenu(shop.id, dalFry.id, { menuCourse: "Main Course" });
assert.equal(
  (await db.product.findUniqueOrThrow({ where: { id: dalFry.id } })).stockTrackingEnabled, false,
  "putting it on the menu is what says the kitchen makes it — no recipe required",
);

await sell(dalFry, 2, 180);
assert.equal(
  (await db.product.findUniqueOrThrow({ where: { id: dalFry.id } })).stockBaseQty, 0,
  "and selling two does not drive it to -2",
);
assert.ok(
  !(await getInventory(shop.id)).some((row) => row.name === "Dal Fry" && row.stockTrackingEnabled !== false),
  "so the store room stops listing it as something to count",
);

/* ------------------- an owner's override survives an ordinary menu edit */

const { updateProduct } = await import("../src/modules/products/products.service.js");

const water = await sellable("Mineral Water", 20, 48);
await updateDishMenu(shop.id, water.id, { menuCourse: "Beverages" });
assert.equal(
  (await db.product.findUniqueOrThrow({ where: { id: water.id } })).stockTrackingEnabled, false,
  "putting a bottle on the menu untracks it like anything else — the rule cannot read minds",
);

// Which is why the owner has to be able to say otherwise. A bottle really is
// bought, stored and counted, and this is the path the product form uses: if the
// API drops the field, the toggle is a decoration and the shopkeeper is stuck
// with a drink they cannot count.
const { updateProductSchema } = await import("../src/modules/products/products.schema.js");
const edit = updateProductSchema.parse({ stockTrackingEnabled: true });
assert.equal(
  edit.stockTrackingEnabled, true,
  "zod strips what it does not declare, so the schema is where a silent drop would happen",
);
await updateProduct(shop.id, water.id, edit);
await updateDishMenu(shop.id, water.id, { menuCourse: "Drinks" });
assert.equal(
  (await db.product.findUniqueOrThrow({ where: { id: water.id } })).stockTrackingEnabled, true,
  "renaming its course must not silently undo the owner's decision",
);
await sell(water, 3, 20);
assert.equal(
  (await db.product.findUniqueOrThrow({ where: { id: water.id } })).stockBaseQty, 45,
  "and a genuinely stocked menu item keeps counting",
);

console.log("dish-stock-is-not-inventory: ok");

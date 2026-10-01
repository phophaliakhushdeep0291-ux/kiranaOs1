import assert from "node:assert/strict";
import db from "../src/db.js";
import { getRecipe } from "../src/verticals/restaurant/recipes/recipes.service.js";

// A dish costed a bottled ingredient at its price per BOTTLE for every gram.
//
// A recipe is written in base units (50 g of mayonnaise) while cost is held per
// RATE unit (₹250 a bottle), so the cost is converted to a per-gram figure first.
// That went through the unit table inside a try/catch that falls back to "costs at
// par" — dividing by 1 — for a unit it does not know. The restaurant trade's own
// unit list offers "bottle", and the product service copies the default pack's
// type into `rateUnit`, so every bottled or packed ingredient took that fallback:
// 50 g of a ₹250 bottle costed ₹12,500 instead of ₹12.50, and the sandwich
// "cost" a few hundred times its menu price.
//
// The code's own comment already said the conversion should be "the product's
// own default" selling unit. Not a throw: the silent factor of 1 is the failure.

async function main() {
  const shop = await db.shop.create({ data: { name: `RCP ${Date.now()}`, ownerName: "o", city: "c", address: "a" } });
  try {
    const dish = await db.product.create({
      data: {
        shopId: shop.id, name: "Paneer Sandwich", category: "snacks",
        baseUnit: "piece", rateUnit: "piece", displayUnit: "piece",
        stockBaseQty: 0, defaultPricePerRateUnit: 120, costPerRateUnit: 0,
        packagingMode: "pooled",
      },
    });
    const component = (ingredient, qtyBase) => db.dishRecipeComponent.create({
      data: {
        shopId: shop.id, dishProductId: dish.id, ingredientProductId: ingredient.id,
        ingredientName: ingredient.name, qtyBase, wastagePct: 0, optional: false,
      },
    });

    // ── a loose ingredient: kg ───────────────────────────────────────
    // Costed before any packed ingredient exists, so this assertion reads the
    // same against the code before and after the fix.
    const paneer = await db.product.create({
      data: {
        shopId: shop.id, name: "Paneer", category: "dairy",
        baseUnit: "g", rateUnit: "kg", displayUnit: "kg",
        stockBaseQty: 2000, defaultPricePerRateUnit: 450, costPerRateUnit: 400,
        packagingMode: "pooled",
      },
    });
    await component(paneer, 100);
    assert.equal((await getRecipe(shop.id, dish.id)).ingredientCost, 40, "100 g of paneer at ₹400/kg is ₹40");

    // ── a bottled ingredient, as the product form makes it ───────────
    const mayo = await db.product.create({
      data: {
        shopId: shop.id, name: "Mayonnaise 1 kg bottle", category: "other",
        baseUnit: "gram", rateUnit: "bottle", displayUnit: "bottle 1 kg",
        stockBaseQty: 3000, defaultPricePerRateUnit: 275, costPerRateUnit: 250,
        packagingMode: "pooled",
      },
    });
    await db.productSellingUnit.create({
      data: {
        shopId: shop.id, productId: mayo.id, name: "bottle 1 kg",
        unitType: "bottle", unitCode: "bottle-1-kg", packSizeValue: 1, packSizeUnit: "kg",
        conversionToBase: 1000, defaultPrice: 275, costPrice: 250, isDefault: true,
      },
    });
    await component(mayo, 50);

    const recipe = await getRecipe(shop.id, dish.id);
    // 50 g of a ₹250, 1000 g bottle is ₹12.50; with the paneer, ₹52.50.
    assert.equal(recipe.ingredientCost, 52.5, "the sandwich costs ₹52.50 in ingredients, not ₹12,540");
    assert.equal(recipe.portionsPossible, 20, "stock is still counted in base units: 2000 g of paneer is 20 portions");

    console.log("recipe-cost-pack-rate-unit.examples.js OK");
  } finally {
    // Best-effort teardown. A throw in here would mask a real assertion failure
    // from the body, which is the only error worth reading.
    for (const remove of [
      () => db.dishRecipeComponent.deleteMany({ where: { shopId: shop.id } }),
      () => db.locationStock.deleteMany({ where: { shopId: shop.id } }),
      () => db.productSellingUnit.deleteMany({ where: { shopId: shop.id } }),
      () => db.product.deleteMany({ where: { shopId: shop.id } }),
      () => db.changeLog.deleteMany({ where: { shopId: shop.id } }),
      () => db.auditLog.deleteMany({ where: { shopId: shop.id } }),
      () => db.subscription.deleteMany({ where: { shopId: shop.id } }),
      () => db.storeLocation.deleteMany({ where: { shopId: shop.id } }),
      () => db.shop.delete({ where: { id: shop.id } }),
    ]) {
      await remove().catch(() => {});
    }
  }
}

await main();

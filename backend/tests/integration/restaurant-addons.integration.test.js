import test, { after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { createIntegrationContext, resetDatabase, assertFailure, assertSuccess } from "./setup.js";
import { createProduct, createTenant, login } from "./factories.js";

const ctx = await createIntegrationContext();

if (ctx.skip) {
  test("restaurant add-on integration tests skipped", { skip: ctx.reason }, () => {});
} else {
  after(async () => ctx.close());
  beforeEach(async () => resetDatabase(ctx.db));

  async function restaurantFixture() {
    const tenant = await createTenant(ctx.db);
    const auth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
    const location = await ctx.db.storeLocation.create({
      data: { shopId: tenant.shop.id, code: "BRANCH-2", name: "Branch 2", isPrimary: false },
    });
    const dish = await createProduct(ctx.db, tenant.shop.id, {
      name: "Paneer Burger",
      stockBaseQty: 20,
      defaultPricePerRateUnit: 120,
    });
    const recipeIngredient = await createProduct(ctx.db, tenant.shop.id, {
      name: "Paneer",
      baseUnit: "kg",
      displayUnit: "kg",
      rateUnit: "kg",
      stockBaseQty: 10,
    });
    const addonIngredient = await createProduct(ctx.db, tenant.shop.id, {
      name: "Cheese",
      baseUnit: "kg",
      displayUnit: "kg",
      rateUnit: "kg",
      stockBaseQty: 10,
    });
    await ctx.db.locationStock.createMany({
      data: [
        { shopId: tenant.shop.id, locationId: location.id, productId: dish.id, stockBaseQty: 5 },
        { shopId: tenant.shop.id, locationId: location.id, productId: recipeIngredient.id, stockBaseQty: 3 },
        { shopId: tenant.shop.id, locationId: location.id, productId: addonIngredient.id, stockBaseQty: 2 },
      ],
    });
    const half = await ctx.db.productSellingUnit.create({
      data: {
        shopId: tenant.shop.id,
        productId: dish.id,
        name: "Half",
        unitType: "portion",
        unitCode: "half",
        conversionToBase: 0.5,
        defaultPrice: 60,
        isDefault: true,
      },
    });
    await ctx.db.dishRecipeComponent.create({
      data: {
        shopId: tenant.shop.id,
        dishProductId: dish.id,
        ingredientProductId: recipeIngredient.id,
        ingredientName: recipeIngredient.name,
        qtyBase: 0.4,
      },
    });
    const group = await ctx.db.menuAddonGroup.create({
      data: { shopId: tenant.shop.id, name: "Cheese choice", minSelect: 1, maxSelect: 1 },
    });
    const option = await ctx.db.menuAddonOption.create({
      data: {
        shopId: tenant.shop.id,
        groupId: group.id,
        name: "Extra cheese",
        priceDelta: 10,
        linkedProductId: addonIngredient.id,
        linkedQtyBase: 0.1,
      },
    });
    await ctx.db.productAddonGroup.create({
      data: { shopId: tenant.shop.id, productId: dish.id, groupId: group.id },
    });
    return { tenant, auth, location, dish, recipeIngredient, addonIngredient, half, option };
  }

  describe("restaurant bill configuration", () => {
    test("keeps an explicit portion price authoritative when a dish also has an MRP", async () => {
      const fixture = await restaurantFixture();
      await ctx.db.product.update({ where: { id: fixture.dish.id }, data: { mrp: 420 } });
      await ctx.db.menuAddonOption.update({ where: { id: fixture.option.id }, data: { priceDelta: 85 } });
      const large = await ctx.db.productSellingUnit.create({
        data: {
          shopId: fixture.tenant.shop.id,
          productId: fixture.dish.id,
          name: "Large",
          unitType: "portion",
          unitCode: "portion-large",
          conversionToBase: 1.4,
          defaultPrice: 590,
          isDefault: false,
        },
      });

      const response = await ctx.post("/api/bills/confirm", {
        locationId: fixture.location.id,
        billType: "normal_sale",
        gstMode: "inclusive",
        customerName: "Walk-in",
        items: [{
          productId: fixture.dish.id,
          name: fixture.dish.name,
          quantity: 1,
          enteredUnit: "Large",
          sellingUnitId: large.id,
          sellingUnitCode: large.unitCode,
          baseRatePerRateUnit: 590,
          ratePerRateUnit: 675,
          gstRate: 0,
          lineDiscount: 0,
          addons: [{ optionId: fixture.option.id, quantity: 1 }],
        }],
        discount: 0,
        actualAmount: 675,
        buyerPaidAmount: 675,
        waivedAmount: 0,
        payments: [{ mode: "cash", amount: 675 }],
      }, { token: fixture.auth.accessToken });

      const bill = assertSuccess(response, 201);
      assert.equal(bill.grandTotal, 675);
      assert.equal(bill.items[0].ratePerRateUnit, 675);
      assert.deepEqual(
        bill.items[0].addons.map(({ name, price, quantity }) => ({ name, price, quantity })),
        [{ name: "Extra cheese", price: 85, quantity: 1 }],
      );

      const branchStock = await ctx.db.locationStock.findMany({ where: { locationId: fixture.location.id } });
      const branchQty = new Map(branchStock.map((row) => [row.productId, row.stockBaseQty]));
      assert.equal(branchQty.get(fixture.dish.id), 3.6, "one Large consumes 1.4 dish units");
      assert.equal(branchQty.get(fixture.recipeIngredient.id), 2.44, "recipe follows the Large portion factor");
      assert.equal(branchQty.get(fixture.addonIngredient.id), 1.9, "one selected add-on consumes stock once");
    });

    test("server reprices add-ons and consumes portion-aware stock at the selected store", async () => {
      const fixture = await restaurantFixture();
      const response = await ctx.post("/api/bills/confirm", {
        locationId: fixture.location.id,
        billType: "normal_sale",
        gstMode: "inclusive",
        customerName: "Walk-in",
        items: [{
          productId: fixture.dish.id,
          name: fixture.dish.name,
          quantity: 2,
          enteredUnit: "Half",
          sellingUnitId: fixture.half.id,
          sellingUnitCode: "half",
          baseRatePerRateUnit: 60,
          ratePerRateUnit: 60,
          gstRate: 0,
          lineDiscount: 0,
          addons: [{
            optionId: fixture.option.id,
            quantity: 1,
            name: "Client-forged label",
            groupName: "Client-forged group",
            price: 0,
          }],
        }],
        discount: 0,
        actualAmount: 140,
        buyerPaidAmount: 140,
        waivedAmount: 0,
        payments: [{ mode: "cash", amount: 140 }],
      }, { token: fixture.auth.accessToken });

      const bill = assertSuccess(response, 201);
      assert.equal(bill.grandTotal, 140);
      assert.equal(bill.items[0].ratePerRateUnit, 70);
      assert.deepEqual(
        bill.items[0].addons.map(({ groupName, name, price, quantity }) => ({ groupName, name, price, quantity })),
        [{ groupName: "Cheese choice", name: "Extra cheese", price: 10, quantity: 1 }],
      );

      const branchStock = await ctx.db.locationStock.findMany({
        where: { locationId: fixture.location.id },
      });
      const branchQty = new Map(branchStock.map((row) => [row.productId, row.stockBaseQty]));
      assert.equal(branchQty.get(fixture.dish.id), 4, "two half portions consume one dish base unit");
      assert.equal(branchQty.get(fixture.recipeIngredient.id), 2.6, "recipe consumes 2 x 0.5 x 0.4 kg");
      assert.equal(branchQty.get(fixture.addonIngredient.id), 1.8, "option consumes 2 x 0.1 kg");

      const ledgers = await ctx.db.stockLedger.findMany({ where: { billId: bill.id } });
      const byAction = new Map(ledgers.map((row) => [row.action, row]));
      assert.equal(byAction.get("sale")?.changeBaseQty, -1);
      assert.equal(byAction.get("recipe_use")?.changeBaseQty, -0.4);
      assert.equal(byAction.get("addon_use")?.changeBaseQty, -0.2);
      assert.equal(byAction.get("recipe_use")?.locationId, fixture.location.id);
      assert.equal(byAction.get("addon_use")?.locationId, fixture.location.id);
    });

    test("required option groups reject incomplete bills before any stock moves", async () => {
      const fixture = await restaurantFixture();
      const response = await ctx.post("/api/bills/confirm", {
        locationId: fixture.location.id,
        billType: "normal_sale",
        gstMode: "inclusive",
        customerName: "Walk-in",
        items: [{
          productId: fixture.dish.id,
          name: fixture.dish.name,
          quantity: 1,
          enteredUnit: "Half",
          sellingUnitId: fixture.half.id,
          baseRatePerRateUnit: 60,
          ratePerRateUnit: 60,
          gstRate: 0,
          lineDiscount: 0,
          addons: [],
        }],
        discount: 0,
        actualAmount: 60,
        buyerPaidAmount: 60,
        waivedAmount: 0,
        payments: [{ mode: "cash", amount: 60 }],
      }, { token: fixture.auth.accessToken });

      const error = assertFailure(response, 409);
      assert.equal(error.code, "MENU_ADDON_SELECTION_INVALID");
      assert.equal(await ctx.db.bill.count(), 0);
      assert.equal(await ctx.db.stockLedger.count(), 0);
    });
  });
}

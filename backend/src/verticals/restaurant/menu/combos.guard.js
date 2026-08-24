import { registerSaleGuard } from "../../../shared/sale-guards.js";
import { decrementLocationInventory } from "../../../modules/stores/location-context.service.js";
import { round2 } from "../../../utils/money.js";
import { aggregateRecipeConsumption } from "../recipes/recipes.guard.js";
import { comboComponentsFor, expandComboPortions } from "./combos.service.js";
import { stockLedgerProvenance } from "../../../modules/inventory/stock-ledger-provenance.js";

/**
 * What selling a combo actually takes out of the kitchen.
 *
 * Selling a thali is not one event, it is several: the guest receives two roti,
 * dal, rice and a sweet, and every one of those either has a recipe of its own or
 * is a stocked good. Nothing else in the system knows that, because a combo is
 * priced and billed as a single Product — which is exactly what keeps the money
 * path simple, and exactly why stock needs this guard.
 *
 * The expansion is TWO levels and no more:
 *
 *   combo → component dishes → those dishes' ingredients
 *
 * The second level is delegated to the recipe layer's own arithmetic rather than
 * reimplemented, so a thali's dal depletes precisely what ordering that dal
 * à la carte would. Components that have no recipe are stocked goods — a bottled
 * drink in a meal deal — and are decremented directly.
 *
 * Depth cannot exceed two because combos.service.js refuses to store a combo
 * inside a combo, so this never has to detect a cycle at sale time, when the only
 * available answer would be to refuse a guest's bill.
 */

export function registerComboConsumptionGuard() {
  registerSaleGuard(async ({ shopId, tx, items, productMap, location }) => {
    const productIds = [...new Set(items.map((item) => item.productId).filter(Boolean))];
    if (productIds.length === 0) return null;

    const components = await comboComponentsFor(tx, shopId, productIds);
    // The overwhelmingly common case: no combo on this bill, and a shop with no
    // combos at all pays one indexed findMany that returns nothing.
    if (components.length === 0) return null;

    const comboIds = new Set(components.map((row) => row.comboProductId));

    /*
     * Portions, scaled by the chosen variation the same way the recipe guard does
     * it. A half thali must take half of everything out of the kitchen, and the
     * declared conversionToBase on the selling unit is the one place that ratio
     * lives — re-deriving it here from the name would be a second answer.
     */
    const sellingUnits = await tx.productSellingUnit.findMany({
      where: { shopId, productId: { in: [...comboIds] }, isActive: true },
    });
    const unitById = new Map(sellingUnits.map((unit) => [unit.id, unit]));
    const unitByCode = new Map(sellingUnits.map((unit) => [`${unit.productId}:${unit.unitCode}`, unit]));
    const defaultUnitByProduct = new Map();
    for (const unit of sellingUnits) {
      const current = defaultUnitByProduct.get(unit.productId);
      if (!current || unit.isDefault) defaultUnitByProduct.set(unit.productId, unit);
    }

    const comboPortions = new Map();
    for (const item of items) {
      if (!item.productId || !comboIds.has(item.productId)) continue;
      const unit = (item.sellingUnitId ? unitById.get(item.sellingUnitId) : null)
        ?? (item.sellingUnitCode ? unitByCode.get(`${item.productId}:${item.sellingUnitCode}`) : null)
        ?? defaultUnitByProduct.get(item.productId)
        ?? null;
      const portions = round2((Number(item.quantity) || 0) * Number(unit?.conversionToBase ?? 1));
      if (portions > 0) comboPortions.set(item.productId, round2((comboPortions.get(item.productId) ?? 0) + portions));
    }
    if (comboPortions.size === 0) return null;

    const expanded = expandComboPortions(comboPortions, components);
    if (expanded.length === 0) return null;

    // Level two: the components' own recipes, through the recipe layer's arithmetic
    // rather than a second copy of it.
    const componentIds = expanded.map((row) => row.componentProductId);
    const recipeComponents = await tx.dishRecipeComponent.findMany({
      where: { shopId, dishProductId: { in: [...new Set(componentIds)] } },
    });
    const dishPortions = new Map(expanded.map((row) => [row.componentProductId, row.portions]));
    const ingredientConsumption = aggregateRecipeConsumption(dishPortions, recipeComponents);

    /*
     * A component with a recipe is consumed through its ingredients — deducting
     * the dish itself as well would charge the kitchen twice for one plate. A
     * component with no recipe is a stocked good and is the thing that moves.
     */
    const dishesWithRecipes = new Set(recipeComponents.map((row) => row.dishProductId));
    const directStock = expanded.filter((row) => !dishesWithRecipes.has(row.componentProductId));

    if (ingredientConsumption.length === 0 && directStock.length === 0) return null;

    return {
      onConfirmed: async ({ tx: confirmTx, bill, location: confirmedLocation, actor }) => {
        const target = confirmedLocation ?? location;
        const moves = [
          ...ingredientConsumption.map((row) => ({
            productId: row.ingredientProductId,
            name: row.ingredientName,
            qtyBase: row.qtyBase,
            reason: "combo recipe",
          })),
          ...directStock.map((row) => ({
            productId: row.componentProductId,
            name: row.componentName,
            qtyBase: row.portions,
            reason: "combo component",
          })),
        ];

        for (const move of moves) {
          const product = await confirmTx.product.findFirst({
            where: { id: move.productId, shopId, deletedAt: null },
          });
          // Deleted from the catalogue between the combo being built and sold.
          // Nothing to move, and a guest's bill is not where to raise it — the
          // kitchen stock screen already reports the broken line.
          if (!product) continue;
          const stockResult = await decrementLocationInventory(confirmTx, {
            shopId,
            location: target,
            product,
            quantityBase: move.qtyBase,
            // A kitchen that has run short must still be able to serve the guest
            // in front of it; the shortfall is recorded, not refused.
            allowShortfall: true,
          });
          await confirmTx.stockLedger.create({
            data: {
              shopId,
              locationId: target.id,
              productId: move.productId,
              productName: product.name ?? move.name,
              ...stockLedgerProvenance(actor),
              /*
               * "recipe_use", not "sale" and not a new action of our own.
               *
               * Not "sale": the combo's own line is the sale, and counting these
               * as sales too would double-count every thali in the reports.
               *
               * Not "combo_use": the assurance rule that flags stock moved after
               * a daily closing lock skips exactly "sale" and "recipe_use". A new
               * action would raise a finding for every component of every combo
               * served after the lock — which is the same event this class already
               * describes: the kitchen consuming stock to fulfil a bill.
               */
              action: "recipe_use",
              changeBaseQty: -move.qtyBase,
              oldStockBaseQty: stockResult.oldStock,
              newStockBaseQty: stockResult.newStock,
              billId: bill.id,
              sourceType: "bill",
              sourceId: bill.id,
              /*
               * Prefixed "combo", deliberately NOT "recipe".
               *
               * The recipe guard writes `recipe:<bill>:<productId>` for the same
               * bill. A dish ordered both à la carte AND inside a thali produces a
               * movement from each guard for one ingredient, and sharing the key
               * would make the second a duplicate and silently under-deplete the
               * kitchen by a portion.
               */
              idempotencyKey: `combo:${bill.id}:${move.productId}`,
              note: `${move.reason}: ${move.name}`,
            },
          });
        }
      },
    };
  });
}

// Self-registering, like the recipe and add-on guards: importing this module is
// what puts combo expansion into the shared sale path, so billing never names a
// trade and a shop with no combos pays one indexed query that returns nothing.
registerComboConsumptionGuard();

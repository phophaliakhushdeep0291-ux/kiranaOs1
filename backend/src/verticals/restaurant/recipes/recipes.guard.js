import { registerSaleGuard } from "../../../shared/sale-guards.js";
import { round2 } from "../../../utils/money.js";
import { toBaseQty } from "../../../utils/units.js";
import { effectiveQtyPerPortion } from "./recipes.service.js";

/**
 * The restaurant's condition on a sale: selling a dish consumes its ingredients.
 *
 * This is the half that makes a kitchen's stock figures true. Core billing
 * decrements what was sold, which for a restaurant is a plate of butter chicken
 * — a thing nobody buys, stores or runs out of. The chicken, cream and butter
 * are what leave the fridge, and until this guard existed nothing moved them.
 *
 * It never refuses a sale. A guest is sitting at a table and the food has been
 * cooked; discovering at the till that the recorded paneer went negative is not
 * a reason to withhold their bill. Stock is allowed to go negative for exactly
 * the reason the counter already allows it elsewhere — the deficit is the true
 * shape of the drift, and hiding it at zero would make the reconciliation
 * impossible. What runs low is reported before service, on the kitchen stock
 * screen, which is where the decision can still be acted on.
 *
 * Registered rather than imported by billing, so the shared path never names a
 * trade. A shop with no recipes pays one `findMany` that returns nothing.
 */

/**
 * How much of each ingredient one bill consumes.
 *
 * Pure and exported so the arithmetic that moves a restaurant's stock can be
 * tested without a database. Aggregated by ingredient rather than by line: a
 * bill with three dishes that all use ginger-garlic paste must produce ONE
 * movement for it, or the ledger reads like three separate kitchen events.
 */
export function aggregateRecipeConsumption(dishPortions, components) {
  const byIngredient = new Map();
  for (const component of components ?? []) {
    const portions = Number(dishPortions.get(component.dishProductId) ?? 0);
    if (portions <= 0) continue;
    const qty = effectiveQtyPerPortion(component) * portions;
    if (qty <= 0) continue;
    const existing = byIngredient.get(component.ingredientProductId);
    if (existing) {
      existing.qtyBase = round2(existing.qtyBase + qty);
    } else {
      byIngredient.set(component.ingredientProductId, {
        ingredientProductId: component.ingredientProductId,
        ingredientName: component.ingredientName,
        qtyBase: round2(qty),
      });
    }
  }
  return [...byIngredient.values()].filter((row) => row.qtyBase > 0);
}

export function registerRecipeConsumptionGuard() {
  registerSaleGuard(async ({ shopId, tx, items, productMap }) => {
    const dishIds = items.map((item) => item.productId).filter(Boolean);
    if (dishIds.length === 0) return null;

    const components = await tx.dishRecipeComponent.findMany({
      where: { shopId, dishProductId: { in: [...new Set(dishIds)] } },
    });
    if (components.length === 0) return null;

    // Portions, in the dish's own base unit. For a dish that is what a portion
    // IS — one plate, one base unit — which is why a recipe written "per portion"
    // and stock kept in base units need no reconciliation between them.
    const dishPortions = new Map();
    for (const item of items) {
      const product = item.productId ? productMap[item.productId] : null;
      if (!product) continue;
      const portions = toBaseQty(Number(item.quantity) || 0, item.enteredUnit, product.baseUnit);
      if (portions > 0) dishPortions.set(product.id, (dishPortions.get(product.id) ?? 0) + portions);
    }

    const consumption = aggregateRecipeConsumption(dishPortions, components);
    if (consumption.length === 0) return null;

    return {
      onConfirmed: async ({ tx: confirmTx, bill }) => {
        for (const row of consumption) {
          // updateMany rather than read-then-write: two waiters ringing up the
          // same dish at once must subtract twice, and an absolute write would
          // lose one of them.
          const updated = await confirmTx.product.updateMany({
            where: { id: row.ingredientProductId, shopId, deletedAt: null },
            data: { stockBaseQty: { decrement: row.qtyBase } },
          });
          // The ingredient was deleted from the catalogue between the recipe
          // being written and the dish being sold. Nothing to move, and the
          // guest's bill is not the place to raise it — the kitchen stock screen
          // already reports the recipe line as broken.
          if (updated.count !== 1) continue;

          const fresh = await confirmTx.product.findFirst({
            where: { id: row.ingredientProductId, shopId },
            select: { stockBaseQty: true, name: true, baseUnit: true },
          });
          const newStock = round2(Number(fresh?.stockBaseQty ?? 0));
          await confirmTx.stockLedger.create({
            data: {
              shopId,
              locationId: bill.locationId ?? null,
              productId: row.ingredientProductId,
              productName: fresh?.name ?? row.ingredientName,
              // Its own action, not "sale": what left the fridge is an
              // ingredient, and a report that called it a sale would double-count
              // against the dish that was actually sold.
              action: "recipe_use",
              changeBaseQty: -row.qtyBase,
              oldStockBaseQty: round2(newStock + row.qtyBase),
              newStockBaseQty: newStock,
              billId: bill.id,
              sourceType: "bill",
              sourceId: bill.id,
              // Derived from the bill, so a sync replay of the same bill cannot
              // deplete the kitchen twice.
              idempotencyKey: `recipe:${bill.id}:${row.ingredientProductId}`,
              clientMovementId: `recipe:${bill.id}:${row.ingredientProductId}`,
              note: `Used by ${bill.billNo}`,
            },
          });
        }
      },
    };
  });
}

// How shared billing learns that a dish has ingredients without importing the
// restaurant pack. Loading this module is what registers the guard, and the only
// way to reach it is through the restaurant pack's routes — so a shop with no
// recipes never runs it. Same arrangement as the pharmacy's schedule guard.
registerRecipeConsumptionGuard();

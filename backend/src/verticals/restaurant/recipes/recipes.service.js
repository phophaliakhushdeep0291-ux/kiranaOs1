import db from "../../../db.js";
import { AppError } from "../../../middleware/error.js";
import { round2 } from "../../../utils/money.js";
import { rateUnitToBase } from "../../../utils/units.js";
import { listProducts } from "../../../modules/products/products.service.js";

/**
 * The recipe book, and the stock question only it can answer.
 *
 * A restaurant's inventory is a lie until this exists. The POS knows it sold
 * four butter chickens; nobody buys, stores or runs out of a butter chicken. The
 * kitchen buys chicken, cream and butter, and those are what disappear during
 * service — so "how much is left?" cannot be answered from the dish at all.
 *
 * A recipe line says: one portion of this dish consumes this much of that
 * ingredient, in the ingredient's own base unit. From that single fact three
 * things follow, and this module produces all three:
 *
 *   1. selling a dish moves real stock  (see recipes.guard.js)
 *   2. "we can still make 6 of these"   (portionsPossible)
 *   3. "order more paneer"              (kitchen stock alerts)
 *
 * Nothing here decides what to do about it. A dish that has run out is reported,
 * not auto-86'd: taking a dish off the menu mid-service is the manager's call,
 * and a stock figure that drifted by 200 g must not silently empty the menu.
 */

/** A dish with more components than this is a stock list, not a recipe. */
export const MAX_COMPONENTS_PER_DISH = 60;

/** Below this many portions a dish is called out before it runs out mid-service. */
export const LOW_PORTIONS_THRESHOLD = 5;

/**
 * What one portion really costs the kitchen, including what is trimmed away.
 *
 * Wastage is part of consumption, not an accounting adjustment: the 100 g of
 * paneer in the dish leaves the fridge as 110 g, and a stock figure that ignores
 * that is wrong by 10% every single service.
 */
export function effectiveQtyPerPortion(component) {
  const qty = Number(component?.qtyBase) || 0;
  const wastage = Number(component?.wastagePct) || 0;
  if (qty <= 0) return 0;
  // Rounded, because this number is subtracted from real stock: 100 g at 10%
  // wastage is 110.00000000000001 in binary floating point, and left alone that
  // dust accumulates through every service into a stock figure nobody can
  // reconcile. Six decimals is far finer than any kitchen weighs.
  return Math.round(qty * (1 + Math.max(0, wastage) / 100) * 1e6) / 1e6;
}

/**
 * How many more of this dish the kitchen can actually put out.
 *
 * The binding constraint is whichever ingredient runs out first, so this is a
 * minimum and not a sum. Returns null when nothing constrains the dish — a dish
 * with no recipe, or one whose only components are optional garnishes — because
 * "unlimited" and "zero" must never be confused on a kitchen screen.
 *
 * Optional components are excluded on purpose: a restaurant out of coriander can
 * still serve dal, and being told otherwise would teach the cook to ignore this
 * number entirely.
 */
export function portionsPossible(components, stockByProductId) {
  const stock = stockByProductId instanceof Map
    ? stockByProductId
    : new Map(Object.entries(stockByProductId ?? {}));

  let limit = null;
  for (const component of components ?? []) {
    if (component.optional) continue;
    const perPortion = effectiveQtyPerPortion(component);
    if (perPortion <= 0) continue;
    const available = Number(stock.get(component.ingredientProductId) ?? 0);
    const possible = Math.max(0, Math.floor(available / perPortion));
    limit = limit === null ? possible : Math.min(limit, possible);
  }
  return limit;
}

/** What the dish costs in ingredients at their current weighted cost. */
export function recipeCost(components, costPerBaseByProductId) {
  const costs = costPerBaseByProductId instanceof Map
    ? costPerBaseByProductId
    : new Map(Object.entries(costPerBaseByProductId ?? {}));
  let total = 0;
  for (const component of components ?? []) {
    total += effectiveQtyPerPortion(component) * Number(costs.get(component.ingredientProductId) ?? 0);
  }
  return round2(total);
}

/**
 * Cost of one base unit of an ingredient.
 *
 * Costs are held per *rate* unit (per kg), while a recipe is written in base
 * units (per g) — so a 100 g component costed against a ₹400/kg price without
 * this conversion would read ₹40,000. The selling unit that defines the
 * conversion is the product's own default, which is the same one the counter
 * prices against.
 */
export function costPerBaseUnit(product) {
  const cost = Number(product?.costPerRateUnit ?? 0);
  if (!Number.isFinite(cost) || cost <= 0) return 0;
  let conversion = 1;
  try {
    conversion = rateUnitToBase(product?.rateUnit ?? product?.baseUnit, product?.baseUnit);
  } catch {
    // An unrecognised unit pairing costs at par rather than throwing: a wrong
    // costing figure on one screen is a smaller failure than a kitchen page
    // that will not open.
    conversion = 1;
  }
  return Number.isFinite(conversion) && conversion > 0 ? cost / conversion : cost;
}

function serializeComponent(row) {
  return {
    id: row.id,
    dishProductId: row.dishProductId,
    ingredientProductId: row.ingredientProductId,
    ingredientName: row.ingredientName,
    qtyBase: row.qtyBase,
    wastagePct: row.wastagePct,
    optional: row.optional,
    note: row.note ?? null,
  };
}

export async function listRecipeComponents(shopId, { dishProductId } = {}) {
  const rows = await db.dishRecipeComponent.findMany({
    where: { shopId, ...(dishProductId ? { dishProductId } : {}) },
    orderBy: [{ dishProductId: "asc" }, { ingredientName: "asc" }],
  });
  return rows.map(serializeComponent);
}

/**
 * Every product this shop has, indexed by id, with the two numbers a recipe
 * needs: how much is on hand in base units, and what a base unit costs.
 */
async function loadProductIndex(shopId, locationId) {
  const products = await listProducts(shopId, { locationId });
  return new Map(products.map((product) => [product.id, product]));
}

export async function getRecipe(shopId, dishProductId, { locationId } = {}) {
  const [components, index] = await Promise.all([
    listRecipeComponents(shopId, { dishProductId }),
    loadProductIndex(shopId, locationId),
  ]);
  const dish = index.get(dishProductId);
  if (!dish) throw new AppError("Dish not found", 404);

  const stock = new Map();
  const costs = new Map();
  for (const component of components) {
    const ingredient = index.get(component.ingredientProductId);
    stock.set(component.ingredientProductId, Number(ingredient?.stockBaseQty ?? 0));
    costs.set(component.ingredientProductId, costPerBaseUnit(ingredient));
  }

  return {
    dish: { id: dish.id, name: dish.name, unit: dish.rateUnit, price: dish.defaultPricePerRateUnit },
    components: components.map((component) => {
      const ingredient = index.get(component.ingredientProductId);
      return {
        ...component,
        // Whether the ingredient still exists is a real answer, not an error: a
        // recipe outlives the catalogue row it was written against, and the cook
        // needs to be told which line to fix rather than shown a broken screen.
        ingredientMissing: !ingredient,
        baseUnit: ingredient?.baseUnit ?? null,
        stockBaseQty: Number(ingredient?.stockBaseQty ?? 0),
        perPortion: round2(effectiveQtyPerPortion(component)),
      };
    }),
    portionsPossible: portionsPossible(components, stock),
    ingredientCost: recipeCost(components, costs),
  };
}

/**
 * Save a dish's recipe as a whole.
 *
 * Replace-all rather than line-by-line edits, because a recipe is read and
 * changed as one thing ("this is what goes in it"), and a partial save would
 * leave the dish costing and depleting against a half-written list.
 */
export async function saveRecipe(shopId, dishProductId, components = []) {
  if (components.length > MAX_COMPONENTS_PER_DISH) {
    throw new AppError(`A recipe can hold ${MAX_COMPONENTS_PER_DISH} ingredients.`, 400);
  }
  const dish = await db.product.findFirst({ where: { id: dishProductId, shopId, deletedAt: null } });
  if (!dish) throw new AppError("Dish not found", 404);

  const ingredientIds = [...new Set(components.map((c) => String(c.ingredientProductId)))];
  const ingredients = ingredientIds.length
    ? await db.product.findMany({
      where: { id: { in: ingredientIds }, shopId, deletedAt: null },
      select: { id: true, name: true },
    })
    : [];
  const byId = new Map(ingredients.map((row) => [row.id, row]));
  for (const id of ingredientIds) {
    if (!byId.has(id)) throw new AppError("One of the ingredients is not in this shop's catalogue.", 400);
  }
  if (byId.has(dishProductId)) {
    // Not pedantry: a self-referencing recipe would deplete the dish twice on
    // every sale, once as stock and once as its own ingredient.
    throw new AppError("A dish cannot be an ingredient of itself.", 400);
  }

  await db.$transaction(async (tx) => {
    await tx.product.update({ where: { id: dishProductId }, data: { restaurantItemType: "prepared" } });
    if (ingredientIds.length > 0) {
      // Only classify untouched legacy rows. An explicitly packaged item may be
      // both sold as-is and used by a recipe, so the owner's choice wins.
      await tx.product.updateMany({
        where: { shopId, id: { in: ingredientIds }, restaurantItemType: null },
        data: { restaurantItemType: "ingredient" },
      });
    }
    await tx.dishRecipeComponent.deleteMany({ where: { shopId, dishProductId } });
    for (const component of components) {
      await tx.dishRecipeComponent.create({
        data: {
          shopId,
          dishProductId,
          ingredientProductId: component.ingredientProductId,
          ingredientName: byId.get(component.ingredientProductId)?.name ?? "Ingredient",
          qtyBase: Number(component.qtyBase) || 0,
          wastagePct: Number(component.wastagePct) || 0,
          optional: component.optional === true,
          note: component.note ? String(component.note).slice(0, 300) : null,
        },
      });
    }
  });

  return getRecipe(shopId, dishProductId);
}

export async function deleteRecipe(shopId, dishProductId) {
  const { count } = await db.dishRecipeComponent.deleteMany({ where: { shopId, dishProductId } });
  return { dishProductId, removed: count };
}

/**
 * Everything the kitchen needs to see before service, in one read.
 *
 * Two lists, because they answer two different questions and a cook conflates
 * them at their peril: what is running out (buy this), and what can no longer be
 * served (take this off the board). One low ingredient can empty six dishes, so
 * neither list is derivable from the other by looking at it.
 */
export async function getKitchenStock(shopId, { locationId } = {}) {
  const [components, index] = await Promise.all([
    listRecipeComponents(shopId),
    loadProductIndex(shopId, locationId),
  ]);

  const byDish = new Map();
  const usedBy = new Map();
  for (const component of components) {
    if (!byDish.has(component.dishProductId)) byDish.set(component.dishProductId, []);
    byDish.get(component.dishProductId).push(component);
    if (!usedBy.has(component.ingredientProductId)) usedBy.set(component.ingredientProductId, new Set());
    usedBy.get(component.ingredientProductId).add(component.dishProductId);
  }

  const stock = new Map();
  for (const [id, product] of index) stock.set(id, Number(product.stockBaseQty ?? 0));

  const ingredients = [...usedBy.entries()].map(([ingredientProductId, dishIds]) => {
    const product = index.get(ingredientProductId);
    const onHand = Number(product?.stockBaseQty ?? 0);
    // The shop's own alert level wins; the reorder level is the fallback so an
    // ingredient nobody set a threshold on can still raise its hand.
    const threshold = Number(product?.lowStockThreshold ?? 0) > 0
      ? Number(product.lowStockThreshold)
      : Number(product?.reorderLevel ?? 0);
    return {
      productId: ingredientProductId,
      name: product?.name ?? components.find((c) => c.ingredientProductId === ingredientProductId)?.ingredientName ?? "Ingredient",
      missing: !product,
      baseUnit: product?.baseUnit ?? null,
      stockBaseQty: round2(onHand),
      threshold: round2(threshold),
      status: onHand <= 0 ? "out" : threshold > 0 && onHand <= threshold ? "low" : "ok",
      usedInDishes: dishIds.size,
      dishIds: [...dishIds],
    };
  }).sort((a, b) => {
    const rank = { out: 0, low: 1, ok: 2 };
    return rank[a.status] - rank[b.status] || a.name.localeCompare(b.name);
  });

  const dishes = [...byDish.entries()].map(([dishProductId, dishComponents]) => {
    const dish = index.get(dishProductId);
    const possible = portionsPossible(dishComponents, stock);
    const blocking = dishComponents
      .filter((component) => !component.optional && effectiveQtyPerPortion(component) > 0)
      .filter((component) => Number(stock.get(component.ingredientProductId) ?? 0) < effectiveQtyPerPortion(component))
      .map((component) => component.ingredientName);
    return {
      dishProductId,
      name: dish?.name ?? "Dish",
      missing: !dish,
      menuCourse: dish?.menuCourse ?? null,
      menuAvailable: dish?.menuAvailable !== false,
      componentCount: dishComponents.length,
      portionsPossible: possible,
      blockedBy: blocking,
      status: possible === null ? "unknown" : possible <= 0 ? "out" : possible <= LOW_PORTIONS_THRESHOLD ? "low" : "ok",
    };
  }).sort((a, b) => {
    const rank = { out: 0, low: 1, unknown: 2, ok: 3 };
    return rank[a.status] - rank[b.status] || a.name.localeCompare(b.name);
  });

  return {
    ingredients,
    dishes,
    summary: {
      ingredientsOut: ingredients.filter((row) => row.status === "out").length,
      ingredientsLow: ingredients.filter((row) => row.status === "low").length,
      dishesOut: dishes.filter((row) => row.status === "out").length,
      dishesLow: dishes.filter((row) => row.status === "low").length,
      dishesWithRecipes: dishes.length,
    },
  };
}

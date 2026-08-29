import db from "../../../db.js";
import { AppError } from "../../../middleware/error.js";

/**
 * Combos: a thali, a meal deal, "burger + fries + coke".
 *
 * A combo needs no pricing of its own, and that is the whole design. It IS a
 * Product, sold at that product's price, taxed and reported through exactly the
 * same path as a single dish — so the cart, GST, totals, the receipt and the
 * assurance rules learn nothing new. What this module adds is the list of dishes
 * the guest actually receives, which is the part the kitchen has to cook and
 * stock has to lose.
 *
 * Depth is deliberately ONE: a component must be a plain dish, never another
 * combo. That is not a simplification for its own sake — it makes a cycle
 * impossible to write, so no expansion can loop and no thali can contain itself.
 * A shop that wants a "family pack of two thalis" lists the dishes twice, which
 * is also what the kitchen wants to read.
 */

/** More than any real thali, and a bound on what one sale can expand into. */
export const MAX_COMPONENTS_PER_COMBO = 24;

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/**
 * What one bill's combo lines expand into, in component dishes.
 *
 * Pure and exported so the arithmetic that moves a kitchen's stock can be tested
 * without a database. Aggregated by component rather than by line for the same
 * reason recipe consumption is: a bill with a thali and a separate roti must
 * produce ONE roti figure, or the kitchen ledger reads like two unrelated events.
 *
 * `comboPortions` is combo product id → portions sold (already scaled by the
 * selected variation, so a half thali is 0.5).
 */
export function expandComboPortions(comboPortions, components) {
  const byComponent = new Map();
  for (const component of components ?? []) {
    const portions = Number(comboPortions.get(component.comboProductId) ?? 0);
    if (portions <= 0) continue;
    const quantity = Number(component.quantity ?? 0);
    if (!(quantity > 0)) continue;
    const total = round2(quantity * portions);
    if (total <= 0) continue;
    const existing = byComponent.get(component.componentProductId);
    if (existing) {
      existing.portions = round2(existing.portions + total);
    } else {
      byComponent.set(component.componentProductId, {
        componentProductId: component.componentProductId,
        componentName: component.componentName,
        portions: total,
      });
    }
  }
  return [...byComponent.values()].filter((row) => row.portions > 0);
}

/**
 * What the components would cost bought separately, and what the combo saves.
 *
 * Shown to the guest and to the owner pricing it. Returned as both numbers rather
 * than only the saving, because "₹40 off" is meaningless on a menu without the
 * ₹220 it came off, and a combo priced ABOVE its parts is a mistake an owner
 * should be able to see rather than a negative number to hide.
 */
export function comboSaving(comboPrice, components, priceByProductId) {
  const separately = round2((components ?? []).reduce((sum, component) => {
    const unit = Number(priceByProductId.get(component.componentProductId) ?? 0);
    return sum + unit * Number(component.quantity ?? 0);
  }, 0));
  const price = round2(comboPrice);
  return {
    separately,
    price,
    // Never negative: a combo dearer than its parts saves nothing, it does not
    // "save minus forty".
    saving: separately > price ? round2(separately - price) : 0,
    dearerThanParts: separately > 0 && price > separately,
  };
}

function serializeComponent(component) {
  return {
    componentProductId: component.componentProductId,
    name: component.componentName,
    quantity: Number(component.quantity ?? 1),
    sortOrder: Number(component.sortOrder ?? 0),
    note: component.note ?? null,
  };
}

export async function listComboComponents(shopId, comboProductId) {
  const rows = await db.menuComboComponent.findMany({
    where: { shopId, comboProductId },
    orderBy: [{ sortOrder: "asc" }, { componentName: "asc" }],
  });
  return rows.map(serializeComponent);
}

/**
 * Replace a combo's component list with exactly this one.
 *
 * Wholesale for the same reason portions and add-on groups are: the editor holds
 * the whole list, and a half-applied edit would leave a thali that bills for
 * dishes the kitchen was never told to cook.
 */
export async function setComboComponents(shopId, comboProductId, components = []) {
  if (components.length > MAX_COMPONENTS_PER_COMBO) {
    throw new AppError(`A combo can hold ${MAX_COMPONENTS_PER_COMBO} dishes at most`, 400);
  }

  const combo = await db.product.findFirst({ where: { id: comboProductId, shopId, deletedAt: null } });
  if (!combo) throw new AppError("That combo is not on this shop's menu", 404);

  const seen = new Set();
  for (const component of components) {
    if (component.componentProductId === comboProductId) {
      throw new AppError(`"${combo.name}" cannot contain itself`, 400);
    }
    if (seen.has(component.componentProductId)) {
      throw new AppError("The same dish is listed twice — set its quantity instead", 400);
    }
    seen.add(component.componentProductId);
  }

  const componentIds = [...seen];
  const dishes = componentIds.length
    ? await db.product.findMany({
        where: { shopId, deletedAt: null, id: { in: componentIds } },
        select: { id: true, name: true },
      })
    : [];
  // Counted rather than trusted: an id from another shop would otherwise put that
  // shop's dish — and its recipe — inside this shop's thali.
  if (dishes.length !== componentIds.length) {
    throw new AppError("One of those dishes is not on this shop's menu", 400);
  }
  const nameById = new Map(dishes.map((dish) => [dish.id, dish.name]));

  // Depth one, enforced here. A component that is itself a combo is what would
  // make expansion recursive and a cycle possible; refused as a sentence.
  if (componentIds.length > 0) {
    const nested = await db.menuComboComponent.findMany({
      where: { shopId, comboProductId: { in: componentIds } },
      select: { comboProductId: true },
      distinct: ["comboProductId"],
    });
    if (nested.length > 0) {
      const names = nested.map((row) => nameById.get(row.comboProductId) ?? "that dish");
      throw new AppError(`${names.join(", ")} is itself a combo. List its dishes here instead.`, 400);
    }
  }

  // The reverse direction: this combo may not become a component's component.
  const usedAsComponent = await db.menuComboComponent.findMany({
    where: { shopId, componentProductId: comboProductId },
    select: { comboProductId: true },
    distinct: ["comboProductId"],
  });
  if (usedAsComponent.length > 0 && components.length > 0) {
    throw new AppError(`"${combo.name}" is already a dish inside another combo, so it cannot contain dishes itself`, 400);
  }

  await db.$transaction(async (tx) => {
    await tx.product.update({ where: { id: comboProductId }, data: { restaurantItemType: "prepared" } });
    await tx.menuComboComponent.deleteMany({ where: { shopId, comboProductId } });
    for (const [index, component] of components.entries()) {
      await tx.menuComboComponent.create({
        data: {
          shopId,
          comboProductId,
          componentProductId: component.componentProductId,
          componentName: nameById.get(component.componentProductId) ?? "Dish",
          quantity: Number(component.quantity ?? 1),
          sortOrder: Number(component.sortOrder ?? index),
          note: component.note?.trim() || null,
        },
      });
    }
  });

  return listComboComponents(shopId, comboProductId);
}

/**
 * Every combo's components in one query, for the menu board.
 *
 * A board of 200 dishes asking per dish is 200 round trips to draw one screen,
 * and the guest page redraws it whenever the kitchen 86s something.
 */
export async function comboComponentsByProduct(shopId) {
  const rows = await db.menuComboComponent.findMany({
    where: { shopId },
    orderBy: [{ sortOrder: "asc" }, { componentName: "asc" }],
  });
  const byCombo = new Map();
  for (const row of rows) {
    if (!byCombo.has(row.comboProductId)) byCombo.set(row.comboProductId, []);
    byCombo.get(row.comboProductId).push(serializeComponent(row));
  }
  return byCombo;
}

/** Raw rows for the sale guard, which needs them unserialized and unsorted. */
export async function comboComponentsFor(tx, shopId, comboProductIds) {
  if (comboProductIds.length === 0) return [];
  return tx.menuComboComponent.findMany({
    where: { shopId, comboProductId: { in: [...new Set(comboProductIds)] } },
  });
}

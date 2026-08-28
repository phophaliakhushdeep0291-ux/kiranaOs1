import db from "../../../db.js";
import { AppError } from "../../../middleware/error.js";
import { listProducts } from "../../../modules/products/products.service.js";
import { listRecipeComponents, portionsPossible } from "../recipes/recipes.service.js";
import { addonGroupsByProduct } from "./addons.service.js";
import { comboComponentsByProduct, comboSaving } from "./combos.service.js";

/**
 * The menu card.
 *
 * A dish is an ordinary Product and stays one — the same pricing, tax, billing
 * and stock path as a packet of biscuits, which is what lets a restaurant's
 * sales, GST and reports work without a second engine. What a menu adds is the
 * part no retail column carries: which course the dish belongs to, whether it is
 * veg, how hot, how long the kitchen needs, and whether it can be served tonight.
 *
 * The distinction that does the real work here is between three ways a dish can
 * be unorderable, which a retail catalogue collapses into one:
 *
 *   inactive      — it is not on the menu at all (delisted)
 *   86'd          — on the menu, priced, but the kitchen has run out TONIGHT
 *   short         — its recipe's ingredients cannot make another portion
 *
 * A waiter needs all three said differently. "We've run out" is an apology; "we
 * don't serve that" is a different sentence, and a guest can tell.
 */

/**
 * Suggested courses, in the order a menu is read rather than alphabetically.
 *
 * Suggestions only: the column is free text, because "Dim sum", "Thali" and
 * "Tandoor" are courses too and a fixed list would quietly tell every restaurant
 * that is not North Indian that this software was not built for them.
 */
export const SUGGESTED_COURSES = [
  "Starters",
  "Soups & Salads",
  "Main course",
  "Breads",
  "Rice & Biryani",
  "Sides",
  "Desserts",
  "Beverages",
];

export const FOOD_TYPES = ["veg", "nonveg", "egg", "vegan", "jain"];

/** Dishes with no course yet, so a half-set-up menu still prints in one piece. */
export const UNCATEGORISED_COURSE = "Other";

function normalizeCourse(value) {
  const text = String(value ?? "").trim();
  return text.slice(0, 60) || null;
}

/** Reuse an existing food category until the owner chooses a menu course. */
export function resolveMenuCourse(product) {
  const explicit = normalizeCourse(product.menuCourse);
  const category = normalizeCourse(product.category);
  const fallback = category && !["general", "other", "uncategorised", "uncategorized"].includes(category.toLowerCase())
    ? category : UNCATEGORISED_COURSE;
  const course = explicit || fallback;
  // Imported "Main Course" and the suggested "Main course" are one section.
  return SUGGESTED_COURSES.find((suggestion) => suggestion.toLowerCase() === course.toLowerCase()) ?? course;
}

function normalizeTags(value) {
  if (value == null) return null;
  const list = Array.isArray(value) ? value : String(value).split(",");
  const cleaned = [...new Set(list.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean))].slice(0, 8);
  return cleaned.length ? cleaned.join(",") : null;
}

export function parseTags(value) {
  return String(value ?? "").split(",").map((tag) => tag.trim()).filter(Boolean);
}

/**
 * Group dishes into the courses a menu is printed in.
 *
 * Pure and exported so the ordering can be tested without a database. Courses
 * the shop actually uses come first in suggested order; anything it invented
 * follows alphabetically, and the catch-all sits last — because a guest reading
 * a menu expects starters before dessert, and "Other" nowhere but the end.
 */
export function groupMenuByCourse(dishes) {
  const byCourse = new Map();
  for (const dish of dishes) {
    const course = resolveMenuCourse(dish);
    if (!byCourse.has(course)) byCourse.set(course, []);
    byCourse.get(course).push(dish);
  }

  const known = SUGGESTED_COURSES.filter((course) => byCourse.has(course));
  const custom = [...byCourse.keys()]
    .filter((course) => !SUGGESTED_COURSES.includes(course) && course !== UNCATEGORISED_COURSE)
    .sort((a, b) => a.localeCompare(b));
  const tail = byCourse.has(UNCATEGORISED_COURSE) ? [UNCATEGORISED_COURSE] : [];

  return [...known, ...custom, ...tail].map((course) => ({
    course,
    dishes: byCourse.get(course).sort((a, b) => (a.menuSortOrder - b.menuSortOrder) || a.name.localeCompare(b.name)),
  }));
}

export function serializeDish(product, { portionsLeft = null, hasRecipe = false, addonGroups = [], comboComponents = [], comboValue = null } = {}) {
  return {
    id: product.id,
    name: product.name,
    category: product.category ?? null,
    price: Number(product.defaultPricePerRateUnit ?? 0),
    mrp: Number(product.mrp ?? 0) || null,
    unit: product.rateUnit || product.displayUnit || "plate",
    imageUrl: product.imageUrl ?? null,
    description: product.description ?? null,
    gstRate: Number(product.gstRate ?? 0),
    menuCourse: normalizeCourse(product.menuCourse),
    foodType: product.foodType ?? null,
    spiceLevel: product.spiceLevel ?? null,
    prepMinutes: product.prepMinutes ?? null,
    tags: parseTags(product.menuTags),
    menuAvailable: product.menuAvailable !== false,
    menuSortOrder: Number(product.menuSortOrder ?? 0),
    // Folded into the board rather than fetched per dish: a menu of 200 dishes
    // would otherwise be 200 extra requests to draw the price a guest reads first.
    // listProducts already includes sellingUnits, so this costs no extra query.
    variations: (product.sellingUnits ?? [])
      .filter((unit) => unit.unitType === PORTION_UNIT_TYPE && unit.isActive !== false)
      .map((unit) => ({
        unitCode: unit.unitCode,
        name: unit.name,
        price: Number(unit.defaultPrice ?? 0),
        portionFactor: Number(unit.conversionToBase ?? 1),
        isDefault: unit.isDefault === true,
      }))
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.price - b.price),
    // "Extra cheese", "no onion". Empty for most dishes, and for every dish in a
    // shop that has not set any up, so a kirana catalogue is unaffected.
    addonGroups,
    // The dishes a thali or meal deal is made of. Empty means an ordinary dish —
    // having components IS what makes a product a combo, so there is no separate
    // flag that could disagree with the list.
    comboComponents,
    isCombo: comboComponents.length > 0,
    // What the parts cost separately, and what the guest saves. Null for anything
    // that is not a combo.
    comboValue,
    // A dish that is cooked to order has no meaningful stock of its own — the
    // ingredients are the stock. Saying so explicitly stops every screen from
    // re-deriving it and getting it differently.
    hasRecipe,
    portionsLeft,
    stockBaseQty: Number(product.stockBaseQty ?? 0),
  };
}

/**
 * The whole menu, as the counter and the guest page both read it.
 *
 * Recipes are folded in here rather than by the caller because "can we still
 * serve this?" is part of what a menu IS for a restaurant, and a screen that
 * asked separately would show a dish as orderable for as long as it took the
 * second request to land.
 */
export async function getMenuBoard(shopId, { locationId, includeUnavailable = true } = {}) {
  const [products, components, addonsByProduct, combosByProduct] = await Promise.all([
    listProducts(shopId, { locationId }),
    listRecipeComponents(shopId),
    addonGroupsByProduct(shopId),
    comboComponentsByProduct(shopId),
  ]);

  const stock = new Map(products.map((product) => [product.id, Number(product.stockBaseQty ?? 0)]));
  // À la carte price per dish, so a combo can be shown against what its parts
  // would cost bought separately.
  const priceByProduct = new Map(products.map((product) => [product.id, Number(product.defaultPricePerRateUnit ?? 0)]));
  const componentsByDish = new Map();
  for (const component of components) {
    if (!componentsByDish.has(component.dishProductId)) componentsByDish.set(component.dishProductId, []);
    componentsByDish.get(component.dishProductId).push(component);
  }

  const dishes = products
    .filter((product) => product.status !== "inactive" && product.isActive !== false)
    .map((product) => {
      const recipe = componentsByDish.get(product.id);
      const comboComponents = combosByProduct.get(product.id) ?? [];
      return serializeDish(product, {
        hasRecipe: Boolean(recipe?.length),
        portionsLeft: recipe?.length ? portionsPossible(recipe, stock) : null,
        addonGroups: addonsByProduct.get(product.id) ?? [],
        comboComponents,
        comboValue: comboComponents.length > 0
          ? comboSaving(Number(product.defaultPricePerRateUnit ?? 0), comboComponents, priceByProduct)
          : null,
      });
    })
    .filter((dish) => includeUnavailable || dish.menuAvailable);

  return {
    courses: groupMenuByCourse(dishes),
    dishCount: dishes.length,
    suggestedCourses: SUGGESTED_COURSES,
  };
}

/**
 * Change how one dish appears on the menu.
 *
 * Only menu columns — price, stock, tax and everything else a dish shares with
 * ordinary retail stay with the product screens that own them, so there is one
 * place a price can change and one audit trail for it.
 */
export async function updateDishMenu(shopId, productId, patch = {}) {
  const product = await db.product.findFirst({ where: { id: productId, shopId, deletedAt: null } });
  if (!product) throw new AppError("Dish not found", 404);

  const data = {};
  if (patch.menuCourse !== undefined) data.menuCourse = normalizeCourse(patch.menuCourse);
  if (patch.foodType !== undefined) {
    data.foodType = patch.foodType && FOOD_TYPES.includes(patch.foodType) ? patch.foodType : null;
  }
  if (patch.spiceLevel !== undefined) {
    data.spiceLevel = patch.spiceLevel == null ? null : Math.max(0, Math.min(3, Number(patch.spiceLevel)));
  }
  if (patch.prepMinutes !== undefined) {
    data.prepMinutes = patch.prepMinutes == null ? null : Math.max(0, Math.min(600, Number(patch.prepMinutes)));
  }
  if (patch.tags !== undefined) data.menuTags = normalizeTags(patch.tags);
  if (patch.menuAvailable !== undefined) data.menuAvailable = patch.menuAvailable === true;
  if (patch.menuSortOrder !== undefined) data.menuSortOrder = Math.max(0, Number(patch.menuSortOrder) || 0);

  if (Object.keys(data).length === 0) throw new AppError("Nothing to update", 400);
  const updated = await db.product.update({ where: { id: product.id }, data });
  return serializeDish(updated);
}

/**
 * Set several dishes at once — how a course gets reordered, and how a kitchen
 * 86s four things at the start of service without four round trips.
 */
export async function bulkUpdateDishMenu(shopId, updates = []) {
  const saved = [];
  for (const update of updates) {
    const { productId, ...patch } = update;
    saved.push(await updateDishMenu(shopId, productId, patch));
  }
  return saved;
}

/** The courses this shop actually uses, for the pickers that offer them. */
export async function listCourses(shopId) {
  const rows = await db.product.findMany({
    where: { shopId, deletedAt: null },
    select: { menuCourse: true, category: true },
    distinct: ["menuCourse", "category"],
  });
  const used = rows.map(resolveMenuCourse).filter((course) => course !== UNCATEGORISED_COURSE);
  return [...new Set([...used, ...SUGGESTED_COURSES])];
}

/**
 * The unit type that marks a selling unit as a menu portion rather than a retail
 * pack. Everything below keys off it, so "Half" and "500 g packet" can sit on the
 * same product without either editor treating the other's rows as its own.
 */
export const PORTION_UNIT_TYPE = "portion";

function portionSlug(name) {
  return String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Build a stable unit code per portion.
 *
 * A name written in Devanagari slugs to nothing, and two such names would collide
 * on one code — which the [shopId, productId, unitCode] unique index would reject
 * with a database error rather than a sentence a shopkeeper can act on. The index
 * fallback keeps every portion addressable whatever alphabet it is written in.
 */
export function buildPortionCodes(variations) {
  const used = new Set();
  return variations.map((variation, index) => {
    if (variation.unitCode) {
      used.add(variation.unitCode);
      return variation.unitCode;
    }
    const slug = portionSlug(variation.name);
    let code = `${PORTION_UNIT_TYPE}-${slug || index + 1}`;
    if (used.has(code)) code = `${PORTION_UNIT_TYPE}-${slug || "p"}-${index + 1}`;
    used.add(code);
    return code;
  });
}

/**
 * Decide what happens to each existing portion row, without touching a database.
 *
 * Split out and exported so the rule that matters most here can be tested on its
 * own: a portion that has ever been billed is DEACTIVATED, never deleted. Its id
 * is stamped on historical BillItems, and deleting it would either break the
 * foreign key or, worse, succeed and leave finalised bills pointing at nothing.
 */
export function planPortionWrite(existingPortions, desiredCodes) {
  const wanted = new Set(desiredCodes);
  const retire = [];
  const remove = [];
  for (const row of existingPortions) {
    if (wanted.has(row.unitCode)) continue;
    if (row.billedCount > 0) retire.push(row);
    else remove.push(row);
  }
  return { retire, remove };
}

/** Exactly one default across the dish's active units, because billing picks one. */
export function resolveDefaultIndex(variations) {
  const flagged = variations.findIndex((variation) => variation.isDefault);
  return flagged >= 0 ? flagged : 0;
}

function serializeVariation(unit) {
  return {
    unitCode: unit.unitCode,
    name: unit.name,
    price: Number(unit.defaultPrice ?? 0),
    portionFactor: Number(unit.conversionToBase ?? 1),
    isDefault: unit.isDefault === true,
    isActive: unit.isActive !== false,
  };
}

/** The portions a dish is sold in, newest state, active rows only. */
export async function listDishVariations(shopId, productId) {
  const units = await db.productSellingUnit.findMany({
    where: { shopId, productId, unitType: PORTION_UNIT_TYPE, isActive: true },
    orderBy: [{ isDefault: "desc" }, { defaultPrice: "asc" }],
  });
  return units.map(serializeVariation);
}

/**
 * Replace a dish's portions with exactly the list given.
 *
 * Retail pack rows on the same product are deliberately left alone: a cafe that
 * sells coffee by the cup and also sells a 250 g bag of beans is not making a
 * mistake, and an editor that silently deleted the bag would be.
 */
export async function setDishVariations(shopId, productId, variations = []) {
  const product = await db.product.findFirst({ where: { id: productId, shopId, deletedAt: null } });
  if (!product) throw new AppError("That dish is not on this shop's menu", 404);

  const seen = new Set();
  for (const variation of variations) {
    const key = variation.name.trim().toLowerCase();
    // Two portions with one name give the waiter a dropdown with two identical
    // rows and no way to tell which price he is about to charge.
    if (seen.has(key)) throw new AppError(`This dish already has a portion called "${variation.name}"`, 400);
    seen.add(key);
  }

  const codes = buildPortionCodes(variations);
  const duplicateCode = codes.find((code, index) => codes.indexOf(code) !== index);
  if (duplicateCode) throw new AppError(`Two portions resolved to the same code (${duplicateCode}). Rename one of them.`, 400);

  const existing = await db.productSellingUnit.findMany({
    where: { shopId, productId },
    include: { _count: { select: { billItems: true } } },
  });
  const portions = existing
    .filter((unit) => unit.unitType === PORTION_UNIT_TYPE)
    .map((unit) => ({ ...unit, billedCount: unit._count?.billItems ?? 0 }));
  const packs = existing.filter((unit) => unit.unitType !== PORTION_UNIT_TYPE);

  const defaultIndex = resolveDefaultIndex(variations);
  const { retire, remove } = planPortionWrite(portions, codes);
  const byCode = new Map(portions.map((unit) => [unit.unitCode, unit]));

  await db.$transaction(async (tx) => {
    for (const row of remove) {
      await tx.productSellingUnit.delete({ where: { id: row.id } });
    }
    for (const row of retire) {
      // Kept so old bills still resolve their unit, hidden so nobody can order it.
      await tx.productSellingUnit.update({ where: { id: row.id }, data: { isActive: false, isDefault: false } });
    }

    for (const [index, variation] of variations.entries()) {
      const data = {
        name: variation.name.trim(),
        unitType: PORTION_UNIT_TYPE,
        unitCode: codes[index],
        // Null, not zero: a portion is not a pack, so none of the packet
        // arithmetic (grams per pack, MRP scaled per pack) should find a number here.
        packSizeValue: null,
        packSizeUnit: null,
        conversionToBase: Number(variation.portionFactor ?? 1),
        defaultPrice: Number(variation.price),
        isDefault: index === defaultIndex,
        isActive: true,
      };
      const current = byCode.get(codes[index]);
      if (current) await tx.productSellingUnit.update({ where: { id: current.id }, data });
      else await tx.productSellingUnit.create({ data: { ...data, shopId, productId } });
    }

    // One default across the whole dish. A pack row left holding the flag would
    // make the cart open on "500 g packet" for a dish now sold by the plate.
    if (variations.length > 0) {
      for (const pack of packs.filter((unit) => unit.isDefault)) {
        await tx.productSellingUnit.update({ where: { id: pack.id }, data: { isDefault: false } });
      }
    }
  });

  return listDishVariations(shopId, productId);
}

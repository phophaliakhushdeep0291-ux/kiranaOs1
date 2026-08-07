import db from "../../../db.js";
import { AppError } from "../../../middleware/error.js";
import { listProducts } from "../../../modules/products/products.service.js";
import { listRecipeComponents, portionsPossible } from "../recipes/recipes.service.js";

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
    const course = dish.menuCourse || UNCATEGORISED_COURSE;
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

export function serializeDish(product, { portionsLeft = null, hasRecipe = false } = {}) {
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
  const [products, components] = await Promise.all([
    listProducts(shopId, { locationId }),
    listRecipeComponents(shopId),
  ]);

  const stock = new Map(products.map((product) => [product.id, Number(product.stockBaseQty ?? 0)]));
  const componentsByDish = new Map();
  for (const component of components) {
    if (!componentsByDish.has(component.dishProductId)) componentsByDish.set(component.dishProductId, []);
    componentsByDish.get(component.dishProductId).push(component);
  }

  const dishes = products
    .filter((product) => product.status !== "inactive" && product.isActive !== false)
    .map((product) => {
      const recipe = componentsByDish.get(product.id);
      return serializeDish(product, {
        hasRecipe: Boolean(recipe?.length),
        portionsLeft: recipe?.length ? portionsPossible(recipe, stock) : null,
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
    where: { shopId, deletedAt: null, menuCourse: { not: null } },
    select: { menuCourse: true },
    distinct: ["menuCourse"],
  });
  const used = rows.map((row) => row.menuCourse).filter(Boolean);
  return [...new Set([...used, ...SUGGESTED_COURSES])];
}

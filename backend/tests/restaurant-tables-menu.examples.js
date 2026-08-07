import assert from "assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  MAX_TABLES_PER_SHOP,
  nextFreeTableCode,
  slugifyTableCode,
} from "../src/verticals/restaurant/tables/tables.service.js";
import {
  costPerBaseUnit,
  effectiveQtyPerPortion,
  portionsPossible,
  recipeCost,
} from "../src/verticals/restaurant/recipes/recipes.service.js";
import { aggregateRecipeConsumption } from "../src/verticals/restaurant/recipes/recipes.guard.js";
import {
  groupMenuByCourse,
  parseTags,
  SUGGESTED_COURSES,
  UNCATEGORISED_COURSE,
} from "../src/verticals/restaurant/menu/menu.service.js";
import {
  dishIsOrderable,
  MENU_THEMES,
  resolveMenuBranding,
} from "../src/verticals/restaurant/storefront/dine-in.storefront.js";
import { createTableSchema, updateTableSchema } from "../src/verticals/restaurant/tables/tables.schema.js";
import { updateDishMenuSchema } from "../src/verticals/restaurant/menu/menu.schema.js";
import { saveRecipeSchema } from "../src/verticals/restaurant/recipes/recipes.schema.js";

/**
 * The restaurant floor, its menu card and its recipe book.
 *
 * What this pins is the arithmetic and the rules a kitchen depends on and that
 * no screen may re-derive differently: what a table's QR sticker says, how many
 * more portions the ingredients can make, what a guest is allowed to order, and
 * that selling three dishes made of the same paste produces ONE stock movement.
 */

const root = dirname(fileURLToPath(new URL("../src/app.js", import.meta.url)));
const read = (relative) => readFileSync(join(root, relative), "utf8");
const readRepo = (relative) => readFileSync(join(root, "..", relative), "utf8");

/* ── What goes on the sticker ──────────────────────────────────────────────── */

assert.equal(slugifyTableCode("T5"), "t5");
assert.equal(slugifyTableCode("Terrace 2"), "terrace-2", "spaces become hyphens, not nothing");
assert.equal(slugifyTableCode("  AC Hall / 12  "), "ac-hall-12", "punctuation collapses to one separator");
assert.equal(slugifyTableCode(""), "table", "a nameless table still gets a usable code");
assert.equal(slugifyTableCode("टेबल"), "table", "a code a waiter cannot read off a sticker is no code");

assert.equal(nextFreeTableCode("t5", []), "t5");
assert.equal(nextFreeTableCode("t5", ["t5"]), "t5-2", "a second T5 is the owner's mistake to make, not an error dialog");
assert.equal(nextFreeTableCode("t5", ["t5", "t5-2"]), "t5-3");
assert.equal(nextFreeTableCode("t9", ["t5", "t5-2"]), "t9", "an unrelated code never shifts");
assert.ok(MAX_TABLES_PER_SHOP >= 100, "a real restaurant floor must fit");

/* ── How much of an ingredient one portion really costs ────────────────────── */

assert.equal(effectiveQtyPerPortion({ qtyBase: 100, wastagePct: 0 }), 100);
assert.equal(
  effectiveQtyPerPortion({ qtyBase: 100, wastagePct: 10 }),
  110,
  "wastage is consumption: 100 g in the dish leaves the fridge as 110 g",
);
assert.equal(effectiveQtyPerPortion({ qtyBase: 0, wastagePct: 50 }), 0, "nothing scaled by wastage is still nothing");
assert.equal(effectiveQtyPerPortion({ qtyBase: 100, wastagePct: -10 }), 100, "wastage never gives stock back");

/* ── How many more can the kitchen make? ───────────────────────────────────── */

const paneerTikka = [
  { ingredientProductId: "paneer", qtyBase: 200, wastagePct: 0, optional: false },
  { ingredientProductId: "capsicum", qtyBase: 50, wastagePct: 0, optional: false },
  { ingredientProductId: "coriander", qtyBase: 5, wastagePct: 0, optional: true },
];

assert.equal(
  portionsPossible(paneerTikka, new Map([["paneer", 1000], ["capsicum", 1000], ["coriander", 1000]])),
  5,
  "the binding constraint is whichever ingredient runs out first, so it is a minimum",
);
assert.equal(
  portionsPossible(paneerTikka, new Map([["paneer", 1000], ["capsicum", 100], ["coriander", 1000]])),
  2,
  "the scarcest required ingredient sets the number",
);
assert.equal(
  portionsPossible(paneerTikka, new Map([["paneer", 1000], ["capsicum", 1000], ["coriander", 0]])),
  5,
  "a shop out of coriander can still serve the dish — optional means optional",
);
assert.equal(
  portionsPossible(paneerTikka, new Map([["paneer", 0], ["capsicum", 1000]])),
  0,
  "a missing required ingredient means none can be made",
);
assert.equal(
  portionsPossible(paneerTikka, new Map()),
  0,
  "an ingredient nobody has stocked reads as zero, not as unlimited",
);
assert.equal(portionsPossible([], new Map([["paneer", 1000]])), null, "no recipe constrains nothing — and null is not zero");
assert.equal(
  portionsPossible([{ ingredientProductId: "garnish", qtyBase: 5, optional: true }], new Map()),
  null,
  "a dish whose only components are garnishes is never reported as out",
);
assert.equal(
  portionsPossible([{ ingredientProductId: "spice", qtyBase: 0, optional: false }], new Map()),
  null,
  "a listed-but-unweighed ingredient does not silently zero the dish",
);
assert.equal(
  portionsPossible(paneerTikka, { paneer: 600, capsicum: 600 }),
  3,
  "a plain object of stock reads the same as a Map",
);

/* ── What a portion costs the kitchen ──────────────────────────────────────── */

assert.equal(
  costPerBaseUnit({ costPerRateUnit: 400, rateUnit: "kg", baseUnit: "g" }),
  0.4,
  "a ₹400/kg ingredient costs 40 paise per gram — costing per rate unit against a recipe in base units is off by 1000x",
);
assert.equal(costPerBaseUnit({ costPerRateUnit: 20, rateUnit: "piece", baseUnit: "piece" }), 20);
assert.equal(costPerBaseUnit({ costPerRateUnit: 0, rateUnit: "kg", baseUnit: "g" }), 0);
assert.equal(
  recipeCost(paneerTikka, { paneer: 0.4, capsicum: 0.06, coriander: 0.2 }),
  round2(200 * 0.4 + 50 * 0.06 + 5 * 0.2),
  "every component counts toward cost, including the garnish the kitchen still buys",
);

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

/* ── Selling dishes moves ingredients, once ────────────────────────────────── */

const components = [
  { dishProductId: "butter-chicken", ingredientProductId: "gg-paste", ingredientName: "Ginger-garlic paste", qtyBase: 20, wastagePct: 0, optional: false },
  { dishProductId: "butter-chicken", ingredientProductId: "chicken", ingredientName: "Chicken", qtyBase: 250, wastagePct: 10, optional: false },
  { dishProductId: "dal-makhani", ingredientProductId: "gg-paste", ingredientName: "Ginger-garlic paste", qtyBase: 15, wastagePct: 0, optional: false },
];

const consumed = aggregateRecipeConsumption(new Map([["butter-chicken", 2], ["dal-makhani", 3]]), components);
const byId = Object.fromEntries(consumed.map((row) => [row.ingredientProductId, row.qtyBase]));
assert.equal(consumed.length, 2, "two dishes sharing a paste produce ONE movement for it, not two");
assert.equal(byId["gg-paste"], 20 * 2 + 15 * 3, "the shared ingredient sums across both dishes");
assert.equal(byId.chicken, round2(250 * 1.1 * 2), "wastage is applied per portion before totalling");

assert.deepEqual(
  aggregateRecipeConsumption(new Map([["butter-chicken", 0]]), components),
  [],
  "a dish that was not sold consumes nothing",
);
assert.deepEqual(
  aggregateRecipeConsumption(new Map([["something-else", 4]]), components),
  [],
  "a dish with no recipe consumes nothing",
);

/* ── The menu, in the order it is read ─────────────────────────────────────── */

const grouped = groupMenuByCourse([
  { name: "Gulab Jamun", menuCourse: "Desserts", menuSortOrder: 0 },
  { name: "Paneer Tikka", menuCourse: "Starters", menuSortOrder: 1 },
  { name: "Papad", menuCourse: null, menuSortOrder: 0 },
  { name: "Dim Sum", menuCourse: "Dim sum", menuSortOrder: 0 },
  { name: "Aloo Tikki", menuCourse: "Starters", menuSortOrder: 0 },
]);
assert.deepEqual(
  grouped.map((section) => section.course),
  ["Starters", "Desserts", "Dim sum", UNCATEGORISED_COURSE],
  "known courses run in menu order, a shop's own course follows, and the catch-all is last",
);
assert.deepEqual(
  grouped[0].dishes.map((dish) => dish.name),
  ["Aloo Tikki", "Paneer Tikka"],
  "within a course the shop's own ordering wins over the alphabet",
);
assert.ok(SUGGESTED_COURSES.includes("Main course"));
assert.deepEqual(parseTags("bestseller, chef-special ,"), ["bestseller", "chef-special"]);
assert.deepEqual(parseTags(null), []);

/* ── What a guest is allowed to order ──────────────────────────────────────── */

const stock = new Map([["paneer", 1000], ["capsicum", 1000]]);

assert.equal(
  dishIsOrderable({ id: "d1", menuAvailable: true, stockBaseQty: 0 }, { components: null, stock }),
  true,
  "a cooked-to-order dish has no stock of its own — hiding it would serve every new restaurant a blank menu",
);
assert.equal(
  dishIsOrderable({ id: "d1", menuAvailable: false, stockBaseQty: 500 }, { components: null, stock }),
  false,
  "86'd tonight means 86'd, whatever the stock column says",
);
assert.equal(
  dishIsOrderable({ id: "d1", menuAvailable: true }, { components: paneerTikka, stock }),
  true,
  "a dish whose ingredients are in the fridge is orderable",
);
assert.equal(
  dishIsOrderable({ id: "d1", menuAvailable: true }, { components: paneerTikka, stock: new Map([["paneer", 0]]) }),
  false,
  "a dish whose ingredients cannot make one more is not orderable",
);
assert.equal(
  dishIsOrderable({ id: "d1", menuAvailable: true, status: "inactive" }, { components: null, stock }),
  false,
  "delisted is not the same as run out, and neither is orderable",
);

/* ── One restaurant must not look like the next ────────────────────────────── */

const plain = resolveMenuBranding({}, { name: "Spice Route" });
assert.equal(plain.displayName, "Spice Route", "a shop that configured nothing still gets its own name");
assert.equal(plain.accent, MENU_THEMES.classic.accent);
assert.ok(plain.surface && plain.ink, "a theme is a considered pair, not one colour");

const dressed = resolveMenuBranding(
  { restaurant: { brand: { displayName: "Kaapi & Co", tagline: "Filter coffee since 1998", theme: "emerald" } } },
  { name: "Kaapi and Company" },
);
assert.equal(dressed.displayName, "Kaapi & Co");
assert.equal(dressed.tagline, "Filter coffee since 1998");
assert.equal(dressed.accent, MENU_THEMES.emerald.accent, "picking a theme actually changes what the guest sees");
assert.equal(
  resolveMenuBranding({ restaurant: { brand: { theme: "not-a-theme" } } }, { name: "X" }).accent,
  MENU_THEMES.classic.accent,
  "an unknown theme falls back rather than rendering an unstyled page",
);
assert.equal(
  resolveMenuBranding({ restaurant: { brand: { logoUrl: "javascript:alert(1)" } } }, { name: "X" }).logoUrl,
  null,
  "a logo is a URL the guest's browser will fetch — anything that is not http(s) is refused",
);

/* ── The schemas a screen sends through ────────────────────────────────────── */

assert.equal(createTableSchema.safeParse({ name: "T5" }).success, true);
assert.equal(createTableSchema.safeParse({ name: "  " }).success, false, "a table needs a name the staff call it by");
assert.equal(createTableSchema.parse({ name: "T5" }).seats, 4);
assert.equal(updateTableSchema.safeParse({}).success, false, "an empty patch is a bug, not a no-op");
assert.equal(
  Object.keys(updateTableSchema.safeParse({ name: "T6" }).data ?? {}).includes("code"),
  false,
  "the code is printed on a sticker already on the wall and must not be editable",
);

assert.equal(
  updateDishMenuSchema.safeParse({ menuCourse: null }).success,
  true,
  "clearing a dish's course is a real edit — .optional() alone would reject the null the UI sends",
);
assert.equal(updateDishMenuSchema.safeParse({ foodType: "veg" }).success, true);
assert.equal(updateDishMenuSchema.safeParse({ foodType: "mystery" }).success, false);
assert.equal(updateDishMenuSchema.safeParse({ spiceLevel: 9 }).success, false, "spice runs 0-3");
assert.equal(saveRecipeSchema.safeParse({ components: [] }).success, true, "emptying a recipe is how one is deleted");
assert.equal(
  saveRecipeSchema.safeParse({ components: [{ ingredientProductId: "p1", qtyBase: -5 }] }).success,
  false,
  "a negative quantity would give stock back on every sale",
);
assert.equal(
  saveRecipeSchema.parse({ components: [{ ingredientProductId: "p1", qtyBase: 100 }] }).components[0].wastagePct,
  0,
);

/* ── The seams, and the boundary they exist to keep ────────────────────────── */

const publicService = read("modules/public/public.service.js");
assert.ok(
  publicService.includes("shapeStorefrontCatalog") && publicService.includes("resolveStorefrontOrderContext"),
  "the public catalogue must ask the registry which storefront to serve",
);
assert.ok(
  !/verticals\/restaurant/.test(publicService),
  "shared code must never name a trade — the restaurant registers itself instead",
);
assert.ok(
  publicService.includes("storefront?.products"),
  "a trade that claimed the storefront decides what is available, not the shelf's stock rule",
);

const storefront = read("verticals/restaurant/storefront/dine-in.storefront.js");
assert.ok(storefront.includes("registerStorefrontMode("), "the dine-in storefront registers itself on load");
assert.ok(
  read("verticals/restaurant/tables/tables.routes.js").includes("storefront/dine-in.storefront.js"),
  "mounting the restaurant's routes must be what loads its storefront",
);
assert.ok(
  read("verticals/restaurant/recipes/recipes.routes.js").includes("recipes.guard.js"),
  "mounting the recipe routes must be what registers ingredient depletion",
);

/* ── Both databases, or it works locally and 500s in production ────────────── */

const sqliteMigration = readRepo("prisma/migrations/20260807120000_restaurant_tables_menu_recipes/migration.sql");
const pgMigration = readRepo("prisma-postgres/migrations/000093_restaurant_tables_menu_recipes/migration.sql");
for (const [name, sql] of [["SQLite", sqliteMigration], ["PostgreSQL", pgMigration]]) {
  assert.ok(/CREATE TABLE (IF NOT EXISTS )?"RestaurantTable"/.test(sql), `${name} migration must create RestaurantTable`);
  assert.ok(/CREATE TABLE (IF NOT EXISTS )?"DishRecipeComponent"/.test(sql), `${name} migration must create DishRecipeComponent`);
  for (const column of ["menuCourse", "foodType", "spiceLevel", "prepMinutes", "menuTags", "menuAvailable", "menuSortOrder"]) {
    assert.ok(sql.includes(`"${column}"`), `${name} migration must add Product.${column}`);
  }
  for (const column of ["tableId", "tableName", "guestCount"]) {
    assert.ok(sql.includes(`"${column}"`), `${name} migration must add CustomerOrder.${column}`);
  }
  assert.ok(sql.includes("RestaurantTable_shopId_code_key"), `${name} migration must make one sticker mean one table`);
}
// Replay safety is a PostgreSQL-only concern: an interrupted deploy re-runs the
// migration, and ADD CONSTRAINT has no IF NOT EXISTS.
assert.ok(pgMigration.includes("duplicate_object"), "the PostgreSQL foreign keys must be replay-safe");
assert.ok(
  (pgMigration.match(/ADD COLUMN IF NOT EXISTS/g) ?? []).length >= 10,
  "every PostgreSQL column add must be guarded",
);

for (const schemaPath of ["prisma/schema.prisma", "prisma-postgres/schema.prisma"]) {
  const schema = readRepo(schemaPath);
  assert.ok(schema.includes("model RestaurantTable"), `${schemaPath} must declare RestaurantTable`);
  assert.ok(schema.includes("model DishRecipeComponent"), `${schemaPath} must declare DishRecipeComponent`);
  assert.ok(schema.includes("menuAvailable"), `${schemaPath} must declare the 86 switch`);
  assert.match(schema, /restaurantTables\s+RestaurantTable\[\]/, `${schemaPath} must relate tables back to the shop`);
  assert.match(schema, /dishRecipeComponents\s+DishRecipeComponent\[\]/, `${schemaPath} must relate recipes back to the shop`);
}

console.log("restaurant-tables-menu.examples.js OK");

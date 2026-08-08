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
  buildPortionCodes,
  groupMenuByCourse,
  parseTags,
  planPortionWrite,
  resolveDefaultIndex,
  SUGGESTED_COURSES,
  UNCATEGORISED_COURSE,
} from "../src/verticals/restaurant/menu/menu.service.js";
import {
  dishIsOrderable,
  MENU_THEMES,
  resolveMenuBranding,
} from "../src/verticals/restaurant/storefront/dine-in.storefront.js";
import { createTableSchema, updateTableSchema } from "../src/verticals/restaurant/tables/tables.schema.js";
import { setDishVariationsSchema, updateDishMenuSchema } from "../src/verticals/restaurant/menu/menu.schema.js";
import { saveRecipeSchema } from "../src/verticals/restaurant/recipes/recipes.schema.js";
import { addonUnitPrice, validateSelection } from "../src/verticals/restaurant/menu/addons.service.js";
import { aggregateAddonConsumption } from "../src/verticals/restaurant/menu/addons.guard.js";
import { comboSaving, expandComboPortions } from "../src/verticals/restaurant/menu/combos.service.js";
import { saveAddonGroupSchema } from "../src/verticals/restaurant/menu/addons.schema.js";

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


/* ── Dish portions (Half / Full) ──────────────────────────────────────────────
 *
 * A portion is a ProductSellingUnit, not a new table, so billing's unit dropdown,
 * the per-unit price and the sellingUnitLabel a finalised bill snapshots all work
 * unchanged. What these pin is the part that is NOT free: that renaming keeps
 * history, that a billed portion is never deleted, and that a portion carries no
 * pack arithmetic.
 */

// A name is slugged into the unit code, and the unique index is on that code.
assert.deepStrictEqual(
  buildPortionCodes([{ name: "Half" }, { name: "Full plate" }]),
  ["portion-half", "portion-full-plate"],
  "a portion code is the slug of its name",
);

// Devanagari slugs to nothing. Without the index fallback both rows would ask for
// the same code and the database, not the shopkeeper, would decide what happened.
assert.deepStrictEqual(
  buildPortionCodes([{ name: "आधा" }, { name: "पूरा" }]),
  ["portion-1", "portion-2"],
  "a portion named in Devanagari still gets its own code",
);

// An existing portion sends its code back, which is what lets it be RENAMED in
// place rather than retired and recreated as a stranger to its own sales history.
assert.deepStrictEqual(
  buildPortionCodes([{ unitCode: "portion-half", name: "Half plate" }]),
  ["portion-half"],
  "a renamed portion keeps the code its bills already reference",
);

{
  // The rule that matters most: a portion that has been billed is deactivated,
  // never deleted. Its id is stamped on historical BillItems.
  const existing = [
    { id: "u1", unitCode: "portion-half", billedCount: 12 },
    { id: "u2", unitCode: "portion-full", billedCount: 0 },
    { id: "u3", unitCode: "portion-quarter", billedCount: 3 },
  ];
  const plan = planPortionWrite(existing, ["portion-full"]);
  assert.deepStrictEqual(plan.retire.map((row) => row.id), ["u1", "u3"], "billed portions are retired, not removed");
  assert.deepStrictEqual(plan.remove.map((row) => row.id), [], "a portion that is still wanted is left alone");

  const untouched = planPortionWrite(existing, ["portion-half", "portion-full", "portion-quarter"]);
  assert.deepStrictEqual(untouched.retire, [], "nothing is retired when every portion is still on the menu");
  assert.deepStrictEqual(untouched.remove, [], "nothing is removed when every portion is still on the menu");
}

{
  // A portion nobody ever ordered is a typo, and deleting it keeps the dropdown
  // honest instead of leaving a hidden row behind forever.
  const plan = planPortionWrite([{ id: "u9", unitCode: "portion-larg", billedCount: 0 }], ["portion-large"]);
  assert.deepStrictEqual(plan.remove.map((row) => row.id), ["u9"], "an unbilled portion is deleted outright");
  assert.deepStrictEqual(plan.retire, [], "an unbilled portion is not retired");
}

// Billing picks one default unit, so exactly one portion must carry the flag.
assert.strictEqual(resolveDefaultIndex([{ isDefault: false }, { isDefault: true }]), 1, "the flagged portion is the default");
assert.strictEqual(resolveDefaultIndex([{ isDefault: false }, { isDefault: false }]), 0, "with none flagged the first portion is the default");
assert.strictEqual(resolveDefaultIndex([{ isDefault: true }, { isDefault: true }]), 0, "with two flagged the first wins rather than both");

{
  // Zero would bill a plate of food at nothing. A free dish is priced at zero with
  // no portions; it is not a portion that costs nothing.
  const rejected = setDishVariationsSchema.safeParse({ variations: [{ name: "Half", price: 0 }] });
  assert.ok(!rejected.success, "a portion priced at zero is rejected");

  const accepted = setDishVariationsSchema.safeParse({ variations: [{ name: "Half", price: 180, portionFactor: 0.5 }] });
  assert.ok(accepted.success, "a priced portion is accepted");
  assert.strictEqual(accepted.data.variations[0].portionFactor, 0.5, "the portion factor survives parsing");

  // Defaulted so an editor that only asks for a name and a price still produces a
  // portion that depletes one full recipe rather than none.
  const defaulted = setDishVariationsSchema.safeParse({ variations: [{ name: "Full", price: 320 }] });
  assert.strictEqual(defaulted.data.variations[0].portionFactor, 1, "a portion factor defaults to one full portion");

  const emptied = setDishVariationsSchema.safeParse({ variations: [] });
  assert.ok(emptied.success, "clearing every portion is a legal edit");
}

/* â”€â”€ Configured add-ons â”€â”€ */

{
  const group = {
    name: "Choose cheese",
    minSelect: 1,
    maxSelect: 2,
    options: [{ id: "cheddar", isActive: true }, { id: "paneer", isActive: true }],
  };
  assert.equal(validateSelection(group, []).ok, false, "a required group cannot be skipped");
  assert.equal(validateSelection(group, ["cheddar"]).ok, true);
  assert.equal(validateSelection(group, ["cheddar", "cheddar", "paneer"]).ok, false, "option quantity counts toward the maximum");
  assert.equal(validateSelection(group, ["foreign"]).ok, false, "a stale or foreign option is refused");
  assert.equal(addonUnitPrice([{ price: 25, quantity: 2 }, { price: 0, quantity: 1 }]), 50);
}

{
  const consumption = aggregateAddonConsumption([
    { quantity: 2, options: [{ linkedProductId: "cheese", linkedQtyBase: 0.05, quantity: 2 }] },
    { quantity: 1, options: [{ linkedProductId: "cheese", linkedQtyBase: 0.1, quantity: 1 }, { linkedProductId: null, linkedQtyBase: 1, quantity: 1 }] },
  ]);
  assert.equal(consumption.get("cheese"), 0.3, "linked stock is aggregated by ingredient and scaled by dish and option quantity");
}

{
  const parsed = saveAddonGroupSchema.safeParse({
    name: "Instructions",
    minSelect: 0,
    maxSelect: 2,
    options: [{ name: "No onion", price: 0 }, { name: "Extra cheese", price: 20, linkedProductId: "cheese", linkedQtyBase: 0.05 }],
  });
  assert.ok(parsed.success, "zero-price instructions and stock-linked extras are both valid");
  assert.equal(parsed.data.options[1].linkedQtyBase, 0.05);
  assert.equal(saveAddonGroupSchema.safeParse({ name: "Broken", minSelect: 2, options: [{ name: "Only one", price: 0 }] }).success, true, "cross-row feasibility is enforced by the service transaction");
}

assert.ok(read("verticals/restaurant/menu/menu.routes.js").includes("addons.guard.js"), "mounting the menu registers authoritative option billing");
const billService = read("modules/bills/bills.service.js");
assert.ok(billService.includes("decorateBillItem"), "billing must let a vertical snapshot configured options inside the bill transaction");
assert.ok(billService.includes("baseRateForCeiling"), "MRP applies to the dish price, not the configured extras on top");

for (const migration of [
  readRepo("prisma/migrations/20260808120000_menu_addons/migration.sql"),
  readRepo("prisma-postgres/migrations/000096_menu_addons/migration.sql"),
]) {
  for (const model of ["MenuAddonGroup", "MenuAddonOption", "ProductAddonGroup", "BillItemAddon"]) {
    assert.ok(migration.includes(`\"${model}\"`), `the add-on migration must create ${model}`);
  }
  assert.ok(migration.includes("linkedQtyBase"), "the stock quantity per option must deploy with the schema");
  assert.ok(migration.includes("pricePaise"), "sold option money needs its integer shadow");
}


/* ── Combos (a thali, a meal deal) ────────────────────────────────────────────
 *
 * A combo is a Product sold at its own price, so nothing in the money path is
 * under test here. What is under test is the expansion: what a sold thali takes
 * out of the kitchen, and that it cannot be built into a shape that loops.
 */

{
  // Two roti in a thali, two thalis sold, plus a thali that shares a component.
  const components = [
    { comboProductId: "thali", componentProductId: "roti", componentName: "Roti", quantity: 2 },
    { comboProductId: "thali", componentProductId: "dal", componentName: "Dal", quantity: 1 },
    { comboProductId: "mini", componentProductId: "roti", componentName: "Roti", quantity: 1 },
  ];
  const expanded = expandComboPortions(new Map([["thali", 2], ["mini", 1]]), components);
  const byId = new Map(expanded.map((row) => [row.componentProductId, row.portions]));
  // 2 thalis x 2 roti + 1 mini x 1 roti. Aggregated to ONE roti figure: two
  // movements for one ingredient makes the kitchen ledger read like two events.
  assert.equal(byId.get("roti"), 5, "a component shared by two combos aggregates into one figure");
  assert.equal(byId.get("dal"), 2);
  assert.equal(expanded.length, 2);
}

{
  // A half thali must take half of everything, which is what the caller passes in
  // after scaling by the selected portion's conversionToBase.
  const expanded = expandComboPortions(new Map([["thali", 0.5]]), [
    { comboProductId: "thali", componentProductId: "rice", componentName: "Rice", quantity: 1 },
  ]);
  assert.equal(expanded[0].portions, 0.5, "a half combo consumes half of each component");
}

{
  // A combo nobody ordered, and a component quantity of zero, both consume nothing
  // rather than producing a zero-quantity stock movement.
  assert.deepStrictEqual(expandComboPortions(new Map(), [
    { comboProductId: "thali", componentProductId: "rice", componentName: "Rice", quantity: 1 },
  ]), []);
  assert.deepStrictEqual(expandComboPortions(new Map([["thali", 1]]), [
    { comboProductId: "thali", componentProductId: "rice", componentName: "Rice", quantity: 0 },
  ]), []);
}

{
  const prices = new Map([["roti", 15], ["dal", 90], ["rice", 60]]);
  const components = [
    { componentProductId: "roti", quantity: 2 },
    { componentProductId: "dal", quantity: 1 },
    { componentProductId: "rice", quantity: 1 },
  ];
  const value = comboSaving(150, components, prices);
  assert.equal(value.separately, 180, "the parts are priced at their own à la carte rates");
  assert.equal(value.saving, 30);
  assert.equal(value.dearerThanParts, false);

  // A combo priced ABOVE its parts saves nothing — it does not "save minus forty".
  // The owner pricing it should see the flag rather than a negative number.
  const bad = comboSaving(200, components, prices);
  assert.equal(bad.saving, 0, "a combo dearer than its parts saves nothing");
  assert.equal(bad.dearerThanParts, true, "and says so, so an owner can see the mistake");

  // A component deleted from the catalogue prices as nothing rather than NaN,
  // which would render as "₹NaN off" on a menu.
  assert.equal(comboSaving(150, [{ componentProductId: "gone", quantity: 1 }], prices).separately, 0);
}

{
  const combosGuard = read("verticals/restaurant/menu/combos.guard.js");
  // Two traps that a later edit could silently reintroduce, both invisible in a
  // passing unit test, so they are pinned against the source.
  //
  // 1. The ledger action must stay "recipe_use". The assurance rule for stock
  //    moved after a daily-closing lock skips exactly "sale" and "recipe_use", so
  //    a new action would raise a finding per component of every combo served
  //    after the lock.
  assert.ok(combosGuard.includes('action: "recipe_use"'), "combo consumption must reuse the recipe_use ledger action");
  assert.ok(!combosGuard.includes('action: "sale"'), "combo components must not be logged as sales, which would double-count the thali");
  // 2. The idempotency key must NOT share the recipe guard's prefix. A dish sold
  //    both a la carte and inside a thali produces a movement from each guard for
  //    one ingredient; a shared key makes the second a duplicate and under-depletes.
  assert.ok(combosGuard.includes("`combo:${bill.id}:"), "combo movements need their own idempotency prefix");
  assert.ok(!combosGuard.includes("`recipe:${bill.id}:"), "sharing the recipe prefix would drop one of two legitimate movements");
}

{
  const service = read("verticals/restaurant/menu/combos.service.js");
  // Depth one, enforced in both directions, is what makes a cycle unwritable —
  // so the sale path never has to detect one when the only answer left would be
  // to refuse a guest's bill.
  assert.ok(service.includes("cannot contain itself"), "a combo must refuse to contain itself");
  assert.ok(service.includes("is itself a combo"), "a combo must refuse a nested combo");
  assert.ok(service.includes("already a dish inside another combo"), "and must refuse the reverse nesting too");
}

for (const migration of [
  readRepo("prisma/migrations/20260808140000_menu_combos/migration.sql"),
  readRepo("prisma-postgres/migrations/000100_menu_combos/migration.sql"),
]) {
  assert.ok(migration.includes('"MenuComboComponent"'), "the combo migration must create MenuComboComponent");
  assert.ok(migration.includes("componentName"), "the component name is copied so a report reads without a join");
}

console.log("restaurant-tables-menu.examples.js OK");

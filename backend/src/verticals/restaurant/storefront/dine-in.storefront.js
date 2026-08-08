import { registerStorefrontMode } from "../../../shared/storefront-modes.js";
import { businessTypeFromSettings } from "../../registry.js";
import { groupMenuByCourse, parseTags, PORTION_UNIT_TYPE, UNCATEGORISED_COURSE } from "../menu/menu.service.js";
import { addonGroupsByProduct, validateSelection } from "../menu/addons.service.js";
import { portionsPossible } from "../recipes/recipes.service.js";
import { resolvePublicTable } from "../tables/tables.service.js";
import db from "../../../db.js";
import { AppError } from "../../../middleware/error.js";

/**
 * What a guest sees after scanning the QR on their table.
 *
 * The existing public page is a delivery catalogue: search, basket, address,
 * time slot. A guest at table 5 has an address — the table they are sitting at —
 * and wants to read a menu, so this trade serves a different page from the same
 * shop record. Registered through the shared storefront registry so the public
 * catalogue never imports the restaurant pack.
 *
 * Two decisions here are worth stating plainly, because both are places the
 * obvious implementation is wrong:
 *
 * AVAILABILITY IS NOT STOCK. The shared catalogue hides anything whose
 * stockBaseQty is not positive, which is right for a shelf and catastrophic for
 * a kitchen: almost no restaurant stock-counts plates of butter chicken, so that
 * rule would serve every new restaurant a blank menu. A dish is orderable when
 * it is on the menu, has not been 86'd tonight, and — if a recipe says what goes
 * into it — its ingredients can still make one.
 *
 * THE TABLE IS NOT A CREDENTIAL. Its code names a piece of furniture in a public
 * room, and anyone standing there can read it. So it grants exactly one thing:
 * the ability to add to that table's order. It never returns a bill, a running
 * total, another table, or anything about the shop's takings.
 */

const DEFAULT_THEME = "classic";

/**
 * The looks a restaurant can pick between.
 *
 * A named preset rather than a free colour field, because the person choosing is
 * a restaurant owner at 11pm, not a designer — and because a hex code typed into
 * a text box is how a menu ends up with 2:1 contrast and an unreadable price
 * column on a phone in daylight. Each preset is a considered pair of light and
 * dark values, resolved on the guest's device.
 */
export const MENU_THEMES = Object.freeze({
  classic: { accent: "#b45309", surface: "#fffaf3", ink: "#1c1917", label: "Classic" },
  midnight: { accent: "#818cf8", surface: "#0f172a", ink: "#e2e8f0", label: "Midnight bistro" },
  saffron: { accent: "#ea580c", surface: "#fff7ed", ink: "#231206", label: "Saffron" },
  emerald: { accent: "#047857", surface: "#f0fdf4", ink: "#052e16", label: "Emerald" },
  rose: { accent: "#be123c", surface: "#fff1f2", ink: "#3f0714", label: "Rose" },
  slate: { accent: "#0f766e", surface: "#f8fafc", ink: "#0f172a", label: "Slate" },
});

export function isRestaurantShop(settings) {
  return businessTypeFromSettings(settings) === "restaurant";
}

/**
 * The restaurant's own presentation, defaulted so a shop that has configured
 * nothing still gets a menu that looks deliberate rather than unfinished.
 */
export function resolveMenuBranding(settings, shop) {
  const configured = settings?.restaurant?.brand ?? {};
  const themeKey = MENU_THEMES[configured.theme] ? configured.theme : DEFAULT_THEME;
  const theme = MENU_THEMES[themeKey];
  return {
    displayName: String(configured.displayName ?? "").trim() || shop?.name || "Our menu",
    tagline: String(configured.tagline ?? "").trim() || null,
    themeKey,
    accent: /^#[0-9a-fA-F]{6}$/.test(String(configured.accent ?? "")) ? configured.accent : theme.accent,
    surface: theme.surface,
    ink: theme.ink,
    logoUrl: typeof configured.logoUrl === "string" && configured.logoUrl.startsWith("http") ? configured.logoUrl : null,
    footerNote: String(configured.footerNote ?? "").trim() || null,
  };
}

/** Whether guests may place their own orders, as opposed to only reading the menu. */
export function guestOrderingAllowed(settings) {
  return settings?.restaurant?.dineIn?.guestOrders !== false;
}

function toMenuItem(product, { portionsLeft, hasRecipe, addonGroups = [] }) {
  return {
    id: product.id,
    name: product.name,
    // The course is what a menu is organised by; the retail category is not
    // shown to the guest at all, because "general" means nothing to a diner.
    course: String(product.menuCourse ?? "").trim() || UNCATEGORISED_COURSE,
    menuCourse: String(product.menuCourse ?? "").trim() || null,
    menuSortOrder: Number(product.menuSortOrder ?? 0),
    description: product.description ?? null,
    price: Number(product.storefrontPrice ?? product.defaultPricePerRateUnit ?? 0),
    unit: product.rateUnit || product.displayUnit || "plate",
    imageUrl: product.imageUrl ?? null,
    foodType: product.foodType ?? null,
    spiceLevel: product.spiceLevel ?? null,
    prepMinutes: product.prepMinutes ?? null,
    tags: parseTags(product.menuTags),
    hasRecipe,
    // Deliberately coarse. A guest does not need "4 portions left" — that is
    // kitchen information, and showing it invites a rush on the last two. What
    // they need is "order it now or pick something else".
    lastFew: hasRecipe && portionsLeft !== null && portionsLeft > 0 && portionsLeft <= 3,
    variations: (product.sellingUnits ?? [])
      .filter((unit) => unit.unitType === PORTION_UNIT_TYPE && unit.isActive !== false)
      .map((unit) => ({
        unitCode: unit.unitCode,
        name: unit.name,
        price: Number(unit.defaultPrice ?? 0),
        isDefault: unit.isDefault === true,
      })),
    addonGroups,
  };
}

/**
 * Is this dish orderable right now?
 *
 * Exported and pure so the rule that decides what a guest may order can be
 * tested directly, rather than inferred from a catalogue response.
 */
export function dishIsOrderable(product, { components, stock }) {
  if (product.status === "inactive" || product.isActive === false) return false;
  if (product.menuAvailable === false) return false;
  if (!components?.length) return true;
  const possible = portionsPossible(components, stock);
  return possible === null || possible > 0;
}

async function shapeCatalog({ shopId, shop, settings, products, request }) {
  if (!isRestaurantShop(settings)) return null;

  const [components, table, addonsByProduct] = await Promise.all([
    db.dishRecipeComponent.findMany({ where: { shopId } }),
    request?.tableCode ? resolvePublicTable(shopId, request.tableCode) : Promise.resolve(null),
    addonGroupsByProduct(shopId),
  ]);

  const componentsByDish = new Map();
  for (const component of components) {
    if (!componentsByDish.has(component.dishProductId)) componentsByDish.set(component.dishProductId, []);
    componentsByDish.get(component.dishProductId).push(component);
  }
  const stock = new Map(products.map((product) => [product.id, Number(product.stockBaseQty ?? 0)]));

  const items = [];
  for (const product of products) {
    const dishComponents = componentsByDish.get(product.id) ?? null;
    if (!dishIsOrderable(product, { components: dishComponents, stock })) continue;
    items.push(toMenuItem(product, {
      hasRecipe: Boolean(dishComponents?.length),
      portionsLeft: dishComponents?.length ? portionsPossible(dishComponents, stock) : null,
      addonGroups: addonsByProduct.get(product.id) ?? [],
    }));
  }

  const grouped = groupMenuByCourse(items);

  return {
    mode: "dine_in",
    // Kept in the flat shape the existing customer page already understands, so
    // a guest who opens the plain shop link (no table) still gets a working page
    // instead of an empty one.
    products: items.map((item) => ({
      id: item.id,
      name: item.name,
      category: item.course,
      unit: item.unit,
      price: item.price,
      mrp: null,
      imageUrl: item.imageUrl,
    })),
    table,
    // Said explicitly rather than left to be inferred from `table` being null:
    // "you scanned a code we do not recognise" and "you opened the menu without
    // scanning anything" are different situations and read differently.
    tableRequested: Boolean(request?.tableCode),
    guestOrdersEnabled: guestOrderingAllowed(settings),
    branding: resolveMenuBranding(settings, shop),
    menu: grouped.map((section) => ({
      course: section.course,
      items: section.dishes.map(({ menuCourse, ...item }) => item),
    })),
  };
}

async function resolveOrderContext({ shopId, settings, body }) {
  if (!isRestaurantShop(settings)) return null;
  const table = body?.tableCode ? await resolvePublicTable(shopId, body.tableCode) : null;
  if (!table) {
    // No table means a takeaway order placed from the plain menu link. Left to
    // the shared path so a restaurant that also delivers keeps that flow intact.
    return null;
  }
  if (!guestOrderingAllowed(settings)) {
    return { blocked: true, reason: "This restaurant takes orders through its staff." };
  }
  return {
    fulfillmentType: "dine_in",
    tableId: table.id,
    tableName: table.name,
    guestCount: Number.isFinite(Number(body?.guestCount)) ? Math.max(0, Math.min(60, Number(body.guestCount))) : null,
    // A guest at a table has no delivery address, and asking for one is how a
    // dine-in order gets abandoned halfway through.
    requiresAddress: false,
  };
}

/** Server-authoritative restaurant line pricing for public QR orders. */
async function prepareOrderLines({ shopId, settings, rawItems, products, orderableIds }) {
  if (!isRestaurantShop(settings)) return null;
  const addonsByProduct = await addonGroupsByProduct(shopId);
  const byId = new Map(products.map((product) => [product.id, product]));
  const lines = [];

  for (const raw of rawItems) {
    const productId = String(raw?.productId ?? "");
    const product = byId.get(productId);
    const qty = Math.round(Math.max(0, Number(raw?.qty ?? raw?.quantity ?? 0)) * 100) / 100;
    if (!product || qty <= 0 || (orderableIds && !orderableIds.has(productId))) continue;

    const variations = (product.sellingUnits ?? []).filter(
      (unit) => unit.unitType === PORTION_UNIT_TYPE && unit.isActive !== false,
    );
    const requestedVariation = String(raw?.variationCode ?? "").trim();
    const variation = requestedVariation
      ? variations.find((unit) => unit.unitCode === requestedVariation)
      : variations.find((unit) => unit.isDefault) ?? null;
    if (requestedVariation && !variation) {
      throw new AppError(`That portion of ${product.name} is no longer available`, 409, "MENU_VARIATION_UNAVAILABLE");
    }

    const groups = addonsByProduct.get(productId) ?? [];
    const requested = Array.isArray(raw?.addons) ? raw.addons : [];
    const requestedById = new Map();
    for (const row of requested) {
      const optionId = String(row?.optionId ?? "");
      const quantity = Math.max(1, Math.min(20, Math.trunc(Number(row?.quantity ?? 1))));
      if (optionId) requestedById.set(optionId, (requestedById.get(optionId) ?? 0) + quantity);
    }

    const matched = new Set();
    const addons = [];
    for (const group of groups) {
      const chosenIds = [];
      for (const option of group.options ?? []) {
        const quantity = requestedById.get(option.id) ?? 0;
        if (quantity <= 0) continue;
        matched.add(option.id);
        for (let count = 0; count < quantity; count += 1) chosenIds.push(option.id);
        addons.push({
          optionId: option.id,
          groupName: group.name,
          name: option.name,
          price: Number(option.price ?? 0),
          quantity,
        });
      }
      const valid = validateSelection(group, chosenIds);
      if (!valid.ok) throw new AppError(valid.reason, 409, "MENU_ADDON_SELECTION_INVALID");
    }
    if ([...requestedById.keys()].some((id) => !matched.has(id))) {
      throw new AppError(`An option on ${product.name} is no longer available`, 409, "MENU_ADDON_SELECTION_INVALID");
    }

    const basePrice = Number(variation?.defaultPrice ?? product.storefrontPrice ?? product.defaultPricePerRateUnit ?? 0);
    const addonPrice = addons.reduce((sum, option) => sum + option.price * option.quantity, 0);
    const price = Math.round((basePrice + addonPrice + Number.EPSILON) * 100) / 100;
    lines.push({
      productId,
      name: variation ? `${product.name} (${variation.name})` : product.name,
      unit: variation?.name ?? product.rateUnit ?? product.displayUnit ?? "plate",
      price,
      basePrice,
      qty,
      variation: variation ? { unitCode: variation.unitCode, name: variation.name, price: basePrice } : null,
      addons,
    });
  }
  return lines;
}

export function registerDineInStorefront() {
  registerStorefrontMode({ id: "dine_in", shapeCatalog, resolveOrderContext, prepareOrderLines });
}

// Loading this module registers the storefront. It is reached through the
// restaurant pack's routes, so no other trade pays for it.
registerDineInStorefront();

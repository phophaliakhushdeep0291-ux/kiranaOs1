import { useCallback } from "react";
import type { AccentColor } from "./theme";
// Type-only. It used to import the English catalogue as a VALUE to check a
// category against the keys that exist, which no longer works: the catalogue is
// split, and `translations/english` statically pulls the deferred half — a value
// import here would drag nine secondary-screen tables back into the startup
// chunk. The shipped categories are already listed below, so ask them instead.
import type { Translate, TranslationKey } from "./i18n";
import {
  BUSINESS_TYPE_IDS,
  getStoredBusinessType,
  isBusinessType,
  saveBusinessType,
  subscribeToBusinessType,
  useBusinessTypeKey,
  type BusinessType,
} from "./business-type-store";

// The store is the trade's identity; this module is its wardrobe. Re-exported so
// every existing caller keeps one import, while the router's registry can take
// the store alone and leave the copy below out of the startup shell.
export {
  BUSINESS_TYPE_IDS,
  getStoredBusinessType,
  isBusinessType,
  saveBusinessType,
  subscribeToBusinessType,
  useBusinessTypeKey,
  type BusinessType,
} from "./business-type-store";

export type DashboardVariant = "general" | "restaurant" | "technical" | "medical";

export type QuickActionIconKey =
  | "billing" | "payment" | "purchase" | "closing"
  | "inventory" | "products" | "reports" | "suppliers";

export type QuickActionColorKey =
  | "primary" | "sky" | "amber" | "violet" | "emerald" | "rose" | "orange" | "teal";

/**
 * Copy in this table is a dictionary KEY, not the words themselves.
 *
 * This is a module-level constant: it is evaluated when the module is imported,
 * long before a language has been chosen, so a sentence written here could never
 * reach `t()` and rendered in English on every Hindi counter. Naming the key
 * instead defers the choice to render time. The words live in
 * `translations/shop-types.ts`, with the Hindi half beside it.
 */
export interface QuickAction {
  label: TranslationKey;
  href: string;
  icon: QuickActionIconKey;
  color: QuickActionColorKey;
}

export interface NavConfig {
  billing: TranslationKey;    // label for /billing nav item
  products: TranslationKey;   // label for /products nav item
  inventory: TranslationKey;  // label for /inventory nav item
  udhar: TranslationKey;      // label for /udhar nav item
  tagline: TranslationKey;    // sidebar brand tagline
}

export interface DashboardConfig {
  heroTitle: TranslationKey;
  heroSubtitle: TranslationKey;
  kpi: { revenue: TranslationKey; profit: TranslationKey; credit: TranslationKey; cash: TranslationKey; };
  creditLabel: TranslationKey;
  quickActions: [QuickAction, QuickAction, QuickAction, QuickAction];
}

export interface BusinessTypeDefinition {
  /**
   * English, and a WIRE VALUE — not display copy.
   *
   * It is written to `settingsJson.storeProfile.businessType` and read back by
   * `businessTypeFromLabel`, so it has to mean the same thing on both sides of
   * the network and in both languages. Never render it; render `labelKey`.
   */
  label: string;
  labelKey: TranslationKey;
  emoji: string;
  descriptionKey: TranslationKey;
  /**
   * Stored on the product exactly as written here, so these are data and stay
   * English. `categoryLabelKey` turns one into words for display.
   */
  categories: string[];
  /** Unit codes that feed pricing and stock maths. Never translated. */
  primaryUnits: string[];
  voiceExampleKey: TranslationKey;
  defaultAccent: AccentColor;
  dashboardVariant: DashboardVariant;
  navConfig: NavConfig;
  dashboard: DashboardConfig;
}

/**
 * The words for a category value, when it is one the trade ships with.
 *
 * A category the owner typed in themselves has no key and must be shown exactly
 * as they wrote it — so this returns null rather than guessing, and the caller
 * falls back to the raw value.
 */
let shippedCategories: Set<string> | null = null;

export function categoryLabelKey(category: string): TranslationKey | null {
  // Built on first call, not at module scope: `BUSINESS_TYPE_DEFS` is declared
  // further down this file, so a module-level `new Set(...)` over it throws
  // before initialization and takes the whole app down at import.
  //
  // Derived from the table rather than restated, so a trade that gains a
  // category cannot be forgotten here. Whether the DICTIONARY has the matching
  // key is a separate question, asked by vertical-navigation-fit.test.ts.
  shippedCategories ??= new Set(Object.values(BUSINESS_TYPE_DEFS).flatMap((definition) => definition.categories));
  return shippedCategories.has(category) ? (`shopType.category.${category}` as TranslationKey) : null;
}

/** A category in the reader's language, or as typed if the shop invented it. */
export function translateCategory(category: string, t: Translate): string {
  const key = categoryLabelKey(category);
  return key ? t(key) : category.replace(/_/g, " ");
}

/** Choices that may create/change a shop — mirrors OFFERED_BUSINESS_TYPES on the server. */
export function offeredBusinessTypes(): BusinessType[] {
  return [...BUSINESS_TYPE_IDS];
}

/**
 * The category a new product starts in, for this trade.
 *
 * Every form used to start on the literal string "general", which only the
 * custom trade actually lists: the other eleven opened their category picker
 * showing its placeholder, beside a red required star that nothing enforced, and
 * saved a category the shop can neither see in its own list nor filter by. A
 * trade's first category is a real answer, and the shop can change it in one tap.
 */
export function defaultCategoryFor(businessType: BusinessType): string {
  const categories = BUSINESS_TYPE_DEFS[businessType]?.categories ?? [];
  return categories.find((category) => category !== "all") ?? "general";
}

/**
 * Note on `label`: those twelve strings are persisted on shops that already
 * exist and are parsed back by `businessTypeFromLabel`. Changing one silently
 * orphans every shop that stored it — the lookup returns null and the trade
 * falls back to whatever the device happens to remember. Edit
 * `shopType.<key>.label` in the dictionary instead; that is the one on screen.
 */
export const BUSINESS_TYPE_DEFS: Record<BusinessType, BusinessTypeDefinition> = {
  kirana: {
    label: "Kirana / General Store",
    labelKey: "shopType.kirana.label",
    emoji: "🛒",
    descriptionKey: "shopType.kirana.description",
    categories: ["grocery", "dairy", "beverages", "snacks", "household", "personal_care", "stationery", "other"],
    primaryUnits: ["piece", "kg", "gram", "litre", "ml", "packet", "box", "dozen"],
    voiceExampleKey: "shopType.kirana.voiceExample",
    defaultAccent: "blue",
    dashboardVariant: "general",
    navConfig: { billing: "shopType.kirana.nav.billing", products: "shopType.kirana.nav.products", inventory: "shopType.kirana.nav.inventory", udhar: "shopType.kirana.nav.udhar", tagline: "shopType.kirana.nav.tagline" },
    dashboard: {
      heroTitle: "shopType.kirana.hero.title",
      heroSubtitle: "shopType.kirana.hero.subtitle",
      kpi: { revenue: "shopType.kirana.kpi.revenue", profit: "shopType.kirana.kpi.profit", credit: "shopType.kirana.kpi.credit", cash: "shopType.kirana.kpi.cash" },
      creditLabel: "shopType.kirana.creditLabel",
      quickActions: [
        { label: "shopType.kirana.action.1", href: "/billing",        icon: "billing",   color: "primary" },
        { label: "shopType.kirana.action.2", href: "/udhar",          icon: "payment",   color: "sky"     },
        { label: "shopType.kirana.action.3", href: "/purchase-bills", icon: "purchase",  color: "amber"   },
        { label: "shopType.kirana.action.4", href: "/daily-closing",  icon: "closing",   color: "violet"  },
      ],
    },
  },

  clothing: {
    label: "Clothing & Fashion",
    labelKey: "shopType.clothing.label",
    emoji: "👕",
    descriptionKey: "shopType.clothing.description",
    categories: ["men", "women", "kids", "sarees", "fabric", "accessories", "innerwear", "other"],
    primaryUnits: ["piece", "meter", "yard", "set", "dozen", "roll", "bundle"],
    voiceExampleKey: "shopType.clothing.voiceExample",
    defaultAccent: "violet",
    dashboardVariant: "general",
    navConfig: { billing: "shopType.clothing.nav.billing", products: "shopType.clothing.nav.products", inventory: "shopType.clothing.nav.inventory", udhar: "shopType.clothing.nav.udhar", tagline: "shopType.clothing.nav.tagline" },
    dashboard: {
      heroTitle: "shopType.clothing.hero.title",
      heroSubtitle: "shopType.clothing.hero.subtitle",
      kpi: { revenue: "shopType.clothing.kpi.revenue", profit: "shopType.clothing.kpi.profit", credit: "shopType.clothing.kpi.credit", cash: "shopType.clothing.kpi.cash" },
      creditLabel: "shopType.clothing.creditLabel",
      quickActions: [
        { label: "shopType.clothing.action.1", href: "/billing",        icon: "billing",   color: "primary" },
        { label: "shopType.clothing.action.2", href: "/udhar",          icon: "payment",   color: "sky"     },
        { label: "shopType.clothing.action.3", href: "/products",       icon: "products",  color: "violet"  },
        { label: "shopType.clothing.action.4", href: "/reports",        icon: "reports",   color: "amber"   },
      ],
    },
  },

  footwear: {
    label: "Footwear & Shoes",
    labelKey: "shopType.footwear.label",
    emoji: "👟",
    descriptionKey: "shopType.footwear.description",
    categories: ["mens", "womens", "kids", "sandals", "sports", "formal", "casual", "other"],
    primaryUnits: ["pair", "piece", "dozen", "box", "set"],
    voiceExampleKey: "shopType.footwear.voiceExample",
    defaultAccent: "rose",
    dashboardVariant: "general",
    navConfig: { billing: "shopType.footwear.nav.billing", products: "shopType.footwear.nav.products", inventory: "shopType.footwear.nav.inventory", udhar: "shopType.footwear.nav.udhar", tagline: "shopType.footwear.nav.tagline" },
    dashboard: {
      heroTitle: "shopType.footwear.hero.title",
      heroSubtitle: "shopType.footwear.hero.subtitle",
      kpi: { revenue: "shopType.footwear.kpi.revenue", profit: "shopType.footwear.kpi.profit", credit: "shopType.footwear.kpi.credit", cash: "shopType.footwear.kpi.cash" },
      creditLabel: "shopType.footwear.creditLabel",
      quickActions: [
        { label: "shopType.footwear.action.1", href: "/billing",       icon: "billing",   color: "primary" },
        { label: "shopType.footwear.action.2", href: "/udhar",         icon: "payment",   color: "sky"     },
        { label: "shopType.footwear.action.3", href: "/inventory",     icon: "inventory", color: "rose"    },
        { label: "shopType.footwear.action.4", href: "/daily-closing", icon: "closing",   color: "amber"   },
      ],
    },
  },

  auto_parts: {
    label: "Auto Parts & Hardware",
    labelKey: "shopType.auto_parts.label",
    emoji: "🔧",
    descriptionKey: "shopType.auto_parts.description",
    categories: ["engine_parts", "filters", "electrical", "body_parts", "tools", "lubricants", "hardware", "fasteners", "other"],
    primaryUnits: ["piece", "set", "box", "litre", "kg", "dozen", "bundle", "sheet"],
    voiceExampleKey: "shopType.auto_parts.voiceExample",
    defaultAccent: "slate",
    dashboardVariant: "technical",
    navConfig: { billing: "shopType.auto_parts.nav.billing", products: "shopType.auto_parts.nav.products", inventory: "shopType.auto_parts.nav.inventory", udhar: "shopType.auto_parts.nav.udhar", tagline: "shopType.auto_parts.nav.tagline" },
    dashboard: {
      heroTitle: "shopType.auto_parts.hero.title",
      heroSubtitle: "shopType.auto_parts.hero.subtitle",
      kpi: { revenue: "shopType.auto_parts.kpi.revenue", profit: "shopType.auto_parts.kpi.profit", credit: "shopType.auto_parts.kpi.credit", cash: "shopType.auto_parts.kpi.cash" },
      creditLabel: "shopType.auto_parts.creditLabel",
      quickActions: [
        { label: "shopType.auto_parts.action.1", href: "/billing",        icon: "billing",   color: "primary" },
        { label: "shopType.auto_parts.action.2", href: "/purchase-bills", icon: "purchase",  color: "amber"   },
        { label: "shopType.auto_parts.action.3", href: "/suppliers",      icon: "suppliers", color: "sky"     },
        { label: "shopType.auto_parts.action.4", href: "/reports",        icon: "reports",   color: "violet"  },
      ],
    },
  },

  electronics: {
    label: "Electronics & Mobiles",
    labelKey: "shopType.electronics.label",
    emoji: "📱",
    descriptionKey: "shopType.electronics.description",
    categories: ["mobiles", "accessories", "appliances", "computers", "cables", "batteries", "networking", "other"],
    primaryUnits: ["piece", "set", "box", "dozen"],
    voiceExampleKey: "shopType.electronics.voiceExample",
    defaultAccent: "blue",
    dashboardVariant: "general",
    navConfig: { billing: "shopType.electronics.nav.billing", products: "shopType.electronics.nav.products", inventory: "shopType.electronics.nav.inventory", udhar: "shopType.electronics.nav.udhar", tagline: "shopType.electronics.nav.tagline" },
    dashboard: {
      heroTitle: "shopType.electronics.hero.title",
      heroSubtitle: "shopType.electronics.hero.subtitle",
      kpi: { revenue: "shopType.electronics.kpi.revenue", profit: "shopType.electronics.kpi.profit", credit: "shopType.electronics.kpi.credit", cash: "shopType.electronics.kpi.cash" },
      creditLabel: "shopType.electronics.creditLabel",
      quickActions: [
        { label: "shopType.electronics.action.1", href: "/billing",       icon: "billing",   color: "primary" },
        { label: "shopType.electronics.action.2", href: "/udhar",         icon: "payment",   color: "sky"     },
        { label: "shopType.electronics.action.3", href: "/inventory",     icon: "inventory", color: "teal"    },
        { label: "shopType.electronics.action.4", href: "/reports",       icon: "reports",   color: "violet"  },
      ],
    },
  },

  pharmacy: {
    label: "Pharmacy & Medical",
    labelKey: "shopType.pharmacy.label",
    emoji: "💊",
    descriptionKey: "shopType.pharmacy.description",
    categories: ["tablets", "syrups", "injections", "equipment", "vitamins", "topical", "surgical", "other"],
    primaryUnits: ["strip", "tablet", "bottle", "tube", "piece", "box", "ml", "gram"],
    voiceExampleKey: "shopType.pharmacy.voiceExample",
    defaultAccent: "teal",
    dashboardVariant: "medical",
    navConfig: { billing: "shopType.pharmacy.nav.billing", products: "shopType.pharmacy.nav.products", inventory: "shopType.pharmacy.nav.inventory", udhar: "shopType.pharmacy.nav.udhar", tagline: "shopType.pharmacy.nav.tagline" },
    dashboard: {
      heroTitle: "shopType.pharmacy.hero.title",
      heroSubtitle: "shopType.pharmacy.hero.subtitle",
      kpi: { revenue: "shopType.pharmacy.kpi.revenue", profit: "shopType.pharmacy.kpi.profit", credit: "shopType.pharmacy.kpi.credit", cash: "shopType.pharmacy.kpi.cash" },
      creditLabel: "shopType.pharmacy.creditLabel",
      quickActions: [
        { label: "shopType.pharmacy.action.1", href: "/billing",        icon: "billing",   color: "primary" },
        { label: "shopType.pharmacy.action.2", href: "/inventory",      icon: "inventory", color: "teal"    },
        { label: "shopType.pharmacy.action.3", href: "/purchase-bills", icon: "purchase",  color: "amber"   },
        { label: "shopType.pharmacy.action.4", href: "/daily-closing",  icon: "closing",   color: "violet"  },
      ],
    },
  },

  stationery: {
    label: "Stationery & Books",
    labelKey: "shopType.stationery.label",
    emoji: "📚",
    descriptionKey: "shopType.stationery.description",
    categories: ["books", "pens", "notebooks", "art_supplies", "office", "files", "other"],
    primaryUnits: ["piece", "box", "dozen", "packet", "roll", "bundle"],
    voiceExampleKey: "shopType.stationery.voiceExample",
    defaultAccent: "amber",
    dashboardVariant: "general",
    navConfig: { billing: "shopType.stationery.nav.billing", products: "shopType.stationery.nav.products", inventory: "shopType.stationery.nav.inventory", udhar: "shopType.stationery.nav.udhar", tagline: "shopType.stationery.nav.tagline" },
    dashboard: {
      heroTitle: "shopType.stationery.hero.title",
      heroSubtitle: "shopType.stationery.hero.subtitle",
      kpi: { revenue: "shopType.stationery.kpi.revenue", profit: "shopType.stationery.kpi.profit", credit: "shopType.stationery.kpi.credit", cash: "shopType.stationery.kpi.cash" },
      creditLabel: "shopType.stationery.creditLabel",
      quickActions: [
        { label: "shopType.stationery.action.1", href: "/billing",       icon: "billing",   color: "primary" },
        { label: "shopType.stationery.action.2", href: "/products",      icon: "products",  color: "amber"   },
        { label: "shopType.stationery.action.3", href: "/inventory",     icon: "inventory", color: "sky"     },
        { label: "shopType.stationery.action.4", href: "/reports",       icon: "reports",   color: "violet"  },
      ],
    },
  },

  furniture: {
    label: "Furniture & Home",
    labelKey: "shopType.furniture.label",
    emoji: "🪑",
    descriptionKey: "shopType.furniture.description",
    categories: ["bedroom", "living_room", "kitchen", "decor", "lighting", "bedding", "storage", "other"],
    primaryUnits: ["piece", "set", "pair", "box"],
    voiceExampleKey: "shopType.furniture.voiceExample",
    defaultAccent: "orange",
    dashboardVariant: "general",
    navConfig: { billing: "shopType.furniture.nav.billing", products: "shopType.furniture.nav.products", inventory: "shopType.furniture.nav.inventory", udhar: "shopType.furniture.nav.udhar", tagline: "shopType.furniture.nav.tagline" },
    dashboard: {
      heroTitle: "shopType.furniture.hero.title",
      heroSubtitle: "shopType.furniture.hero.subtitle",
      kpi: { revenue: "shopType.furniture.kpi.revenue", profit: "shopType.furniture.kpi.profit", credit: "shopType.furniture.kpi.credit", cash: "shopType.furniture.kpi.cash" },
      creditLabel: "shopType.furniture.creditLabel",
      quickActions: [
        { label: "shopType.furniture.action.1", href: "/billing",       icon: "billing",   color: "primary" },
        { label: "shopType.furniture.action.2", href: "/udhar",         icon: "payment",   color: "sky"     },
        { label: "shopType.furniture.action.3", href: "/products",      icon: "products",  color: "orange"  },
        { label: "shopType.furniture.action.4", href: "/reports",       icon: "reports",   color: "violet"  },
      ],
    },
  },

  cosmetics: {
    label: "Beauty & Cosmetics",
    labelKey: "shopType.cosmetics.label",
    emoji: "💄",
    descriptionKey: "shopType.cosmetics.description",
    categories: ["skincare", "makeup", "haircare", "fragrances", "nailcare", "grooming", "other"],
    primaryUnits: ["piece", "bottle", "tube", "ml", "gram", "box", "set"],
    voiceExampleKey: "shopType.cosmetics.voiceExample",
    defaultAccent: "rose",
    dashboardVariant: "general",
    navConfig: { billing: "shopType.cosmetics.nav.billing", products: "shopType.cosmetics.nav.products", inventory: "shopType.cosmetics.nav.inventory", udhar: "shopType.cosmetics.nav.udhar", tagline: "shopType.cosmetics.nav.tagline" },
    dashboard: {
      heroTitle: "shopType.cosmetics.hero.title",
      heroSubtitle: "shopType.cosmetics.hero.subtitle",
      kpi: { revenue: "shopType.cosmetics.kpi.revenue", profit: "shopType.cosmetics.kpi.profit", credit: "shopType.cosmetics.kpi.credit", cash: "shopType.cosmetics.kpi.cash" },
      creditLabel: "shopType.cosmetics.creditLabel",
      quickActions: [
        { label: "shopType.cosmetics.action.1", href: "/billing",       icon: "billing",   color: "primary" },
        { label: "shopType.cosmetics.action.2", href: "/udhar",         icon: "payment",   color: "rose"    },
        { label: "shopType.cosmetics.action.3", href: "/products",      icon: "products",  color: "sky"     },
        { label: "shopType.cosmetics.action.4", href: "/reports",       icon: "reports",   color: "violet"  },
      ],
    },
  },

  restaurant: {
    label: "Restaurant & Café",
    labelKey: "shopType.restaurant.label",
    emoji: "🍽️",
    descriptionKey: "shopType.restaurant.description",
    categories: ["starters", "main_course", "beverages", "snacks", "desserts", "thali", "other"],
    primaryUnits: ["piece", "plate", "glass", "bottle", "kg", "litre"],
    voiceExampleKey: "shopType.restaurant.voiceExample",
    defaultAccent: "amber",
    dashboardVariant: "restaurant",
    // "Menu" and "Kitchen" belong to the restaurant pack's own screens — the 86
    // list at /menu and the ticket rail at /kitchen, both of which title
    // themselves that way. Reusing the words here put two identical entries in
    // the sidebar pointing at different pages, and hid each specialist screen
    // behind the generic one. These two name what a kitchen actually calls them:
    // the dishes it sells, and the room it keeps stock in.
    navConfig: { billing: "shopType.restaurant.nav.billing", products: "shopType.restaurant.nav.products", inventory: "shopType.restaurant.nav.inventory", udhar: "shopType.restaurant.nav.udhar", tagline: "shopType.restaurant.nav.tagline" },
    dashboard: {
      heroTitle: "shopType.restaurant.hero.title",
      heroSubtitle: "shopType.restaurant.hero.subtitle",
      kpi: { revenue: "shopType.restaurant.kpi.revenue", profit: "shopType.restaurant.kpi.profit", credit: "shopType.restaurant.kpi.credit", cash: "shopType.restaurant.kpi.cash" },
      creditLabel: "shopType.restaurant.creditLabel",
      quickActions: [
        { label: "shopType.restaurant.action.1", href: "/billing",       icon: "billing",   color: "primary" },
        { label: "shopType.restaurant.action.2", href: "/udhar",         icon: "payment",   color: "sky"     },
        { label: "shopType.restaurant.action.3", href: "/products",      icon: "products",  color: "amber"   },
        { label: "shopType.restaurant.action.4", href: "/daily-closing", icon: "closing",   color: "violet"  },
      ],
    },
  },

  manufacturing: {
    label: "Manufacturing, Wholesale & Export",
    labelKey: "shopType.manufacturing.label",
    emoji: "🏭",
    descriptionKey: "shopType.manufacturing.description",
    categories: ["raw_material", "packaging_material", "work_in_progress", "finished_goods", "by_product", "other"],
    primaryUnits: ["kg", "gram", "litre", "ml", "piece", "packet", "pouch", "box", "carton", "pallet"],
    voiceExampleKey: "shopType.manufacturing.voiceExample",
    defaultAccent: "teal",
    dashboardVariant: "technical",
    navConfig: { billing: "shopType.manufacturing.nav.billing", products: "shopType.manufacturing.nav.products", inventory: "shopType.manufacturing.nav.inventory", udhar: "shopType.manufacturing.nav.udhar", tagline: "shopType.manufacturing.nav.tagline" },
    dashboard: {
      heroTitle: "shopType.manufacturing.hero.title",
      heroSubtitle: "shopType.manufacturing.hero.subtitle",
      kpi: { revenue: "shopType.manufacturing.kpi.revenue", profit: "shopType.manufacturing.kpi.profit", credit: "shopType.manufacturing.kpi.credit", cash: "shopType.manufacturing.kpi.cash" },
      creditLabel: "shopType.manufacturing.creditLabel",
      quickActions: [
        { label: "shopType.manufacturing.action.1", href: "/manufacturing", icon: "inventory", color: "teal" },
        { label: "shopType.manufacturing.action.2", href: "/purchase-bills", icon: "purchase", color: "amber" },
        { label: "shopType.manufacturing.action.3", href: "/billing", icon: "billing", color: "primary" },
        { label: "shopType.manufacturing.action.4", href: "/reports", icon: "reports", color: "violet" },
      ],
    },
  },

  other: {
    label: "Other / Custom",
    labelKey: "shopType.other.label",
    emoji: "🏪",
    descriptionKey: "shopType.other.description",
    categories: ["general", "category_a", "category_b", "other"],
    primaryUnits: ["piece", "box", "set", "bundle", "dozen"],
    voiceExampleKey: "shopType.other.voiceExample",
    defaultAccent: "blue",
    dashboardVariant: "general",
    navConfig: { billing: "shopType.other.nav.billing", products: "shopType.other.nav.products", inventory: "shopType.other.nav.inventory", udhar: "shopType.other.nav.udhar", tagline: "shopType.other.nav.tagline" },
    dashboard: {
      heroTitle: "shopType.other.hero.title",
      heroSubtitle: "shopType.other.hero.subtitle",
      kpi: { revenue: "shopType.other.kpi.revenue", profit: "shopType.other.kpi.profit", credit: "shopType.other.kpi.credit", cash: "shopType.other.kpi.cash" },
      creditLabel: "shopType.other.creditLabel",
      quickActions: [
        { label: "shopType.other.action.1", href: "/billing",       icon: "billing",   color: "primary" },
        { label: "shopType.other.action.2", href: "/udhar",         icon: "payment",   color: "sky"     },
        { label: "shopType.other.action.3", href: "/inventory",     icon: "inventory", color: "amber"   },
        { label: "shopType.other.action.4", href: "/reports",       icon: "reports",   color: "violet"  },
      ],
    },
  },
};

export function businessTypeFromLabel(label: unknown): BusinessType | null {
  if (typeof label !== "string") return null;
  const hit = (Object.keys(BUSINESS_TYPE_DEFS) as BusinessType[]).find(
    (key) => BUSINESS_TYPE_DEFS[key].label === label,
  );
  return hit ?? null;
}

/** The trade key plus its copy. Use `useBusinessTypeKey` when the copy is not needed. */
export function useBusinessType() {
  const businessType = useBusinessTypeKey();
  const setBusinessType = useCallback((bt: BusinessType) => saveBusinessType(bt), []);
  return { businessType, setBusinessType, def: BUSINESS_TYPE_DEFS[businessType] };
}

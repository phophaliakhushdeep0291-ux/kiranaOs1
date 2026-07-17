import { useCallback, useSyncExternalStore } from "react";
import type { AccentColor } from "./theme";

export type BusinessType =
  | "kirana" | "clothing" | "footwear" | "auto_parts" | "electronics"
  | "pharmacy" | "stationery" | "furniture" | "cosmetics" | "restaurant" | "other";

export type DashboardVariant = "general" | "restaurant" | "technical" | "medical";

export type QuickActionIconKey =
  | "billing" | "payment" | "purchase" | "closing"
  | "inventory" | "products" | "reports" | "suppliers";

export type QuickActionColorKey =
  | "primary" | "sky" | "amber" | "violet" | "emerald" | "rose" | "orange" | "teal";

export interface QuickAction {
  label: string;
  href: string;
  icon: QuickActionIconKey;
  color: QuickActionColorKey;
}

export interface NavConfig {
  billing: string;    // label for /billing nav item
  products: string;   // label for /products nav item
  inventory: string;  // label for /inventory nav item
  udhar: string;      // label for /udhar nav item
  tagline: string;    // sidebar brand tagline
}

export interface DashboardConfig {
  heroTitle: string;
  heroSubtitle: string;
  kpi: { revenue: string; profit: string; credit: string; cash: string; };
  creditLabel: string;
  quickActions: [QuickAction, QuickAction, QuickAction, QuickAction];
}

export interface BusinessTypeDefinition {
  label: string;
  emoji: string;
  description: string;
  categories: string[];
  primaryUnits: string[];
  voiceExample: string;
  defaultAccent: AccentColor;
  dashboardVariant: DashboardVariant;
  navConfig: NavConfig;
  dashboard: DashboardConfig;
}

export const BUSINESS_TYPE_DEFS: Record<BusinessType, BusinessTypeDefinition> = {
  kirana: {
    label: "Kirana / General Store",
    emoji: "🛒",
    description: "Grocery, FMCG, daily essentials",
    categories: ["grocery", "dairy", "beverages", "snacks", "household", "personal_care", "stationery", "other"],
    primaryUnits: ["piece", "kg", "gram", "litre", "ml", "packet", "box", "dozen"],
    voiceExample: "name aata, cost 40, selling 45, stock 10 kg, category grocery",
    defaultAccent: "blue",
    dashboardVariant: "general",
    navConfig: { billing: "Billing", products: "Products", inventory: "Inventory", udhar: "Customers / Udhar", tagline: "Built for busy Indian stores" },
    dashboard: {
      heroTitle: "Today's counter",
      heroSubtitle: "Sales, cash, udhar, and stock at a glance.",
      kpi: { revenue: "Today's Sales", profit: "Gross Profit", credit: "Udhar Outstanding", cash: "Cash Collected" },
      creditLabel: "Udhar",
      quickActions: [
        { label: "New Bill",  href: "/billing",        icon: "billing",   color: "primary" },
        { label: "Collect",   href: "/udhar",          icon: "payment",   color: "sky"     },
        { label: "Purchase",  href: "/purchase-bills", icon: "purchase",  color: "amber"   },
        { label: "Close Day", href: "/daily-closing",  icon: "closing",   color: "violet"  },
      ],
    },
  },

  clothing: {
    label: "Clothing & Fashion",
    emoji: "👕",
    description: "Garments, sarees, fabric, readymade",
    categories: ["men", "women", "kids", "sarees", "fabric", "accessories", "innerwear", "other"],
    primaryUnits: ["piece", "meter", "yard", "set", "dozen", "roll", "bundle"],
    voiceExample: "name cotton shirt, cost 200, selling 350, stock 20 piece, category men",
    defaultAccent: "violet",
    dashboardVariant: "general",
    navConfig: { billing: "New Bill", products: "Catalogue", inventory: "Stock", udhar: "Credit", tagline: "Fashion Counter" },
    dashboard: {
      heroTitle: "Fashion counter",
      heroSubtitle: "Today's sales, stock, and customer credit.",
      kpi: { revenue: "Sales Today", profit: "Gross Margin", credit: "Customer Credit", cash: "Cash In Hand" },
      creditLabel: "Credit",
      quickActions: [
        { label: "New Bill",  href: "/billing",        icon: "billing",   color: "primary" },
        { label: "Collect",   href: "/udhar",          icon: "payment",   color: "sky"     },
        { label: "Catalogue", href: "/products",       icon: "products",  color: "violet"  },
        { label: "Reports",   href: "/reports",        icon: "reports",   color: "amber"   },
      ],
    },
  },

  footwear: {
    label: "Footwear & Shoes",
    emoji: "👟",
    description: "Shoes, sandals, chappals, sports footwear",
    categories: ["mens", "womens", "kids", "sandals", "sports", "formal", "casual", "other"],
    primaryUnits: ["pair", "piece", "dozen", "box", "set"],
    voiceExample: "name sports shoes, cost 400, selling 650, stock 10 pair, category sports",
    defaultAccent: "rose",
    dashboardVariant: "general",
    navConfig: { billing: "New Bill", products: "Catalogue", inventory: "Stock", udhar: "Dues", tagline: "Footwear Counter" },
    dashboard: {
      heroTitle: "Footwear counter",
      heroSubtitle: "Today's billing and inventory overview.",
      kpi: { revenue: "Sales Today", profit: "Gross Margin", credit: "Customer Dues", cash: "Cash In Hand" },
      creditLabel: "Dues",
      quickActions: [
        { label: "New Bill",  href: "/billing",       icon: "billing",   color: "primary" },
        { label: "Collect",   href: "/udhar",         icon: "payment",   color: "sky"     },
        { label: "Stock",     href: "/inventory",     icon: "inventory", color: "rose"    },
        { label: "Close Day", href: "/daily-closing", icon: "closing",   color: "amber"   },
      ],
    },
  },

  auto_parts: {
    label: "Auto Parts & Hardware",
    emoji: "🔧",
    description: "Tractor parts, spare parts, tools, hardware",
    categories: ["engine_parts", "filters", "electrical", "body_parts", "tools", "lubricants", "hardware", "fasteners", "other"],
    primaryUnits: ["piece", "set", "box", "litre", "kg", "dozen", "bundle", "sheet"],
    voiceExample: "name oil filter, cost 120, selling 180, stock 15 piece, category filters",
    defaultAccent: "slate",
    dashboardVariant: "technical",
    navConfig: { billing: "New Bill", products: "Parts", inventory: "Godown", udhar: "Khata", tagline: "Parts & Hardware" },
    dashboard: {
      heroTitle: "Parts & hardware",
      heroSubtitle: "Sales, supplier dues, and credit outstanding.",
      kpi: { revenue: "Sales Today", profit: "Gross Margin", credit: "Party Credit", cash: "Cash Collected" },
      creditLabel: "Party Credit",
      quickActions: [
        { label: "New Bill",  href: "/billing",        icon: "billing",   color: "primary" },
        { label: "Purchase",  href: "/purchase-bills", icon: "purchase",  color: "amber"   },
        { label: "Suppliers", href: "/suppliers",      icon: "suppliers", color: "sky"     },
        { label: "Reports",   href: "/reports",        icon: "reports",   color: "violet"  },
      ],
    },
  },

  electronics: {
    label: "Electronics & Mobiles",
    emoji: "📱",
    description: "Phones, appliances, accessories, cables",
    categories: ["mobiles", "accessories", "appliances", "computers", "cables", "batteries", "networking", "other"],
    primaryUnits: ["piece", "set", "box", "dozen"],
    voiceExample: "name earphones, cost 300, selling 550, stock 8 piece, category accessories",
    defaultAccent: "blue",
    dashboardVariant: "general",
    navConfig: { billing: "New Bill", products: "Products", inventory: "Stock", udhar: "Credit", tagline: "Electronics Counter" },
    dashboard: {
      heroTitle: "Electronics sales",
      heroSubtitle: "Today's billing and payment tracking.",
      kpi: { revenue: "Sales Today", profit: "Gross Margin", credit: "Customer Credit", cash: "Cash Collected" },
      creditLabel: "Credit",
      quickActions: [
        { label: "New Bill",  href: "/billing",       icon: "billing",   color: "primary" },
        { label: "Collect",   href: "/udhar",         icon: "payment",   color: "sky"     },
        { label: "Inventory", href: "/inventory",     icon: "inventory", color: "teal"    },
        { label: "Reports",   href: "/reports",       icon: "reports",   color: "violet"  },
      ],
    },
  },

  pharmacy: {
    label: "Pharmacy & Medical",
    emoji: "💊",
    description: "Medicines, medical equipment, health products",
    categories: ["tablets", "syrups", "injections", "equipment", "vitamins", "topical", "surgical", "other"],
    primaryUnits: ["strip", "tablet", "bottle", "tube", "piece", "box", "ml", "gram"],
    voiceExample: "name paracetamol, cost 12, selling 15, stock 50 strip, category tablets",
    defaultAccent: "teal",
    dashboardVariant: "medical",
    navConfig: { billing: "Counter", products: "Medicines", inventory: "Stock", udhar: "Accounts", tagline: "Pharmacy Counter" },
    dashboard: {
      heroTitle: "Pharmacy counter",
      heroSubtitle: "Dispensing, stock, and patient accounts.",
      kpi: { revenue: "Sales Today", profit: "Gross Margin", credit: "Patient Accounts", cash: "Cash Collected" },
      creditLabel: "Patient Accounts",
      quickActions: [
        { label: "Counter",   href: "/billing",        icon: "billing",   color: "primary" },
        { label: "Medicines", href: "/inventory",      icon: "inventory", color: "teal"    },
        { label: "Purchase",  href: "/purchase-bills", icon: "purchase",  color: "amber"   },
        { label: "Close Day", href: "/daily-closing",  icon: "closing",   color: "violet"  },
      ],
    },
  },

  stationery: {
    label: "Stationery & Books",
    emoji: "📚",
    description: "Books, pens, notebooks, office supplies",
    categories: ["books", "pens", "notebooks", "art_supplies", "office", "files", "other"],
    primaryUnits: ["piece", "box", "dozen", "packet", "roll", "bundle"],
    voiceExample: "name ball pen, cost 5, selling 10, stock 100 dozen, category pens",
    defaultAccent: "amber",
    dashboardVariant: "general",
    navConfig: { billing: "New Bill", products: "Products", inventory: "Stock", udhar: "Credit", tagline: "Stationery Counter" },
    dashboard: {
      heroTitle: "Stationery counter",
      heroSubtitle: "Today's sales and stock overview.",
      kpi: { revenue: "Sales Today", profit: "Gross Margin", credit: "Customer Credit", cash: "Cash In Hand" },
      creditLabel: "Credit",
      quickActions: [
        { label: "New Bill",  href: "/billing",       icon: "billing",   color: "primary" },
        { label: "Products",  href: "/products",      icon: "products",  color: "amber"   },
        { label: "Inventory", href: "/inventory",     icon: "inventory", color: "sky"     },
        { label: "Reports",   href: "/reports",       icon: "reports",   color: "violet"  },
      ],
    },
  },

  furniture: {
    label: "Furniture & Home",
    emoji: "🪑",
    description: "Furniture, décor, home furnishings",
    categories: ["bedroom", "living_room", "kitchen", "decor", "lighting", "bedding", "storage", "other"],
    primaryUnits: ["piece", "set", "pair", "box"],
    voiceExample: "name study chair, cost 2500, selling 3800, stock 5 piece, category bedroom",
    defaultAccent: "orange",
    dashboardVariant: "general",
    navConfig: { billing: "New Bill", products: "Products", inventory: "Stock", udhar: "Dues", tagline: "Furniture Showroom" },
    dashboard: {
      heroTitle: "Furniture showroom",
      heroSubtitle: "Sales, customer dues, and delivery.",
      kpi: { revenue: "Sales Today", profit: "Gross Margin", credit: "Customer Dues", cash: "Cash Collected" },
      creditLabel: "Dues",
      quickActions: [
        { label: "New Bill", href: "/billing",       icon: "billing",   color: "primary" },
        { label: "Collect",  href: "/udhar",         icon: "payment",   color: "sky"     },
        { label: "Products", href: "/products",      icon: "products",  color: "orange"  },
        { label: "Reports",  href: "/reports",       icon: "reports",   color: "violet"  },
      ],
    },
  },

  cosmetics: {
    label: "Beauty & Cosmetics",
    emoji: "💄",
    description: "Skincare, makeup, haircare, salon products",
    categories: ["skincare", "makeup", "haircare", "fragrances", "nailcare", "grooming", "other"],
    primaryUnits: ["piece", "bottle", "tube", "ml", "gram", "box", "set"],
    voiceExample: "name face cream, cost 80, selling 150, stock 20 piece, category skincare",
    defaultAccent: "rose",
    dashboardVariant: "general",
    navConfig: { billing: "New Bill", products: "Products", inventory: "Stock", udhar: "Credit", tagline: "Beauty Counter" },
    dashboard: {
      heroTitle: "Beauty counter",
      heroSubtitle: "Today's sales and customer care.",
      kpi: { revenue: "Sales Today", profit: "Gross Margin", credit: "Customer Credit", cash: "Cash In Hand" },
      creditLabel: "Credit",
      quickActions: [
        { label: "New Bill",  href: "/billing",       icon: "billing",   color: "primary" },
        { label: "Collect",   href: "/udhar",         icon: "payment",   color: "rose"    },
        { label: "Products",  href: "/products",      icon: "products",  color: "sky"     },
        { label: "Reports",   href: "/reports",       icon: "reports",   color: "violet"  },
      ],
    },
  },

  restaurant: {
    label: "Restaurant & Café",
    emoji: "🍽️",
    description: "Food, snacks, beverages, quick service",
    categories: ["starters", "main_course", "beverages", "snacks", "desserts", "thali", "other"],
    primaryUnits: ["piece", "plate", "glass", "bottle", "kg", "litre"],
    voiceExample: "name dal makhani, cost 60, selling 120, stock 10 kg, category main_course",
    defaultAccent: "amber",
    dashboardVariant: "restaurant",
    navConfig: { billing: "New Order", products: "Menu", inventory: "Kitchen", udhar: "Tabs", tagline: "Restaurant & Café" },
    dashboard: {
      heroTitle: "Restaurant billing",
      heroSubtitle: "Orders, revenue, and daily closing.",
      kpi: { revenue: "Revenue Today", profit: "Gross Margin", credit: "Pending Tabs", cash: "Cash Collected" },
      creditLabel: "Tabs",
      quickActions: [
        { label: "New Order", href: "/billing",       icon: "billing",   color: "primary" },
        { label: "Collect",   href: "/udhar",         icon: "payment",   color: "sky"     },
        { label: "Menu",      href: "/products",      icon: "products",  color: "amber"   },
        { label: "Close Day", href: "/daily-closing", icon: "closing",   color: "violet"  },
      ],
    },
  },

  other: {
    label: "Other / Custom",
    emoji: "🏪",
    description: "Any other retail business",
    categories: ["general", "category_a", "category_b", "other"],
    primaryUnits: ["piece", "box", "set", "bundle", "dozen"],
    voiceExample: "name product, cost 100, selling 150, stock 10 piece, category general",
    defaultAccent: "blue",
    dashboardVariant: "general",
    navConfig: { billing: "New Bill", products: "Products", inventory: "Inventory", udhar: "Credit", tagline: "Retail Counter" },
    dashboard: {
      heroTitle: "Business counter",
      heroSubtitle: "Sales, stock, and daily management.",
      kpi: { revenue: "Sales Today", profit: "Gross Margin", credit: "Customer Credit", cash: "Cash Collected" },
      creditLabel: "Credit",
      quickActions: [
        { label: "New Bill",  href: "/billing",       icon: "billing",   color: "primary" },
        { label: "Collect",   href: "/udhar",         icon: "payment",   color: "sky"     },
        { label: "Inventory", href: "/inventory",     icon: "inventory", color: "amber"   },
        { label: "Reports",   href: "/reports",       icon: "reports",   color: "violet"  },
      ],
    },
  },
};

const LS_KEY = "kirana-os:ui-business-type:v1";

export function isBusinessType(value: unknown): value is BusinessType {
  return typeof value === "string" && value in BUSINESS_TYPE_DEFS;
}

export function businessTypeFromLabel(label: unknown): BusinessType | null {
  if (typeof label !== "string") return null;
  const hit = (Object.keys(BUSINESS_TYPE_DEFS) as BusinessType[]).find(
    (key) => BUSINESS_TYPE_DEFS[key].label === label,
  );
  return hit ?? null;
}

// Module-level reactive store: every component using useBusinessType() re-renders
// the moment the type changes (settings save, server hydration) — no reload needed.
let currentType: BusinessType = (() => {
  try {
    const saved = localStorage.getItem(LS_KEY);
    return isBusinessType(saved) ? saved : "kirana";
  } catch {
    return "kirana";
  }
})();
const listeners = new Set<() => void>();

export function getStoredBusinessType(): BusinessType {
  return currentType;
}

export function saveBusinessType(bt: BusinessType) {
  if (!isBusinessType(bt)) return;
  currentType = bt;
  try {
    localStorage.setItem(LS_KEY, bt);
  } catch { /* private mode */ }
  listeners.forEach((notify) => notify());
}

function subscribe(notify: () => void) {
  listeners.add(notify);
  return () => { listeners.delete(notify); };
}

export function useBusinessType() {
  const businessType = useSyncExternalStore(subscribe, getStoredBusinessType);
  const setBusinessType = useCallback((bt: BusinessType) => saveBusinessType(bt), []);
  return { businessType, setBusinessType, def: BUSINESS_TYPE_DEFS[businessType] };
}

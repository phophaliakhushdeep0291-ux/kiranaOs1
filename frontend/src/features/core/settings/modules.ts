import { useCallback, useSyncExternalStore } from "react";
import { getStoredBusinessType, useBusinessType, type BusinessType } from "./business-types";

/**
 * App modules ("services") the owner can switch off to declutter the app.
 *
 * Switching a module off only hides its entry points — sidebar, mobile menu,
 * dashboard quick actions, floating helpers. Nothing is deleted and no data
 * stops syncing, so a module can be switched back on at any time and the route
 * still works if something deep-links straight to it.
 *
 * Billing, Dashboard, Settings and Cloud Backup are deliberately not listed:
 * they are the app's spine and hiding them would strand the user.
 */
export type ModuleId =
  | "sales_history"
  | "returns"
  | "rentals"
  | "prescriptions"
  | "serial_units"
  | "part_fitment"
  | "book_lists"
  | "size_runs"
  | "furniture_orders"
  | "testers"
  | "customers"
  | "products"
  | "inventory"
  | "purchases"
  | "expenses"
  | "money"
  | "reports"
  | "offers"
  | "loyalty"
  | "gift_cards"
  | "assurance"
  | "activity"
  | "staff"
  | "audit_logs"
  | "ask_artha"
  | "voice_assistant"
  | "report_issue";

export type ModuleGroup = "Sell" | "Stock & buying" | "Money & growth" | "Manage" | "On-screen helpers";

export const MODULE_GROUPS: ModuleGroup[] = ["Sell", "Stock & buying", "Money & growth", "Manage", "On-screen helpers"];

export interface ModuleDefinition {
  id: ModuleId;
  group: ModuleGroup;
  label: string;
  description: string;
  /** Route prefixes this module owns. Empty for helpers that have no page. */
  paths: string[];
  /**
   * Business types this module is on for until the owner says otherwise. Omit for
   * the modules every shop wants; list them for a trade-specific one so a kirana
   * store is not shown a feature it will never use — it stays one switch away in
   * Settings → Modules, and an explicit choice always beats this default.
   */
  defaultForBusinessTypes?: BusinessType[];
}

export const MODULE_DEFS: ModuleDefinition[] = [
  // ── Sell ────────────────────────────────────────────────────────────────────
  {
    id: "sales_history",
    group: "Sell",
    label: "Bills & sales history",
    description: "Past bills, customer QR orders, sales overview",
    paths: ["/bills", "/orders-received", "/sales-overview"],
  },
  {
    id: "returns",
    group: "Sell",
    label: "Returns & refunds",
    description: "Take items back and settle refunds",
    paths: ["/returns"],
  },
  {
    id: "rentals",
    group: "Sell",
    label: "Rentals",
    description: "Rent garments out for a run of days and keep them off the catalogue meanwhile",
    paths: ["/rentals"],
    // Renting stock out is a clothing-shop trade; other verticals can switch it on.
    defaultForBusinessTypes: ["clothing"],
  },
  {
    id: "prescriptions",
    group: "Sell",
    label: "Prescription register",
    description: "Record who prescribed a medicine, for whom, and what was dispensed",
    paths: ["/prescriptions"],
    // The register a chemist has to produce on inspection; other verticals can
    // switch it on if they dispense against prescriptions too.
    defaultForBusinessTypes: ["pharmacy"],
  },
  {
    id: "serial_units",
    group: "Sell",
    label: "IMEI & serial register",
    description: "Track each handset or appliance by its own number, with warranty cover",
    paths: ["/serial-units"],
    // Naming each piece of stock is an electronics trade; other verticals can
    // switch it on if they sell serialised goods too.
    defaultForBusinessTypes: ["electronics"],
  },
  {
    id: "part_fitment",
    group: "Sell",
    label: "Part finder",
    description: "Look up which parts fit a customer's vehicle, and what else will do",
    paths: ["/fitment"],
    // "Does this fit?" is an auto-parts question; a hardware shop runs the same
    // pack without it, and can switch it on if it starts stocking for vehicles.
    defaultForBusinessTypes: ["auto_parts"],
  },
  {
    id: "book_lists",
    group: "Sell",
    label: "Class book lists",
    description: "A school class's whole set on one bill, and what you are short of before term",
    paths: ["/book-lists"],
    // A book shop's trade, but a general store next to a school sells sets too.
    defaultForBusinessTypes: ["stationery"],
  },
  {
    id: "furniture_orders",
    group: "Sell",
    label: "Order book",
    description: "Quotes, advances and deliveries for goods that leave the shop later",
    paths: ["/orders"],
    // Selling before the goods leave the floor is a showroom trade; any shop
    // that quotes and delivers later can switch it on.
    defaultForBusinessTypes: ["furniture"],
  },
  {
    id: "customers",
    group: "Sell",
    label: "Customers & udhar",
    description: "Customer list, credit ledger, collections",
    paths: ["/customers", "/udhar"],
  },

  // ── Stock & buying ──────────────────────────────────────────────────────────
  {
    id: "products",
    group: "Stock & buying",
    label: "Products & categories",
    description: "Product catalogue, pricing and categories",
    paths: ["/products", "/categories"],
  },
  {
    id: "testers",
    group: "Stock & buying",
    label: "Tester stock",
    description: "Track what is open on the counter, and what testers are costing you",
    paths: ["/testers"],
    // Putting stock out for customers to try is a beauty-counter trade; any shop
    // that does it can switch it on.
    defaultForBusinessTypes: ["cosmetics"],
  },
  {
    id: "size_runs",
    group: "Stock & buying",
    label: "Size runs",
    description: "See the gaps in each style's size run, and find stock by a customer's own size",
    paths: ["/size-runs"],
    // Selling by the pair in a size system is a footwear trade; a sports shop
    // stocking shoes alongside other goods can switch it on.
    defaultForBusinessTypes: ["footwear"],
  },
  {
    id: "inventory",
    group: "Stock & buying",
    label: "Stock & inventory",
    description: "Stock in / out, adjustments, transfers, batches",
    paths: ["/inventory"],
  },
  {
    id: "purchases",
    group: "Stock & buying",
    label: "Purchases & suppliers",
    description: "Supplier bills, dues and payments",
    paths: ["/purchase-bills", "/suppliers"],
  },

  // ── Money & growth ──────────────────────────────────────────────────────────
  {
    id: "expenses",
    group: "Money & growth",
    label: "Expenses",
    description: "Day-to-day shop spending",
    paths: ["/expenses"],
  },
  {
    id: "money",
    group: "Money & growth",
    label: "Cash & payments",
    description: "Money statement and daily closing",
    paths: ["/money-statement", "/daily-closing"],
  },
  {
    id: "reports",
    group: "Money & growth",
    label: "Reports & analytics",
    description: "Sales, profit and performance reports",
    paths: ["/reports"],
  },
  {
    id: "offers",
    group: "Money & growth",
    label: "Offers & discounts",
    description: "Discount rules and promotions",
    paths: ["/offers"],
  },
  {
    id: "loyalty",
    group: "Money & growth",
    label: "Loyalty",
    description: "Points and member rewards",
    paths: ["/loyalty"],
  },
  {
    id: "gift_cards",
    group: "Money & growth",
    label: "Gift cards",
    description: "Issue and redeem gift cards",
    paths: ["/gift-cards"],
  },

  // ── Manage ──────────────────────────────────────────────────────────────────
  {
    id: "assurance",
    group: "Manage",
    label: "Financial assurance",
    description: "Automated audit rules, findings and evidence",
    paths: ["/assurance"],
  },
  {
    id: "activity",
    group: "Manage",
    label: "Activity & insights",
    description: "How this shop uses Artha",
    paths: ["/activity-insights"],
  },
  {
    id: "staff",
    group: "Manage",
    label: "Staff",
    description: "Staff accounts and permissions",
    paths: ["/staff"],
  },
  {
    id: "audit_logs",
    group: "Manage",
    label: "Audit trail",
    description: "Record of important actions",
    paths: ["/audit-logs"],
  },
  {
    id: "ask_artha",
    group: "Manage",
    label: "Ask Artha",
    description: "AI answers from your own shop data",
    paths: ["/help"],
  },

  // ── On-screen helpers ───────────────────────────────────────────────────────
  {
    id: "voice_assistant",
    group: "On-screen helpers",
    label: "Voice assistant button",
    description: "Floating mic button on every screen",
    paths: [],
  },
  {
    id: "report_issue",
    group: "On-screen helpers",
    label: "Report issue button",
    description: "Floating support button on every screen",
    paths: [],
  },
];

/**
 * Only explicit choices are stored, so a module added in a later release
 * shows up for everyone instead of being silently off for existing shops.
 */
export type ModuleVisibility = Partial<Record<ModuleId, boolean>>;

const LS_KEY = "kirana-os:ui-modules:v1";
const KNOWN_IDS = new Set<string>(MODULE_DEFS.map((module) => module.id));

export function isModuleId(value: unknown): value is ModuleId {
  return typeof value === "string" && KNOWN_IDS.has(value);
}

/** Drops unknown keys and non-boolean values from a stored/served blob. */
export function sanitizeModuleVisibility(value: unknown): ModuleVisibility {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const clean: ModuleVisibility = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    // Settings blobs round-trip through JSON and older writers stored 0/1 —
    // treat anything that is not an explicit "off" as on.
    if (!isModuleId(key)) continue;
    if (typeof raw === "boolean") clean[key] = raw;
    else if (raw === 0 || raw === 1) clean[key] = raw === 1;
    else if (raw === "true" || raw === "false") clean[key] = raw === "true";
  }
  return clean;
}

function cleanPath(path: string) {
  return (path.split(/[?#]/)[0] || "/").replace(/\/+$/, "") || "/";
}

/**
 * Which module owns a route, longest prefix first so `/inventory/batches`
 * resolves to inventory and `/products/x/pricing` to products.
 * Returns null for routes no module owns — those are always visible.
 */
export function moduleForPath(path: string): ModuleId | null {
  const target = cleanPath(path);
  let best: { id: ModuleId; length: number } | null = null;
  for (const module of MODULE_DEFS) {
    for (const owned of module.paths) {
      const root = cleanPath(owned);
      if (target !== root && !target.startsWith(`${root}/`)) continue;
      if (!best || root.length > best.length) best = { id: module.id, length: root.length };
    }
  }
  return best?.id ?? null;
}

// Module-level reactive store: every component reading module visibility
// re-renders the moment a toggle flips or the server value hydrates.
let visibility: ModuleVisibility = (() => {
  try {
    return sanitizeModuleVisibility(JSON.parse(localStorage.getItem(LS_KEY) ?? "{}"));
  } catch {
    return {};
  }
})();

const listeners = new Set<() => void>();

export function getModuleVisibility(): ModuleVisibility {
  return visibility;
}

function sameVisibility(a: ModuleVisibility, b: ModuleVisibility) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (a[key as ModuleId] !== b[key as ModuleId]) return false;
  }
  return true;
}

export function saveModuleVisibility(next: ModuleVisibility): ModuleVisibility {
  const clean = sanitizeModuleVisibility(next);
  if (sameVisibility(clean, visibility)) return visibility;
  visibility = clean;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(clean));
  } catch { /* private mode */ }
  listeners.forEach((notify) => notify());
  return visibility;
}

/**
 * Merges a change into whatever is stored *right now* and returns the result.
 * Toggling several switches in quick succession must not have each one merge
 * into the snapshot its own render closed over — that silently drops every
 * change but the last.
 */
export function patchModuleVisibility(partial: ModuleVisibility): ModuleVisibility {
  return saveModuleVisibility({ ...visibility, ...partial });
}

/** Subscribe outside React; returns the unsubscribe. */
export function subscribeToModuleVisibility(notify: () => void) {
  listeners.add(notify);
  return () => { listeners.delete(notify); };
}

const DEFS_BY_ID = new Map(MODULE_DEFS.map((module) => [module.id, module]));

/**
 * Whether a path belongs to a trade this shop actually runs.
 *
 * Core cannot ask the vertical registry directly — the whole point of the
 * split is that the shared spine never depends on one trade's code — so the
 * app installs the answer at startup instead (see `app/providers.tsx`). Until
 * it does, nothing is gated, which is the right behaviour for tests and for
 * any surface that renders before the packs are wired up.
 */
let pathGate: (path: string) => boolean = () => true;

export function setModulePathGate(gate: (path: string) => boolean) {
  pathGate = gate;
}

/**
 * Whether a module is on offer at all for this shop. A module whose every route
 * belongs to another trade is not "switched off" — it does not exist here, and
 * showing the owner a switch for it would be a switch that does nothing.
 */
export function isModuleAvailable(id: ModuleId): boolean {
  const def = DEFS_BY_ID.get(id);
  if (!def || def.paths.length === 0) return true;
  return def.paths.some((path) => pathGate(path));
}

/**
 * Whether a module is on when the owner has never touched its switch: on for
 * everyone, unless the definition limits it to particular trades.
 */
function defaultEnabled(id: ModuleId, businessType: BusinessType): boolean {
  const only = DEFS_BY_ID.get(id)?.defaultForBusinessTypes;
  return !only || only.includes(businessType);
}

function resolveEnabled(value: ModuleVisibility, id: ModuleId, businessType: BusinessType): boolean {
  return value[id] ?? defaultEnabled(id, businessType);
}

/** Non-reactive read, for code paths outside React. */
export function isModuleEnabled(id: ModuleId): boolean {
  return resolveEnabled(visibility, id, getStoredBusinessType());
}

/** Non-reactive route check. Routes no module owns are always enabled. */
export function isPathEnabled(path: string): boolean {
  if (!pathGate(path)) return false;
  const id = moduleForPath(path);
  return id === null || isModuleEnabled(id);
}

export function useModuleVisibility() {
  const value = useSyncExternalStore(subscribeToModuleVisibility, getModuleVisibility, getModuleVisibility);
  // Subscribed rather than read once: a trade-specific module's default flips the
  // moment the owner changes the shop's business type, with no reload.
  const { businessType } = useBusinessType();
  const isEnabled = useCallback((id: ModuleId) => resolveEnabled(value, id, businessType), [value, businessType]);
  const isHrefEnabled = useCallback(
    (href: string) => {
      // Another trade's route is not hidden, it is absent — checked first so a
      // shop can never be offered an entry point into a pack it does not run.
      if (!pathGate(href)) return false;
      const id = moduleForPath(href);
      return id === null || resolveEnabled(value, id, businessType);
    },
    [value, businessType],
  );
  const setVisibility = useCallback((next: ModuleVisibility) => saveModuleVisibility(next), []);
  const patchVisibility = useCallback((partial: ModuleVisibility) => patchModuleVisibility(partial), []);
  return { visibility: value, isEnabled, isHrefEnabled, setVisibility, patchVisibility };
}

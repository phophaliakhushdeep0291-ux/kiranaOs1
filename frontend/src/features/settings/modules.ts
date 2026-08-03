import { useCallback, useSyncExternalStore } from "react";

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

/** Non-reactive read, for code paths outside React. Unset means on. */
export function isModuleEnabled(id: ModuleId): boolean {
  return visibility[id] !== false;
}

/** Non-reactive route check. Routes no module owns are always enabled. */
export function isPathEnabled(path: string): boolean {
  const id = moduleForPath(path);
  return id === null || isModuleEnabled(id);
}

export function useModuleVisibility() {
  const value = useSyncExternalStore(subscribeToModuleVisibility, getModuleVisibility, getModuleVisibility);
  const isEnabled = useCallback((id: ModuleId) => value[id] !== false, [value]);
  const isHrefEnabled = useCallback(
    (href: string) => {
      const id = moduleForPath(href);
      return id === null || value[id] !== false;
    },
    [value],
  );
  const setVisibility = useCallback((next: ModuleVisibility) => saveModuleVisibility(next), []);
  const patchVisibility = useCallback((partial: ModuleVisibility) => patchModuleVisibility(partial), []);
  return { visibility: value, isEnabled, isHrefEnabled, setVisibility, patchVisibility };
}

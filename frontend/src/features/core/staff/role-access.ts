import { loadAuthSession } from "@/lib/storage/auth-storage";

/**
 * The till's copy of the server's role catalogue
 * (backend/src/core/permissions/rbac.js), plus which screens each role may open.
 *
 * Deliberately free of React and of anything heavier than auth storage: the
 * offline write path (`lib/offline/db.ts`) and the sync engine read it, and
 * neither may pull a component tree into the startup bundle.
 *
 * The server is the authority. A signed-in user carries `permissions` from the
 * login response, and that list wins over this table (see `usePermission`);
 * this copy is what an old cached session or a first offline boot falls back
 * on. `tests/role-permissions-parity.test.ts` fails if the two drift.
 */

export const STAFF_ROLES = ["owner", "manager", "cashier", "viewer"] as const;
export type StaffRole = typeof STAFF_ROLES[number];

/** What `User.role` stores for each role the till shows. */
export const SERVER_ROLE: Record<StaffRole, string> = {
  owner: "owner",
  manager: "admin",
  cashier: "staff",
  viewer: "viewer",
};

export const POS_PERMISSIONS = [
  "create_bill",
  "cancel_bill",
  "record_payment",
  "reverse_payment",
  "view_reports",
  "manage_products",
  "manage_customers",
  "manage_inventory",
  "manage_staff",
  "export_data",
  "change_settings",
  "view_profit",
  "apply_discount",
  "sell_below_minimum_price",
] as const;

export type PermissionName = typeof POS_PERMISSIONS[number];

/**
 * What each role can actually do, as the server enforces it.
 *
 * The Staff screen prints this as a role x permission matrix under the heading
 * "Role access enforced by the server", so every cell is a promise about the
 * API. Two cells were once not true, and both were checked by asking the server
 * as each role (backend: tests/integration/staff-report-access.integration.test.js):
 *
 *   - A cashier CAN read the operational reports. Sales summary, daily closing,
 *     payment modes, inventory health and GST are open to every shop user by
 *     design: a cashier closing the till has to see the day's takings.
 *
 *   - A manager CANNOT see profit. /reports/pnl, /top-products and
 *     /monthly-breakdown are owner-only.
 *
 * The owner PIN, not the role, is what stands between a cashier and stock
 * corrections, cancellations and shop settings; without it the server answers
 * "Owner PIN required" to all of them. Those stay dashes here because that is
 * what the cashier experiences.
 *
 * A viewer is read-only everywhere: the server refuses its writes
 * (ROLE_READ_ONLY), and this device refuses to queue them (`lib/offline/db.ts`).
 */
export const ROLE_PERMISSIONS: Record<StaffRole, PermissionName[]> = {
  owner: [...POS_PERMISSIONS],
  manager: [
    "create_bill",
    "cancel_bill",
    "record_payment",
    "reverse_payment",
    "view_reports",
    "manage_products",
    "manage_customers",
    "manage_inventory",
    "export_data",
    "change_settings",
    "apply_discount",
  ],
  cashier: ["create_bill", "record_payment", "manage_customers", "apply_discount", "view_reports"],
  viewer: ["view_reports"],
};

export function normalizeStaffRole(role: string | null | undefined): StaffRole {
  const normalized = String(role ?? "owner").trim().toLowerCase();
  if (normalized === "owner") return "owner";
  if (normalized === "manager" || normalized === "admin") return "manager";
  if (normalized === "cashier" || normalized === "staff") return "cashier";
  if (normalized === "viewer" || normalized === "read_only" || normalized === "readonly") return "viewer";
  return "cashier";
}

/** Only an explicit view-only role is read-only; a missing role is never guessed into one. */
export function isReadOnlyRole(role: string | null | undefined): boolean {
  if (typeof role !== "string" || !role.trim()) return false;
  return normalizeStaffRole(role) === "viewer";
}

/** Whether the login on this device right now is view-only. */
export function isReadOnlySession(): boolean {
  return isReadOnlyRole(loadAuthSession().user?.role);
}

/** The permission list the server sent with the login, when it sent one. */
export function serverPermissions(user: unknown): PermissionName[] | null {
  if (typeof user !== "object" || user === null || Array.isArray(user)) return null;
  const raw = (user as Record<string, unknown>).permissions;
  if (!Array.isArray(raw)) return null;
  return raw.filter((item): item is PermissionName => POS_PERMISSIONS.includes(item as PermissionName));
}

export function effectivePermissions(role: StaffRole, granted?: PermissionName[] | null): PermissionName[] {
  if (role === "owner") return [...POS_PERMISSIONS];
  return [...(granted ?? ROLE_PERMISSIONS[role] ?? [])];
}

export function hasPermission(role: StaffRole, permission: PermissionName, granted?: PermissionName[] | null): boolean {
  return effectivePermissions(role, granted).includes(permission);
}

/** Whether a signed-in user's role holds a permission, preferring the list the server sent. */
export function userHasPermission(user: { role?: string | null } | null | undefined, permission: PermissionName): boolean {
  return hasPermission(normalizeStaffRole(user?.role), permission, serverPermissions(user));
}

/**
 * Screens a role may not open, and why.
 *
 * Two kinds of rule, and each is only ever a screen the server already refuses
 * that role — so a rule here takes nothing away, it replaces a page that loads
 * and then fails with a page that says why:
 *
 *   - `permission`: the screen's own data or its actions are refused outright
 *     (a role guard, not an owner-PIN prompt the owner could approve).
 *   - `changesData`: the screen exists to make changes, so a view-only login
 *     has nothing to do there.
 *
 * Matched against the path with query and hash removed; a rule for `/staff`
 * also covers `/staff/...`.
 */
export interface RouteAccessRule {
  path: string | RegExp;
  permission?: PermissionName;
  changesData?: true;
}

export const ROUTE_ACCESS_RULES: RouteAccessRule[] = [
  { path: "/staff", permission: "manage_staff" },
  { path: "/settings/staff", permission: "manage_staff" },
  { path: "/accounting", permission: "view_profit" },
  { path: "/channel-settlements", permission: "view_profit" },
  { path: "/activity-insights", permission: "view_profit" },
  { path: "/settings/integrations", permission: "change_settings" },
  { path: /^\/products\/[^/]+\/pricing$/, permission: "manage_products" },

  { path: "/billing", changesData: true },
  { path: "/import-order", changesData: true },
  { path: "/returns", changesData: true },
  { path: "/inventory/stock-in", changesData: true },
  { path: "/inventory/stock-out", changesData: true },
  { path: "/inventory/adjustments", changesData: true },
  { path: "/inventory/stock-transfers", changesData: true },
  { path: "/inventory/stock-counts", changesData: true },
  { path: "/purchase-bills", changesData: true },
  { path: "/suppliers", changesData: true },
  { path: "/expenses", changesData: true },
  { path: "/recycle-bin", changesData: true },
  { path: "/settings/setup", changesData: true },
  { path: "/settings/store-profile", changesData: true },
  { path: "/settings/modules", changesData: true },
  { path: "/settings/billing", changesData: true },
  { path: "/settings/taxes", changesData: true },
  { path: "/settings/notifications", changesData: true },
  { path: "/settings/advanced", changesData: true },
];

function ruleMatches(rule: RouteAccessRule, path: string): boolean {
  if (rule.path instanceof RegExp) return rule.path.test(path);
  return path === rule.path || path.startsWith(`${rule.path}/`);
}

export type RouteAccessDecision =
  | { allowed: true }
  | { allowed: false; reason: "read_only" }
  | { allowed: false; reason: "permission"; permission: PermissionName };

export function routeAccessFor(
  rawPath: string,
  role: StaffRole,
  granted?: PermissionName[] | null,
): RouteAccessDecision {
  const path = rawPath.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  for (const rule of ROUTE_ACCESS_RULES) {
    if (!ruleMatches(rule, path)) continue;
    if (rule.changesData && role === "viewer") return { allowed: false, reason: "read_only" };
    if (rule.permission && !hasPermission(role, rule.permission, granted)) {
      return { allowed: false, reason: "permission", permission: rule.permission };
    }
  }
  return { allowed: true };
}

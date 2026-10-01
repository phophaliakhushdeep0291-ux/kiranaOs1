/**
 * Role-based access: the one catalogue of what each role may do.
 *
 * Roles are fixed — the owner picks one for each staff login and the role
 * decides everything. `User.role` stores the value on the left; the till shows
 * the label on the right:
 *
 *   owner   Owner    everything, and the only role whose PIN approves risky work
 *   admin   Manager  runs the shop day to day; no staff, profit or accounts
 *   staff   Cashier  the counter: bills, payments, customers
 *   viewer  Viewer   read-only — can look, cannot change anything
 *
 * This list is what the Staff screen prints as "Role access enforced by the
 * server", so every cell is a promise about the API. The till keeps a copy in
 * `frontend/src/features/core/staff/permissions.ts` for offline boot, and
 * `frontend/src/tests/role-permissions-parity.test.ts` fails if the two differ.
 * `tests/rbac-catalogue.examples.js` binds each owner/manager-only permission
 * to the `requireRole` guards on real routes, so the matrix cannot claim a
 * boundary the routes do not draw.
 *
 * The owner PIN is a separate layer on top of this. A cashier cannot cancel a
 * bill on their own, but the owner standing at the counter can approve it with
 * the PIN; that approval is checked where it always was, not here.
 */

export const ROLES = Object.freeze({
  OWNER: "owner",
  MANAGER: "admin",
  CASHIER: "staff",
  VIEWER: "viewer",
});

/** Roles the owner can give through staff management. Owner transfer is a separate flow. */
export const ASSIGNABLE_STAFF_ROLES = Object.freeze([ROLES.MANAGER, ROLES.CASHIER, ROLES.VIEWER]);

export const PERMISSIONS = Object.freeze([
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
]);

export const ROLE_PERMISSIONS = Object.freeze({
  [ROLES.OWNER]: Object.freeze([...PERMISSIONS]),
  [ROLES.MANAGER]: Object.freeze([
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
  ]),
  [ROLES.CASHIER]: Object.freeze([
    "create_bill",
    "record_payment",
    "manage_customers",
    "apply_discount",
    "view_reports",
  ]),
  [ROLES.VIEWER]: Object.freeze(["view_reports"]),
});

const READ_ONLY_ROLES = new Set([ROLES.VIEWER]);

/** An unknown role holds nothing: access is granted by the catalogue, never by default. */
export function permissionsForRole(role) {
  return [...(ROLE_PERMISSIONS[role] ?? [])];
}

export function roleHasPermission(role, permission) {
  return (ROLE_PERMISSIONS[role] ?? []).includes(permission);
}

export function isReadOnlyRole(role) {
  return READ_ONLY_ROLES.has(role);
}

/**
 * The writes a read-only login still has to make just to stay signed in and
 * be helped. Nothing here changes shop records:
 *
 *   - its own password, and the owner-PIN check the lock screen uses to unlock
 *   - registering and reporting the health of its own device
 *   - sync: `ack` records how far the device has read; `push` is let through
 *     so each event is refused on its own with PERMISSION_DENIED (the till
 *     never pushes from a read-only session — this is the server's backstop)
 *   - usage events, error reports and support requests
 *   - acknowledging a remote-support command, which the device drains for
 *     every signed-in user
 *   - asking the assistant a question (its write tools are hidden from this
 *     role, and confirming a proposed action is not on this list)
 *
 * Paths are matched against the mounted URL, query string removed.
 */
const READ_ONLY_ALLOWED_WRITES = Object.freeze([
  /^\/api\/auth\/change-password$/,
  /^\/api\/auth\/pin\/verify$/,
  /^\/api\/devices\/(activate|heartbeat|health)$/,
  /^\/api\/sync\/(push|ack)$/,
  /^\/api\/activity\/events$/,
  /^\/api\/diagnostics\/(errors|support-requests|assistant)$/,
  /^\/api\/support\/commands\/[^/]+\/ack$/,
  /^\/api\/ai\/agent\/(chat|reject)$/,
  /^\/api\/ai\/feedback$/,
]);

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isReadOnlyAllowedRequest(method, path) {
  if (SAFE_METHODS.has(String(method).toUpperCase())) return true;
  const cleanPath = String(path ?? "").split("?")[0].replace(/\/+$/, "");
  return READ_ONLY_ALLOWED_WRITES.some((pattern) => pattern.test(cleanPath));
}

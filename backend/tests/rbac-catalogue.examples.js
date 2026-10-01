// The role catalogue is only worth something if it describes the routes.
//
// The Staff screen prints `ROLE_PERMISSIONS` as a role x permission matrix
// under "Role access enforced by the server". Most owner/manager boundaries are
// still drawn by `requireRole(...)` on the route itself, so nothing forced the
// two to agree: the matrix once showed a manager could see profit while
// /reports/pnl answered 403. This binds each permission the matrix restricts to
// real routes, and fails when a route's guard admits a different set of roles
// than the catalogue says holds that permission.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  ASSIGNABLE_STAFF_ROLES,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  ROLES,
  isReadOnlyAllowedRequest,
  isReadOnlyRole,
  permissionsForRole,
  roleHasPermission,
} from "../src/core/permissions/rbac.js";
import { inviteStaffSchema, updateStaffSchema } from "../src/modules/auth/auth.schema.js";

const root = process.cwd();
const ALL_ROLES = Object.values(ROLES);

// ── The catalogue itself ────────────────────────────────────────────────────

assert.deepEqual([...ROLE_PERMISSIONS.owner].sort(), [...PERMISSIONS].sort(), "the owner holds every permission");
for (const [role, granted] of Object.entries(ROLE_PERMISSIONS)) {
  for (const permission of granted) {
    assert.ok(PERMISSIONS.includes(permission), `${role} lists unknown permission ${permission}`);
  }
  assert.equal(new Set(granted).size, granted.length, `${role} lists a permission twice`);
}
assert.deepEqual(permissionsForRole("viewer"), ["view_reports"], "a viewer can look at reports and nothing else");
assert.equal(isReadOnlyRole("viewer"), true);
for (const role of ["owner", "admin", "staff"]) assert.equal(isReadOnlyRole(role), false, `${role} is not read-only`);
assert.deepEqual(permissionsForRole("manager"), [], "an unknown role value holds nothing");
assert.deepEqual(permissionsForRole(undefined), []);
assert.equal(ASSIGNABLE_STAFF_ROLES.includes("owner"), false, "owner transfer is not a staff-screen role change");

// Staff management accepts exactly the assignable roles.
for (const role of ASSIGNABLE_STAFF_ROLES) {
  assert.equal(inviteStaffSchema.safeParse({ name: "Asha", mobile: "9876543210", password: "secret1", role }).success, true, `invite as ${role}`);
  assert.equal(updateStaffSchema.safeParse({ role }).success, true, `change to ${role}`);
}
assert.equal(inviteStaffSchema.safeParse({ name: "Asha", mobile: "9876543210", password: "secret1", role: "owner" }).success, false);

// ── The read-only gate ──────────────────────────────────────────────────────

assert.equal(isReadOnlyAllowedRequest("GET", "/api/bills"), true);
assert.equal(isReadOnlyAllowedRequest("HEAD", "/api/bills"), true);
for (const [method, url] of [
  ["POST", "/api/bills/confirm"],
  ["POST", "/api/customers"],
  ["PATCH", "/api/shops"],
  ["DELETE", "/api/products/p1"],
  ["POST", "/api/ai/agent/confirm"],
  ["POST", "/api/sync/retry"],
  ["POST", "/api/auth/pin/set"],
]) {
  assert.equal(isReadOnlyAllowedRequest(method, url), false, `${method} ${url} is a write a viewer must not make`);
}
for (const [method, url] of [
  ["POST", "/api/sync/push"],
  ["POST", "/api/sync/ack?x=1"],
  ["POST", "/api/devices/heartbeat/"],
  ["POST", "/api/auth/pin/verify"],
  ["POST", "/api/support/commands/cmd_1/ack"],
]) {
  assert.equal(isReadOnlyAllowedRequest(method, url), true, `${method} ${url} keeps a viewer's session alive`);
}

// ── The catalogue against the routes ───────────────────────────────────────

function loadRouteGuards() {
  const app = fs.readFileSync(path.join(root, "src/app.js"), "utf8");
  const imports = {};
  for (const m of app.matchAll(/import\s+(\w+)\s+from\s+"([^"]+)"/g)) imports[m[1]] = m[2];
  for (const m of app.matchAll(/import\s+\{([^}]+)\}\s+from\s+"([^"]+)"/g)) {
    const indexFile = path.resolve(root, "src", m[2]);
    if (!fs.existsSync(indexFile)) continue;
    const index = fs.readFileSync(indexFile, "utf8");
    for (const part of m[1].split(",")) {
      const [original, alias] = part.trim().split(/\s+as\s+/);
      const hit = index.match(new RegExp(`export\\s*\\{\\s*default\\s+as\\s+${original}\\s*\\}\\s*from\\s*"([^"]+)"`));
      if (hit) imports[(alias ?? original).trim()] = path.relative(path.join(root, "src"), path.resolve(path.dirname(indexFile), hit[1]));
    }
  }

  const routes = new Map();
  for (const mount of app.matchAll(/app\.use\("([^"]+)",\s*(\w+)\)/g)) {
    const [, prefix, name] = mount;
    if (!imports[name]) continue;
    const file = path.resolve(root, "src", imports[name]);
    if (!fs.existsSync(file)) continue;
    const source = fs.readFileSync(file, "utf8");
    const routerRoles = [...source.matchAll(/router\.use\(([^;]*?)\);/gs)]
      .map((use) => guardRoles(use[1]))
      .find(Boolean) ?? null;
    const pattern = /router\.(get|post|put|patch|delete)\(/g;
    let match;
    while ((match = pattern.exec(source))) {
      let depth = 1;
      let end = pattern.lastIndex;
      while (end < source.length && depth > 0) {
        if (source[end] === "(") depth += 1;
        else if (source[end] === ")") depth -= 1;
        end += 1;
      }
      const body = source.slice(pattern.lastIndex, end - 1);
      const routePath = body.match(/^\s*["'`]([^"'`]*)["'`]/)?.[1];
      if (routePath === undefined) continue;
      const key = `${match[1].toUpperCase()} ${prefix}${routePath === "/" ? "" : routePath}`;
      // Some paths are declared twice (a guarded and an unguarded variant); keep the strictest.
      const roles = guardRoles(body) ?? routerRoles;
      const previous = routes.get(key);
      routes.set(key, previous && roles ? previous.filter((role) => roles.includes(role)) : roles ?? previous ?? null);
    }
  }
  return routes;
}

/** The roles a guard expression admits, or null when it carries no role guard. */
function guardRoles(expression) {
  const role = expression.match(/requireRole\(([^)]*)\)/);
  if (role) return [...role[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
  const permission = expression.match(/requirePermission\(([^)]*)\)/);
  if (permission) {
    const required = [...permission[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
    for (const name of required) assert.ok(PERMISSIONS.includes(name), `requirePermission names unknown permission ${name}`);
    return ALL_ROLES.filter((candidate) => required.every((name) => roleHasPermission(candidate, name)));
  }
  return null;
}

const routes = loadRouteGuards();
assert.ok(routes.size > 400, `route discovery looks broken: found ${routes.size}`);

for (const [route, roles] of routes) {
  if (!roles) continue;
  for (const role of roles) assert.ok(ALL_ROLES.includes(role), `${route} admits unknown role "${role}"`);
}

/**
 * Each permission the matrix withholds from somebody, bound to routes whose
 * guard is that boundary. Permissions every non-viewer role holds are enforced
 * by the read-only gate instead and have no role guard to bind to.
 */
const BINDINGS = {
  manage_staff: [
    "GET /api/auth/staff",
    "POST /api/auth/staff",
    "PATCH /api/auth/staff/:id/role",
    "DELETE /api/auth/staff/:id",
  ],
  view_profit: [
    "GET /api/reports/pnl",
    "GET /api/reports/top-products",
    "GET /api/reports/monthly-breakdown",
    "GET /api/accounting/profit-and-loss",
    "GET /api/accounting/channel-settlements",
    "GET /api/activity/insights",
    "GET /api/activity/analytics",
  ],
  manage_products: [
    "PATCH /api/products/:id",
    "DELETE /api/products/:id",
    "POST /api/pricing/rules",
    "PATCH /api/pricing/products/:productId/units/:unitId",
  ],
  manage_inventory: [
    "POST /api/stores/transfers",
    "PATCH /api/inventory-lots/products/:productId/tracking",
    "POST /api/purchase-orders",
  ],
  export_data: [
    "POST /api/reports/exports",
    "GET /api/reports/exports/:jobId/download",
  ],
  change_settings: [
    "PATCH /api/shops/setup-status",
    "PUT /api/payment-provider/connections/:provider",
    "POST /api/reminders/templates",
    "GET /api/integrations/overview",
  ],
};

for (const [permission, boundRoutes] of Object.entries(BINDINGS)) {
  const holders = ALL_ROLES.filter((role) => roleHasPermission(role, permission)).sort();
  for (const route of boundRoutes) {
    assert.ok(routes.has(route), `${route} is bound to ${permission} but no longer exists`);
    const admitted = routes.get(route);
    assert.ok(admitted, `${route} carries no role guard, so it cannot enforce ${permission}`);
    assert.deepEqual(
      [...admitted].sort(),
      holders,
      `${route} admits ${admitted.join(", ")}, but the catalogue gives ${permission} to ${holders.join(", ")}`,
    );
  }
}

console.log(`rbac-catalogue: ${PERMISSIONS.length} permissions, ${routes.size} routes read, ${Object.values(BINDINGS).flat().length} bound`);

import { describe, expect, it } from "vitest";
import {
  POS_PERMISSIONS,
  ROLE_PERMISSIONS,
  SERVER_ROLE,
  STAFF_ROLES,
  hasPermission,
  isReadOnlyRole,
  normalizeStaffRole,
  routeAccessFor,
  serverPermissions,
} from "@/features/core/staff/role-access";
// The server's catalogue, read as the running API reads it. The till keeps a
// copy for offline boot; this is what stops the copy from drifting.
import * as server from "../../../backend/src/core/permissions/rbac.js";

describe("the till's role catalogue matches the server's", () => {
  it("names the same permissions", () => {
    expect([...POS_PERMISSIONS].sort()).toEqual([...server.PERMISSIONS].sort());
  });

  it("gives every role the same permissions", () => {
    for (const role of STAFF_ROLES) {
      const stored = SERVER_ROLE[role];
      expect(Object.keys(server.ROLE_PERMISSIONS), `server has no role "${stored}"`).toContain(stored);
      expect([...ROLE_PERMISSIONS[role]].sort(), `${role} (${stored})`).toEqual([...server.permissionsForRole(stored)].sort());
    }
  });

  it("maps every stored role back to the role it displays", () => {
    for (const role of STAFF_ROLES) expect(normalizeStaffRole(SERVER_ROLE[role])).toBe(role);
  });

  it("agrees which roles are read-only", () => {
    for (const role of STAFF_ROLES) {
      expect(isReadOnlyRole(SERVER_ROLE[role]), role).toBe(server.isReadOnlyRole(SERVER_ROLE[role]));
    }
    // A missing role is never guessed into read-only; the session just has not loaded.
    expect(isReadOnlyRole(undefined)).toBe(false);
    expect(isReadOnlyRole("")).toBe(false);
  });
});

describe("the permissions a login carries", () => {
  it("prefers the list the server sent over the local copy", () => {
    const granted = serverPermissions({ role: "admin", permissions: ["view_reports", "not_a_permission"] });
    expect(granted).toEqual(["view_reports"]);
    expect(hasPermission("manager", "manage_products", granted)).toBe(false);
  });

  it("falls back to the local copy for a session cached before the server sent one", () => {
    const granted = serverPermissions({ role: "admin" });
    expect(granted).toBeNull();
    expect(hasPermission("manager", "manage_products", granted)).toBe(true);
  });

  it("always lets the owner through", () => {
    expect(hasPermission("owner", "manage_staff", [])).toBe(true);
  });
});

describe("which screens a role may open", () => {
  it("keeps a viewer out of screens that exist to change things", () => {
    for (const path of ["/billing", "/inventory/stock-in", "/purchase-bills", "/returns/new", "/settings/store-profile", "/expenses?tab=new"]) {
      expect(routeAccessFor(path, "viewer"), path).toEqual({ allowed: false, reason: "read_only" });
    }
  });

  it("still lets a viewer look around", () => {
    for (const path of ["/dashboard", "/bills", "/bills/b1", "/products", "/customers/c1", "/inventory", "/reports", "/settings/printer"]) {
      expect(routeAccessFor(path, "viewer").allowed, path).toBe(true);
    }
  });

  it("keeps staff management and the owner's numbers with the owner", () => {
    for (const role of ["manager", "cashier", "viewer"] as const) {
      expect(routeAccessFor("/staff", role)).toEqual({ allowed: false, reason: "permission", permission: "manage_staff" });
      expect(routeAccessFor("/settings/staff", role).allowed).toBe(false);
      expect(routeAccessFor("/accounting", role).allowed).toBe(false);
    }
    expect(routeAccessFor("/staff", "owner").allowed).toBe(true);
    expect(routeAccessFor("/accounting", "owner").allowed).toBe(true);
  });

  it("leaves the counter's screens open to a cashier", () => {
    for (const path of ["/billing", "/bills", "/customers", "/inventory/stock-in", "/returns", "/daily-closing"]) {
      expect(routeAccessFor(path, "cashier").allowed, path).toBe(true);
    }
    expect(routeAccessFor("/products/p1/pricing", "cashier").allowed).toBe(false);
    expect(routeAccessFor("/products/p1/pricing", "manager").allowed).toBe(true);
  });

  it("matches a rule's sub-paths but not a longer name that merely starts the same", () => {
    expect(routeAccessFor("/staff/new", "cashier").allowed).toBe(false);
    expect(routeAccessFor("/staffing-notes", "cashier").allowed).toBe(true);
  });
});

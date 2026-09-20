import { describe, expect, it } from "vitest";
import {
  ROLE_PERMISSIONS,
  hasPermission,
  normalizeStaffRole,
  permissionsForRole,
} from "@/features/core/staff/permissions";

/**
 * The Staff screen prints ROLE_PERMISSIONS as a role x permission matrix under
 * the heading "Role access enforced by the server". Every cell is therefore a
 * claim about the API, and two of them were wrong — checked by signing in as
 * each role and asking (backend:
 * tests/integration/staff-report-access.integration.test.js, which asserts the
 * same two facts over real HTTP).
 *
 * This is the cheap half of that pair: it fails the moment somebody edits the
 * table without going back to the server to see whether the server agrees.
 */
describe("the role matrix the Staff screen prints", () => {
  it("lets a cashier see the reports they need to close the till", () => {
    // Sales summary, daily closing, payment modes, inventory health and GST all
    // answer 200 to a cashier by design. The matrix used to print a dash here,
    // so an owner reading it believed their cashier could not see the day's
    // takings — while the cashier could.
    expect(hasPermission("cashier", "view_reports")).toBe(true);
  });

  it("does not promise a manager the profit the server keeps for the owner", () => {
    // /reports/pnl, /top-products and /monthly-breakdown are requireRole("owner").
    // A manager asking gets 403. The matrix used to print a tick.
    expect(hasPermission("manager", "view_profit")).toBe(false);
    expect(ROLE_PERMISSIONS.manager).not.toContain("view_profit");
  });

  it("still keeps profit and the owner's own controls away from a cashier", () => {
    for (const permission of ["view_profit", "manage_products", "manage_staff", "change_settings"] as const) {
      expect(hasPermission("cashier", permission)).toBe(false);
    }
  });

  it("gives the owner everything", () => {
    for (const permission of ["view_profit", "manage_staff", "sell_below_minimum_price"] as const) {
      expect(hasPermission("owner", permission)).toBe(true);
    }
  });

  it("reads the server's own role names, which are not the ones it displays", () => {
    // The API stores owner/admin/staff; the screen says Owner/Manager/Cashier.
    // A mapping slip here would show a manager the cashier's row.
    expect(normalizeStaffRole("admin")).toBe("manager");
    expect(normalizeStaffRole("staff")).toBe("cashier");
    expect(normalizeStaffRole(undefined)).toBe("owner");
    // Anything unrecognised must fall to the LEAST privileged working role
    // rather than quietly granting more than the server will honour.
    expect(normalizeStaffRole("chief vibes officer")).toBe("cashier");
  });

  it("hands a staff row the permissions its role really has", () => {
    // local-actions writes this list onto the staff record the list screen shows.
    expect(permissionsForRole("cashier")).toContain("view_reports");
    expect(permissionsForRole("manager")).not.toContain("view_profit");
  });
});

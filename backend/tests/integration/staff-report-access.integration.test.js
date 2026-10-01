// What a cashier can see, proved by asking as one.
//
// Two separate gaps sit behind this file.
//
// The first: phase2-rbac asserts that `requireRole("owner")` is WRITTEN on the
// profit routes. That is a grep over the routes file — it proves the middleware
// is spelled there, not that it refuses anybody. reports.integration already
// asks live for /pnl and /financial-ledger-reconciliation, but /top-products,
// /monthly-breakdown and /staff-sales carry the same guard with nobody watching
// it. A reordering that puts a handler before requireRole, or a route
// re-exported elsewhere, keeps the regex green while the door stands open.
//
// The second has no coverage anywhere: a cashier needs the day's sales and the
// drawer to close the till, so those endpoints are open to every shop user by
// design — which makes them the likely place for the shop's buying price to
// leak out the side in a field nobody reads.
import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import { assertFailure, assertSuccess, createIntegrationContext, resetDatabase } from "./setup.js";
import { createPaidBillViaApi, createProduct, createStaff, createTenant, login } from "./factories.js";

const ctx = await createIntegrationContext();

/**
 * Any key whose name says cost, profit or margin, at any depth.
 *
 * Matched on the whole key, not a prefix: `costPerRateUnit` is the shop's
 * buying price, but `costCentre` would not be, and a prefix match cannot tell
 * them apart.
 */
const MARGIN_KEY = /^(cost|costPrice|costValue|costPerRateUnit|averageCostPrice|totalCost|profit|grossProfit|netProfit|profitEstimate|estimatedProfit|margin|marginPct|marginPercent|lineCost|lineProfit)$/i;

function findMarginKey(value, path = "$") {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const hit = findMarginKey(item, `${path}[${index}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value)) {
    if (MARGIN_KEY.test(key)) return `${path}.${key}`;
    const hit = findMarginKey(child, `${path}.${key}`);
    if (hit) return hit;
  }
  return null;
}

if (ctx.skip) {
  test("staff report access integration tests skipped", { skip: ctx.reason }, () => {});
} else {
  after(async () => ctx.close());

  describe("what a cashier can read", () => {
    let owner;
    let staff;
    let manager;

    before(async () => {
      await resetDatabase(ctx.db);
      const tenant = await createTenant(ctx.db, { shopName: "Cashier Visibility Shop" });
      const hired = await createStaff(ctx.db, tenant.shop.id, { role: "staff" });
      const promoted = await createStaff(ctx.db, tenant.shop.id, { role: "admin", name: "Manager User" });

      owner = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
      staff = await login(ctx, hired.staffMobile, hired.staffPassword);
      manager = await login(ctx, promoted.staffMobile, promoted.staffPassword);
      assert.equal(staff.user.role, "staff", "the fixture must actually be a cashier");
      assert.equal(manager.user.role, "admin", "and the other one a manager");

      // Bought at 6, sold at 10. An empty report cannot leak a margin, so the
      // leak check is only worth anything with a real sale behind it.
      const product = await createProduct(ctx.db, tenant.shop.id, {
        name: "Margin Biscuit", stockBaseQty: 50, costPerRateUnit: 6, defaultPricePerRateUnit: 10,
      });
      await createPaidBillViaApi(ctx, owner.accessToken, product, { quantity: 3, ratePerRateUnit: 10 });
    });

    // The owner's numbers are refused, not merely absent.
    for (const [name, path] of Object.entries({
      "top products": "/api/reports/top-products",
      "monthly breakdown": "/api/reports/monthly-breakdown",
      "staff sales": "/api/reports/staff-sales",
      "profit and loss": "/api/reports/pnl?range=daily",
    })) {
      test(`${name} refuses a cashier`, async () => {
        assertFailure(await ctx.get(path, { token: staff.accessToken }), 403);
      });
    }

    // A manager is not an owner. The Staff screen used to promise them the
    // profit report; the route is requireRole("owner") and answers 403.
    test("profit and loss refuses a manager too", async () => {
      assertFailure(await ctx.get("/api/reports/pnl?range=daily", { token: manager.accessToken }), 403);
      assertFailure(await ctx.get("/api/reports/top-products", { token: manager.accessToken }), 403);
      assertFailure(await ctx.get("/api/reports/monthly-breakdown?year=2026", { token: manager.accessToken }), 403);
    });

    test("though a manager does get the staff-sales report a cashier cannot", async () => {
      // requireRole("owner", "admin") — the one owner-ish report they share.
      assertSuccess(await ctx.get("/api/reports/staff-sales", { token: manager.accessToken }));
    });

    test("and the owner still gets their own profit report", async () => {
      // Proves the refusals above are about WHO asked, not a broken route
      // answering 403 for reasons of its own.
      const pnl = assertSuccess(await ctx.get("/api/reports/pnl?range=daily", { token: owner.accessToken }));
      assert.equal(typeof pnl.grossSales, "number");

      // And it doubles as the control for the leak checks below. A detector
      // that has stopped detecting passes every one of them in silence, so it
      // has to find the profit in the one report that is supposed to carry it.
      assert.notEqual(
        findMarginKey(pnl), null,
        "the P&L must contain a cost or profit key, or the leak checks below prove nothing",
      );
    });

    // And the counter reports carry no margin with them.
    for (const [name, path] of Object.entries({
      "sales summary": "/api/reports/sales-summary?range=today",
      "daily closing": "/api/reports/daily-closing?source=live",
      "payment modes": "/api/reports/payment-modes",
      "payment summary": "/api/reports/payment-summary",
      "inventory health": "/api/reports/inventory-health",
      "GST": "/api/reports/gst?range=daily",
    })) {
      test(`${name} stays open to a cashier and names no cost or profit`, async () => {
        const body = assertSuccess(await ctx.get(path, { token: staff.accessToken }));
        // An empty body leaks nothing and proves nothing; the sale seeded above
        // is what makes these reports worth reading.
        assert.ok(Object.keys(body ?? {}).length > 0, `${path} answered with nothing to inspect`);
        const leak = findMarginKey(body);
        assert.equal(leak, null, `${path} exposes the shop's buying price to a cashier at ${leak}`);
      });
    }
  });
}

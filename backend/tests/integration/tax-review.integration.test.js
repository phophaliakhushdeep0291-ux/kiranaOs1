import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createIntegrationContext, resetDatabase, assertSuccess, assertFailure } from "./setup.js";
import { createTenant, createStaff, login } from "./factories.js";

const ctx = await createIntegrationContext();
if (ctx.skip) test("tax review requires integration runtime", { skip: ctx.reason }, () => {});
else {
  after(() => ctx.close());
  beforeEach(() => resetDatabase(ctx.db));
  test("reconciliation accepts only owned registrations and rejects unauthorized roles and partial admin scope", async () => {
    const gstin = "27AAPFU0939F1ZV";
    const tenant = await createTenant(ctx.db, { gstNumber: gstin });
    const foreign = await createTenant(ctx.db);
    const first = await ctx.db.storeLocation.create({ data: { shopId: tenant.shop.id, code: "A", name: "A", gstNumber: gstin } });
    await ctx.db.storeLocation.create({ data: { shopId: tenant.shop.id, code: "B", name: "B", gstNumber: gstin } });
    const auth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
    const body = { schemaVersion: "kirana-tax-reconciliation-v1", recipientGstin: gstin, period: "2026-09", books: [], statement: [] };
    const path = "/api/compliance/tax-reconciliation";
    const response = assertSuccess(await ctx.post(path, body, { token: auth.accessToken }));
    assert.equal(response.filingEnabled, false);
    assert.equal(response.eligibleItcPaise, null);
    const otherAuth = await login(ctx, foreign.ownerMobile, foreign.ownerPassword);
    assertFailure(await ctx.post(path, body, { token: otherAuth.accessToken }), 403);
    const admin = await createStaff(ctx.db, tenant.shop.id, { role: "admin" });
    await ctx.db.userLocationAccess.create({ data: { shopId: tenant.shop.id, userId: admin.staff.id, locationId: first.id } });
    const adminAuth = await login(ctx, admin.staffMobile, admin.staffPassword);
    assertFailure(await ctx.post(path, body, { token: adminAuth.accessToken }), 403);
    const staff = await createStaff(ctx.db, tenant.shop.id);
    const staffAuth = await login(ctx, staff.staffMobile, staff.staffPassword);
    assertFailure(await ctx.post(path, body, { token: staffAuth.accessToken }), 403);
    assertFailure(await ctx.post(path, { ...body, period: "2026-13" }, { token: auth.accessToken }), 400);
  });
  test("tax review enforces authentication, roles and location boundaries over real records", async () => {
    const tenant = await createTenant(ctx.db);
    const other = await createTenant(ctx.db);
    const branch = await ctx.db.storeLocation.create({ data: { shopId: tenant.shop.id, code: "REVIEW", name: "Review branch" } });
    const second = await ctx.db.storeLocation.create({ data: { shopId: tenant.shop.id, code: "SECOND", name: "Second branch" } });
    const foreign = await ctx.db.storeLocation.create({ data: { shopId: other.shop.id, code: "FOREIGN", name: "Other shop" } });
    for (const [id, shopId, locationId, deletedAt, spentAt] of [
      ["included", tenant.shop.id, branch.id, null, "2026-09-01T00:00:00Z"],
      ["deleted", tenant.shop.id, branch.id, new Date(), "2026-09-01T00:00:00Z"],
      ["old", tenant.shop.id, branch.id, null, "2026-08-01T00:00:00Z"],
      ["another-location", tenant.shop.id, second.id, null, "2026-09-01T00:00:00Z"],
      ["another-shop", other.shop.id, foreign.id, null, "2026-09-01T00:00:00Z"],
    ]) await ctx.db.expense.create({ data: { id, shopId, locationId, title: id, amount: 100, spentAt: new Date(spentAt), deletedAt } });
    const path = "/api/compliance/tax-review?from=2026-09-01&to=2026-09-30";
    assertFailure(await ctx.get(path), 401);
    const auth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
    const options = { token: auth.accessToken, headers: { "x-location-id": branch.id } };
    const result = assertSuccess(await ctx.get(path, options));
    assert.equal(result.coverage.expenseCount, 1);
    assert.deepEqual(result.findings.find((f) => f.code === "expense_vendor").sources, [{ type: "expense", id: "included" }]);
    assert.equal(result.filingEnabled, false);
    assertFailure(await ctx.get(path, { ...options, headers: { "x-location-id": foreign.id } }), 409);
    assertFailure(await ctx.get("/api/compliance/tax-review?from=2026-02-30&to=2026-03-01", options), 400);
    const staff = await createStaff(ctx.db, tenant.shop.id);
    const staffAuth = await login(ctx, staff.staffMobile, staff.staffPassword);
    assertFailure(await ctx.get(path, { token: staffAuth.accessToken }), 403);
  });
}

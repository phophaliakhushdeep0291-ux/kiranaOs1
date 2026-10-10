import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createIntegrationContext, resetDatabase, assertFailure, assertSuccess } from "./setup.js";
import { createCustomer, createTenant, customerPayload, login } from "./factories.js";

const ctx = await createIntegrationContext();
if (ctx.skip) {
  test("injection boundaries skipped", { skip: ctx.reason }, () => {});
} else {
  after(async () => ctx.close());
  beforeEach(async () => resetDatabase(ctx.db));
  test("SQL syntax in customer writes and searches stays data and cannot widen tenant access", async () => {
    const a = await createTenant(ctx.db);
    const b = await createTenant(ctx.db);
    const auth = await login(ctx, a.ownerMobile, a.ownerPassword);
    const options = { token: auth.accessToken };
    const hostile = "O'Reilly'); DROP TABLE Customer; --";
    const other = await createCustomer(ctx.db, b.shop.id, { name: hostile });
    const own = assertSuccess(await ctx.post("/api/customers", customerPayload({ name: hostile }), options), 201);
    assert.equal(own.name, hostile);
    const found = assertSuccess(await ctx.get(`/api/customers?search=${encodeURIComponent(hostile)}`, options));
    assert.ok(found.some((row) => row.id === own.id));
    assert.equal(found.some((row) => row.id === other.id), false);
    const injection = assertSuccess(await ctx.get(`/api/customers?search=${encodeURIComponent("' OR 1=1 --")}`, options));
    assert.deepEqual(injection, []);
    assertFailure(await ctx.get(`/api/customers/${encodeURIComponent("' OR 1=1 --")}`, options), 404);
    assert.equal(await ctx.db.customer.count(), 2, "the table and both tenants' records remain intact");
  });
}

import test, { after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import {
  assertFailure,
  assertSuccess,
  createIntegrationContext,
  resetDatabase,
} from "./setup.js";
import { createTenant, login } from "./factories.js";

const ctx = await createIntegrationContext();

if (ctx.skip) {
  test("expense integration tests skipped", { skip: ctx.reason }, () => {});
} else {
  after(async () => ctx.close());
  beforeEach(async () => resetDatabase(ctx.db));

  describe("expense correctness", () => {
    test("create is idempotent and date-only summaries use the shop timezone", async () => {
      const tenant = await createTenant(ctx.db);
      const auth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
      const body = {
        idempotencyKey: "expense-proof-20260726-1",
        clientExpenseId: "client-expense-20260726-1",
        title: "Night electricity purchase",
        amount: 125.55,
        category: "utilities",
        paymentMode: "upi",
        status: "paid",
        spentAt: "2026-07-25T18:45:00.000Z",
      };

      const created = assertSuccess(
        await ctx.post("/api/expenses", body, { token: auth.accessToken }),
        201,
      );
      assert.equal(created.amount, 125.55);
      assert.equal(created.amountPaise, 12555);
      assert.equal(created.idempotentReplay, false);
      assert.equal(created.recordedByUserId, tenant.owner.id);
      assert.equal(created.recordedByRole, "owner");
      assert.equal(created.recordedBy, tenant.owner.name);

      const stored = await ctx.db.expense.findUniqueOrThrow({ where: { id: created.id } });
      assert.equal(stored.recordedByUserId, tenant.owner.id);
      assert.equal(stored.recordedByRole, "owner");
      assert.equal(stored.recordedBy, tenant.owner.name);

      const replay = assertSuccess(
        await ctx.post("/api/expenses", body, { token: auth.accessToken }),
        200,
      );
      assert.equal(replay.id, created.id);
      assert.equal(replay.idempotentReplay, true);
      assert.equal(replay.recordedByUserId, tenant.owner.id);

      const changedReplay = assertFailure(
        await ctx.post("/api/expenses", { ...body, amount: 150 }, { token: auth.accessToken }),
        409,
      );
      assert.equal(changedReplay.code, "IDEMPOTENCY_KEY_REUSED");
      assert.equal(await ctx.db.expense.count({ where: { shopId: tenant.shop.id } }), 1);
      assert.equal(
        await ctx.db.auditLog.count({
          where: { shopId: tenant.shop.id, action: "EXPENSE_CREATED", entityId: created.id },
        }),
        1,
      );

      const indiaDay = assertSuccess(
        await ctx.get("/api/expenses/summary?from=2026-07-26&to=2026-07-26", {
          token: auth.accessToken,
        }),
      );
      assert.equal(indiaDay.count, 1);
      assert.equal(indiaDay.total, 125.55);

      const previousIndiaDay = assertSuccess(
        await ctx.get("/api/expenses/summary?from=2026-07-25&to=2026-07-25", {
          token: auth.accessToken,
        }),
      );
      assert.equal(previousIndiaDay.count, 0);
    });

    test("delete and restore require a verified owner PIN", async () => {
      const tenant = await createTenant(ctx.db);
      const auth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
      const created = assertSuccess(await ctx.post("/api/expenses", {
        idempotencyKey: "expense-owner-pin-proof-1",
        title: "PIN protected expense",
        amount: 250,
        category: "maintenance",
        paymentMode: "cash",
        status: "paid",
      }, { token: auth.accessToken }), 201);

      assertFailure(await ctx.delete(`/api/expenses/${created.id}`, { token: auth.accessToken }), 403);
      assert.equal((await ctx.db.expense.findUniqueOrThrow({ where: { id: created.id } })).deletedAt, null);

      assertSuccess(await ctx.delete(`/api/expenses/${created.id}`, {
        token: auth.accessToken,
        ownerPin: tenant.ownerPin,
      }));
      assert.ok((await ctx.db.expense.findUniqueOrThrow({ where: { id: created.id } })).deletedAt);

      assertFailure(await ctx.post(`/api/expenses/${created.id}/restore`, {}, { token: auth.accessToken }), 403);
      assertSuccess(await ctx.post(`/api/expenses/${created.id}/restore`, {}, {
        token: auth.accessToken,
        ownerPin: tenant.ownerPin,
      }));
      assert.equal((await ctx.db.expense.findUniqueOrThrow({ where: { id: created.id } })).deletedAt, null);
    });
  });
}

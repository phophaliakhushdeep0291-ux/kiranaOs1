import test, { after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { assertFailure, assertSuccess, createIntegrationContext, resetDatabase } from "./setup.js";
import { createTenant, login } from "./factories.js";

const ctx = await createIntegrationContext();

if (ctx.skip) {
  test("general ledger integration tests skipped", { skip: ctx.reason }, () => {});
} else {
  after(async () => ctx.close());
  beforeEach(async () => resetDatabase(ctx.db));

  async function ownerContext() {
    const tenant = await createTenant(ctx.db, { planCode: "pro" });
    const auth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
    return { tenant, auth };
  }

  async function forceAuditFailure(action, name, operation) {
    await ctx.db.$executeRawUnsafe(`
      CREATE TRIGGER ${name}
      BEFORE INSERT ON AuditLog
      WHEN NEW.action = '${action}'
      BEGIN
        SELECT RAISE(ABORT, 'forced ${action} audit failure');
      END
    `);
    try {
      return await operation();
    } finally {
      await ctx.db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${name}`);
    }
  }

  describe("general-ledger required audit atomicity", () => {
    test("rolls account creation, manual journals, period close, and projection back when their audit cannot be stored", async () => {
      const { tenant, auth } = await ownerContext();
      const request = { token: auth.accessToken, ownerPin: tenant.ownerPin };

      const failedAccount = await forceAuditFailure(
        "LEDGER_ACCOUNT_CREATED",
        "force_ledger_account_audit_failure",
        () => ctx.post("/api/accounting/chart-of-accounts", {
          code: "6500",
          name: "Professional fees",
          category: "expense",
          normalSide: "debit",
        }, request),
      );
      assert.equal(assertFailure(failedAccount, 503).code, "GENERAL_LEDGER_AUDIT_WRITE_FAILED");
      assert.equal(await ctx.db.chartOfAccount.count({ where: { shopId: tenant.shop.id, code: "6500" } }), 0);

      const accounts = assertSuccess(await ctx.get("/api/accounting/chart-of-accounts", { token: auth.accessToken }));
      assert.ok(accounts.some((account) => account.code === "1000"));
      assert.equal(await ctx.db.auditLog.count({ where: { shopId: tenant.shop.id, action: "LEDGER_SYSTEM_ACCOUNTS_ENSURED" } }), 1);

      const journalPayload = {
        reference: "ATOMIC-JOURNAL-1",
        businessDate: "2032-06-15T00:00:00.000Z",
        description: "Required audit rollback proof",
        lines: [
          { accountCode: "1000", debitPaise: 10_000, creditPaise: 0 },
          { accountCode: "3000", debitPaise: 0, creditPaise: 10_000 },
        ],
      };
      const failedJournal = await forceAuditFailure(
        "LEDGER_MANUAL_JOURNAL_POSTED",
        "force_ledger_journal_audit_failure",
        () => ctx.post("/api/accounting/journals", journalPayload, request),
      );
      assert.equal(assertFailure(failedJournal, 503).code, "GENERAL_LEDGER_AUDIT_WRITE_FAILED");
      assert.equal(await ctx.db.journalEntry.count({ where: { shopId: tenant.shop.id, sourceId: journalPayload.reference } }), 0);
      assert.equal(await ctx.db.journalLine.count({ where: { shopId: tenant.shop.id } }), 0);

      const period = assertSuccess(await ctx.post("/api/accounting/periods", {
        name: "June 2032",
        startsAt: "2032-06-01T00:00:00.000Z",
        endsAt: "2032-06-30T23:59:59.999Z",
      }, request), 201);
      const failedClose = await forceAuditFailure(
        "LEDGER_PERIOD_CLOSED",
        "force_ledger_period_close_audit_failure",
        () => ctx.post(`/api/accounting/periods/${period.id}/close`, { reason: "Owner reviewed month close" }, request),
      );
      assert.equal(assertFailure(failedClose, 503).code, "GENERAL_LEDGER_AUDIT_WRITE_FAILED");
      assert.equal((await ctx.db.accountingPeriod.findUniqueOrThrow({ where: { id: period.id } })).status, "open");

      await ctx.db.financialLedger.createMany({ data: [
        {
          shopId: tenant.shop.id,
          sourceType: "audit_projection_proof",
          sourceId: "PROJECTION-1",
          entryType: "sale",
          direction: "credit",
          amountPaise: 5_000n,
          businessDate: new Date("2032-07-01T00:00:00.000Z"),
          idempotencyKey: `projection:${tenant.shop.id}:sale`,
        },
        {
          shopId: tenant.shop.id,
          sourceType: "audit_projection_proof",
          sourceId: "PROJECTION-1",
          entryType: "cash_in",
          direction: "debit",
          amountPaise: 5_000n,
          businessDate: new Date("2032-07-01T00:00:00.000Z"),
          idempotencyKey: `projection:${tenant.shop.id}:cash`,
        },
      ] });
      const failedProjection = await forceAuditFailure(
        "LEDGER_PROJECTED",
        "force_ledger_projection_audit_failure",
        () => ctx.post("/api/accounting/general-ledger/project", {}, request),
      );
      assert.equal(assertFailure(failedProjection, 503).code, "GENERAL_LEDGER_AUDIT_WRITE_FAILED");
      assert.equal(await ctx.db.journalEntry.count({ where: { shopId: tenant.shop.id, sourceType: "audit_projection_proof" } }), 0);
    });

    test("stores each successful financial mutation and its audit exactly once", async () => {
      const { tenant, auth } = await ownerContext();
      const request = { token: auth.accessToken, ownerPin: tenant.ownerPin };
      await ctx.get("/api/accounting/chart-of-accounts", { token: auth.accessToken });

      const account = assertSuccess(await ctx.post("/api/accounting/chart-of-accounts", {
        code: "6500",
        name: "Professional fees",
        category: "expense",
        normalSide: "debit",
      }, request), 201);
      assert.equal(await ctx.db.chartOfAccount.count({ where: { id: account.id } }), 1);
      assert.equal(await ctx.db.auditLog.count({ where: {
        shopId: tenant.shop.id,
        action: "LEDGER_ACCOUNT_CREATED",
        entityId: account.id,
      } }), 1);
    });
  });
}

import test, { after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { createIntegrationContext, resetDatabase, assertFailure, assertSuccess } from "./setup.js";
import { createStaff, createTenant, login } from "./factories.js";

const ctx = await createIntegrationContext();

if (ctx.skip) {
  test("bank reconciliation integration tests skipped", { skip: ctx.reason }, () => {});
} else {
  after(async () => ctx.close());
  beforeEach(async () => resetDatabase(ctx.db));

  async function ownerContext(planCode = "pro") {
    const tenant = await createTenant(ctx.db, { planCode });
    const auth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
    return { tenant, auth };
  }

  function statementCsv() {
    return [
      "Date,Description,Reference,Debit,Credit,Balance",
      "2026-07-20,Marketplace settlement,SET-100,,100.00,1000.00",
      "2026-07-20,Supplier transfer,SUP-250,250.00,,750.00",
      "2026-07-21,Bank fee,FEE-10,10.00,,740.00",
      "2026-07-20,Marketplace settlement,SET-100,,100.00,1000.00",
    ].join("\n");
  }

  async function createLedgerRows(shopId) {
    const base = {
      shopId,
      sourceType: "integration_reconciliation",
      paymentMode: "bank",
      businessDate: new Date("2026-07-20T12:00:00.000Z"),
    };
    const incoming60 = await ctx.db.financialLedger.create({
      data: {
        ...base,
        sourceId: "SET-100-A",
        entryType: "bank_in",
        direction: "debit",
        amountPaise: 6_000n,
        idempotencyKey: `bank-reconciliation:${shopId}:in-60`,
      },
    });
    const incoming40 = await ctx.db.financialLedger.create({
      data: {
        ...base,
        sourceId: "SET-100-B",
        entryType: "bank_in",
        direction: "debit",
        amountPaise: 4_000n,
        idempotencyKey: `bank-reconciliation:${shopId}:in-40`,
      },
    });
    const outgoing250 = await ctx.db.financialLedger.create({
      data: {
        ...base,
        sourceId: "SUP-250",
        entryType: "supplier_payment",
        direction: "debit",
        amountPaise: 25_000n,
        idempotencyKey: `bank-reconciliation:${shopId}:out-250`,
      },
    });
    return { incoming60, incoming40, outgoing250 };
  }

  describe("bank and UPI statement reconciliation", () => {
    test("imports idempotently, suggests without auto-matching, allocates, reverses, ignores, audits, and isolates tenants", async () => {
      const { tenant, auth } = await ownerContext();
      const other = await ownerContext();
      const rows = await createLedgerRows(tenant.shop.id);
      const importBody = {
        accountType: "bank",
        accountName: "HDFC current account",
        accountLast4: "1234",
        fileName: "hdfc-july.csv",
        csvText: statementCsv(),
      };

      const missingPin = assertFailure(
        await ctx.post("/api/accounting/bank-statements/import", importBody, { token: auth.accessToken }),
        403,
      );
      assert.match(missingPin.error, /PIN/i);

      const imported = assertSuccess(
        await ctx.post("/api/accounting/bank-statements/import", importBody, {
          token: auth.accessToken,
          ownerPin: tenant.ownerPin,
        }),
        201,
      );
      assert.equal(imported.rowCount, 4);
      assert.equal(imported.importedCount, 3);
      assert.equal(imported.duplicateCount, 1, "same-statement duplicates must not create duplicate transactions");
      assert.equal(imported.idempotentReplay, false);

      const replay = assertSuccess(
        await ctx.post("/api/accounting/bank-statements/import", importBody, {
          token: auth.accessToken,
          ownerPin: tenant.ownerPin,
        }),
      );
      assert.equal(replay.id, imported.id);
      assert.equal(replay.idempotentReplay, true);
      assert.equal(await ctx.db.bankStatementTransaction.count({ where: { shopId: tenant.shop.id } }), 3);
      assert.equal(await ctx.db.auditLog.count({
        where: { shopId: tenant.shop.id, action: "BANK_STATEMENT_IMPORTED" },
      }), 1, "idempotent replay must not duplicate the import audit event");

      let view = assertSuccess(await ctx.get("/api/accounting/bank-reconciliation", { token: auth.accessToken }));
      assert.equal(view.calculationVersion, "bank-reconciliation-v1");
      assert.equal(view.autoMatch, false);
      assert.equal(view.summary.transactionCount, 3);
      assert.equal(view.summary.counts.unmatched, 3);
      assert.ok(view.limitations.some((item) => item.includes("not a live bank")));
      const settlement = view.transactions.find((row) => row.reference === "SET-100");
      const supplier = view.transactions.find((row) => row.reference === "SUP-250");
      const fee = view.transactions.find((row) => row.reference === "FEE-10");
      assert.ok(settlement && supplier && fee);
      assert.equal(settlement.suggestions.length, 0, "two smaller rows must not be misrepresented as an exact single-row suggestion");
      assert.deepEqual(
        settlement.allocationOptions.map((candidate) => candidate.amount.paise).sort((a, b) => a - b),
        [4_000, 6_000],
      );
      assert.equal(supplier.suggestions[0]?.ledgerRowId, rows.outgoing250.id);
      assert.equal(
        await ctx.db.bankReconciliationAllocation.count({ where: { shopId: tenant.shop.id } }),
        0,
        "suggestions must never create allocations",
      );

      const noteRequired = assertFailure(await ctx.post(
        `/api/accounting/bank-transactions/${settlement.id}/match`,
        { ledgerRowIds: [rows.incoming60.id] },
        { token: auth.accessToken, ownerPin: tenant.ownerPin },
      ), 422);
      assert.equal(noteRequired.code, "BANK_RECONCILIATION_NOTE_REQUIRED");

      const matched = assertSuccess(await ctx.post(
        `/api/accounting/bank-transactions/${settlement.id}/match`,
        {
          ledgerRowIds: [rows.incoming60.id, rows.incoming40.id],
          note: "Marketplace settles two recorded receipts as one bank credit",
        },
        { token: auth.accessToken, ownerPin: tenant.ownerPin },
      ), 201);
      assert.equal(matched.matchStatus, "matched");
      assert.equal(matched.reconciledAmount.paise, 10_000);
      assert.equal(matched.autoMatched, false);

      const supplierMatched = assertSuccess(await ctx.post(
        `/api/accounting/bank-transactions/${supplier.id}/match`,
        { ledgerRowIds: [rows.outgoing250.id] },
        { token: auth.accessToken, ownerPin: tenant.ownerPin },
      ), 201);
      assert.equal(supplierMatched.matchStatus, "matched");

      const secondStatement = assertSuccess(await ctx.post(
        "/api/accounting/bank-statements/import",
        {
          ...importBody,
          fileName: "hdfc-july-extra.csv",
          csvText: "Date,Description,Reference,Debit,Credit\n2026-07-20,Other credit,OTHER-60,,60.00",
        },
        { token: auth.accessToken, ownerPin: tenant.ownerPin },
      ), 201);
      assert.equal(secondStatement.importedCount, 1);
      view = assertSuccess(await ctx.get("/api/accounting/bank-reconciliation", { token: auth.accessToken }));
      const otherCredit = view.transactions.find((row) => row.reference === "OTHER-60");
      const reused = assertFailure(await ctx.post(
        `/api/accounting/bank-transactions/${otherCredit.id}/match`,
        { ledgerRowIds: [rows.incoming60.id] },
        { token: auth.accessToken, ownerPin: tenant.ownerPin },
      ), 409);
      assert.equal(reused.code, "BANK_LEDGER_ALREADY_MATCHED");

      const ignored = assertSuccess(await ctx.post(
        `/api/accounting/bank-transactions/${fee.id}/ignore`,
        { reason: "Bank charge is not yet recorded as an operating expense" },
        { token: auth.accessToken, ownerPin: tenant.ownerPin },
      ));
      assert.equal(ignored.matchStatus, "ignored");      view = assertSuccess(await ctx.get("/api/accounting/bank-reconciliation", { token: auth.accessToken }));
      assert.equal(view.summary.ignored.paise, 1_000, "ignored value must remain explicit");
      assert.equal(view.summary.open.paise, 6_000, "ignored rows must not inflate the actionable open total");
      const restored = assertSuccess(await ctx.post(
        `/api/accounting/bank-transactions/${fee.id}/restore`,
        { reason: "Expense will now be recorded before matching" },
        { token: auth.accessToken, ownerPin: tenant.ownerPin },
      ));
      assert.equal(restored.matchStatus, "unmatched");

      const allocationIds = (await ctx.db.bankReconciliationAllocation.findMany({
        where: { bankStatementTransactionId: settlement.id, status: "active" },
        select: { id: true },
      })).map((row) => row.id);
      const reversed = assertSuccess(await ctx.post(
        `/api/accounting/bank-transactions/${settlement.id}/unmatch`,
        { allocationIds, reason: "Owner reviewed the settlement evidence and is correcting the allocation" },
        { token: auth.accessToken, ownerPin: tenant.ownerPin },
      ));
      assert.equal(reversed.matchStatus, "unmatched");
      assert.equal(reversed.reconciledAmount.paise, 0);
      const historicalAllocations = await ctx.db.bankReconciliationAllocation.findMany({
        where: { bankStatementTransactionId: settlement.id },
      });
      assert.ok(historicalAllocations.every((row) => row.status === "reversed"));
      assert.ok(historicalAllocations.every((row) => row.activeLedgerKey === null));

      const eventActions = (await ctx.db.bankReconciliationEvent.findMany({
        where: { shopId: tenant.shop.id },
        select: { action: true },
      })).map((row) => row.action);
      for (const action of ["match", "unmatch", "ignore", "restore"]) {
        assert.ok(eventActions.includes(action), `${action} must be append-only evidence`);
      }
      const auditActions = (await ctx.db.auditLog.findMany({
        where: { shopId: tenant.shop.id, action: { startsWith: "BANK_" } },
        select: { action: true },
      })).map((row) => row.action);
      for (const action of [
        "BANK_STATEMENT_IMPORTED",
        "BANK_RECONCILIATION_MATCHED",
        "BANK_RECONCILIATION_UNMATCHED",
        "BANK_RECONCILIATION_IGNORED",
        "BANK_RECONCILIATION_RESTORED",
      ]) assert.ok(auditActions.includes(action), `${action} must be in the tenant audit trail`);

      const crossTenant = assertFailure(await ctx.post(
        `/api/accounting/bank-transactions/${supplier.id}/unmatch`,
        { reason: "Attempting a cross-tenant reversal must never reveal or change the record" },
        { token: other.auth.accessToken, ownerPin: other.tenant.ownerPin },
      ), 404);
      assert.equal(crossTenant.code, "BANK_TRANSACTION_NOT_FOUND");
    });

    test("serializes or rejects concurrent allocations without over-reconciling", async () => {
      const { tenant, auth } = await ownerContext();
      const rows = await createLedgerRows(tenant.shop.id);
      assertSuccess(await ctx.post(
        "/api/accounting/bank-statements/import",
        {
          accountType: "bank",
          accountName: "Concurrency account",
          fileName: "concurrency.csv",
          csvText: "Date,Description,Reference,Debit,Credit\n2026-07-20,Concurrent settlement,CON-100,,100.00",
        },
        { token: auth.accessToken, ownerPin: tenant.ownerPin },
      ), 201);
      const view = assertSuccess(await ctx.get("/api/accounting/bank-reconciliation", { token: auth.accessToken }));
      const transaction = view.transactions.find((row) => row.reference === "CON-100");
      assert.ok(transaction);

      const attempts = await Promise.all([
        ctx.post(
          `/api/accounting/bank-transactions/${transaction.id}/match`,
          { ledgerRowIds: [rows.incoming60.id], note: "Concurrent partial allocation A" },
          { token: auth.accessToken, ownerPin: tenant.ownerPin },
        ),
        ctx.post(
          `/api/accounting/bank-transactions/${transaction.id}/match`,
          { ledgerRowIds: [rows.incoming40.id], note: "Concurrent partial allocation B" },
          { token: auth.accessToken, ownerPin: tenant.ownerPin },
        ),
      ]);
      const statuses = attempts.map((response) => response.status).sort((a, b) => a - b);
      assert.equal(statuses[0], 201);
      assert.ok(statuses[1] === 201 || statuses[1] === 409, JSON.stringify(attempts));
      const rejected = attempts.find((response) => response.status === 409);
      if (rejected) {
        assert.ok(
          ["BANK_RECONCILIATION_CONFLICT", "BANK_RECONCILIATION_STATE_DRIFT", "BANK_LEDGER_ALREADY_MATCHED"].includes(rejected.body?.code),
          JSON.stringify(rejected.body),
        );
      }
      const stored = await ctx.db.bankStatementTransaction.findUnique({ where: { id: transaction.id } });
      const active = await ctx.db.bankReconciliationAllocation.findMany({ where: { bankStatementTransactionId: transaction.id, status: "active" } });
      const activeTotal = active.reduce((total, allocation) => total + allocation.amountPaise, 0n);
      assert.equal(stored.reconciledAmountPaise, activeTotal);
      assert.ok(stored.reconciledAmountPaise <= stored.amountPaise, "concurrent requests must never over-reconcile");
      assert.equal(active.length, statuses[1] === 201 ? 2 : 1, "every success must have one active allocation");
    });
    test("enforces owner role and subscribed CSV entitlement", async () => {
      const { tenant, auth } = await ownerContext("pro");
      const staffAccount = await createStaff(ctx.db, tenant.shop.id);
      const staffAuth = await login(ctx, staffAccount.staffMobile, staffAccount.staffPassword);
      assertFailure(await ctx.get("/api/accounting/bank-reconciliation", { token: staffAuth.accessToken }), 403);

      const starter = await ownerContext("starter");
      const blocked = assertFailure(
        await ctx.get("/api/accounting/bank-reconciliation", { token: starter.auth.accessToken }),
        403,
      );
      assert.equal(blocked.code, "FEATURE_NOT_INCLUDED");

      const allowed = assertSuccess(await ctx.get("/api/accounting/bank-reconciliation", { token: auth.accessToken }));
      assert.equal(allowed.scope, "shop");
    });
  });
}

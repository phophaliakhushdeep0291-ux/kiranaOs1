import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createIntegrationContext, resetDatabase } from "./setup.js";
import { createTenant } from "./factories.js";
import { evaluateEntity, createRun, executeRun, collectEntitiesForPeriod } from "../../src/modules/assurance/evaluation.service.js";
import { RULES_BY_CODE } from "../../src/modules/assurance/rules/index.js";
import { runTransactionTriggeredAssurance } from "../../src/workers/assurance.worker.js";
import { buildAssuranceReport } from "../../src/modules/assurance/report.service.js";
import { moneyShadows } from "../../src/utils/money.js";

const ctx = await createIntegrationContext();
if (ctx.skip) {
  test("assurance reliability unavailable", { skip: ctx.reason }, () => {});
} else {
  after(() => ctx.close());
  const rule = RULES_BY_CODE.BILL_MARKED_PAID_WITHOUT_PAYMENTS;
  async function fixture() {
    await resetDatabase(ctx.db);
    const { shop } = await createTenant(ctx.db);
    const bill = await ctx.db.bill.create({ data: { shopId: shop.id, billNo: "RELIABILITY-1",
      subtotal: 100, grandTotal: 100, paidAmount: 100, ...moneyShadows({ subtotal: 100, grandTotal: 100, paidAmount: 100 }) } });
    return { shop, bill, entity: { entityType: "BILL", entityId: bill.id } };
  }
  async function finding(shopId) {
    return ctx.db.auditFinding.findFirst({ where: { shopId }, include: {
      rules: { orderBy: { ruleCode: "asc" } }, statusHistory: { orderBy: { createdAt: "asc" } },
    } });
  }
  async function runWith(shopId, entity, rules = [rule]) {
    const run = await createRun(shopId, { runType: "MANUAL" }, ctx.db);
    return executeRun(shopId, run, [entity], { client: ctx.db, rules });
  }

  test("incomplete checks preserve findings; completed rechecks resolve and reopen recurring problems", async () => {
    const { shop, bill, entity } = await fixture();
    await runWith(shop.id, entity);
    const before = await finding(shop.id);
    assert.equal(before.status, "OPEN");
    const broken = { ...rule, evaluate() { throw Error("Injected rule failure"); } };
    const partial = await runWith(shop.id, entity, [broken]);
    assert.equal(partial.status, "PARTIAL");
    assert.equal(partial.complete, false);
    const stored = await ctx.db.auditRun.findUnique({ where: { id: partial.runId } });
    assert.equal(JSON.parse(stored.summaryJson).ruleFailureCount, 1);
    assert.deepEqual(await finding(shop.id), before);
    const evaluation = await ctx.db.auditEvaluation.findFirst({ where: { auditRunId: partial.runId } });
    assert.equal(JSON.parse(evaluation.resultJson).complete, false);
    // Disabling a rule cannot certify that the financial condition was fixed.
    await ctx.db.auditRule.create({ data: { shopId: shop.id, ruleCode: rule.ruleCode, enabled: false } });
    await runWith(shop.id, entity);
    assert.deepEqual(await finding(shop.id), before);
    await ctx.db.auditRule.deleteMany({ where: { shopId: shop.id } });
    const payment = await ctx.db.payment.create({ data: { shopId: shop.id, billId: bill.id,
      mode: "cash", amount: 100, ...moneyShadows({ amount: 100 }) } });
    assert.equal((await runWith(shop.id, entity)).status, "COMPLETED");
    assert.equal((await finding(shop.id)).status, "CORRECTED");
    // Simulate a later canonical-data regression.
    await ctx.db.payment.delete({ where: { id: payment.id } });
    await runWith(shop.id, entity);
    await runWith(shop.id, entity);
    const reopened = await finding(shop.id);
    assert.equal(reopened.id, before.id);
    assert.equal(reopened.status, "OPEN");
    assert.equal(reopened.reopenCount, 1);
    assert.match(reopened.statusHistory.at(-1).comment, /detected again/);
  });

  test("failed history persistence rolls back the evaluation, finding and evidence together", async () => {
    const { shop, bill } = await fixture();
    const run = await createRun(shop.id, { runType: "MANUAL" }, ctx.db);
    const failingClient = new Proxy(ctx.db, { get(target, property) {
      if (property === "$transaction") return (work, options) => target.$transaction(tx => work(new Proxy(tx, {
        get(transaction, key) {
          if (key === "auditFindingStatusHistory") return { create() { throw Error("History unavailable"); } };
          return transaction[key];
        },
      })), options);
      return target[property];
    } });
    await assert.rejects(evaluateEntity(shop.id, "BILL", bill.id, {
      runId: run.id, client: failingClient, rules: [rule],
    }), /History unavailable/);
    for (const model of ["auditEvaluation", "auditFinding", "auditFindingRule", "auditEvidenceRequirement", "auditFindingStatusHistory"]) {
      assert.equal(await ctx.db[model].count({ where: { shopId: shop.id } }), 0, model);
    }
    await evaluateEntity(shop.id, "BILL", bill.id, { runId: run.id, client: ctx.db, rules: [rule] });
    assert.equal(await ctx.db.auditFinding.count({ where: { shopId: shop.id } }), 1);
  });

  test("coverage distinguishes exactly 2,000 records from an actually truncated period", async () => {
    const { shop } = await fixture();
    const range = { from: new Date(0), to: new Date(), entityTypes: ["BILL"] };
    const clientFor = count => ({ bill: { async findMany(query) {
      assert.equal(query.where.shopId, shop.id);
      return Array.from({ length: Math.min(count, query.take) }, (_, i) => ({ id: `bill-${i}` }));
    } } });
    const exact = await collectEntitiesForPeriod(shop.id, { ...range, client: clientFor(2000) });
    assert.equal(exact.entities.length, 2000);
    assert.deepEqual(exact.truncated, []);
    const capped = await collectEntitiesForPeriod(shop.id, { ...range, client: clientFor(2001) });
    assert.equal(capped.entities.length, 2000);
    assert.deepEqual(capped.truncated, [{ entityType: "BILL", cap: 2000 }]);
    const run = await createRun(shop.id, { runType: "MANUAL", scope: { truncated: capped.truncated } }, ctx.db);
    const result = await executeRun(shop.id, run, [], { client: ctx.db });
    assert.equal(result.status, "PARTIAL");
    assert.equal(result.complete, false);
    assert.deepEqual(JSON.parse((await ctx.db.auditRun.findUnique({ where: { id: run.id } })).summaryJson).truncated, capped.truncated);
  });

  test("a failed durable evaluation rejects the job so BullMQ can retry", async () => {
    const { shop } = await fixture();
    await assert.rejects(runTransactionTriggeredAssurance({ shopId: shop.id, entityType: "BILL", entityId: "missing-bill" }),
      error => error.code === "ASSURANCE_EVALUATION_INCOMPLETE" && Boolean(error.runId));
    const run = await ctx.db.auditRun.findFirst({ where: { shopId: shop.id } });
    assert.equal(run.status, "FAILED");
    assert.ok(run.completedAt);
  });

  test("reports count distinct evaluated records, including healthy records, and expose incomplete runs", async () => {
    const { shop, entity } = await fixture();
    await runWith(shop.id, entity);
    await runWith(shop.id, entity);
    const healthyBill = await ctx.db.bill.create({ data: { shopId: shop.id, billNo: "HEALTHY-2",
      subtotal: 100, grandTotal: 100, paidAmount: 100, ...moneyShadows({ subtotal: 100, grandTotal: 100, paidAmount: 100 }) } });
    await ctx.db.payment.create({ data: { shopId: shop.id, billId: healthyBill.id,
      mode: "cash", amount: 100, ...moneyShadows({ amount: 100 }) } });
    await runWith(shop.id, { entityType: "BILL", entityId: healthyBill.id });
    await runWith(shop.id, entity, [{ ...rule, evaluate() { throw Error("Unavailable check"); } }]);
    const report = await buildAssuranceReport(shop.id, { from: new Date(0), to: new Date() });
    assert.equal(report.coverage.auditRuns, 4);
    assert.equal(report.coverage.evaluationAttempts, 4);
    assert.equal(report.coverage.transactionsReviewed, 2);
    assert.deepEqual(report.coverage.entitiesByType, { BILL: 2 });
    assert.equal(report.coverage.incompleteRuns, 1);
    assert.deepEqual(report.coverage.runsByStatus, { COMPLETED: 3, PARTIAL: 1 });
    const foreign = await createTenant(ctx.db);
    const empty = await buildAssuranceReport(foreign.shop.id, { from: new Date(0), to: new Date() });
    assert.equal(empty.coverage.transactionsReviewed, 0);
  });

  test("configuration failures finish the run instead of leaving it running forever", async () => {
    const { shop } = await fixture();
    const run = await createRun(shop.id, { runType: "MANUAL" }, ctx.db);
    const client = new Proxy(ctx.db, { get(target, key) {
      return key === "auditRule" ? { findMany() { throw Error("Configuration unavailable"); } } : target[key];
    } });
    await assert.rejects(executeRun(shop.id, run, [], { client }), /Configuration unavailable/);
    const stored = await ctx.db.auditRun.findUnique({ where: { id: run.id } });
    assert.equal(stored.status, "FAILED");
    assert.ok(stored.completedAt);
  });
}

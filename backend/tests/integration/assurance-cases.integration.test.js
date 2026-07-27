// Financial Assurance Engine — investigation cases, scheduled runs and the
// advisory evidence classifier. These close the three surfaces that had models
// or provider methods but no caller.
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { assertFailure, assertSuccess, createIntegrationContext, resetDatabase } from "./setup.js";
import { createCustomer, createProduct, createStaff, createTenant, login, unique, uniqueMobile } from "./factories.js";
import { moneyShadows } from "../../src/utils/money.js";
import { ENTITY_TYPES } from "../../src/modules/assurance/assurance.constants.js";
import { runScheduledAssurance, recomputeBaselinesForShops } from "../../src/workers/assurance.worker.js";

const ctx = await createIntegrationContext();

if (ctx.skip) {
  test("assurance case integration tests skipped", { skip: ctx.reason }, () => {});
} else {
  after(async () => ctx.close());
  runSuite();
}

let seq = 0;

async function makeBill(shopId, overrides = {}) {
  seq += 1;
  const grandTotal = overrides.grandTotal ?? 100;
  const money = {
    subtotal: grandTotal, discount: 0, gst: 0, grandTotal, actualAmount: grandTotal,
    buyerPaidAmount: overrides.paidAmount ?? grandTotal, waivedAmount: 0, grossProfit: 0,
    paidAmount: overrides.paidAmount ?? grandTotal, creditAmount: overrides.creditAmount ?? 0,
  };
  const { items, payments, ...rest } = overrides;
  return ctx.db.bill.create({
    data: {
      shopId, billNo: `CASE-${Date.now()}-${seq}`, billType: "normal_sale", status: "active",
      customerName: overrides.customerName ?? "Walk-in", gstMode: "inclusive",
      ...money, ...moneyShadows(money),
      ...Object.fromEntries(Object.entries(rest).filter(([key]) => ["customerId", "createdByUserId", "createdAt"].includes(key))),
      ...(items ? { items: { create: items } } : {}),
      ...(payments ? { payments: { create: payments } } : {}),
    },
    include: { items: true },
  });
}

function billItem(product, overrides = {}) {
  const quantity = overrides.quantity ?? 1;
  const rate = overrides.ratePerRateUnit ?? 100;
  const lineTotal = overrides.lineTotal ?? quantity * rate;
  return {
    productId: product.id, name: product.name, quantity, enteredUnit: "piece", baseUnit: "piece",
    quantityInBaseUnit: quantity, rateUnit: "piece", ratePerRateUnit: rate, costPerRateUnit: 60,
    gstRate: 0, lineDiscount: 0, lineTotal, lineCost: 60 * quantity, lineProfit: lineTotal - 60 * quantity,
  };
}

function runSuite() {
  test("case proposals group findings deterministically by shared entity", async () => {
    await resetDatabase(ctx.db);
    const { shop, owner, ownerMobile, ownerPassword } = await createTenant(ctx.db);
    const token = (await login(ctx, ownerMobile, ownerPassword)).accessToken;
    const product = await createProduct(ctx.db, shop.id);
    const { staff } = await createStaff(ctx.db, shop.id);
    const customer = await createCustomer(ctx.db, shop.id, { name: "Repeat Customer" });

    // Three broken bills for the SAME customer, all created by the SAME staff
    // member: two independent real relationships the grouping must find.
    const billIds = [];
    for (let index = 0; index < 3; index += 1) {
      const bill = await makeBill(shop.id, {
        grandTotal: 500, paidAmount: 500, customerId: customer.id, customerName: customer.name,
        createdByUserId: staff.id,
        items: [billItem(product, { quantity: 5, ratePerRateUnit: 100, lineTotal: 500 })],
        // no payment rows → BILL_MARKED_PAID_WITHOUT_PAYMENTS on each
      });
      billIds.push(bill.id);
      assertSuccess(await ctx.post(`/api/audit/evaluate/transaction/BILL/${bill.id}`, {}, { token }));
    }

    const proposals = assertSuccess(await ctx.get("/api/audit/cases/proposals", { token }));
    assert.ok(proposals.groups.length > 0, "expected at least one proposed group");

    const customerGroup = proposals.groups.find((group) => group.strategy === "CUSTOMER");
    assert.ok(customerGroup, `expected a CUSTOMER group, got ${proposals.groups.map((g) => g.strategy).join(",")}`);
    assert.equal(customerGroup.findingCount, 3);
    assert.equal(customerGroup.totalAmountRupees, 1500);
    for (const id of billIds) {
      assert.ok(customerGroup.findingIds.length === 3);
    }

    const staffGroup = proposals.groups.find((group) => group.strategy === "STAFF");
    assert.ok(staffGroup, "expected a STAFF group");
    assert.equal(staffGroup.findingCount, 3);

    // A rule firing across several records is its own systemic story.
    const ruleGroup = proposals.groups.find((group) => group.strategy === "RULE_PATTERN");
    assert.ok(ruleGroup, "expected a RULE_PATTERN group");
    assert.ok(ruleGroup.ruleCodes.includes("BILL_MARKED_PAID_WITHOUT_PAYMENTS"));

    // Grouping proposes only — nothing is persisted until a reviewer decides.
    assert.equal(await ctx.db.auditCase.count({ where: { shopId: shop.id } }), 0);
  });

  test("a case can be created, summarized and closed without touching its findings", async () => {
    await resetDatabase(ctx.db);
    const { shop, owner, ownerMobile, ownerPassword } = await createTenant(ctx.db);
    const token = (await login(ctx, ownerMobile, ownerPassword)).accessToken;
    const product = await createProduct(ctx.db, shop.id);

    const findingIds = [];
    for (let index = 0; index < 2; index += 1) {
      const bill = await makeBill(shop.id, {
        grandTotal: 800, paidAmount: 800, createdByUserId: owner.id,
        items: [billItem(product, { quantity: 8, ratePerRateUnit: 100, lineTotal: 800 })],
      });
      const result = assertSuccess(await ctx.post(`/api/audit/evaluate/transaction/BILL/${bill.id}`, {}, { token }));
      findingIds.push(result.finding.findingId);
    }

    const created = assertSuccess(
      await ctx.post("/api/audit/cases", { title: "Unrecorded tender pattern", findingIds }, { token }),
      201
    );
    assert.equal(created.findingCount, 2);
    assert.equal(created.status, "OPEN");
    assert.equal(created.totalAmountRupees, 1600);
    assert.ok(["HIGH", "CRITICAL", "MEDIUM"].includes(created.riskLevel));

    const detail = assertSuccess(await ctx.get(`/api/audit/cases/${created.caseId}`, { token }));
    assert.equal(detail.findings.length, 2);
    assert.ok(detail.findings.every((finding) => finding.ruleCodes.includes("BILL_MARKED_PAID_WITHOUT_PAYMENTS")));

    // Summary falls back to deterministic text with the provider disabled.
    const summary = assertSuccess(await ctx.post(`/api/audit/cases/${created.caseId}/summary`, {}, { token }));
    assert.equal(summary.source, "deterministic_fallback");
    assert.equal(summary.degraded, true);
    assert.ok(summary.summary.includes("2"));
    assert.ok(!/fraud/i.test(summary.summary));
    assert.ok(summary.disclaimer.includes("not a statutory audit opinion"));

    // Closing a case must NOT close its findings — they have their own lifecycle.
    const closed = assertSuccess(
      await ctx.patch(`/api/audit/cases/${created.caseId}/status`, { status: "CLOSED" }, { token })
    );
    assert.equal(closed.status, "CLOSED");
    assert.ok(closed.closedAt);
    const findings = await ctx.db.auditFinding.findMany({ where: { id: { in: findingIds } } });
    assert.ok(findings.every((finding) => finding.status === "OPEN"), "findings keep their own status");

    const list = assertSuccess(await ctx.get("/api/audit/cases", { token }));
    assert.equal(list.cases.length, 1);
    assert.equal(list.pagination.total, 1);
  });

  test("cases are shop-isolated and reject foreign findings", async () => {
    await resetDatabase(ctx.db);
    const shopA = await createTenant(ctx.db);
    const shopB = await createTenant(ctx.db);
    const tokenA = (await login(ctx, shopA.ownerMobile, shopA.ownerPassword)).accessToken;
    const tokenB = (await login(ctx, shopB.ownerMobile, shopB.ownerPassword)).accessToken;
    const product = await createProduct(ctx.db, shopA.shop.id);

    const bill = await makeBill(shopA.shop.id, {
      grandTotal: 300, paidAmount: 300, createdByUserId: shopA.owner.id,
      items: [billItem(product, { quantity: 3, ratePerRateUnit: 100, lineTotal: 300 })],
    });
    const findingId = (await assertSuccess(await ctx.post(`/api/audit/evaluate/transaction/BILL/${bill.id}`, {}, { token: tokenA }))).finding.findingId;
    const created = assertSuccess(await ctx.post("/api/audit/cases", { title: "Shop A case", findingIds: [findingId] }, { token: tokenA }), 201);

    // Shop B cannot read the case, summarize it, or close it.
    assertFailure(await ctx.get(`/api/audit/cases/${created.caseId}`, { token: tokenB }), 404);
    assertFailure(await ctx.post(`/api/audit/cases/${created.caseId}/summary`, {}, { token: tokenB }), 404);
    assertFailure(await ctx.patch(`/api/audit/cases/${created.caseId}/status`, { status: "CLOSED" }, { token: tokenB }), 404);
    assert.equal(assertSuccess(await ctx.get("/api/audit/cases", { token: tokenB })).cases.length, 0);

    // And cannot build a case out of shop A's finding id.
    assertFailure(await ctx.post("/api/audit/cases", { title: "Steal", findingIds: [findingId] }, { token: tokenB }), 404);
  });

  test("scheduled sweep evaluates active shops and is idempotent", async () => {
    await resetDatabase(ctx.db);
    const shopOne = await createTenant(ctx.db);
    const shopTwo = await createTenant(ctx.db);
    const idle = await createTenant(ctx.db);
    const productOne = await createProduct(ctx.db, shopOne.shop.id);
    const productTwo = await createProduct(ctx.db, shopTwo.shop.id);

    await makeBill(shopOne.shop.id, {
      grandTotal: 400, paidAmount: 400, createdByUserId: shopOne.owner.id,
      items: [billItem(productOne, { quantity: 4, ratePerRateUnit: 100, lineTotal: 400 })],
    });
    await makeBill(shopTwo.shop.id, {
      grandTotal: 700, paidAmount: 700, createdByUserId: shopTwo.owner.id,
      items: [billItem(productTwo, { quantity: 7, ratePerRateUnit: 100, lineTotal: 700 })],
    });

    const first = await runScheduledAssurance({ lookbackHours: 24 });
    assert.ok(first.shopsEvaluated >= 2, `expected both active shops, got ${first.shopsEvaluated}`);
    assert.ok(first.findingsCreated >= 2);
    // The idle shop has no activity in the window, so it is not swept at all.
    assert.ok(!first.results.some((row) => row.shopId === idle.shop.id && row.runId));

    const runs = await ctx.db.auditRun.findMany({ where: { runType: "SCHEDULED" } });
    assert.ok(runs.length >= 2);
    assert.ok(runs.every((run) => run.status === "COMPLETED"));
    assert.ok(runs.every((run) => run.periodFrom && run.periodTo), "scheduled runs record their window");

    // Re-running the same window creates no new findings: evaluation is idempotent.
    const findingsBefore = await ctx.db.auditFinding.count();
    const second = await runScheduledAssurance({ lookbackHours: 24 });
    assert.equal(second.findingsCreated, 0, "a repeated sweep must not duplicate findings");
    assert.equal(await ctx.db.auditFinding.count(), findingsBefore);

    // One shop's failure never stops the sweep.
    const scoped = await runScheduledAssurance({ shopIds: [shopOne.shop.id], lookbackHours: 24 });
    assert.equal(scoped.shopsConsidered, 1);
    assert.equal(scoped.shopsFailed, 0);
  });

  test("scheduled baseline refresh writes baselines for active shops", async () => {
    await resetDatabase(ctx.db);
    const { shop } = await createTenant(ctx.db);

    for (let index = 0; index < 12; index += 1) {
      await ctx.db.expense.create({
        data: {
          shopId: shop.id, title: `Transport ${index}`, amount: 200 + index, category: "transport",
          paymentMode: "upi", vendor: "Tempo",
          spentAt: new Date(Date.now() - (index + 1) * 24 * 3600 * 1000),
          createdAt: new Date(Date.now() - (index + 1) * 24 * 3600 * 1000),
        },
      });
    }

    const result = await recomputeBaselinesForShops({ shopIds: [shop.id] });
    assert.equal(result.shopsProcessed, 1);
    assert.ok(result.baselinesWritten > 0);
    assert.equal(result.failureCount, 0);

    const baseline = await ctx.db.auditBaseline.findFirst({
      where: { shopId: shop.id, metricKey: "expense_amount", scopeKey: "category:transport" },
    });
    assert.ok(baseline, "a category baseline should be persisted");
    assert.ok(baseline.sampleCount >= 12);
  });

  test("evidence classification is advisory and never auto-applies", async () => {
    await resetDatabase(ctx.db);
    const { ownerMobile, ownerPassword } = await createTenant(ctx.db);
    const token = (await login(ctx, ownerMobile, ownerPassword)).accessToken;

    const result = assertSuccess(
      await ctx.post("/api/audit/evidence/classify", { description: "Photo of the supplier invoice for the dal delivery" }, { token })
    );
    // With the provider disabled the classifier declines rather than guessing.
    assert.equal(result.source, "deterministic_fallback");
    assert.equal(result.advisory, true);
    assert.equal(result.evidenceType, null);
    assert.ok(result.note.includes("human decisions"));

    assertFailure(await ctx.post("/api/audit/evidence/classify", { description: "" }, { token }), 400);
  });
}

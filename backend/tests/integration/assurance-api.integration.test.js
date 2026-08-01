// Financial Assurance Engine — API, permissions, workflow and MVP acceptance.
//
// Everything here goes through real HTTP against a real app + real test DB, and
// asserts persisted state. The MVP acceptance scenario at the bottom builds one
// test shop containing all 18 required events and checks the engine's verdict on
// each of them.
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { assertFailure, assertSuccess, createIntegrationContext, resetDatabase } from "./setup.js";
import { createCustomer, createProduct, createStaff, createTenant, login, unique, uniqueMobile } from "./factories.js";
import { moneyShadows } from "../../src/utils/money.js";
import { ENTITY_TYPES, FINDING_STATUS } from "../../src/modules/assurance/assurance.constants.js";
import { flushAuditQueue, setTransactionTriggeredEnabled } from "../../src/modules/assurance/assurance.hooks.js";

const ctx = await createIntegrationContext();

if (ctx.skip) {
  test("assurance API integration tests skipped", { skip: ctx.reason }, () => {});
} else {
  after(async () => ctx.close());
  runSuite();
}

let billSeq = 0;

async function makeBill(shopId, overrides = {}) {
  billSeq += 1;
  const grandTotal = overrides.grandTotal ?? 100;
  const money = {
    subtotal: overrides.subtotal ?? grandTotal,
    discount: overrides.discount ?? 0,
    gst: 0,
    grandTotal,
    actualAmount: grandTotal,
    buyerPaidAmount: overrides.paidAmount ?? grandTotal,
    waivedAmount: 0,
    grossProfit: 0,
    paidAmount: overrides.paidAmount ?? grandTotal,
    creditAmount: overrides.creditAmount ?? 0,
  };
  const { items, payments, ...rest } = overrides;
  return ctx.db.bill.create({
    data: {
      shopId,
      billNo: overrides.billNo ?? `KOS-A-${Date.now()}-${billSeq}`,
      billType: overrides.billType ?? "normal_sale",
      status: overrides.status ?? "active",
      customerName: overrides.customerName ?? "Walk-in",
      gstMode: "inclusive",
      ...money,
      ...moneyShadows(money),
      ...Object.fromEntries(
        Object.entries(rest).filter(([key]) =>
          ["customerId", "createdByUserId", "deviceId", "sourceDeviceId", "idempotencyKey", "clientBillId", "status", "cancelledAt", "cancelledReason", "businessDate", "createdAt", "discountReason"].includes(key)
        )
      ),
      ...(items ? { items: { create: items } } : {}),
      ...(payments ? { payments: { create: payments } } : {}),
    },
    include: { items: true, payments: true },
  });
}

function billItem(product, overrides = {}) {
  const quantity = overrides.quantity ?? 1;
  const rate = overrides.ratePerRateUnit ?? 100;
  const lineTotal = overrides.lineTotal ?? quantity * rate;
  return {
    productId: product?.id ?? null,
    name: product?.name ?? "Item",
    quantity,
    enteredUnit: "piece",
    baseUnit: "piece",
    quantityInBaseUnit: quantity,
    rateUnit: "piece",
    ratePerRateUnit: rate,
    costPerRateUnit: overrides.costPerRateUnit ?? 60,
    gstRate: 0,
    lineDiscount: 0,
    lineTotal,
    lineCost: (overrides.costPerRateUnit ?? 60) * quantity,
    lineProfit: lineTotal - (overrides.costPerRateUnit ?? 60) * quantity,
  };
}

// Evaluate one entity through the API as the owner.
async function evaluateViaApi(token, entityType, entityId, { expectStatus = 200 } = {}) {
  const response = await ctx.post(`/api/audit/evaluate/transaction/${entityType}/${entityId}`, {}, { token });
  if (expectStatus === 200) return assertSuccess(response);
  return assertFailure(response, expectStatus);
}

function runSuite() {
  test("every /api/audit route requires authentication", async () => {
    await resetDatabase(ctx.db);
    for (const [method, path] of [
      ["GET", "/api/audit/dashboard"],
      ["GET", "/api/audit/findings"],
      ["GET", "/api/audit/runs"],
      ["GET", "/api/audit/rules"],
      ["GET", "/api/audit/evidence-requests"],
      ["POST", "/api/audit/runs"],
    ]) {
      const response = await ctx.request(method, path, { body: method === "POST" ? {} : undefined });
      assert.equal(response.status, 401, `${method} ${path} should require auth`);
    }
  });

  test("shop isolation: a finding id from another shop is never readable", async () => {
    await resetDatabase(ctx.db);
    const shopA = await createTenant(ctx.db);
    const shopB = await createTenant(ctx.db);
    const tokenA = (await login(ctx, shopA.ownerMobile, shopA.ownerPassword)).accessToken;
    const tokenB = (await login(ctx, shopB.ownerMobile, shopB.ownerPassword)).accessToken;

    const productA = await createProduct(ctx.db, shopA.shop.id);
    const billA = await makeBill(shopA.shop.id, {
      grandTotal: 100, paidAmount: 100, createdByUserId: shopA.owner.id,
      items: [billItem(productA, { lineTotal: 100 })],
    });
    const evaluated = await evaluateViaApi(tokenA, ENTITY_TYPES.BILL, billA.id);
    const findingId = evaluated.finding.findingId;
    assert.ok(findingId);

    // Shop B cannot read it, patch it, add evidence to it, review it or assign it.
    assertFailure(await ctx.get(`/api/audit/findings/${findingId}`, { token: tokenB }), 404);
    assertFailure(await ctx.patch(`/api/audit/findings/${findingId}/status`, { status: FINDING_STATUS.CLOSED }, { token: tokenB }), 404);
    assertFailure(
      await ctx.post(`/api/audit/findings/${findingId}/evidence`, { evidenceType: "PAYMENT_RECEIPT", referenceValue: "x" }, { token: tokenB }),
      404
    );
    assertFailure(await ctx.post(`/api/audit/findings/${findingId}/review`, { decision: "FALSE_POSITIVE" }, { token: tokenB }), 404);
    assertFailure(await ctx.post(`/api/audit/findings/${findingId}/assign`, { reviewerUserId: shopB.owner.id }, { token: tokenB }), 404);

    // Shop B's list and dashboard contain nothing from shop A.
    const listB = assertSuccess(await ctx.get("/api/audit/findings", { token: tokenB }));
    assert.equal(listB.findings.length, 0);
    const dashboardB = assertSuccess(await ctx.get("/api/audit/dashboard", { token: tokenB }));
    assert.equal(dashboardB.totals.openFindings, 0);

    // Shop B cannot evaluate shop A's bill either.
    await evaluateViaApi(tokenB, ENTITY_TYPES.BILL, billA.id, { expectStatus: 404 });

    // Shop A still sees exactly its own finding.
    const listA = assertSuccess(await ctx.get("/api/audit/findings", { token: tokenA }));
    assert.equal(listA.findings.length, 1);
    assert.equal(listA.findings[0].findingId, findingId);
  });

  test("role permissions: staff see only assigned findings and cannot resolve them", async () => {
    await resetDatabase(ctx.db);
    const { shop, owner, ownerMobile, ownerPassword } = await createTenant(ctx.db);
    const { staff, staffMobile, staffPassword } = await createStaff(ctx.db, shop.id);
    const ownerToken = (await login(ctx, ownerMobile, ownerPassword)).accessToken;
    const staffToken = (await login(ctx, staffMobile, staffPassword)).accessToken;

    const product = await createProduct(ctx.db, shop.id);
    const billOne = await makeBill(shop.id, { grandTotal: 100, paidAmount: 100, createdByUserId: owner.id, items: [billItem(product, { lineTotal: 100 })] });
    const billTwo = await makeBill(shop.id, { grandTotal: 200, paidAmount: 200, createdByUserId: owner.id, items: [billItem(product, { quantity: 2, lineTotal: 200 })] });
    const findingOne = (await evaluateViaApi(ownerToken, ENTITY_TYPES.BILL, billOne.id)).finding.findingId;
    const findingTwo = (await evaluateViaApi(ownerToken, ENTITY_TYPES.BILL, billTwo.id)).finding.findingId;

    // Staff sees nothing until something is assigned to them.
    let staffList = assertSuccess(await ctx.get("/api/audit/findings", { token: staffToken }));
    assert.equal(staffList.findings.length, 0);
    assertFailure(await ctx.get(`/api/audit/findings/${findingOne}`, { token: staffToken }), 404);

    // Owner assigns one finding to the staff member.
    assertSuccess(await ctx.post(`/api/audit/findings/${findingOne}/assign`, { reviewerUserId: staff.id }, { token: ownerToken }));

    staffList = assertSuccess(await ctx.get("/api/audit/findings", { token: staffToken }));
    assert.equal(staffList.findings.length, 1);
    assert.equal(staffList.findings[0].findingId, findingOne);
    assertSuccess(await ctx.get(`/api/audit/findings/${findingOne}`, { token: staffToken }));
    // Still not the other one.
    assertFailure(await ctx.get(`/api/audit/findings/${findingTwo}`, { token: staffToken }), 404);

    // Staff may submit evidence on their own finding …
    assertSuccess(
      await ctx.post(
        `/api/audit/findings/${findingOne}/evidence`,
        { evidenceType: "STAFF_EXPLANATION", referenceValue: "Customer paid in cash, I forgot to record the tender." },
        { token: staffToken }
      ),
      201
    );

    // … but cannot close it, cannot assign, and cannot change rules.
    assertFailure(await ctx.patch(`/api/audit/findings/${findingOne}/status`, { status: FINDING_STATUS.CLOSED }, { token: staffToken }), 403);
    assertFailure(await ctx.patch(`/api/audit/findings/${findingOne}/status`, { status: FINDING_STATUS.FALSE_POSITIVE }, { token: staffToken }), 403);
    assertFailure(await ctx.post(`/api/audit/findings/${findingOne}/assign`, { reviewerUserId: owner.id }, { token: staffToken }), 403);
    assertFailure(await ctx.patch("/api/audit/rules/BILL_TOTAL_MISMATCH", { enabled: false }, { token: staffToken }), 403);
    // Staff cannot submit evidence on a finding that is not theirs.
    assertFailure(
      await ctx.post(`/api/audit/findings/${findingTwo}/evidence`, { evidenceType: "STAFF_EXPLANATION", referenceValue: "x" }, { token: staffToken }),
      404
    );
  });

  test("audit_reviewer can verify evidence and close findings; manager cannot", async () => {
    await resetDatabase(ctx.db);
    const { shop, owner, ownerMobile, ownerPassword } = await createTenant(ctx.db);
    const reviewer = await createStaff(ctx.db, shop.id, { role: "audit_reviewer" });
    const manager = await createStaff(ctx.db, shop.id, { role: "admin" });
    const ownerToken = (await login(ctx, ownerMobile, ownerPassword)).accessToken;
    const reviewerToken = (await login(ctx, reviewer.staffMobile, reviewer.staffPassword)).accessToken;
    const managerToken = (await login(ctx, manager.staffMobile, manager.staffPassword)).accessToken;

    const product = await createProduct(ctx.db, shop.id);
    const bill = await makeBill(shop.id, { grandTotal: 100, paidAmount: 100, createdByUserId: owner.id, items: [billItem(product, { lineTotal: 100 })] });
    const findingId = (await evaluateViaApi(ownerToken, ENTITY_TYPES.BILL, bill.id)).finding.findingId;

    // A manager sees all findings and can review, but cannot declare a false positive.
    const managerList = assertSuccess(await ctx.get("/api/audit/findings", { token: managerToken }));
    assert.equal(managerList.findings.length, 1);
    assertSuccess(await ctx.post(`/api/audit/findings/${findingId}/review`, { decision: "NEEDS_MORE_EVIDENCE", notes: "Asked the cashier." }, { token: managerToken }), 201);
    assertFailure(await ctx.patch(`/api/audit/findings/${findingId}/status`, { status: FINDING_STATUS.FALSE_POSITIVE }, { token: managerToken }), 403);
    assertFailure(await ctx.patch(`/api/audit/findings/${findingId}/status`, { status: FINDING_STATUS.CLOSED }, { token: managerToken }), 403);

    // The reviewer can verify evidence and resolve.
    const evidence = assertSuccess(
      await ctx.post(`/api/audit/findings/${findingId}/evidence`, { evidenceType: "PAYMENT_RECEIPT", referenceValue: "Receipt book page 41" }, { token: reviewerToken }),
      201
    );
    assert.equal(evidence.verificationStatus, "PROVIDED", "evidence is never auto-verified");
    const verified = assertSuccess(
      await ctx.patch(`/api/audit/evidence/${evidence.evidenceId}/verify`, { verificationStatus: "VERIFIED", reviewerNotes: "Matches the receipt book." }, { token: reviewerToken })
    );
    assert.equal(verified.verificationStatus, "VERIFIED");
    assert.ok(verified.verifiedAt);
    assert.equal(verified.verifiedByUserId, reviewer.staff.id);

    // A manager cannot verify evidence.
    assertFailure(await ctx.patch(`/api/audit/evidence/${evidence.evidenceId}/verify`, { verificationStatus: "REJECTED" }, { token: managerToken }), 403);

    const resolved = assertSuccess(
      await ctx.patch(`/api/audit/findings/${findingId}/status`, { status: FINDING_STATUS.CONFIRMED_ISSUE, comment: "Genuine missed tender entry." }, { token: reviewerToken })
    );
    assert.equal(resolved.status, FINDING_STATUS.CONFIRMED_ISSUE);
    assert.ok(resolved.resolvedAt);
  });

  test("evidence lifecycle is preserved end to end, and reuse is surfaced", async () => {
    await resetDatabase(ctx.db);
    const { shop, owner, ownerMobile, ownerPassword } = await createTenant(ctx.db);
    const token = (await login(ctx, ownerMobile, ownerPassword)).accessToken;

    const expenseOne = await ctx.db.expense.create({
      data: { shopId: shop.id, title: "Repairs", amount: 4000, category: "maintenance", paymentMode: "cash", vendor: null, notes: null },
    });
    const expenseTwo = await ctx.db.expense.create({
      data: { shopId: shop.id, title: "Repairs again", amount: 6000, category: "maintenance", paymentMode: "cash", vendor: null, notes: null },
    });
    const findingOne = (await evaluateViaApi(token, ENTITY_TYPES.EXPENSE, expenseOne.id)).finding;
    const findingTwo = (await evaluateViaApi(token, ENTITY_TYPES.EXPENSE, expenseTwo.id)).finding;

    // Missing-evidence detection raised a requirement automatically.
    const detail = assertSuccess(await ctx.get(`/api/audit/findings/${findingOne.findingId}`, { token }));
    const requirement = detail.evidenceRequirements.find((row) => row.evidenceType === "EXPENSE_RECEIPT");
    assert.ok(requirement, "an EXPENSE_RECEIPT requirement should exist");
    assert.equal(requirement.status, "REQUESTED");

    // The open request appears in the evidence-requests queue.
    const queue = assertSuccess(await ctx.get("/api/audit/evidence-requests", { token }));
    assert.ok(queue.requests.some((row) => row.requirementId === requirement.requirementId));

    // Owner requests one more, which moves the finding to EVIDENCE_REQUESTED.
    assertSuccess(
      await ctx.post(`/api/audit/findings/${findingOne.findingId}/evidence-requests`, { evidenceType: "OWNER_APPROVAL", description: "Approve this repair spend" }, { token }),
      201
    );
    const afterRequest = assertSuccess(await ctx.get(`/api/audit/findings/${findingOne.findingId}`, { token }));
    assert.equal(afterRequest.status, FINDING_STATUS.EVIDENCE_REQUESTED);

    // Submit evidence against the requirement.
    const submitted = assertSuccess(
      await ctx.post(
        `/api/audit/findings/${findingOne.findingId}/evidence`,
        { evidenceType: "EXPENSE_RECEIPT", requirementId: requirement.requirementId, referenceKind: "reference", referenceValue: "RCPT-2026-0041" },
        { token }
      ),
      201
    );
    assert.equal(submitted.verificationStatus, "PROVIDED");
    assert.ok(submitted.checksumSha256, "a checksum is always recorded");
    assert.equal(submitted.reuseWarningCount, 0);

    // The requirement flipped to PROVIDED.
    const afterSubmit = assertSuccess(await ctx.get(`/api/audit/findings/${findingOne.findingId}`, { token }));
    assert.equal(afterSubmit.evidenceRequirements.find((r) => r.requirementId === requirement.requirementId).status, "PROVIDED");

    // 10. Same receipt reference reused on a different finding → surfaced, not silently accepted.
    const reused = assertSuccess(
      await ctx.post(
        `/api/audit/findings/${findingTwo.findingId}/evidence`,
        { evidenceType: "EXPENSE_RECEIPT", referenceKind: "reference", referenceValue: "RCPT-2026-0041" },
        { token }
      ),
      201
    );
    assert.equal(reused.reuseWarningCount, 1, "the same receipt on two findings must be flagged");
    assert.equal(reused.extractedMetadata.reuseCount, 1);
    assert.equal(reused.extractedMetadata.reusedOnOtherFindings[0].findingId, findingOne.findingId);

    // Rejecting evidence is recorded and does not delete it.
    const rejected = assertSuccess(
      await ctx.patch(`/api/audit/evidence/${reused.evidenceId}/verify`, { verificationStatus: "REJECTED", reviewerNotes: "Already claimed on another expense." }, { token })
    );
    assert.equal(rejected.verificationStatus, "REJECTED");
    const stillThere = await ctx.db.auditEvidence.count({ where: { shopId: shop.id } });
    assert.equal(stillThere, 2, "evidence is never removed");
  });

  test("finding lifecycle enforces legal transitions and keeps an immutable trail", async () => {
    await resetDatabase(ctx.db);
    const { shop, owner, ownerMobile, ownerPassword } = await createTenant(ctx.db);
    const token = (await login(ctx, ownerMobile, ownerPassword)).accessToken;
    const product = await createProduct(ctx.db, shop.id);
    const bill = await makeBill(shop.id, { grandTotal: 100, paidAmount: 100, createdByUserId: owner.id, items: [billItem(product, { lineTotal: 100 })] });
    const findingId = (await evaluateViaApi(token, ENTITY_TYPES.BILL, bill.id)).finding.findingId;

    // Illegal jump is refused with a clear code.
    const illegal = assertFailure(
      await ctx.patch(`/api/audit/findings/${findingId}/status`, { status: FINDING_STATUS.OPEN }, { token })
    , 422);
    assert.equal(illegal.code, "AUDIT_INVALID_STATUS_TRANSITION");

    // Legal path: OPEN → UNDER_REVIEW → CONFIRMED_ISSUE → CORRECTED → CLOSED.
    for (const status of [FINDING_STATUS.UNDER_REVIEW, FINDING_STATUS.CONFIRMED_ISSUE, FINDING_STATUS.CORRECTED, FINDING_STATUS.CLOSED]) {
      const updated = assertSuccess(
        await ctx.patch(`/api/audit/findings/${findingId}/status`, { status, comment: `moving to ${status}` }, { token })
      );
      assert.equal(updated.status, status);
    }

    const detail = assertSuccess(await ctx.get(`/api/audit/findings/${findingId}`, { token }));
    // The trail has one row per transition, in order, each attributed.
    const transitions = detail.timeline.filter((row) => row.previousStatus !== row.newStatus && !row.newStatus.startsWith("EVIDENCE_"));
    assert.ok(transitions.length >= 5, `expected the full trail, got ${transitions.length}`);
    assert.equal(transitions[0].newStatus, FINDING_STATUS.OPEN);
    assert.equal(transitions[0].changedByRole, "system");
    assert.equal(transitions.at(-1).newStatus, FINDING_STATUS.CLOSED);
    assert.equal(transitions.at(-1).changedByRole, "owner");
    assert.equal(transitions.at(-1).changedByUserId, owner.id);
    for (const row of transitions) assert.ok(row.createdAt, "every transition is timestamped");

    // There is no delete endpoint, and the rows survive further activity.
    const deleteAttempt = await ctx.delete(`/api/audit/findings/${findingId}`, { token });
    assert.equal(deleteAttempt.status, 404, "findings cannot be deleted through the API");
    const historyCount = await ctx.db.auditFindingStatusHistory.count({ where: { findingId } });
    assert.ok(historyCount >= 5);
  });

  test("a reviewer's FALSE_POSITIVE verdict is not resurrected by re-evaluation", async () => {
    await resetDatabase(ctx.db);
    const { shop, owner, ownerMobile, ownerPassword } = await createTenant(ctx.db);
    const token = (await login(ctx, ownerMobile, ownerPassword)).accessToken;
    const product = await createProduct(ctx.db, shop.id);
    const bill = await makeBill(shop.id, { grandTotal: 100, paidAmount: 100, createdByUserId: owner.id, items: [billItem(product, { lineTotal: 100 })] });
    const findingId = (await evaluateViaApi(token, ENTITY_TYPES.BILL, bill.id)).finding.findingId;

    assertSuccess(
      await ctx.patch(`/api/audit/findings/${findingId}/status`, { status: FINDING_STATUS.FALSE_POSITIVE, comment: "Cash was received; tender entry is a known gap." }, { token })
    );

    // Re-evaluating the same unchanged bill must not reopen the judged finding.
    await evaluateViaApi(token, ENTITY_TYPES.BILL, bill.id);
    await evaluateViaApi(token, ENTITY_TYPES.BILL, bill.id);

    const detail = assertSuccess(await ctx.get(`/api/audit/findings/${findingId}`, { token }));
    assert.equal(detail.status, FINDING_STATUS.FALSE_POSITIVE, "a reviewed false positive stays closed");
    assert.equal(detail.reopenCount, 0);
    const total = await ctx.db.auditFinding.count({ where: { shopId: shop.id, sourceEntityId: bill.id } });
    assert.equal(total, 1, "no shadow duplicate finding is created");
  });

  test("runs, dashboard, rules and report endpoints work with the AI provider disabled", async () => {
    await resetDatabase(ctx.db);
    const { shop, owner, ownerMobile, ownerPassword } = await createTenant(ctx.db);
    const token = (await login(ctx, ownerMobile, ownerPassword)).accessToken;
    const product = await createProduct(ctx.db, shop.id);

    await makeBill(shop.id, { grandTotal: 100, paidAmount: 100, createdByUserId: owner.id, items: [billItem(product, { lineTotal: 100 })] });
    await ctx.db.expense.create({ data: { shopId: shop.id, title: "Big spend", amount: 9000, category: "general", paymentMode: "cash" } });

    const from = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const to = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

    // A MANUAL run over a period.
    const run = assertSuccess(await ctx.post("/api/audit/runs", { runType: "MANUAL", from, to }, { token }), 201);
    assert.equal(run.status, "COMPLETED");
    assert.ok(run.evaluated >= 2, `expected entities to be evaluated, got ${run.evaluated}`);
    assert.ok(run.findingsCreated >= 2);

    const runDetail = assertSuccess(await ctx.get(`/api/audit/runs/${run.runId}`, { token }));
    assert.equal(runDetail.runType, "MANUAL");
    assert.ok(runDetail.engineVersion.startsWith("assurance-engine-"));
    assert.match(runDetail.rulesetVersion, /^ruleset-/);
    assert.ok(runDetail.evaluations.length >= 2);
    assert.ok(runDetail.evaluations[0].inputHash, "each evaluation records its input hash");
    assert.ok(runDetail.summary.findingsByCategory);

    const runList = assertSuccess(await ctx.get("/api/audit/runs", { token }));
    assert.equal(runList.runs.length, 1);
    assert.equal(runList.pagination.total, 1);

    // Dashboard.
    const dashboard = assertSuccess(await ctx.get("/api/audit/dashboard", { token }));
    assert.ok(dashboard.totals.openFindings >= 2);
    assert.ok(dashboard.totals.unresolvedEvidenceRequests >= 1);
    assert.ok(dashboard.topRiskAreas.length >= 1);
    assert.ok(dashboard.latestRun);
    assert.equal(dashboard.aiStatus.provider, "disabled");
    assert.ok(dashboard.disclaimer.includes("not statutory audit conclusions"));
    assert.ok(Array.isArray(dashboard.trend));
    assert.ok(dashboard.affected.staff.length >= 1, "the bill's author appears under affected staff");

    // Rules catalog and per-shop override.
    const rules = assertSuccess(await ctx.get("/api/audit/rules", { token }));
    assert.ok(rules.rules.length >= 90);
    const sample = rules.rules.find((rule) => rule.ruleCode === "BILL_TOTAL_MISMATCH");
    assert.equal(sample.enabled, true);
    assert.equal(sample.effectiveWeight, sample.defaultWeight);
    assert.ok(sample.evidenceTypes.length >= 1);

    const updated = assertSuccess(await ctx.patch("/api/audit/rules/BILL_TOTAL_MISMATCH", { enabled: false, weightOverride: 10 }, { token }));
    assert.equal(updated.enabled, false);
    assert.equal(updated.effectiveWeight, 10);
    const persistedOverride = await ctx.db.auditRule.findFirst({ where: { shopId: shop.id, ruleCode: "BILL_TOTAL_MISMATCH" } });
    assert.equal(persistedOverride.enabled, false);
    // Unknown rule codes are rejected.
    assertFailure(await ctx.patch("/api/audit/rules/NOT_A_RULE", { enabled: false }, { token }), 404);

    // Assurance report — must never present itself as a statutory audit.
    const report = assertSuccess(await ctx.get(`/api/audit/report?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { token }));
    assert.equal(report.title, "Financial Assurance Report");
    assert.equal(report.isStatutoryAudit, false);
    // The title must not label it a statutory audit; the subtitle may mention the
    // phrase only to deny it.
    assert.ok(!/statutory/i.test(report.title), report.title);
    assert.match(report.subtitle, /not a statutory audit report/i);
    assert.ok(report.limitations.length >= 8, "limitations are part of the report");
    assert.ok(report.limitations.some((line) => /not replace a Chartered Accountant/i.test(line)));
    assert.ok(report.coverage.transactionsReviewed >= 2);
    assert.ok(report.findings.raised >= 2);
    assert.ok(report.byArea);
    assert.ok(report.evidence.outstandingRequests >= 1);

    // Explanation falls back to deterministic text because the provider is disabled.
    const findings = assertSuccess(await ctx.get("/api/audit/findings", { token }));
    const explanation = assertSuccess(await ctx.post(`/api/audit/findings/${findings.findings[0].findingId}/explain`, { language: "en" }, { token }));
    assert.equal(explanation.source, "deterministic_fallback");
    assert.equal(explanation.degraded, true);
    assert.ok(explanation.explanation.includes("Potential inconsistency detected"));
    assert.ok(!/fraud/i.test(explanation.explanation));
    // The engine still produced the finding regardless of the AI layer.
    const stored = await ctx.db.auditFinding.findFirst({ where: { id: findings.findings[0].findingId } });
    assert.ok(stored.aiExplanation.includes("Potential inconsistency detected"));
  });

  test("input validation rejects malformed audit requests", async () => {
    await resetDatabase(ctx.db);
    const { ownerMobile, ownerPassword } = await createTenant(ctx.db);
    const token = (await login(ctx, ownerMobile, ownerPassword)).accessToken;

    assertFailure(await ctx.post("/api/audit/runs", {}, { token }), 400); // missing range
    assertFailure(await ctx.post("/api/audit/runs", { from: "2026-07-10T00:00:00Z", to: "2026-07-01T00:00:00Z" }, { token }), 400); // inverted
    assertFailure(await ctx.post("/api/audit/runs", { from: "not-a-date", to: "not-a-date" }, { token }), 400);
    assertFailure(await ctx.get("/api/audit/findings?riskLevel=NOPE", { token }), 400);
    assertFailure(await ctx.get("/api/audit/findings?limit=9999", { token }), 400);
    assertFailure(await ctx.post("/api/audit/evaluate/transaction/NONSENSE/abc", {}, { token }), 400);
    assertFailure(await ctx.get("/api/audit/report", { token }), 400); // range required
    // A well-formed but unknown id is a 404, never a leak.
    assertFailure(await ctx.get("/api/audit/findings/cl0000000000000000000000", { token }), 404);
    assertFailure(await ctx.get("/api/audit/runs/cl0000000000000000000000", { token }), 404);
  });

  test("state-changing audit actions are written to the shop's audit log", async () => {
    await resetDatabase(ctx.db);
    const { shop, owner, ownerMobile, ownerPassword } = await createTenant(ctx.db);
    const token = (await login(ctx, ownerMobile, ownerPassword)).accessToken;
    const product = await createProduct(ctx.db, shop.id);
    const bill = await makeBill(shop.id, { grandTotal: 100, paidAmount: 100, createdByUserId: owner.id, items: [billItem(product, { lineTotal: 100 })] });
    const findingId = (await evaluateViaApi(token, ENTITY_TYPES.BILL, bill.id)).finding.findingId;

    assertSuccess(await ctx.post(`/api/audit/findings/${findingId}/evidence`, { evidenceType: "PAYMENT_RECEIPT", referenceValue: "Book 3 page 9" }, { token }), 201);
    assertSuccess(await ctx.patch(`/api/audit/findings/${findingId}/status`, { status: FINDING_STATUS.UNDER_REVIEW, comment: "checking" }, { token }));
    assertSuccess(await ctx.patch("/api/audit/rules/BILL_SOLD_BELOW_COST", { enabled: false }, { token }));

    const actions = (await ctx.db.auditLog.findMany({ where: { shopId: shop.id }, select: { action: true } })).map((row) => row.action);
    for (const expected of ["AUDIT_TRANSACTION_EVALUATED", "AUDIT_EVIDENCE_SUBMITTED", "AUDIT_FINDING_STATUS_CHANGED", "AUDIT_RULE_UPDATED"]) {
      assert.ok(actions.includes(expected), `expected ${expected} in the audit log, got ${actions.join(",")}`);
    }
  });

  test("transaction-triggered evaluation runs after commit without blocking billing", async () => {
    await resetDatabase(ctx.db);
    // Post-commit evaluation is off in the test environment by default so its
    // background writes cannot contend with unrelated suites. This test is the
    // one that means to exercise it, so it opts in and restores the default.
    setTransactionTriggeredEnabled(true);
    try {
    const { shop, ownerMobile, ownerPassword } = await createTenant(ctx.db);
    const token = (await login(ctx, ownerMobile, ownerPassword)).accessToken;
    const product = await createProduct(ctx.db, shop.id, { stockBaseQty: 50, defaultPricePerRateUnit: 20, costPerRateUnit: 10 });

    // A real bill through the real billing API.
    const response = await ctx.post(
      "/api/bills/confirm",
      {
        billType: "normal_sale",
        gstMode: "inclusive",
        customerName: "Walk-in",
        items: [{ productId: product.id, name: product.name, quantity: 2, enteredUnit: "piece", ratePerRateUnit: 20, gstRate: 0, lineDiscount: 0 }],
        discount: 0,
        actualAmount: 40,
        buyerPaidAmount: 40,
        payments: [{ mode: "cash", amount: 40 }],
      },
      { token }
    );
    const bill = assertSuccess(response, 201);

    // The response did not wait for the audit engine.
    await flushAuditQueue();

    const run = await ctx.db.auditRun.findFirst({
      where: { shopId: shop.id, runType: "TRANSACTION_TRIGGERED" },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(run, "a TRANSACTION_TRIGGERED run should have been created after the commit");
    assert.equal(run.status, "COMPLETED");
    const evaluation = await ctx.db.auditEvaluation.findFirst({
      where: { auditRunId: run.id, sourceEntityType: ENTITY_TYPES.BILL, sourceEntityId: bill.id },
    });
    assert.ok(evaluation, "the committed bill was evaluated");
    // A well-formed sale through the real API should be clean.
    assert.equal(evaluation.riskScore, 0);
    const finding = await ctx.db.auditFinding.findFirst({ where: { shopId: shop.id, sourceEntityId: bill.id } });
    assert.equal(finding, null, "a healthy sale must not raise a finding");
    } finally {
      setTransactionTriggeredEnabled(null);
      await flushAuditQueue();
    }
  });

  // ── MVP ACCEPTANCE SCENARIO ─────────────────────────────────
  test("MVP acceptance scenario: 18 events, correct verdict on each", async () => {
    await resetDatabase(ctx.db);
    const main = await createTenant(ctx.db, { shopName: "Assurance Acceptance Shop" });
    const other = await createTenant(ctx.db, { shopName: "Other Tenant Shop" });
    const staff = await createStaff(ctx.db, main.shop.id, { name: "Counter Staff" });
    const token = (await login(ctx, main.ownerMobile, main.ownerPassword)).accessToken;
    const shopId = main.shop.id;

    const product = await createProduct(ctx.db, shopId, { name: "Toor Dal", stockBaseQty: 100, costPerRateUnit: 60, defaultPricePerRateUnit: 100 });
    const supplier = await ctx.db.supplier.create({ data: { shopId, name: unique("Wholesaler"), mobile: uniqueMobile(), address: "Mandi Road" } });
    const customer = await createCustomer(ctx.db, shopId, { name: "Regular Customer", type: "udhar" });
    const otherCustomer = await createCustomer(ctx.db, other.shop.id, { name: "Foreign Customer" });

    const expectations = [];
    const record = (label, entityType, entityId, expectedRules) => expectations.push({ label, entityType, entityId, expectedRules });

    // 1. Normal cash bill.
    const cashBill = await makeBill(shopId, {
      grandTotal: 100, paidAmount: 100, createdByUserId: main.owner.id,
      items: [billItem(product, { lineTotal: 100 })],
      payments: [{ shopId, mode: "cash", amount: 100, ...moneyShadows({ amount: 100 }) }],
    });
    record("1. normal cash bill", ENTITY_TYPES.BILL, cashBill.id, []);

    // 2. Normal UPI bill.
    const upiBill = await makeBill(shopId, {
      grandTotal: 250, paidAmount: 250, createdByUserId: main.owner.id,
      items: [billItem(product, { quantity: 2, ratePerRateUnit: 125, lineTotal: 250 })],
      payments: [{ shopId, mode: "upi", amount: 250, providerReference: "UTR90001111", ...moneyShadows({ amount: 250 }) }],
    });
    record("2. normal UPI bill", ENTITY_TYPES.BILL, upiBill.id, []);

    // 3. Correct udhar bill (with its matching ledger debit).
    const udharBill = await makeBill(shopId, {
      grandTotal: 300, paidAmount: 0, creditAmount: 300, customerId: customer.id, customerName: customer.name,
      createdByUserId: main.owner.id, items: [billItem(product, { quantity: 3, ratePerRateUnit: 100, lineTotal: 300 })],
    });
    await ctx.db.udharLedger.create({
      data: { shopId, customerId: customer.id, customerName: customer.name, type: "debit", amount: 300, mode: "credit", billId: udharBill.id, ...moneyShadows({ amount: 300 }) },
    });
    record("3. correct udhar bill", ENTITY_TYPES.BILL, udharBill.id, []);

    // 4. Bill marked paid without sufficient payment.
    const fakePaid = await makeBill(shopId, {
      grandTotal: 500, paidAmount: 500, createdByUserId: staff.staff.id,
      items: [billItem(product, { quantity: 5, ratePerRateUnit: 100, lineTotal: 500 })],
      payments: [{ shopId, mode: "cash", amount: 100, ...moneyShadows({ amount: 100 }) }],
    });
    record("4. bill marked paid without sufficient payment", ENTITY_TYPES.BILL, fakePaid.id, ["BILL_MARKED_PAID_WITHOUT_PAYMENTS"]);

    // 5. Duplicate bill retry (same customer, amount, items, same device, seconds apart).
    const retryAt = new Date();
    await makeBill(shopId, {
      grandTotal: 180, paidAmount: 180, customerId: customer.id, customerName: customer.name, createdByUserId: staff.staff.id,
      deviceId: "device-counter-1", sourceDeviceId: "device-counter-1", createdAt: retryAt,
      items: [billItem(product, { quantity: 2, ratePerRateUnit: 90, lineTotal: 180 })],
      payments: [{ shopId, mode: "cash", amount: 180, ...moneyShadows({ amount: 180 }) }],
    });
    const retryTwin = await makeBill(shopId, {
      grandTotal: 180, paidAmount: 180, customerId: customer.id, customerName: customer.name, createdByUserId: staff.staff.id,
      deviceId: "device-counter-1", sourceDeviceId: "device-counter-1", createdAt: new Date(retryAt.getTime() + 15000),
      items: [billItem(product, { quantity: 2, ratePerRateUnit: 90, lineTotal: 180 })],
      payments: [{ shopId, mode: "cash", amount: 180, ...moneyShadows({ amount: 180 }) }],
    });
    record("5. duplicate bill retry", ENTITY_TYPES.BILL, retryTwin.id, ["BILL_NEAR_DUPLICATE"]);

    // 6. Excessive staff discount with no reason.
    const discountBill = await makeBill(shopId, {
      subtotal: 40, discount: 60, grandTotal: 40, paidAmount: 40, createdByUserId: staff.staff.id,
      items: [billItem(product, { quantity: 1, ratePerRateUnit: 100, lineTotal: 40 })],
      payments: [{ shopId, mode: "cash", amount: 40, ...moneyShadows({ amount: 40 }) }],
    });
    record("6. excessive staff discount", ENTITY_TYPES.BILL, discountBill.id, ["BILL_EXCESSIVE_DISCOUNT", "BILL_DISCOUNT_WITHOUT_AUTHORIZATION"]);

    // 7. Purchase with missing invoice.
    const noInvoicePurchase = await ctx.db.purchaseHistory.create({
      data: {
        shopId, productId: product.id, supplierId: supplier.id, supplierName: supplier.name,
        qtyBase: 30, pricePerRateUnit: 60, totalCost: 1800, billAmount: 1800, invoiceNumber: null,
        purchasePaymentStatus: "paid", purchasePaidAmount: 1800, purchaseDueAmount: 0,
        ...moneyShadows({ pricePerRateUnit: 60, totalCost: 1800, billAmount: 1800, purchasePaidAmount: 1800, purchaseDueAmount: 0 }),
      },
    });
    await ctx.db.stockLedger.create({
      data: {
        shopId, productId: product.id, productName: product.name, action: "purchase",
        changeBaseQty: 30, oldStockBaseQty: 100, newStockBaseQty: 130,
        supplierName: supplier.name, sourceType: "purchase", sourceId: noInvoicePurchase.id,
      },
    });
    record("7. purchase with missing invoice", ENTITY_TYPES.PURCHASE, noInvoicePurchase.id, ["PURCHASE_MISSING_INVOICE_EVIDENCE"]);

    // 8. Purchase quantity differing from the stock actually received.
    const shortPurchase = await ctx.db.purchaseHistory.create({
      data: {
        shopId, productId: product.id, supplierId: supplier.id, supplierName: supplier.name,
        qtyBase: 40, pricePerRateUnit: 60, totalCost: 2400, billAmount: 2400, invoiceNumber: "WS-5001",
        purchasePaymentStatus: "paid", purchasePaidAmount: 2400, purchaseDueAmount: 0,
        ...moneyShadows({ pricePerRateUnit: 60, totalCost: 2400, billAmount: 2400, purchasePaidAmount: 2400, purchaseDueAmount: 0 }),
      },
    });
    await ctx.db.stockLedger.create({
      data: {
        shopId, productId: product.id, productName: product.name, action: "purchase",
        changeBaseQty: 25, oldStockBaseQty: 130, newStockBaseQty: 155, // 25 received against 40 purchased
        invoiceNumber: "WS-5001", supplierName: supplier.name, sourceType: "purchase", sourceId: shortPurchase.id,
      },
    });
    record("8. purchase quantity differs from stock receipt", ENTITY_TYPES.PURCHASE, shortPurchase.id, ["PURCHASE_STOCK_QUANTITY_MISMATCH"]);

    // 9. Duplicate supplier invoice number.
    await ctx.db.purchaseHistory.create({
      data: {
        shopId, productId: product.id, supplierId: supplier.id, supplierName: supplier.name,
        qtyBase: 10, pricePerRateUnit: 60, totalCost: 600, billAmount: 600, invoiceNumber: "WS-DUP-77",
        ...moneyShadows({ pricePerRateUnit: 60, totalCost: 600, billAmount: 600 }),
      },
    });
    const duplicateInvoice = await ctx.db.purchaseHistory.create({
      data: {
        shopId, productId: product.id, supplierId: supplier.id, supplierName: supplier.name,
        qtyBase: 10, pricePerRateUnit: 60, totalCost: 600, billAmount: 600, invoiceNumber: "WS-DUP-77",
        ...moneyShadows({ pricePerRateUnit: 60, totalCost: 600, billAmount: 600 }),
      },
    });
    record("9. duplicate supplier invoice", ENTITY_TYPES.PURCHASE, duplicateInvoice.id, ["PURCHASE_DUPLICATE_INVOICE_NUMBER"]);

    // 10. Expense without receipt.
    const noReceipt = await ctx.db.expense.create({
      data: { shopId, title: "Shop repairs", amount: 3500, category: "maintenance", paymentMode: "cash", vendor: null, notes: null, recordedBy: null },
    });
    record("10. expense without receipt", ENTITY_TYPES.EXPENSE, noReceipt.id, ["EXPENSE_MISSING_RECEIPT", "EXPENSE_MISSING_PAYEE"]);

    // 11. Duplicate expense.
    const dupSpentAt = new Date();
    await ctx.db.expense.create({
      data: { shopId, title: "Loading charges", amount: 800, category: "transport", paymentMode: "cash", vendor: "Hamaal", spentAt: dupSpentAt },
    });
    const duplicateExpense = await ctx.db.expense.create({
      data: { shopId, title: "Loading charges", amount: 800, category: "transport", paymentMode: "cash", vendor: "Hamaal", spentAt: new Date(dupSpentAt.getTime() + 7200 * 1000) },
    });
    record("11. duplicate expense", ENTITY_TYPES.EXPENSE, duplicateExpense.id, ["EXPENSE_DUPLICATE"]);

    // 12 + 13. Unauthorized stock correction and a stock movement with no source.
    const messyProduct = await createProduct(ctx.db, shopId, { name: "Sugar", stockBaseQty: 500, costPerRateUnit: 40 });
    await ctx.db.stockLedger.create({
      data: { shopId, productId: messyProduct.id, productName: messyProduct.name, action: "sale", changeBaseQty: -30, oldStockBaseQty: 200, newStockBaseQty: 170, billId: null },
    });
    await ctx.db.stockLedger.create({
      data: { shopId, productId: messyProduct.id, productName: messyProduct.name, action: "correction", changeBaseQty: -80, oldStockBaseQty: 170, newStockBaseQty: 90, note: null },
    });
    record("12+13. unauthorized correction and unsourced stock movement", ENTITY_TYPES.PRODUCT, messyProduct.id, [
      "STOCK_LARGE_MANUAL_CORRECTION",
      "STOCK_DECREASE_WITHOUT_SOURCE",
    ]);

    // 14. Customer payment exceeding outstanding.
    const overpaidCustomer = await createCustomer(ctx.db, shopId, { name: "Overpaying Customer" });
    const overBase = Date.now();
    await ctx.db.udharLedger.create({
      data: { shopId, customerId: overpaidCustomer.id, customerName: overpaidCustomer.name, type: "debit", amount: 200, mode: "credit", createdAt: new Date(overBase), ...moneyShadows({ amount: 200 }) },
    });
    await ctx.db.udharLedger.create({
      data: { shopId, customerId: overpaidCustomer.id, customerName: overpaidCustomer.name, type: "payment", amount: 900, mode: "cash", createdAt: new Date(overBase + 5000), ...moneyShadows({ amount: 900 }) },
    });
    record("14. customer payment exceeding outstanding", ENTITY_TYPES.CUSTOMER, overpaidCustomer.id, [
      "UDHAR_PAYMENT_EXCEEDS_OUTSTANDING",
      "UDHAR_NEGATIVE_BALANCE",
    ]);

    // 15. Backdated transaction after a locked daily closing.
    const closingDay = new Date();
    closingDay.setHours(9, 0, 0, 0);
    const lockedAt = new Date(closingDay.getTime());
    await ctx.db.dailyClosingSnapshot.create({
      data: {
        shopId, date: closingDay, totalSalesPaise: 0, cashReceivedPaise: 0, expectedCashPaise: 0, totalBills: 0,
        lockedAt, lockedByUserId: main.owner.id, generatedAt: lockedAt, source: "manual",
      },
    });
    // Genuinely backdated: businessDate preserves the time of sale before the
    // lock, while createdAt and the sync event show the later server replay.
    const backdatedKey = `offline-acc-${Date.now()}`;
    const backdated = await makeBill(shopId, {
      grandTotal: 700, paidAmount: 700, createdByUserId: staff.staff.id,
      businessDate: new Date(lockedAt.getTime() - 90 * 60 * 1000),
      createdAt: new Date(lockedAt.getTime() + 4 * 3600 * 1000),
      idempotencyKey: backdatedKey, sourceDeviceId: "device-offline-acc",
      items: [billItem(product, { quantity: 7, ratePerRateUnit: 100, lineTotal: 700 })],
      payments: [{ shopId, mode: "cash", amount: 700, ...moneyShadows({ amount: 700 }) }],
    });
    await ctx.db.offlineSyncEvent.create({
      data: {
        shopId, eventId: `evt-${backdatedKey}`, type: "CREATE_BILL", status: "synced", attempts: 1,
        requestJson: JSON.stringify({ idempotencyKey: backdatedKey, grandTotal: 700 }),
        resultJson: '{"ok":true}',
        createdAt: new Date(lockedAt.getTime() + 4 * 3600 * 1000),
      },
    });
    record("15. backdated bill into locked closing", ENTITY_TYPES.BILL, backdated.id, ["BILL_BACKDATED_INTO_LOCKED_DAY"]);

    // 16. Duplicate offline sync event (re-queued under a new event id).
    const payload = JSON.stringify({ type: "CREATE_BILL", payload: { billNo: "OFF-1", grandTotal: 450 } });
    await ctx.db.offlineSyncEvent.create({
      data: { shopId, eventId: "acc-evt-1", type: "CREATE_BILL", status: "synced", attempts: 1, requestJson: payload, resultJson: "{\"ok\":true}" },
    });
    const duplicateSync = await ctx.db.offlineSyncEvent.create({
      data: { shopId, eventId: "acc-evt-2", type: "CREATE_BILL", status: "synced", attempts: 1, requestJson: payload, resultJson: "{\"ok\":true}" },
    });
    record("16. duplicate offline sync event", ENTITY_TYPES.SYNC_EVENT, duplicateSync.id, ["SYNC_DUPLICATE_OFFLINE_EVENT"]);

    // 17. Cancelled bill still affecting a derived report (ledger not reversed).
    const cancelled = await makeBill(shopId, {
      grandTotal: 400, paidAmount: 400, status: "cancelled", cancelledAt: new Date(), cancelledReason: "wrong entry",
      createdByUserId: staff.staff.id, items: [billItem(product, { quantity: 4, ratePerRateUnit: 100, lineTotal: 400 })],
      payments: [{ shopId, mode: "cash", amount: 400, ...moneyShadows({ amount: 400 }) }],
    });
    await ctx.db.financialLedger.create({
      data: {
        shopId, billId: cancelled.id, sourceType: "bill", sourceId: cancelled.id, entryType: "sale",
        direction: "credit", amountPaise: 40000n, businessDate: new Date(), idempotencyKey: `acc:${cancelled.id}:sale`,
      },
    });
    record("17. cancelled bill still in derived report", ENTITY_TYPES.BILL, cancelled.id, ["CANCELLED_BILL_STILL_IN_LEDGER"]);

    // 18. Cross-shop reference attempt.
    const crossShop = await makeBill(shopId, {
      grandTotal: 150, paidAmount: 150, customerId: otherCustomer.id, customerName: "Foreign Customer",
      createdByUserId: staff.staff.id, items: [billItem(product, { quantity: 1, ratePerRateUnit: 150, lineTotal: 150 })],
      payments: [{ shopId, mode: "cash", amount: 150, ...moneyShadows({ amount: 150 }) }],
    });
    record("18. cross-shop reference attempt", ENTITY_TYPES.BILL, crossShop.id, ["BILL_CROSS_SHOP_REFERENCE"]);

    // ── run the engine over everything via the API ────────────
    const from = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
    const to = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const run = assertSuccess(await ctx.post("/api/audit/runs", { runType: "MANUAL", from, to }, { token }), 201);
    assert.ok(["COMPLETED", "PARTIAL"].includes(run.status), `run status ${run.status}`);
    assert.equal(run.failures.length, 0, `no entity should fail: ${JSON.stringify(run.failures)}`);

    // The engine evaluates customers/products/sync events too, so evaluate the
    // few entities the period sweep does not reach by their own activity.
    for (const entity of expectations) {
      await evaluateViaApi(token, entity.entityType, entity.entityId);
    }

    // ── assert the verdict on each of the 18 events ───────────
    const summary = [];
    for (const entity of expectations) {
      const finding = await ctx.db.auditFinding.findFirst({
        where: { shopId, sourceEntityType: entity.entityType, sourceEntityId: entity.entityId },
        include: { rules: true, evidenceRequirements: true },
      });

      if (entity.expectedRules.length === 0) {
        assert.equal(
          finding,
          null,
          `${entity.label} should pass cleanly but raised: ${finding?.rules.map((r) => r.ruleCode).join(",")}`
        );
        summary.push({ label: entity.label, verdict: "clean" });
        continue;
      }

      assert.ok(finding, `${entity.label} should have raised a finding`);
      const codes = finding.rules.filter((rule) => rule.active).map((rule) => rule.ruleCode);
      for (const expected of entity.expectedRules) {
        assert.ok(codes.includes(expected), `${entity.label}: expected ${expected}, got ${codes.join(",")}`);
      }
      // Transparent, reproducible score.
      const breakdown = JSON.parse(finding.scoreBreakdownJson);
      const modified = Math.max(0, Math.min(100, Math.round(breakdown.baseScore * breakdown.materialityMultiplier * breakdown.historyMultiplier)));
      const recomputed = breakdown.scoreFloorApplied ? Math.min(100, breakdown.scoreFloor) : modified;
      assert.equal(recomputed, finding.riskScore, `${entity.label}: score must be reproducible from its breakdown`);
      assert.ok(finding.riskScore > 0 && finding.riskScore <= 100);
      assert.ok(["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(finding.riskLevel));
      assert.ok(breakdown.triggeredRules.every((rule) => Number.isInteger(rule.scoreContribution)));
      // Appropriate evidence was requested.
      assert.ok(finding.evidenceRequirements.length > 0, `${entity.label}: evidence should have been requested`);
      // Findings are preserved with a trail.
      const history = await ctx.db.auditFindingStatusHistory.count({ where: { findingId: finding.id } });
      assert.ok(history >= 1, `${entity.label}: needs a status-history row`);

      summary.push({
        label: entity.label,
        verdict: "flagged",
        riskScore: finding.riskScore,
        riskLevel: finding.riskLevel,
        rules: codes,
        evidenceRequested: finding.evidenceRequirements.map((row) => row.evidenceType),
      });
    }

    // Duplicate evaluation does not create duplicate findings.
    const beforeCount = await ctx.db.auditFinding.count({ where: { shopId } });
    for (const entity of expectations) {
      await evaluateViaApi(token, entity.entityType, entity.entityId);
    }
    const afterCount = await ctx.db.auditFinding.count({ where: { shopId } });
    assert.equal(afterCount, beforeCount, "re-evaluating everything must not duplicate findings");

    // Shop isolation held throughout: the other tenant has no findings at all,
    // even though one of its customers was referenced by a bill in this shop.
    const otherFindings = await ctx.db.auditFinding.count({ where: { shopId: other.shop.id } });
    assert.equal(otherFindings, 0);

    // The critical cross-shop case is scored CRITICAL.
    const crossFinding = await ctx.db.auditFinding.findFirst({ where: { shopId, sourceEntityId: crossShop.id } });
    assert.equal(crossFinding.riskLevel, "CRITICAL");

    // No canonical financial record was touched by any of this.
    const untouchedBill = await ctx.db.bill.findFirst({ where: { id: fakePaid.id } });
    assert.equal(Number(untouchedBill.paidAmount), 500, "the engine must not correct the bill it flagged");
    const untouchedProduct = await ctx.db.product.findFirst({ where: { id: messyProduct.id } });
    assert.equal(Number(untouchedProduct.stockBaseQty), 500, "the engine must not correct stock it flagged");
    const untouchedCustomer = await ctx.db.customer.findFirst({ where: { id: overpaidCustomer.id } });
    assert.equal(Number(untouchedCustomer.udharAmount), 0, "the engine must not adjust a customer balance");

    // The report reflects the scenario and stays honest about what it is.
    const report = assertSuccess(await ctx.get(`/api/audit/report?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { token }));
    assert.equal(report.isStatutoryAudit, false);
    assert.ok(report.findings.raised >= 14, `expected the flagged events in the report, got ${report.findings.raised}`);
    assert.ok(report.byArea.duplicateRisks >= 3);
    assert.ok(report.byArea.purchaseRisks >= 2);
    assert.ok(report.byArea.expenseRisks >= 2);
    assert.ok(report.byArea.syncIntegrityIssues >= 2);
    assert.ok(report.byArea.customerCreditInconsistencies >= 1);
    assert.ok(report.byArea.inventoryInconsistencies >= 1);

    const cleanCount = summary.filter((row) => row.verdict === "clean").length;
    const flaggedCount = summary.filter((row) => row.verdict === "flagged").length;
    assert.equal(cleanCount, 3, "the three healthy transactions must pass");
    assert.equal(flaggedCount, expectations.length - 3);

    // Printed so the acceptance evidence is visible in CI output.
    console.log("\nMVP acceptance scenario results:");
    for (const row of summary) {
      if (row.verdict === "clean") console.log(`  ✓ ${row.label} → no finding (correct)`);
      else console.log(`  ⚑ ${row.label} → ${row.riskLevel} ${row.riskScore}/100 [${row.rules.join(", ")}] evidence: ${row.evidenceRequested.join(", ")}`);
    }
  });
}

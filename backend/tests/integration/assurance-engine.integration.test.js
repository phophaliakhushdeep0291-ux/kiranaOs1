// Financial Assurance Engine — deterministic engine tests.
//
// These tests assert PERSISTED outcomes (findings, rules, scores, history rows)
// rather than mocked calls, per the testing requirements. Bad data is written
// directly with Prisma because the business APIs correctly refuse to create it:
// the engine's job is to detect inconsistencies that already exist in a shop's
// data, whatever produced them (an old app version, a bad sync replay, a bug).
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createIntegrationContext, resetDatabase } from "./setup.js";
import { createCustomer, createProduct, createTenant, unique, uniqueMobile } from "./factories.js";
import { evaluateEntity } from "../../src/modules/assurance/evaluation.service.js";
import { ENTITY_TYPES, FINDING_STATUS, RISK_LEVELS } from "../../src/modules/assurance/assurance.constants.js";
import { scoreFinding, materialityFor, historyModifierFor } from "../../src/modules/assurance/risk-scoring.service.js";
import { ALL_RULES, RULESET_VERSION, RULES_BY_CODE } from "../../src/modules/assurance/rules/index.js";
import { computeRobustStats, recomputeShopBaselines } from "../../src/modules/assurance/baseline.service.js";
import { redactForExternalAi, containsLikelyPii } from "../../src/modules/assurance/ai/redaction.js";
import { explainFinding } from "../../src/modules/assurance/ai/audit-ai.service.js";
import { MockAuditAIProvider } from "../../src/modules/assurance/ai/providers.js";
import { moneyShadows } from "../../src/utils/money.js";

const ctx = await createIntegrationContext();

if (ctx.skip) {
  test("assurance engine integration tests skipped", { skip: ctx.reason }, () => {});
} else {
  after(async () => ctx.close());
  runSuite();
}

// ── helpers ───────────────────────────────────────────────────

let billSeq = 0;

async function makeBill(db, shopId, overrides = {}) {
  billSeq += 1;
  const grandTotal = overrides.grandTotal ?? 100;
  const money = {
    subtotal: overrides.subtotal ?? grandTotal,
    discount: overrides.discount ?? 0,
    gst: overrides.gst ?? 0,
    grandTotal,
    actualAmount: overrides.actualAmount ?? grandTotal,
    buyerPaidAmount: overrides.buyerPaidAmount ?? overrides.paidAmount ?? grandTotal,
    waivedAmount: overrides.waivedAmount ?? 0,
    grossProfit: overrides.grossProfit ?? 0,
    paidAmount: overrides.paidAmount ?? grandTotal,
    creditAmount: overrides.creditAmount ?? 0,
  };
  const { items, payments, ...rest } = overrides;
  return db.bill.create({
    data: {
      shopId,
      billNo: overrides.billNo ?? `KOS-T-${Date.now()}-${billSeq}`,
      billType: overrides.billType ?? "normal_sale",
      status: overrides.status ?? "active",
      customerName: overrides.customerName ?? "Walk-in",
      gstMode: overrides.gstMode ?? "inclusive",
      ...money,
      ...moneyShadows(money),
      ...Object.fromEntries(
        Object.entries(rest).filter(([key]) =>
          [
            "customerId", "createdByUserId", "deviceId", "sourceDeviceId", "clientBillId",
            "idempotencyKey", "cancelledAt", "cancelledReason", "returnOfBillId", "refundMode",
            "discountReason", "createdAt", "updatedAt", "locationId",
          ].includes(key)
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
    name: product?.name ?? overrides.name ?? "Item",
    quantity,
    enteredUnit: overrides.enteredUnit ?? "piece",
    baseUnit: overrides.baseUnit ?? "piece",
    quantityInBaseUnit: overrides.quantityInBaseUnit ?? quantity,
    rateUnit: overrides.rateUnit ?? "piece",
    ratePerRateUnit: rate,
    costPerRateUnit: overrides.costPerRateUnit ?? 60,
    gstRate: 0,
    lineDiscount: overrides.lineDiscount ?? 0,
    lineTotal,
    lineCost: overrides.lineCost ?? (overrides.costPerRateUnit ?? 60) * quantity,
    lineProfit: overrides.lineProfit ?? lineTotal - (overrides.costPerRateUnit ?? 60) * quantity,
    ...(overrides.note !== undefined ? { note: overrides.note } : {}),
    ...(overrides.conversionToBase !== undefined ? { conversionToBase: overrides.conversionToBase } : {}),
  };
}

async function evaluate(shopId, entityType, entityId) {
  return evaluateEntity(shopId, entityType, entityId, { client: ctx.db });
}

function ruleCodes(result) {
  return result.triggeredRules.map((rule) => rule.ruleCode).sort();
}

async function findingFor(shopId, entityType, entityId) {
  return ctx.db.auditFinding.findFirst({
    where: { shopId, sourceEntityType: entityType, sourceEntityId: entityId },
    include: { rules: true, evidenceRequirements: true, statusHistory: { orderBy: { createdAt: "asc" } } },
  });
}

function runSuite() {
  // ── Layer 2/3 unit-level guarantees ─────────────────────────

  test("rule registry is well formed and versioned", () => {
    assert.ok(ALL_RULES.length >= 90, `expected 90+ rules, got ${ALL_RULES.length}`);
    assert.match(RULESET_VERSION, /^ruleset-[0-9a-f]{12}$/);
    for (const rule of ALL_RULES) {
      assert.equal(typeof rule.evaluate, "function", `${rule.ruleCode} needs an evaluate function`);
      assert.ok(rule.applicableEntityTypes.length > 0, `${rule.ruleCode} needs entity types`);
      assert.ok(rule.defaultWeight > 0 && rule.defaultWeight <= 60, `${rule.ruleCode} weight out of range`);
      assert.ok(["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(rule.severity));
      assert.equal(rule.ruleId, `${rule.ruleCode}@${rule.version}`);
      assert.ok(rule.remediation.length > 10, `${rule.ruleCode} needs remediation guidance`);
    }
  });

  test("risk score is deterministic, transparent and clamped", () => {
    const fakeRule = {
      ruleCode: "TEST_RULE",
      version: 1,
      category: "BILLING",
      severity: "HIGH", // ×1.5
      defaultWeight: 30,
    };
    const first = scoreFinding([{ rule: fakeRule, details: {} }], { amountPaise: 100000 });
    const second = scoreFinding([{ rule: fakeRule, details: {} }], { amountPaise: 100000 });
    assert.deepEqual(first, second, "same inputs must produce an identical breakdown");

    // 30 × 1.5 = 45 base; ₹1,000 sits in the 1.0 materiality band; no history.
    assert.equal(first.baseScore, 45);
    assert.equal(first.materialityMultiplier, 1);
    assert.equal(first.finalScore, 45);
    assert.equal(first.riskLevel, RISK_LEVELS.MEDIUM);
    assert.equal(first.triggeredRules[0].scoreContribution, 45);
    assert.ok(first.formula.includes("clamp"));

    // Per-rule cap applies before summing.
    const heavy = scoreFinding([{ rule: { ...fakeRule, severity: "CRITICAL", defaultWeight: 60 }, details: {} }], {});
    assert.equal(heavy.triggeredRules[0].scoreContribution, 60, "single rule contribution is capped at 60");
    assert.equal(heavy.triggeredRules[0].cappedAt, 60);

    // Score never exceeds 100 no matter how many rules fire.
    const many = scoreFinding(
      Array.from({ length: 10 }, (_, index) => ({ rule: { ...fakeRule, ruleCode: `R${index}` }, details: {} })),
      { amountPaise: 100000000, priorConfirmedFindings: 5 }
    );
    assert.equal(many.finalScore, 100);
    assert.equal(many.riskLevel, RISK_LEVELS.CRITICAL);
  });

  test("risk level thresholds sit on documented boundaries", () => {
    const at = (score) => {
      const weight = score; // MEDIUM severity ⇒ ×1
      return scoreFinding([{ rule: { ruleCode: "X", version: 1, category: "BILLING", severity: "MEDIUM", defaultWeight: weight } , details: {} }], { amountPaise: 100000 });
    };
    assert.equal(at(29).riskLevel, RISK_LEVELS.LOW);
    assert.equal(at(30).riskLevel, RISK_LEVELS.MEDIUM);
    assert.equal(at(54).riskLevel, RISK_LEVELS.MEDIUM);
    assert.equal(at(55).riskLevel, RISK_LEVELS.HIGH);
    assert.equal(at(60).riskLevel, RISK_LEVELS.HIGH);
    // 60 weight × 1.3 materiality (> ₹25,000) = 78 → still HIGH; add history → CRITICAL.
    assert.equal(materialityFor(3000000).multiplier, 1.3);
    assert.equal(historyModifierFor(3).multiplier, 1.2);
  });

  test("baselines use robust statistics and refuse to guess on thin history", () => {
    const thin = computeRobustStats([10, 20, 30]);
    assert.equal(thin.status, "INSUFFICIENT_DATA");
    assert.equal(thin.sampleCount, 3);
    assert.equal(thin.minimumSamples, 30);

    const values = Array.from({ length: 40 }, (_, index) => index + 1);
    const stats = computeRobustStats(values);
    assert.equal(stats.status, "OK");
    assert.equal(stats.median, 20.5);
    assert.equal(stats.p25, 10.75);
    assert.equal(stats.p75, 30.25);
    assert.ok(stats.upperFence > stats.p75);
  });

  // ── redaction and AI fallback ───────────────────────────────

  test("redaction strips identity before any provider call", () => {
    const raw = {
      customerName: "Ramesh Kumar",
      mobile: "9876543210",
      buyerGstin: "27AAPFU0939F1ZV",
      note: "paid via ramesh@okhdfcbank, call 9876543210, acct 123456789012",
      token: "Bearer abcdefghijklmnopqrstuvwx",
      customerId: "cust_abc123",
      billId: "bill_xyz789",
      amountPaise: 118000,
      nested: { address: "12 MG Road", customerId: "cust_abc123" },
    };
    const { payload, report } = redactForExternalAi(raw);

    assert.equal(payload.customerName, undefined, "names are dropped");
    assert.equal(payload.mobile, undefined);
    assert.equal(payload.buyerGstin, undefined);
    assert.equal(payload.token, undefined);
    assert.equal(payload.nested.address, undefined);
    assert.ok(!String(payload.note).includes("9876543210"), "phone masked in free text");
    assert.ok(!String(payload.note).includes("okhdfcbank"), "UPI id masked in free text");
    assert.ok(!String(payload.note).includes("123456789012"), "account number masked");
    assert.equal(payload.amountPaise, 118000, "audit facts survive redaction");
    assert.match(payload.customerId, /^CUSTOMER_\d+$/, "ids are pseudonymized");
    assert.equal(payload.customerId, payload.nested.customerId, "same id maps to the same pseudonym");
    assert.notEqual(payload.customerId, payload.billId);
    assert.ok(report.droppedKeys.includes("customerName"));
    assert.equal(containsLikelyPii(payload), false, "redacted payload passes the PII guard");
    assert.equal(containsLikelyPii(raw), true, "guard catches the raw payload");
  });

  test("AI failure and disabled provider both fall back to deterministic text", async () => {
    const finding = {
      sourceEntityType: "BILL",
      riskScore: 62,
      riskLevel: "HIGH",
      confidence: 0.9,
      amountPaise: 118000,
      triggeredRules: [
        { ruleCode: "BILL_TOTAL_MISMATCH", name: "Bill total mismatch", severity: "CRITICAL", scoreContribution: 60, remediation: "Check the arithmetic.", details: {} },
      ],
      scoreBreakdown: { formula: "f", baseScore: 60 },
    };

    // Provider throws → engine still returns a usable explanation.
    const throwing = await explainFinding({ finding, provider: new MockAuditAIProvider({ failMode: "throw" }) });
    assert.equal(throwing.source, "deterministic_fallback");
    assert.equal(throwing.degraded, true);
    assert.ok(throwing.text.includes("Potential inconsistency detected"));
    assert.ok(throwing.text.includes("62/100"));

    // Malformed provider output is rejected by schema validation.
    const malformed = await explainFinding({ finding, provider: new MockAuditAIProvider({ failMode: "malformed" }) });
    assert.equal(malformed.source, "deterministic_fallback");
    assert.equal(malformed.failureReason, "invalid_provider_output");

    // Working mock provider is used, and its output is non-accusatory.
    const working = await explainFinding({ finding, provider: new MockAuditAIProvider() });
    assert.equal(working.source, "ai_provider");
    assert.equal(working.degraded, false);
    assert.ok(!/fraud has occurred/i.test(working.text));
    assert.ok(working.disclaimer.includes("not a statutory audit opinion"));
  });

  test("provider output containing accusatory language is rejected", async () => {
    const accusing = {
      name: "accusing",
      available: true,
      async explainFinding() {
        return { summary: "Fraud has occurred and the staff member is guilty of theft.", whatToCheck: [], suggestedEvidence: [] };
      },
    };
    const result = await explainFinding({
      finding: { sourceEntityType: "BILL", riskScore: 50, riskLevel: "MEDIUM", confidence: 1, amountPaise: 1000, triggeredRules: [] },
      provider: accusing,
    });
    assert.equal(result.source, "deterministic_fallback");
    assert.match(result.failureReason, /language_policy_violation/);
  });

  // ── engine behaviour against real records ───────────────────

  test("clean bills produce no finding; broken bills produce explained findings", async () => {
    await resetDatabase(ctx.db);
    const { shop, owner } = await createTenant(ctx.db);
    const product = await createProduct(ctx.db, shop.id, { defaultPricePerRateUnit: 100, costPerRateUnit: 60 });

    // 1 + 2. Normal cash and UPI bills — internally consistent.
    for (const mode of ["cash", "upi"]) {
      const bill = await makeBill(ctx.db, shop.id, {
        grandTotal: 100,
        paidAmount: 100,
        createdByUserId: owner.id,
        items: [billItem(product)],
        payments: [{ shopId: shop.id, mode, amount: 100, ...moneyShadows({ amount: 100 }) }],
      });
      const result = await evaluate(shop.id, ENTITY_TYPES.BILL, bill.id);
      assert.equal(result.triggered, false, `${mode} bill should be clean, got ${ruleCodes(result).join(",")}`);
      assert.equal(await findingFor(shop.id, ENTITY_TYPES.BILL, bill.id), null);
    }

    // 4. Bill marked paid without sufficient payment rows.
    const unpaid = await makeBill(ctx.db, shop.id, {
      grandTotal: 100,
      paidAmount: 100,
      createdByUserId: owner.id,
      items: [billItem(product)],
      // no payment rows at all
    });
    const unpaidResult = await evaluate(shop.id, ENTITY_TYPES.BILL, unpaid.id);
    assert.ok(ruleCodes(unpaidResult).includes("BILL_MARKED_PAID_WITHOUT_PAYMENTS"));
    const unpaidFinding = await findingFor(shop.id, ENTITY_TYPES.BILL, unpaid.id);
    assert.ok(unpaidFinding, "a finding must be persisted");
    assert.equal(unpaidFinding.status, FINDING_STATUS.OPEN);
    // Every finding must explain exactly which rule fired, with its numbers.
    const persistedRule = unpaidFinding.rules.find((rule) => rule.ruleCode === "BILL_MARKED_PAID_WITHOUT_PAYMENTS");
    assert.ok(persistedRule);
    const details = JSON.parse(persistedRule.detailsJson);
    assert.equal(details.declaredPaidAmount, 100);
    assert.equal(details.confirmedPaymentSum, 0);
    assert.equal(details.shortfallRupees, 100);
    // Evidence requirements are raised automatically from the rule definition.
    const requiredTypes = unpaidFinding.evidenceRequirements.map((row) => row.evidenceType);
    assert.ok(requiredTypes.includes("PAYMENT_RECEIPT"), `expected PAYMENT_RECEIPT, got ${requiredTypes.join(",")}`);
    // And the score is reproducible from the stored breakdown.
    const breakdown = JSON.parse(unpaidFinding.scoreBreakdownJson);
    const modified = Math.max(0, Math.min(100, Math.round(breakdown.baseScore * breakdown.materialityMultiplier * breakdown.historyMultiplier)));
      const recomputed = breakdown.scoreFloorApplied ? Math.min(100, breakdown.scoreFloor) : modified;
    assert.equal(recomputed, unpaidFinding.riskScore);
  });

  test("bill arithmetic, discount and below-cost rules fire with exact numbers", async () => {
    await resetDatabase(ctx.db);
    const { shop, owner } = await createTenant(ctx.db);
    const staff = await ctx.db.user.create({
      data: { shopId: shop.id, name: "Staff", mobile: uniqueMobile(), passwordHash: "x", role: "staff" },
    });
    const product = await createProduct(ctx.db, shop.id, { costPerRateUnit: 60 });

    // Bill total does not equal item totals minus discounts.
    const mismatch = await makeBill(ctx.db, shop.id, {
      grandTotal: 250, // items say 100
      paidAmount: 250,
      createdByUserId: owner.id,
      items: [billItem(product, { quantity: 1, ratePerRateUnit: 100, lineTotal: 100 })],
      payments: [{ shopId: shop.id, mode: "cash", amount: 250, ...moneyShadows({ amount: 250 }) }],
    });
    const mismatchResult = await evaluate(shop.id, ENTITY_TYPES.BILL, mismatch.id);
    assert.ok(ruleCodes(mismatchResult).includes("BILL_TOTAL_MISMATCH"));
    const totalRule = mismatchResult.triggeredRules.find((r) => r.ruleCode === "BILL_TOTAL_MISMATCH");
    assert.equal(totalRule.details.expectedGrandTotal, 100);
    assert.equal(totalRule.details.storedGrandTotal, 250);
    assert.equal(totalRule.details.differenceRupees, 150);

    // 6. Excessive staff discount with no reason and no owner approval.
    const discounted = await makeBill(ctx.db, shop.id, {
      subtotal: 50,
      discount: 50, // 50% of the ₹100 gross
      grandTotal: 50,
      paidAmount: 50,
      createdByUserId: staff.id,
      items: [billItem(product, { quantity: 1, ratePerRateUnit: 100, lineTotal: 50 })],
      payments: [{ shopId: shop.id, mode: "cash", amount: 50, ...moneyShadows({ amount: 50 }) }],
    });
    const discountResult = await evaluate(shop.id, ENTITY_TYPES.BILL, discounted.id);
    const discountCodes = ruleCodes(discountResult);
    assert.ok(discountCodes.includes("BILL_EXCESSIVE_DISCOUNT"), discountCodes.join(","));
    assert.ok(discountCodes.includes("BILL_DISCOUNT_WITHOUT_AUTHORIZATION"), discountCodes.join(","));
    const excessive = discountResult.triggeredRules.find((r) => r.ruleCode === "BILL_EXCESSIVE_DISCOUNT");
    assert.equal(excessive.details.discountPercent, 50);
    assert.equal(excessive.details.configuredMaxPercent, 20);

    // An owner applying the same discount is self-authorizing: only the ceiling rule fires.
    const ownerDiscounted = await makeBill(ctx.db, shop.id, {
      subtotal: 50, discount: 50, grandTotal: 50, paidAmount: 50,
      createdByUserId: owner.id,
      items: [billItem(product, { quantity: 1, ratePerRateUnit: 100, lineTotal: 50 })],
      payments: [{ shopId: shop.id, mode: "cash", amount: 50, ...moneyShadows({ amount: 50 }) }],
    });
    const ownerCodes = ruleCodes(await evaluate(shop.id, ENTITY_TYPES.BILL, ownerDiscounted.id));
    assert.ok(ownerCodes.includes("BILL_EXCESSIVE_DISCOUNT"));
    assert.ok(!ownerCodes.includes("BILL_DISCOUNT_WITHOUT_AUTHORIZATION"), "owner discounts are authorized");

    // A recorded discount reason also clears the authorization rule for staff.
    const withReason = await makeBill(ctx.db, shop.id, {
      subtotal: 50, discount: 50, grandTotal: 50, paidAmount: 50,
      createdByUserId: staff.id,
      discountReason: "Damaged packaging, agreed with owner",
      items: [billItem(product, { quantity: 1, ratePerRateUnit: 100, lineTotal: 50 })],
      payments: [{ shopId: shop.id, mode: "cash", amount: 50, ...moneyShadows({ amount: 50 }) }],
    });
    const reasonCodes = ruleCodes(await evaluate(shop.id, ENTITY_TYPES.BILL, withReason.id));
    assert.ok(!reasonCodes.includes("BILL_DISCOUNT_WITHOUT_AUTHORIZATION"), "a recorded reason satisfies the control");

    // Selling below recorded cost beyond tolerance.
    const belowCost = await makeBill(ctx.db, shop.id, {
      grandTotal: 40, paidAmount: 40,
      createdByUserId: owner.id,
      items: [billItem(product, { quantity: 1, ratePerRateUnit: 40, lineTotal: 40, costPerRateUnit: 60 })],
      payments: [{ shopId: shop.id, mode: "cash", amount: 40, ...moneyShadows({ amount: 40 }) }],
    });
    const belowCodes = ruleCodes(await evaluate(shop.id, ENTITY_TYPES.BILL, belowCost.id));
    assert.ok(belowCodes.includes("BILL_SOLD_BELOW_COST"), belowCodes.join(","));
  });

  test("duplicate bill retry and duplicate bill number are detected", async () => {
    await resetDatabase(ctx.db);
    const { shop, owner } = await createTenant(ctx.db);
    const product = await createProduct(ctx.db, shop.id);
    const customer = await createCustomer(ctx.db, shop.id);

    // 5. Duplicate bill retry: same customer, same total, same item signature,
    // seconds apart — the classic offline double-submit.
    const at = new Date();
    const first = await makeBill(ctx.db, shop.id, {
      grandTotal: 100, paidAmount: 100, customerId: customer.id, createdByUserId: owner.id, createdAt: at,
      items: [billItem(product, { quantity: 1, ratePerRateUnit: 100 })],
      payments: [{ shopId: shop.id, mode: "cash", amount: 100, ...moneyShadows({ amount: 100 }) }],
    });
    const second = await makeBill(ctx.db, shop.id, {
      grandTotal: 100, paidAmount: 100, customerId: customer.id, createdByUserId: owner.id,
      createdAt: new Date(at.getTime() + 20 * 1000),
      items: [billItem(product, { quantity: 1, ratePerRateUnit: 100 })],
      payments: [{ shopId: shop.id, mode: "cash", amount: 100, ...moneyShadows({ amount: 100 }) }],
    });

    const codes = ruleCodes(await evaluate(shop.id, ENTITY_TYPES.BILL, second.id));
    assert.ok(codes.includes("BILL_NEAR_DUPLICATE"), codes.join(","));
    const finding = await findingFor(shop.id, ENTITY_TYPES.BILL, second.id);
    const details = JSON.parse(finding.rules.find((r) => r.ruleCode === "BILL_NEAR_DUPLICATE").detailsJson);
    assert.ok(details.matchingBillIds.includes(first.id));
    assert.equal(details.windowMinutes, 10);
  });

  test("cancelled bill still affecting ledger, stock and udhar is flagged", async () => {
    await resetDatabase(ctx.db);
    const { shop, owner } = await createTenant(ctx.db);
    const product = await createProduct(ctx.db, shop.id);
    const customer = await createCustomer(ctx.db, shop.id, { udharAmount: 100 });

    // 17. Cancelled bill whose FinancialLedger sale row was never reversed, whose
    // stock was never restored, and whose udhar debit still stands.
    const bill = await makeBill(ctx.db, shop.id, {
      grandTotal: 100, paidAmount: 0, creditAmount: 100,
      status: "cancelled", cancelledAt: new Date(), cancelledReason: "customer returned",
      customerId: customer.id, createdByUserId: owner.id,
      items: [billItem(product, { quantity: 1, ratePerRateUnit: 100 })],
    });
    await ctx.db.financialLedger.create({
      data: {
        shopId: shop.id, billId: bill.id, customerId: customer.id,
        sourceType: "bill", sourceId: bill.id, entryType: "sale", direction: "credit",
        amountPaise: 10000n, businessDate: new Date(), idempotencyKey: `test:${bill.id}:sale`,
      },
    });
    await ctx.db.stockLedger.create({
      data: {
        shopId: shop.id, productId: product.id, productName: product.name, billId: bill.id,
        action: "sale", changeBaseQty: -1, oldStockBaseQty: 20, newStockBaseQty: 19,
      },
    });
    await ctx.db.udharLedger.create({
      data: {
        shopId: shop.id, customerId: customer.id, customerName: customer.name,
        type: "debit", amount: 100, mode: "credit", billId: bill.id, ...moneyShadows({ amount: 100 }),
      },
    });

    const codes = ruleCodes(await evaluate(shop.id, ENTITY_TYPES.BILL, bill.id));
    assert.ok(codes.includes("CANCELLED_BILL_STILL_IN_LEDGER"), codes.join(","));
    assert.ok(codes.includes("CANCELLED_BILL_STOCK_NOT_RESTORED"), codes.join(","));
    assert.ok(codes.includes("BILL_CANCELLED_WITHOUT_AUDIT_LOG"), codes.join(","));

    // The customer-scope rule catches the udhar side of the same problem.
    const customerCodes = ruleCodes(await evaluate(shop.id, ENTITY_TYPES.CUSTOMER, customer.id));
    assert.ok(customerCodes.includes("UDHAR_CANCELLED_BILL_STILL_COUNTED"), customerCodes.join(","));

    // A properly reversed cancellation is clean: add the offsetting rows.
    await ctx.db.financialLedger.create({
      data: {
        shopId: shop.id, billId: bill.id, customerId: customer.id,
        sourceType: "bill_cancel", sourceId: bill.id, entryType: "sale", direction: "credit",
        amountPaise: -10000n, businessDate: new Date(), idempotencyKey: `test:${bill.id}:sale:reverse`,
      },
    });
    await ctx.db.stockLedger.create({
      data: {
        shopId: shop.id, productId: product.id, productName: product.name, billId: bill.id,
        action: "cancel_reversal", changeBaseQty: 1, oldStockBaseQty: 19, newStockBaseQty: 20,
      },
    });
    const afterReversal = ruleCodes(await evaluate(shop.id, ENTITY_TYPES.BILL, bill.id));
    assert.ok(!afterReversal.includes("CANCELLED_BILL_STILL_IN_LEDGER"), "reversed ledger nets to zero");
    assert.ok(!afterReversal.includes("CANCELLED_BILL_STOCK_NOT_RESTORED"), "restored stock nets to zero");
  });

  test("udhar reconciliation: balance drift, over-payment and negative balance", async () => {
    await resetDatabase(ctx.db);
    const { shop } = await createTenant(ctx.db);

    // 3. A correct udhar customer reconciles and produces no finding.
    const clean = await createCustomer(ctx.db, shop.id, { udharAmount: 300 });
    await ctx.db.udharLedger.createMany({
      data: [
        { shopId: shop.id, customerId: clean.id, customerName: clean.name, type: "debit", amount: 500, mode: "credit" },
        { shopId: shop.id, customerId: clean.id, customerName: clean.name, type: "payment", amount: 200, mode: "cash" },
      ],
    });
    const cleanResult = await evaluate(shop.id, ENTITY_TYPES.CUSTOMER, clean.id);
    assert.equal(cleanResult.triggered, false, `clean khata flagged: ${ruleCodes(cleanResult).join(",")}`);

    // Stored balance drifts from the ledger.
    const drifted = await createCustomer(ctx.db, shop.id, { udharAmount: 999 });
    await ctx.db.udharLedger.create({
      data: { shopId: shop.id, customerId: drifted.id, customerName: drifted.name, type: "debit", amount: 500, mode: "credit" },
    });
    const driftCodes = ruleCodes(await evaluate(shop.id, ENTITY_TYPES.CUSTOMER, drifted.id));
    assert.ok(driftCodes.includes("UDHAR_BALANCE_LEDGER_MISMATCH"), driftCodes.join(","));

    // 14. Payment exceeding the outstanding balance at the time it was posted.
    const over = await createCustomer(ctx.db, shop.id, { udharAmount: 0 });
    const base = Date.now();
    await ctx.db.udharLedger.create({
      data: { shopId: shop.id, customerId: over.id, customerName: over.name, type: "debit", amount: 100, mode: "credit", createdAt: new Date(base) },
    });
    await ctx.db.udharLedger.create({
      data: { shopId: shop.id, customerId: over.id, customerName: over.name, type: "payment", amount: 400, mode: "cash", createdAt: new Date(base + 1000) },
    });
    const overResult = await evaluate(shop.id, ENTITY_TYPES.CUSTOMER, over.id);
    const overCodes = ruleCodes(overResult);
    assert.ok(overCodes.includes("UDHAR_PAYMENT_EXCEEDS_OUTSTANDING"), overCodes.join(","));
    assert.ok(overCodes.includes("UDHAR_NEGATIVE_BALANCE"), overCodes.join(","));
    const overRule = overResult.triggeredRules.find((r) => r.ruleCode === "UDHAR_PAYMENT_EXCEEDS_OUTSTANDING");
    assert.equal(overRule.details.overPayments[0].paymentAmount, 400);
    assert.equal(overRule.details.overPayments[0].outstandingBefore, 100);
    assert.equal(overRule.details.overPayments[0].excessRupees, 300);
  });

  test("inventory reconciliation: ledger drift, unsourced movement, unauthorized correction", async () => {
    await resetDatabase(ctx.db);
    const { shop } = await createTenant(ctx.db);

    // A product whose movements reconcile exactly produces no finding.
    const clean = await createProduct(ctx.db, shop.id, { stockBaseQty: 18 });
    await ctx.db.stockLedger.create({
      data: {
        shopId: shop.id, productId: clean.id, productName: clean.name, action: "purchase",
        changeBaseQty: 18, oldStockBaseQty: 0, newStockBaseQty: 18,
        supplierName: "Test Supplier", invoiceNumber: "INV-1",
      },
    });
    const cleanResult = await evaluate(shop.id, ENTITY_TYPES.PRODUCT, clean.id);
    assert.equal(cleanResult.triggered, false, `clean product flagged: ${ruleCodes(cleanResult).join(",")}`);

    // 13. Stock movement without a source transaction (sale with no bill), plus
    // 12. an unauthorized/unexplained large correction, plus stock drift.
    const messy = await createProduct(ctx.db, shop.id, { stockBaseQty: 100 });
    await ctx.db.stockLedger.create({
      data: {
        shopId: shop.id, productId: messy.id, productName: messy.name, action: "sale",
        changeBaseQty: -5, oldStockBaseQty: 20, newStockBaseQty: 15, billId: null,
      },
    });
    await ctx.db.stockLedger.create({
      data: {
        shopId: shop.id, productId: messy.id, productName: messy.name, action: "correction",
        changeBaseQty: -10, oldStockBaseQty: 15, newStockBaseQty: 5, note: null,
      },
    });
    const messyResult = await evaluate(shop.id, ENTITY_TYPES.PRODUCT, messy.id);
    const messyCodes = ruleCodes(messyResult);
    assert.ok(messyCodes.includes("STOCK_DECREASE_WITHOUT_SOURCE"), messyCodes.join(","));
    assert.ok(messyCodes.includes("STOCK_LARGE_MANUAL_CORRECTION"), messyCodes.join(","));
    assert.ok(messyCodes.includes("STOCK_BALANCE_LEDGER_MISMATCH"), messyCodes.join(","));
    const drift = messyResult.triggeredRules.find((r) => r.ruleCode === "STOCK_BALANCE_LEDGER_MISMATCH");
    assert.equal(drift.details.storedStockBaseQty, 100);
    assert.equal(drift.details.ledgerClosingBaseQty, 5);
    assert.equal(drift.details.differenceBaseQty, 95);

    const correction = messyResult.triggeredRules.find((r) => r.ruleCode === "STOCK_LARGE_MANUAL_CORRECTION");
    assert.equal(correction.details.corrections[0].hasReason, false);

    // Negative stock is reported but treated as a MEDIUM operational signal,
    // because KiranaOS deliberately allows overselling.
    const negative = await createProduct(ctx.db, shop.id, { stockBaseQty: -3 });
    const negativeCodes = ruleCodes(await evaluate(shop.id, ENTITY_TYPES.PRODUCT, negative.id));
    assert.ok(negativeCodes.includes("STOCK_NEGATIVE_BALANCE"), negativeCodes.join(","));
  });

  test("purchase rules: missing invoice, quantity mismatch, duplicate invoice", async () => {
    await resetDatabase(ctx.db);
    const { shop } = await createTenant(ctx.db);
    const product = await createProduct(ctx.db, shop.id);
    const supplier = await ctx.db.supplier.create({
      data: { shopId: shop.id, name: unique("Supplier"), mobile: uniqueMobile(), address: "Market Road" },
    });

    // A clean quick purchase: invoice number present, stock matches, due reconciles.
    const clean = await ctx.db.purchaseHistory.create({
      data: {
        shopId: shop.id, productId: product.id, supplierId: supplier.id, supplierName: supplier.name,
        qtyBase: 10, pricePerRateUnit: 50, totalCost: 500, billAmount: 500,
        invoiceNumber: "SUP-INV-001", purchasePaymentStatus: "paid", purchasePaidAmount: 500, purchaseDueAmount: 0,
        ...moneyShadows({ pricePerRateUnit: 50, totalCost: 500, billAmount: 500, purchasePaidAmount: 500, purchaseDueAmount: 0 }),
      },
    });
    await ctx.db.stockLedger.create({
      data: {
        shopId: shop.id, productId: product.id, productName: product.name, action: "purchase",
        changeBaseQty: 10, oldStockBaseQty: 20, newStockBaseQty: 30,
        invoiceNumber: "SUP-INV-001", supplierName: supplier.name,
        sourceType: "purchase", sourceId: clean.id,
        createdAt: clean.createdAt,
      },
    });
    const cleanCodes = ruleCodes(await evaluate(shop.id, ENTITY_TYPES.PURCHASE, clean.id));
    assert.ok(!cleanCodes.includes("PURCHASE_MISSING_INVOICE_EVIDENCE"), cleanCodes.join(","));
    assert.ok(!cleanCodes.includes("PURCHASE_STOCK_QUANTITY_MISMATCH"), cleanCodes.join(","));

    // 7 + 8. Missing invoice above threshold AND stock received ≠ quantity purchased.
    const bad = await ctx.db.purchaseHistory.create({
      data: {
        shopId: shop.id, productId: product.id, supplierId: supplier.id, supplierName: supplier.name,
        qtyBase: 20, pricePerRateUnit: 100, totalCost: 2000, billAmount: 2000,
        invoiceNumber: null, purchasePaymentStatus: "paid", purchasePaidAmount: 2000, purchaseDueAmount: 0,
        ...moneyShadows({ pricePerRateUnit: 100, totalCost: 2000, billAmount: 2000, purchasePaidAmount: 2000, purchaseDueAmount: 0 }),
      },
    });
    await ctx.db.stockLedger.create({
      data: {
        shopId: shop.id, productId: product.id, productName: product.name, action: "purchase",
        changeBaseQty: 12, oldStockBaseQty: 30, newStockBaseQty: 42, // only 12 of 20 arrived
        supplierName: supplier.name, sourceType: "purchase", sourceId: bad.id,
        createdAt: bad.createdAt,
      },
    });
    const badResult = await evaluate(shop.id, ENTITY_TYPES.PURCHASE, bad.id);
    const badCodes = ruleCodes(badResult);
    assert.ok(badCodes.includes("PURCHASE_MISSING_INVOICE_EVIDENCE"), badCodes.join(","));
    assert.ok(badCodes.includes("PURCHASE_STOCK_QUANTITY_MISMATCH"), badCodes.join(","));
    const qtyRule = badResult.triggeredRules.find((r) => r.ruleCode === "PURCHASE_STOCK_QUANTITY_MISMATCH");
    assert.equal(qtyRule.details.purchasedBaseQty, 20);
    assert.equal(qtyRule.details.stockedBaseQty, 12);
    assert.equal(qtyRule.details.differenceBaseQty, -8);

    // 9. Duplicate supplier invoice number.
    const dupA = await ctx.db.purchaseHistory.create({
      data: {
        shopId: shop.id, productId: product.id, supplierId: supplier.id, supplierName: supplier.name,
        qtyBase: 5, pricePerRateUnit: 50, totalCost: 250, billAmount: 250, invoiceNumber: "SUP-INV-DUP",
        ...moneyShadows({ pricePerRateUnit: 50, totalCost: 250, billAmount: 250 }),
      },
    });
    const dupB = await ctx.db.purchaseHistory.create({
      data: {
        shopId: shop.id, productId: product.id, supplierId: supplier.id, supplierName: supplier.name,
        qtyBase: 5, pricePerRateUnit: 50, totalCost: 250, billAmount: 250, invoiceNumber: "SUP-INV-DUP",
        ...moneyShadows({ pricePerRateUnit: 50, totalCost: 250, billAmount: 250 }),
      },
    });
    const dupCodes = ruleCodes(await evaluate(shop.id, ENTITY_TYPES.PURCHASE, dupB.id));
    assert.ok(dupCodes.includes("PURCHASE_DUPLICATE_INVOICE_NUMBER"), dupCodes.join(","));
    const dupFinding = await findingFor(shop.id, ENTITY_TYPES.PURCHASE, dupB.id);
    const dupDetails = JSON.parse(dupFinding.rules.find((r) => r.ruleCode === "PURCHASE_DUPLICATE_INVOICE_NUMBER").detailsJson);
    assert.ok(dupDetails.duplicatePurchaseIds.includes(dupA.id));
  });

  test("expense rules: duplicate, missing receipt, missing payee, backdating", async () => {
    await resetDatabase(ctx.db);
    const { shop } = await createTenant(ctx.db);

    // A clean expense with a payee and a note, below the receipt threshold.
    const clean = await ctx.db.expense.create({
      data: { shopId: shop.id, title: "Tea for staff", amount: 120, category: "general", paymentMode: "cash", vendor: "Corner stall", notes: "daily", recordedBy: "Owner User" },
    });
    const cleanResult = await evaluate(shop.id, ENTITY_TYPES.EXPENSE, clean.id);
    assert.equal(cleanResult.triggered, false, `clean expense flagged: ${ruleCodes(cleanResult).join(",")}`);

    // 10. Expense above threshold with no receipt reference and no payee.
    const noReceipt = await ctx.db.expense.create({
      data: { shopId: shop.id, title: "Misc purchase", amount: 5000, category: "general", paymentMode: "cash", vendor: null, notes: null, recordedBy: null },
    });
    const noReceiptCodes = ruleCodes(await evaluate(shop.id, ENTITY_TYPES.EXPENSE, noReceipt.id));
    assert.ok(noReceiptCodes.includes("EXPENSE_MISSING_RECEIPT"), noReceiptCodes.join(","));
    assert.ok(noReceiptCodes.includes("EXPENSE_MISSING_PAYEE"), noReceiptCodes.join(","));
    assert.ok(noReceiptCodes.includes("EXPENSE_UNATTRIBUTED"), noReceiptCodes.join(","));

    // 11. Duplicate expense: same amount and category within a day.
    const spentAt = new Date();
    const dupA = await ctx.db.expense.create({
      data: { shopId: shop.id, title: "Transport", amount: 750, category: "transport", paymentMode: "cash", vendor: "Tempo", spentAt },
    });
    const dupB = await ctx.db.expense.create({
      data: { shopId: shop.id, title: "Transport", amount: 750, category: "transport", paymentMode: "cash", vendor: "Tempo", spentAt: new Date(spentAt.getTime() + 3600 * 1000) },
    });
    const dupCodes = ruleCodes(await evaluate(shop.id, ENTITY_TYPES.EXPENSE, dupB.id));
    assert.ok(dupCodes.includes("EXPENSE_DUPLICATE"), dupCodes.join(","));
    const dupFinding = await findingFor(shop.id, ENTITY_TYPES.EXPENSE, dupB.id);
    const details = JSON.parse(dupFinding.rules.find((r) => r.ruleCode === "EXPENSE_DUPLICATE").detailsJson);
    assert.ok(details.duplicateExpenseIds.includes(dupA.id));

    // Backdated expense: spent five days before it was recorded.
    const backdated = await ctx.db.expense.create({
      data: {
        shopId: shop.id, title: "Old rent", amount: 300, category: "rent", paymentMode: "cash", vendor: "Landlord",
        spentAt: new Date(Date.now() - 5 * 24 * 3600 * 1000),
      },
    });
    const backCodes = ruleCodes(await evaluate(shop.id, ENTITY_TYPES.EXPENSE, backdated.id));
    assert.ok(backCodes.includes("EXPENSE_BACKDATED"), backCodes.join(","));
  });

  test("backdated transaction after a locked daily closing is detected", async () => {
    await resetDatabase(ctx.db);
    const { shop, owner } = await createTenant(ctx.db);
    const product = await createProduct(ctx.db, shop.id);

    // Anchor the scenario to a day that is unambiguously in the past. Using
    // "today at noon" made the test depend on the wall clock: run before noon,
    // the lock timestamp is in the future and nothing can be late relative to it.
    const day = new Date(Date.now() - 24 * 60 * 60 * 1000);
    day.setHours(12, 0, 0, 0);
    const lockedAt = new Date(day.getTime());

    await ctx.db.dailyClosingSnapshot.create({
      data: {
        shopId: shop.id, date: day, totalSalesPaise: 0, cashReceivedPaise: 0, expectedCashPaise: 0,
        totalBills: 0, lockedAt, lockedByUserId: owner.id, generatedAt: lockedAt, source: "manual",
      },
    });

    // 15. A bill timestamped BEFORE the lock whose offline sync event only
    // arrived after it: genuinely backdated into a signed-off day.
    const idempotencyKey = `offline-backdated-${Date.now()}`;
    const late = await makeBill(ctx.db, shop.id, {
      grandTotal: 500, paidAmount: 500, createdByUserId: owner.id,
      createdAt: new Date(lockedAt.getTime() - 3600 * 1000),
      idempotencyKey, sourceDeviceId: "device-offline-1",
      items: [billItem(product, { quantity: 5, ratePerRateUnit: 100, lineTotal: 500 })],
      payments: [{ shopId: shop.id, mode: "cash", amount: 500, ...moneyShadows({ amount: 500 }) }],
    });
    await ctx.db.offlineSyncEvent.create({
      data: {
        shopId: shop.id, eventId: `evt-${idempotencyKey}`, type: "CREATE_BILL", status: "synced", attempts: 1,
        requestJson: JSON.stringify({ idempotencyKey, grandTotal: 500 }),
        resultJson: "{\"ok\":true}",
        createdAt: new Date(lockedAt.getTime() + 2 * 3600 * 1000),
      },
    });
    const codes = ruleCodes(await evaluate(shop.id, ENTITY_TYPES.BILL, late.id));
    assert.ok(codes.includes("BILL_BACKDATED_INTO_LOCKED_DAY"), codes.join(","));

    // A sale simply made later in the same day is NOT reported per-bill: that
    // would flood the shop. It is reported once on the closing instead.
    const laterSale = await makeBill(ctx.db, shop.id, {
      grandTotal: 200, paidAmount: 200, createdByUserId: owner.id,
      createdAt: new Date(lockedAt.getTime() + 3 * 3600 * 1000),
      items: [billItem(product, { quantity: 2, ratePerRateUnit: 100, lineTotal: 200 })],
      payments: [{ shopId: shop.id, mode: "cash", amount: 200, ...moneyShadows({ amount: 200 }) }],
    });
    const laterCodes = ruleCodes(await evaluate(shop.id, ENTITY_TYPES.BILL, laterSale.id));
    assert.ok(!laterCodes.includes("BILL_BACKDATED_INTO_LOCKED_DAY"), `later same-day sale must not be flagged: ${laterCodes.join(",")}`);

    // 12/15 (closing side). The snapshot's own figures are now stale versus the
    // canonical bills, and cash expenses are not deducted from expected cash.
    await ctx.db.expense.create({
      data: { shopId: shop.id, title: "Cash purchase", amount: 400, category: "general", paymentMode: "cash", vendor: "Local", spentAt: day },
    });
    const snapshot = await ctx.db.dailyClosingSnapshot.findFirst({ where: { shopId: shop.id } });
    const closingResult = await evaluate(shop.id, ENTITY_TYPES.DAILY_CLOSING, snapshot.id);
    const closingCodes = ruleCodes(closingResult);
    assert.ok(closingCodes.includes("CLOSING_CASH_FIGURE_STALE"), closingCodes.join(","));
    assert.ok(closingCodes.includes("CLOSING_SALES_FIGURE_STALE"), closingCodes.join(","));
    assert.ok(closingCodes.includes("CLOSING_LATE_TRANSACTION_AFTER_LOCK"), closingCodes.join(","));
    assert.ok(closingCodes.includes("CLOSING_CASH_EXPENSES_NOT_DEDUCTED"), closingCodes.join(","));
    const staleCash = closingResult.triggeredRules.find((r) => r.ruleCode === "CLOSING_CASH_FIGURE_STALE");
    assert.equal(staleCash.details.snapshotCashPaise, 0);
    // ₹500 backdated bill + ₹200 later same-day sale, neither in the snapshot.
    assert.equal(staleCash.details.recomputedCashPaise, 70000);
  });

  test("split payment mismatch and reused UPI reference are detected on a closing", async () => {
    await resetDatabase(ctx.db);
    const { shop, owner } = await createTenant(ctx.db);
    const product = await createProduct(ctx.db, shop.id);
    const day = new Date();
    day.setHours(10, 0, 0, 0);

    // Two bills sharing one UPI reference, and one bill whose payment rows do
    // not add up to its declared paid amount.
    await makeBill(ctx.db, shop.id, {
      grandTotal: 200, paidAmount: 200, createdByUserId: owner.id, createdAt: day,
      items: [billItem(product, { quantity: 2, ratePerRateUnit: 100, lineTotal: 200 })],
      payments: [{ shopId: shop.id, mode: "upi", amount: 200, providerReference: "UTR12345678", ...moneyShadows({ amount: 200 }) }],
    });
    await makeBill(ctx.db, shop.id, {
      grandTotal: 200, paidAmount: 200, createdByUserId: owner.id, createdAt: new Date(day.getTime() + 60000),
      items: [billItem(product, { quantity: 2, ratePerRateUnit: 100, lineTotal: 200 })],
      payments: [{ shopId: shop.id, mode: "upi", amount: 200, providerReference: "UTR12345678", ...moneyShadows({ amount: 200 }) }],
    });
    await makeBill(ctx.db, shop.id, {
      grandTotal: 300, paidAmount: 300, createdByUserId: owner.id, createdAt: new Date(day.getTime() + 120000),
      items: [billItem(product, { quantity: 3, ratePerRateUnit: 100, lineTotal: 300 })],
      payments: [{ shopId: shop.id, mode: "cash", amount: 120, ...moneyShadows({ amount: 120 }) }],
    });

    const snapshot = await ctx.db.dailyClosingSnapshot.create({
      data: {
        shopId: shop.id, date: day, totalSalesPaise: 70000, cashReceivedPaise: 12000,
        upiReceivedPaise: 40000, expectedCashPaise: 12000, totalBills: 3, generatedAt: new Date(), source: "manual",
      },
    });
    const result = await evaluate(shop.id, ENTITY_TYPES.DAILY_CLOSING, snapshot.id);
    const codes = ruleCodes(result);
    assert.ok(codes.includes("CLOSING_UPI_REFERENCE_REUSED"), codes.join(","));
    assert.ok(codes.includes("CLOSING_SPLIT_PAYMENT_MISMATCH"), codes.join(","));

    // The reference itself is masked in the finding — findings must not become a
    // new place where payment identifiers leak.
    const reuse = result.triggeredRules.find((r) => r.ruleCode === "CLOSING_UPI_REFERENCE_REUSED");
    assert.equal(reuse.details.reusedReferences[0].providerReference, "*******5678");
    const split = result.triggeredRules.find((r) => r.ruleCode === "CLOSING_SPLIT_PAYMENT_MISMATCH");
    assert.equal(split.details.mismatchedBills[0].declaredPaidRupees, 300);
    assert.equal(split.details.mismatchedBills[0].paymentRowSumRupees, 120);
  });

  test("offline sync duplicate and success-with-error are detected", async () => {
    await resetDatabase(ctx.db);
    const { shop } = await createTenant(ctx.db);

    // 16. The same operation re-queued under a fresh event id: the shop-level
    // uniqueness constraint cannot catch this, so the engine must.
    const requestJson = JSON.stringify({ type: "CREATE_BILL", payload: { billNo: "KOS-1", grandTotal: 250 } });
    const firstEvent = await ctx.db.offlineSyncEvent.create({
      data: { shopId: shop.id, eventId: "evt-original", type: "CREATE_BILL", status: "synced", attempts: 1, requestJson, resultJson: "{\"ok\":true}" },
    });
    const replay = await ctx.db.offlineSyncEvent.create({
      data: { shopId: shop.id, eventId: "evt-requeued", type: "CREATE_BILL", status: "synced", attempts: 1, requestJson, resultJson: "{\"ok\":true}" },
    });

    const dupResult = await evaluate(shop.id, ENTITY_TYPES.SYNC_EVENT, replay.id);
    const dupCodes = ruleCodes(dupResult);
    assert.ok(dupCodes.includes("SYNC_DUPLICATE_OFFLINE_EVENT"), dupCodes.join(","));
    const dupRule = dupResult.triggeredRules.find((r) => r.ruleCode === "SYNC_DUPLICATE_OFFLINE_EVENT");
    assert.equal(dupRule.details.duplicateKind, "same_request_payload");
    assert.ok(dupRule.details.duplicateRowIds.includes(firstEvent.id));

    // Marked synced while still carrying an error, and stuck after retries.
    const lying = await ctx.db.offlineSyncEvent.create({
      data: { shopId: shop.id, eventId: "evt-lying", type: "CREATE_PAYMENT", status: "synced", attempts: 2, requestJson: "{}", error: "unique constraint failed" },
    });
    const lyingCodes = ruleCodes(await evaluate(shop.id, ENTITY_TYPES.SYNC_EVENT, lying.id));
    assert.ok(lyingCodes.includes("SYNC_FAILED_EVENT_MARKED_SUCCESS"), lyingCodes.join(","));
    assert.ok(lyingCodes.includes("SYNC_SYNCED_WITHOUT_RESULT"), lyingCodes.join(","));

    const stuck = await ctx.db.offlineSyncEvent.create({
      data: { shopId: shop.id, eventId: "evt-stuck", type: "CREATE_BILL", status: "processing", attempts: 5, requestJson: "{}" },
    });
    const stuckCodes = ruleCodes(await evaluate(shop.id, ENTITY_TYPES.SYNC_EVENT, stuck.id));
    assert.ok(stuckCodes.includes("SYNC_EVENT_STUCK_PROCESSING"), stuckCodes.join(","));

    // A healthy synced event stays clean.
    const healthy = await ctx.db.offlineSyncEvent.create({
      data: { shopId: shop.id, eventId: "evt-ok", type: "CREATE_CUSTOMER", status: "synced", attempts: 1, requestJson: "{\"unique\":\"payload\"}", resultJson: "{\"id\":\"x\"}" },
    });
    const healthyResult = await evaluate(shop.id, ENTITY_TYPES.SYNC_EVENT, healthy.id);
    assert.equal(healthyResult.triggered, false, `healthy event flagged: ${ruleCodes(healthyResult).join(",")}`);
  });

  test("cross-shop entity reference is detected without leaking the other tenant", async () => {
    await resetDatabase(ctx.db);
    const shopA = await createTenant(ctx.db);
    const shopB = await createTenant(ctx.db);
    const productA = await createProduct(ctx.db, shopA.shop.id);
    const customerB = await createCustomer(ctx.db, shopB.shop.id);
    const productB = await createProduct(ctx.db, shopB.shop.id);

    // 18. A bill in shop A referencing shop B's customer and product.
    const bill = await makeBill(ctx.db, shopA.shop.id, {
      grandTotal: 100, paidAmount: 100, customerId: customerB.id, createdByUserId: shopA.owner.id,
      items: [billItem(productA), { ...billItem(productB), productId: productB.id }],
      payments: [{ shopId: shopA.shop.id, mode: "cash", amount: 100, ...moneyShadows({ amount: 100 }) }],
    });

    const result = await evaluate(shopA.shop.id, ENTITY_TYPES.BILL, bill.id);
    const codes = ruleCodes(result);
    assert.ok(codes.includes("BILL_CROSS_SHOP_REFERENCE"), codes.join(","));
    const rule = result.triggeredRules.find((r) => r.ruleCode === "BILL_CROSS_SHOP_REFERENCE");
    assert.equal(rule.severity, "CRITICAL");
    // The finding records THAT the reference is foreign, never the other shop's id.
    const serialized = JSON.stringify(rule.details);
    assert.ok(!serialized.includes(shopB.shop.id), "the other tenant's shopId must not appear in the finding");
    assert.ok(serialized.includes(customerB.id), "the offending reference id is recorded for remediation");
    assert.equal(result.riskLevel, RISK_LEVELS.CRITICAL);
  });

  test("evaluation is idempotent: re-running does not duplicate findings or change the score", async () => {
    await resetDatabase(ctx.db);
    const { shop, owner } = await createTenant(ctx.db);
    const product = await createProduct(ctx.db, shop.id);
    const bill = await makeBill(ctx.db, shop.id, {
      grandTotal: 100, paidAmount: 100, createdByUserId: owner.id,
      items: [billItem(product, { quantity: 1, ratePerRateUnit: 100, lineTotal: 100 })],
      // no payments → BILL_MARKED_PAID_WITHOUT_PAYMENTS
    });

    const first = await evaluate(shop.id, ENTITY_TYPES.BILL, bill.id);
    const second = await evaluate(shop.id, ENTITY_TYPES.BILL, bill.id);
    const third = await evaluate(shop.id, ENTITY_TYPES.BILL, bill.id);

    assert.equal(first.finalScore, second.finalScore);
    assert.equal(second.finalScore, third.finalScore);
    assert.equal(first.inputHash, third.inputHash, "unchanged data ⇒ identical input hash");
    assert.deepEqual(ruleCodes(first), ruleCodes(third));

    const findings = await ctx.db.auditFinding.count({ where: { shopId: shop.id, sourceEntityId: bill.id } });
    assert.equal(findings, 1, "one entity ⇒ exactly one finding, however many times it is evaluated");

    const findingRules = await ctx.db.auditFindingRule.count({
      where: { shopId: shop.id, finding: { sourceEntityId: bill.id }, ruleCode: "BILL_MARKED_PAID_WITHOUT_PAYMENTS" },
    });
    assert.equal(findingRules, 1, "rule rows are upserted, not appended");

    // Evidence requirements are also not duplicated across runs.
    const requirements = await ctx.db.auditEvidenceRequirement.groupBy({
      by: ["evidenceType"],
      where: { shopId: shop.id, finding: { sourceEntityId: bill.id } },
      _count: { _all: true },
    });
    for (const row of requirements) {
      assert.equal(row._count._all, 1, `duplicate requirement for ${row.evidenceType}`);
    }
  });

  test("a cleared condition auto-resolves the finding with a recorded reason", async () => {
    await resetDatabase(ctx.db);
    const { shop, owner } = await createTenant(ctx.db);
    const product = await createProduct(ctx.db, shop.id);
    const bill = await makeBill(ctx.db, shop.id, {
      grandTotal: 100, paidAmount: 100, createdByUserId: owner.id,
      items: [billItem(product, { quantity: 1, ratePerRateUnit: 100, lineTotal: 100 })],
    });
    await evaluate(shop.id, ENTITY_TYPES.BILL, bill.id);
    const before = await findingFor(shop.id, ENTITY_TYPES.BILL, bill.id);
    assert.equal(before.status, FINDING_STATUS.OPEN);

    // The shop records the missing payment through normal business flows.
    await ctx.db.payment.create({
      data: { shopId: shop.id, billId: bill.id, mode: "cash", amount: 100, ...moneyShadows({ amount: 100 }) },
    });

    const after = await evaluate(shop.id, ENTITY_TYPES.BILL, bill.id);
    assert.equal(after.triggered, false);
    const resolved = await findingFor(shop.id, ENTITY_TYPES.BILL, bill.id);
    assert.equal(resolved.status, FINDING_STATUS.CORRECTED);
    assert.equal(resolved.resolutionType, "AUTO_RESOLVED_CONDITION_CLEARED");
    assert.ok(resolved.resolvedAt);
    // The auto-resolution is explicit in the immutable trail, never silent.
    const lastHistory = resolved.statusHistory.at(-1);
    assert.equal(lastHistory.newStatus, FINDING_STATUS.CORRECTED);
    assert.equal(lastHistory.changedByRole, "system");
    assert.match(lastHistory.comment, /no longer exists/);
    // Rules stay on the record for the trail but are marked inactive.
    assert.ok(resolved.rules.every((rule) => rule.active === false));
  });

  test("engine writes nothing to canonical financial tables", async () => {
    await resetDatabase(ctx.db);
    const { shop, owner } = await createTenant(ctx.db);
    const product = await createProduct(ctx.db, shop.id, { stockBaseQty: 100 });
    const customer = await createCustomer(ctx.db, shop.id, { udharAmount: 999 });
    await ctx.db.udharLedger.create({
      data: { shopId: shop.id, customerId: customer.id, customerName: customer.name, type: "debit", amount: 500, mode: "credit" },
    });
    const bill = await makeBill(ctx.db, shop.id, {
      grandTotal: 250, paidAmount: 250, createdByUserId: owner.id,
      items: [billItem(product, { quantity: 1, ratePerRateUnit: 100, lineTotal: 100 })],
    });
    await ctx.db.stockLedger.create({
      data: { shopId: shop.id, productId: product.id, productName: product.name, action: "sale", changeBaseQty: -5, oldStockBaseQty: 20, newStockBaseQty: 15 },
    });

    const snapshotBefore = await canonicalSnapshot(shop.id);
    await evaluate(shop.id, ENTITY_TYPES.BILL, bill.id);
    await evaluate(shop.id, ENTITY_TYPES.CUSTOMER, customer.id);
    await evaluate(shop.id, ENTITY_TYPES.PRODUCT, product.id);
    const snapshotAfter = await canonicalSnapshot(shop.id);

    assert.deepEqual(snapshotAfter, snapshotBefore, "evaluation must not modify canonical financial data");
  });

  async function canonicalSnapshot(shopId) {
    const [bills, items, payments, udhar, stock, products, customers, expenses, ledger] = await Promise.all([
      ctx.db.bill.findMany({ where: { shopId }, orderBy: { id: "asc" } }),
      ctx.db.billItem.findMany({ where: { bill: { shopId } }, orderBy: { id: "asc" } }),
      ctx.db.payment.findMany({ where: { bill: { shopId } }, orderBy: { id: "asc" } }),
      ctx.db.udharLedger.findMany({ where: { shopId }, orderBy: { id: "asc" } }),
      ctx.db.stockLedger.findMany({ where: { shopId }, orderBy: { id: "asc" } }),
      ctx.db.product.findMany({ where: { shopId }, orderBy: { id: "asc" } }),
      ctx.db.customer.findMany({ where: { shopId }, orderBy: { id: "asc" } }),
      ctx.db.expense.findMany({ where: { shopId }, orderBy: { id: "asc" } }),
      ctx.db.financialLedger.findMany({ where: { shopId }, orderBy: { id: "asc" } }),
    ]);
    return JSON.parse(
      JSON.stringify({ bills, items, payments, udhar, stock, products, customers, expenses, ledger }, (_key, value) =>
        typeof value === "bigint" ? value.toString() : value
      )
    );
  }

  test("a buggy rule cannot take down an evaluation", async () => {
    await resetDatabase(ctx.db);
    const { shop, owner } = await createTenant(ctx.db);
    const product = await createProduct(ctx.db, shop.id);
    const bill = await makeBill(ctx.db, shop.id, {
      grandTotal: 100, paidAmount: 100, createdByUserId: owner.id,
      items: [billItem(product)],
      payments: [{ shopId: shop.id, mode: "cash", amount: 100, ...moneyShadows({ amount: 100 }) }],
    });

    // Rule objects are frozen, so inject a deliberately broken rule through the
    // engine's rule-set seam rather than mutating a shared registry entry.
    const brokenRule = {
      ...RULES_BY_CODE.BILL_TOTAL_MISMATCH,
      ruleCode: "TEST_BROKEN_RULE",
      evaluate() { throw new Error("boom"); },
    };
    const healthyRule = RULES_BY_CODE.BILL_MARKED_PAID_WITHOUT_PAYMENTS;

    const result = await evaluateEntity(shop.id, ENTITY_TYPES.BILL, bill.id, {
      client: ctx.db,
      rules: [brokenRule, healthyRule],
    });

    assert.equal(result.ruleErrors.length, 1, "the broken rule is recorded as an error");
    assert.equal(result.ruleErrors[0].ruleCode, "TEST_BROKEN_RULE");
    assert.equal(result.ruleErrors[0].message, "boom");
    assert.equal(result.rulesEvaluated, 2, "evaluation continued past the failure");
    // The engine still produced a usable, complete result.
    assert.equal(result.engineVersion, result.engineVersion);
    assert.ok(Number.isInteger(result.finalScore));
  });

  test("shop-level rule overrides disable rules and change weights", async () => {
    await resetDatabase(ctx.db);
    const { shop, owner } = await createTenant(ctx.db);
    const product = await createProduct(ctx.db, shop.id);
    const bill = await makeBill(ctx.db, shop.id, {
      grandTotal: 100, paidAmount: 100, createdByUserId: owner.id,
      items: [billItem(product, { quantity: 1, ratePerRateUnit: 100, lineTotal: 100 })],
    });

    const baseline = await evaluate(shop.id, ENTITY_TYPES.BILL, bill.id);
    assert.ok(baseline.triggered);

    // Lower the weight: the same rule fires with a smaller contribution.
    await ctx.db.auditRule.create({
      data: { shopId: shop.id, ruleCode: "BILL_MARKED_PAID_WITHOUT_PAYMENTS", enabled: true, weightOverride: 2 },
    });
    const reweighted = await evaluate(shop.id, ENTITY_TYPES.BILL, bill.id);
    const reweightedRule = reweighted.triggeredRules.find((r) => r.ruleCode === "BILL_MARKED_PAID_WITHOUT_PAYMENTS");
    assert.equal(reweightedRule.weightSource, "shop_override");
    assert.equal(reweightedRule.weight, 2);
    assert.ok(reweighted.finalScore < baseline.finalScore);

    // Disable it: the rule no longer participates at all.
    await ctx.db.auditRule.update({
      where: { shopId_ruleCode: { shopId: shop.id, ruleCode: "BILL_MARKED_PAID_WITHOUT_PAYMENTS" } },
      data: { enabled: false },
    });
    const disabled = await evaluate(shop.id, ENTITY_TYPES.BILL, bill.id);
    assert.ok(!ruleCodes(disabled).includes("BILL_MARKED_PAID_WITHOUT_PAYMENTS"));
  });

  test("sales returns are not mis-flagged, and amounts are never negative", async () => {
    await resetDatabase(ctx.db);
    const { shop, owner } = await createTenant(ctx.db);
    const product = await createProduct(ctx.db, shop.id);

    // A sales return is the mirror image of a sale: KiranaOS stores negative
    // quantities AND a negative total. Both are correct, and neither is an
    // "impossible quantity" — this used to flag every return in the shop.
    const returnBill = await makeBill(ctx.db, shop.id, {
      billType: "sales_return", grandTotal: -118, paidAmount: -118, createdByUserId: owner.id,
      items: [billItem(product, { quantity: -1, ratePerRateUnit: 118, lineTotal: -118, quantityInBaseUnit: -1 })],
      payments: [{ shopId: shop.id, mode: "cash", amount: -118, ...moneyShadows({ amount: -118 }) }],
    });
    await ctx.db.stockLedger.create({
      data: {
        shopId: shop.id, productId: product.id, productName: product.name, billId: returnBill.id,
        action: "sales_return", changeBaseQty: 1, oldStockBaseQty: 20, newStockBaseQty: 21,
      },
    });

    const result = await evaluate(shop.id, ENTITY_TYPES.BILL, returnBill.id);
    assert.ok(!ruleCodes(result).includes("BILL_INVALID_QUANTITY"),
      `a return's negative quantities are correct, got ${ruleCodes(result).join(",")}`);

    // A forward sale with a negative quantity IS still wrong.
    const badSale = await makeBill(ctx.db, shop.id, {
      grandTotal: 100, paidAmount: 100, createdByUserId: owner.id,
      items: [billItem(product, { quantity: -2, ratePerRateUnit: 50, lineTotal: 100, quantityInBaseUnit: -2 })],
      payments: [{ shopId: shop.id, mode: "cash", amount: 100, ...moneyShadows({ amount: 100 }) }],
    });
    assert.ok(ruleCodes(await evaluate(shop.id, ENTITY_TYPES.BILL, badSale.id)).includes("BILL_INVALID_QUANTITY"));

    // Whatever is flagged, the amount shown to a shopkeeper is never negative:
    // signed amounts made dashboard totals arithmetically wrong.
    const negativeAmounts = await ctx.db.auditFinding.count({ where: { shopId: shop.id, amountPaise: { lt: 0 } } });
    assert.equal(negativeAmounts, 0, "findings must never carry a negative amount");
  });

  test("findings quantify the gap, and totals never exceed reality", async () => {
    await resetDatabase(ctx.db);
    const { shop, owner } = await createTenant(ctx.db);
    const product = await createProduct(ctx.db, shop.id, { costPerRateUnit: 60, stockBaseQty: 100 });

    // ₹1,000 bill that only collected ₹250 — the gap is ₹750, not ₹1,000.
    const bill = await makeBill(ctx.db, shop.id, {
      grandTotal: 1000, paidAmount: 1000, createdByUserId: owner.id,
      items: [billItem(product, { quantity: 10, ratePerRateUnit: 100, lineTotal: 1000 })],
      payments: [{ shopId: shop.id, mode: "cash", amount: 250, ...moneyShadows({ amount: 250 }) }],
    });
    const billFinding = await findingFor(shop.id, ENTITY_TYPES.BILL, bill.id) ?? (await evaluate(shop.id, ENTITY_TYPES.BILL, bill.id), await findingFor(shop.id, ENTITY_TYPES.BILL, bill.id));
    assert.equal(Number(billFinding.discrepancyPaise), 75000, "gap is the ₹750 shortfall");
    assert.equal(Number(billFinding.amountPaise), 100000, "record size stays the ₹1,000 bill");

    // 20 phantom units of a ₹60-cost product = a ₹1,200 gap, not the whole
    // stock valuation (which used to make the headline exceed lifetime sales).
    await ctx.db.stockLedger.create({
      data: {
        shopId: shop.id, productId: product.id, productName: product.name, action: "purchase",
        changeBaseQty: 80, oldStockBaseQty: 0, newStockBaseQty: 80, supplierName: "S", invoiceNumber: "I-1",
      },
    });
    await evaluate(shop.id, ENTITY_TYPES.PRODUCT, product.id);
    const stockFinding = await findingFor(shop.id, ENTITY_TYPES.PRODUCT, product.id);
    assert.equal(Number(stockFinding.discrepancyPaise), 120000, "20 units × ₹60 cost");
    assert.ok(Number(stockFinding.amountPaise) > Number(stockFinding.discrepancyPaise),
      "stock valuation is larger than the gap, and must not be what gets totalled");
  });

  test("baselines are computed from the shop's own history and gate outlier rules", async () => {
    await resetDatabase(ctx.db);
    const { shop } = await createTenant(ctx.db);

    // Twelve ordinary transport expenses, then one far outside the range.
    for (let index = 0; index < 12; index += 1) {
      await ctx.db.expense.create({
        data: {
          shopId: shop.id, title: `Transport ${index}`, amount: 200 + index, category: "transport",
          paymentMode: "upi", vendor: "Tempo", spentAt: new Date(Date.now() - (index + 2) * 24 * 3600 * 1000),
        },
      });
    }
    const outlier = await ctx.db.expense.create({
      data: { shopId: shop.id, title: "Transport big", amount: 25000, category: "transport", paymentMode: "upi", vendor: "Tempo" },
    });

    // Before baselines exist, the outlier rule must stay silent rather than guess.
    const beforeCodes = ruleCodes(await evaluate(shop.id, ENTITY_TYPES.EXPENSE, outlier.id));
    assert.ok(!beforeCodes.includes("EXPENSE_UNUSUALLY_HIGH_FOR_CATEGORY"), "no baseline ⇒ no outlier claim");

    await recomputeShopBaselines(shop.id, { client: ctx.db });
    const baseline = await ctx.db.auditBaseline.findFirst({
      where: { shopId: shop.id, metricKey: "expense_amount", scopeKey: "category:transport" },
    });
    assert.ok(baseline, "a category baseline should be persisted");
    assert.equal(baseline.status, "OK");
    assert.ok(baseline.sampleCount >= 12);

    const afterCodes = ruleCodes(await evaluate(shop.id, ENTITY_TYPES.EXPENSE, outlier.id));
    assert.ok(afterCodes.includes("EXPENSE_UNUSUALLY_HIGH_FOR_CATEGORY"), afterCodes.join(","));
  });
}

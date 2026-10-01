import assert from "node:assert/strict";
import db from "../src/db.js";
import { evaluateEntity } from "../src/modules/assurance/evaluation.service.js";
import { RULES_BY_CODE } from "../src/modules/assurance/rules/index.js";

// A stock finding on a packaged product said no money was in question.
//
// A finding carries `discrepancyPaise`: the gap itself, valued at the product's
// cost. Stock gaps are measured in base units and cost is per RATE unit, so the
// gap is converted through the product's rate unit first. That went through the
// unit table inside a try/catch that answers 0 for a unit it does not know —
// right for a genuinely unknown unit ("no figure beats a wrong figure"), but the
// starter catalogue quotes 7Up per "bottle", so EVERY packaged product landed
// there. Two missing bottles read as nothing at risk, and the dashboard's total of
// money in question quietly left out most of a kirana shop's catalogue.
//
// Not a throw like the other sites: the silent zero is the failure.

const rule = RULES_BY_CODE.STOCK_BALANCE_LEDGER_MISMATCH;

/**
 * Make the stock cache disagree with the movement history, evaluate only the rule
 * that measures that gap, and return the money the finding says is in question.
 */
async function stockGapFinding(shopId, product, { stored, ledgerClosing }) {
  await db.product.update({ where: { id: product.id }, data: { stockBaseQty: stored } });
  await db.stockLedger.create({
    data: {
      shopId, productId: product.id, productName: product.name,
      action: "purchase", changeBaseQty: ledgerClosing, oldStockBaseQty: 0, newStockBaseQty: ledgerClosing,
      sourceType: "purchase",
    },
  });
  const result = await evaluateEntity(shopId, "PRODUCT", product.id, { rules: [rule] });
  assert.equal(result.triggered, true, `${product.name}: the stock gap is a finding`);
  assert.deepEqual(result.ruleErrors, [], `${product.name}: the rule itself ran cleanly`);
  const finding = await db.auditFinding.findUnique({ where: { id: result.findingId } });
  return finding.discrepancyPaise === null ? null : Number(finding.discrepancyPaise);
}

async function main() {
  const shop = await db.shop.create({ data: { name: `ASP ${Date.now()}`, ownerName: "o", city: "c", address: "a" } });
  try {
    // ── a loose product: the unit table converts kg ──────────────────
    // Evaluated first and on its own, so this assertion reads the same against
    // the code before and after the fix.
    const sugar = await db.product.create({
      data: {
        shopId: shop.id, name: "Loose Sugar", category: "grocery",
        baseUnit: "g", rateUnit: "kg", displayUnit: "kg",
        stockBaseQty: 0, defaultPricePerRateUnit: 45, costPerRateUnit: 40,
        packagingMode: "pooled",
      },
    });
    assert.equal(
      await stockGapFinding(shop.id, sugar, { stored: 5000, ledgerClosing: 3000 }),
      8000,
      "2 kg of sugar missing at ₹40/kg is ₹80 in question",
    );

    // ── a packaged product, exactly as the starter catalogue makes it ─
    const sevenUp = await db.product.create({
      data: {
        shopId: shop.id, name: "7Up 750ml", category: "soft drinks",
        baseUnit: "ml", rateUnit: "bottle", displayUnit: "bottle 750 ml",
        stockBaseQty: 0, defaultPricePerRateUnit: 45, costPerRateUnit: 40,
        packagingMode: "pooled",
      },
    });
    await db.productSellingUnit.create({
      data: {
        shopId: shop.id, productId: sevenUp.id, name: "bottle 750 ml",
        unitType: "bottle", unitCode: "bottle-750-ml", packSizeValue: 750, packSizeUnit: "ml",
        conversionToBase: 750, defaultPrice: 45, maximumPrice: 45, costPrice: 40,
        onHandQty: 0, isDefault: true,
      },
    });
    // 1500 ml is 2 bottles; at ₹40 a bottle that is ₹80. Before the fix the
    // finding said null — nothing measured at all.
    assert.equal(
      await stockGapFinding(shop.id, sevenUp, { stored: 9000, ledgerClosing: 7500 }),
      8000,
      "2 bottles of 7Up missing at ₹40 cost is ₹80 in question",
    );

    // ── a genuinely unknown unit still costs nothing, never a guess ──
    // No packaging to fall back on, so there is no honest figure: the finding
    // keeps its "not measured" rather than inventing one — and the evaluation
    // itself does not fail.
    const odd = await db.product.create({
      data: {
        shopId: shop.id, name: "Mystery Crate", category: "other",
        baseUnit: "piece", rateUnit: "crate", displayUnit: "crate",
        stockBaseQty: 0, defaultPricePerRateUnit: 100, costPerRateUnit: 90,
        packagingMode: "pooled",
      },
    });
    assert.equal(
      await stockGapFinding(shop.id, odd, { stored: 5, ledgerClosing: 3 }),
      null,
      "an unconvertible unit is left unvalued, as before",
    );

    console.log("assurance-pack-rate-unit.examples.js OK");
  } finally {
    // Best-effort teardown. A throw in here would mask a real assertion failure
    // from the body, which is the only error worth reading.
    for (const remove of [
      () => db.auditFindingStatusHistory.deleteMany({ where: { shopId: shop.id } }),
      () => db.auditEvidenceRequirement.deleteMany({ where: { shopId: shop.id } }),
      () => db.auditFindingRule.deleteMany({ where: { shopId: shop.id } }),
      () => db.auditFinding.deleteMany({ where: { shopId: shop.id } }),
      () => db.auditEvaluation.deleteMany({ where: { shopId: shop.id } }),
      () => db.auditBaseline.deleteMany({ where: { shopId: shop.id } }),
      () => db.stockLedger.deleteMany({ where: { shopId: shop.id } }),
      () => db.productSellingUnit.deleteMany({ where: { shopId: shop.id } }),
      () => db.product.deleteMany({ where: { shopId: shop.id } }),
      () => db.changeLog.deleteMany({ where: { shopId: shop.id } }),
      () => db.auditLog.deleteMany({ where: { shopId: shop.id } }),
      () => db.subscription.deleteMany({ where: { shopId: shop.id } }),
      () => db.storeLocation.deleteMany({ where: { shopId: shop.id } }),
      () => db.shop.delete({ where: { id: shop.id } }),
    ]) {
      await remove().catch(() => {});
    }
  }
}

await main();

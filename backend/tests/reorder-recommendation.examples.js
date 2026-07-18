import assert from "node:assert/strict";
import { calculateReorderRecommendation } from "../src/modules/purchase-orders/reorderRecommendation.js";

function recommendation(overrides = {}) {
  return calculateReorderRecommendation({
    stockBaseQty: 20,
    lowStockThreshold: 5,
    manualReorderBaseQty: 0,
    openOrderBaseQty: 0,
    netSalesBaseQty: 0,
    salesLineCount: 0,
    baseUnit: "piece",
    ...overrides,
  });
}

const lowStock = recommendation({ stockBaseQty: 3 });
assert.equal(lowStock.recommendedOrderBaseQty, 7);
assert.equal(lowStock.reasonCode, "low_stock_floor");
assert.equal(lowStock.forecastConfidence, "no_history");
assert.match(lowStock.explanation, /3 piece/);

const manualFloor = recommendation({ stockBaseQty: 3, manualReorderBaseQty: 10 });
assert.equal(manualFloor.recommendedOrderBaseQty, 10);
assert.equal(manualFloor.reasonCode, "manual_reorder_floor");

const demandCoverage = recommendation({
  stockBaseQty: 50,
  netSalesBaseQty: 90,
  salesLineCount: 15,
});
assert.equal(demandCoverage.recommendedOrderBaseQty, 13);
assert.equal(demandCoverage.averageDailySalesBaseQty, 3);
assert.equal(demandCoverage.demandTargetBaseQty, 63);
assert.equal(demandCoverage.coverageDaysRemaining, 16.67);
assert.equal(demandCoverage.forecastConfidence, "high");
assert.equal(demandCoverage.reasonCode, "demand_coverage");
assert.equal(demandCoverage.calculationVersion, "deterministic_reorder_v1");

const openOrderCoversNeed = recommendation({
  stockBaseQty: 3,
  manualReorderBaseQty: 10,
  openOrderBaseQty: 10,
});
assert.equal(openOrderCoversNeed, null, "open supplier orders must not create duplicate recommendations");

const partialOpenOrder = recommendation({
  stockBaseQty: 3,
  manualReorderBaseQty: 10,
  openOrderBaseQty: 4,
});
assert.equal(partialOpenOrder.recommendedOrderBaseQty, 6);
assert.equal(partialOpenOrder.openOrderBaseQty, 4);

const returnsNetDemandDown = recommendation({
  stockBaseQty: 20,
  lowStockThreshold: 0,
  netSalesBaseQty: -5,
  salesLineCount: 2,
});
assert.equal(returnsNetDemandDown, null, "net returns must never invent negative or replacement demand");

const lowEvidence = recommendation({
  stockBaseQty: 0,
  lowStockThreshold: 0,
  netSalesBaseQty: 3,
  salesLineCount: 1,
});
assert.equal(lowEvidence.forecastConfidence, "low");
assert.match(lowEvidence.explanation, /30-day net sales: 3 piece across 1 sale line/);

console.log("Reorder recommendation examples passed");

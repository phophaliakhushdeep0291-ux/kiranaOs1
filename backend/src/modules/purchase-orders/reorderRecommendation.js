import { round2 } from "../../utils/money.js";

export const REORDER_SALES_WINDOW_DAYS = 30;
export const REORDER_TARGET_COVERAGE_DAYS = 21;
export const REORDER_CALCULATION_VERSION = "deterministic_reorder_v1";

function ceil2(value) {
  const normalized = Math.max(0, Number(value) || 0);
  return Math.ceil((normalized * 100) - Number.EPSILON) / 100;
}

function confidenceFor(lineCount, netSalesBaseQty) {
  if (netSalesBaseQty <= 0 || lineCount <= 0) return "no_history";
  if (lineCount >= 12) return "high";
  if (lineCount >= 4) return "medium";
  return "low";
}

/**
 * Produces a deterministic, reviewable replenishment recommendation. This is
 * intentionally not described as AI: every output is derived from the values
 * returned alongside it and can be independently recalculated by the user.
 */
export function calculateReorderRecommendation({
  stockBaseQty,
  lowStockThreshold = 0,
  manualReorderBaseQty = 0,
  openOrderBaseQty = 0,
  netSalesBaseQty = 0,
  salesLineCount = 0,
  salesWindowDays = REORDER_SALES_WINDOW_DAYS,
  targetCoverageDays = REORDER_TARGET_COVERAGE_DAYS,
  baseUnit = "unit",
}) {
  const stock = round2(Number(stockBaseQty || 0));
  const threshold = Math.max(0, round2(Number(lowStockThreshold || 0)));
  const manualReorder = Math.max(0, round2(Number(manualReorderBaseQty || 0)));
  const alreadyOrdered = Math.max(0, round2(Number(openOrderBaseQty || 0)));
  const windowDays = Math.max(1, Math.trunc(Number(salesWindowDays) || REORDER_SALES_WINDOW_DAYS));
  const coverageTarget = Math.max(1, Math.trunc(Number(targetCoverageDays) || REORDER_TARGET_COVERAGE_DAYS));
  const netSales = Math.max(0, round2(Number(netSalesBaseQty || 0)));
  const lineCount = Math.max(0, Math.trunc(Number(salesLineCount) || 0));
  const averageDailySalesBaseQty = round2(netSales / windowDays);
  const demandTargetBaseQty = round2(averageDailySalesBaseQty * coverageTarget);
  const lowStockTriggered = threshold > 0 && stock <= threshold;

  // A configured reorder level is the preferred batch quantity once the low
  // stock trigger fires. Otherwise replenish to twice the alert threshold.
  const lowStockFloorBaseQty = lowStockTriggered
    ? Math.max(
        Math.max(0, manualReorder - alreadyOrdered),
        Math.max(0, (threshold * 2) - stock - alreadyOrdered),
      )
    : 0;
  const demandShortfallBaseQty = Math.max(0, demandTargetBaseQty - stock - alreadyOrdered);
  const hasDemandEvidence = netSales > 0 && lineCount > 0;
  const recommendedOrderBaseQty = ceil2(Math.max(
    lowStockFloorBaseQty,
    hasDemandEvidence ? demandShortfallBaseQty : 0,
  ));

  if (recommendedOrderBaseQty <= 0) return null;

  const reasonCode = hasDemandEvidence && demandShortfallBaseQty >= lowStockFloorBaseQty
    ? "demand_coverage"
    : manualReorder > 0 && Math.max(0, manualReorder - alreadyOrdered) >= Math.max(0, (threshold * 2) - stock - alreadyOrdered)
      ? "manual_reorder_floor"
      : "low_stock_floor";
  const forecastConfidence = confidenceFor(lineCount, netSales);
  const coverageDaysRemaining = averageDailySalesBaseQty > 0
    ? round2(Math.max(0, stock) / averageDailySalesBaseQty)
    : null;
  const unit = String(baseUnit || "unit");
  const explanation = reasonCode === "demand_coverage"
    ? `${windowDays}-day net sales: ${netSales} ${unit} across ${lineCount} sale line${lineCount === 1 ? "" : "s"}; ${stock} on hand + ${alreadyOrdered} already ordered; target: ${coverageTarget} days.`
    : reasonCode === "manual_reorder_floor"
      ? `Stock is ${stock} ${unit} against the ${threshold} alert level; configured reorder batch is ${manualReorder}, with ${alreadyOrdered} already ordered.`
      : `Stock is ${stock} ${unit} against the ${threshold} alert level; replenishment floor is twice the alert level, less ${alreadyOrdered} already ordered.`;

  return {
    recommendedOrderBaseQty,
    netSalesBaseQty: netSales,
    salesLineCount: lineCount,
    salesWindowDays: windowDays,
    averageDailySalesBaseQty,
    demandTargetBaseQty,
    targetCoverageDays: coverageTarget,
    openOrderBaseQty: alreadyOrdered,
    coverageDaysRemaining,
    forecastConfidence,
    reasonCode,
    explanation,
    calculationVersion: REORDER_CALCULATION_VERSION,
  };
}

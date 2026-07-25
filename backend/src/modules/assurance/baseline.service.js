// Shop-specific behavioral baselines using robust statistics only (median,
// interquartile range, percentiles). No machine learning. A baseline below its
// minimum sample count reports INSUFFICIENT_DATA and MUST NOT contribute to
// any risk score — rules receive it with `usable: false`.
import db from "../../db.js";
import { BASELINE_MINIMUM_SAMPLES, BASELINE_STATUS } from "./assurance.constants.js";

export const BASELINE_METRICS = Object.freeze({
  SALE_AMOUNT: "sale_amount",
  DISCOUNT_PERCENT: "discount_percent",
  EXPENSE_AMOUNT: "expense_amount", // scoped per category
  PURCHASE_PRICE: "purchase_price", // scoped per product
  PURCHASE_AMOUNT: "purchase_amount", // scoped per supplier
  STOCK_CORRECTIONS_PER_WEEK: "stock_corrections_per_week",
});

export function computeRobustStats(values, { minimumSamples = BASELINE_MINIMUM_SAMPLES } = {}) {
  const clean = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const sampleCount = clean.length;
  if (sampleCount === 0) {
    return { status: BASELINE_STATUS.INSUFFICIENT_DATA, sampleCount, minimumSamples };
  }
  const stats = {
    sampleCount,
    minimumSamples,
    status: sampleCount >= minimumSamples ? BASELINE_STATUS.OK : BASELINE_STATUS.INSUFFICIENT_DATA,
    median: percentile(clean, 50),
    p25: percentile(clean, 25),
    p75: percentile(clean, 75),
    p90: percentile(clean, 90),
    p99: percentile(clean, 99),
    mean: clean.reduce((sum, v) => sum + v, 0) / sampleCount,
  };
  stats.iqr = stats.p75 - stats.p25;
  // Robust outlier fence: Tukey with a conservative multiplier.
  stats.upperFence = stats.p75 + 3 * stats.iqr;
  return stats;
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const rank = (p / 100) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
}

/**
 * Recompute and persist all baselines for a shop from canonical records.
 * Reads canonical tables, writes ONLY AuditBaseline rows.
 */
export async function recomputeShopBaselines(shopId, { client = db, windowDays = 90 } = {}) {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const [bills, expenses, purchases] = await Promise.all([
    client.bill.findMany({
      where: { shopId, status: "active", createdAt: { gte: since } },
      select: { grandTotal: true, subtotal: true, discount: true },
    }),
    client.expense.findMany({
      where: { shopId, deletedAt: null, spentAt: { gte: since } },
      select: { amount: true, category: true },
    }),
    client.purchaseHistory.findMany({
      where: { shopId, createdAt: { gte: since } },
      select: { totalCost: true, pricePerRateUnit: true, productId: true, supplierId: true, supplierName: true },
    }),
  ]);

  const entries = [];
  entries.push({
    metricKey: BASELINE_METRICS.SALE_AMOUNT,
    scopeKey: "global",
    stats: computeRobustStats(bills.map((b) => Number(b.grandTotal ?? 0))),
  });
  entries.push({
    metricKey: BASELINE_METRICS.DISCOUNT_PERCENT,
    scopeKey: "global",
    stats: computeRobustStats(
      bills
        .filter((b) => Number(b.subtotal ?? 0) > 0)
        .map((b) => (100 * Number(b.discount ?? 0)) / (Number(b.subtotal ?? 0) + Number(b.discount ?? 0)))
    ),
  });

  const expensesByCategory = groupBy(expenses, (e) => e.category || "general");
  for (const [category, rows] of expensesByCategory) {
    entries.push({
      metricKey: BASELINE_METRICS.EXPENSE_AMOUNT,
      scopeKey: `category:${category}`,
      stats: computeRobustStats(rows.map((r) => Number(r.amount ?? 0)), { minimumSamples: 10 }),
    });
  }

  const purchasesByProduct = groupBy(purchases.filter((p) => p.productId), (p) => p.productId);
  for (const [productId, rows] of purchasesByProduct) {
    entries.push({
      metricKey: BASELINE_METRICS.PURCHASE_PRICE,
      scopeKey: `product:${productId}`,
      stats: computeRobustStats(rows.map((r) => Number(r.pricePerRateUnit ?? 0)), { minimumSamples: 5 }),
    });
  }

  const purchasesBySupplier = groupBy(purchases, (p) => p.supplierId || `name:${p.supplierName}`);
  for (const [supplierKey, rows] of purchasesBySupplier) {
    entries.push({
      metricKey: BASELINE_METRICS.PURCHASE_AMOUNT,
      scopeKey: `supplier:${supplierKey}`,
      stats: computeRobustStats(rows.map((r) => Number(r.totalCost ?? 0)), { minimumSamples: 5 }),
    });
  }

  for (const entry of entries) {
    const { stats } = entry;
    const data = {
      windowDays,
      sampleCount: stats.sampleCount ?? 0,
      minimumSamples: stats.minimumSamples ?? BASELINE_MINIMUM_SAMPLES,
      status: stats.status,
      median: stats.median ?? null,
      p25: stats.p25 ?? null,
      p75: stats.p75 ?? null,
      p90: stats.p90 ?? null,
      p99: stats.p99 ?? null,
      mean: stats.mean ?? null,
      statsJson: JSON.stringify({ iqr: stats.iqr ?? null, upperFence: stats.upperFence ?? null }),
      computedAt: new Date(),
    };
    await client.auditBaseline.upsert({
      where: { shopId_metricKey_scopeKey: { shopId, metricKey: entry.metricKey, scopeKey: entry.scopeKey } },
      update: data,
      create: { shopId, metricKey: entry.metricKey, scopeKey: entry.scopeKey, ...data },
    });
  }

  return entries.length;
}

/**
 * Load persisted baselines into a lookup usable by rules:
 *   baselines.get("sale_amount", "global") →
 *     { usable, status, median, p25, p75, p90, p99, mean, iqr, upperFence, sampleCount }
 * Missing baselines return { usable: false, status: "INSUFFICIENT_DATA" }.
 */
export async function getShopBaselines(shopId, { client = db } = {}) {
  const rows = await client.auditBaseline.findMany({ where: { shopId } });
  const byKey = new Map(rows.map((row) => [`${row.metricKey}|${row.scopeKey}`, row]));
  return {
    get(metricKey, scopeKey = "global") {
      const row = byKey.get(`${metricKey}|${scopeKey}`);
      if (!row) {
        return { usable: false, status: BASELINE_STATUS.INSUFFICIENT_DATA, sampleCount: 0, minimumSamples: BASELINE_MINIMUM_SAMPLES };
      }
      let extra = {};
      try {
        extra = JSON.parse(row.statsJson || "{}");
      } catch {
        extra = {};
      }
      return {
        usable: row.status === BASELINE_STATUS.OK,
        status: row.status,
        sampleCount: row.sampleCount,
        minimumSamples: row.minimumSamples,
        median: row.median,
        p25: row.p25,
        p75: row.p75,
        p90: row.p90,
        p99: row.p99,
        mean: row.mean,
        iqr: extra.iqr ?? null,
        upperFence: extra.upperFence ?? null,
        computedAt: row.computedAt,
      };
    },
    all: rows,
  };
}

function groupBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!key) continue;
    const list = map.get(key) ?? [];
    list.push(row);
    map.set(key, list);
  }
  return map;
}

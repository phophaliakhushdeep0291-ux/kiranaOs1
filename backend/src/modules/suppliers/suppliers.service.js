import db from "../../db.js";
import { round2, sumMoney } from "../../utils/money.js";
import { AppError } from "../../middleware/error.js";

export async function listSuppliers(shopId) {
  return db.supplier.findMany({ where: { shopId, deletedAt: null }, orderBy: { name: "asc" } });
}

export async function getSupplier(shopId, id) {
  const supplier = await db.supplier.findFirst({ where: { id, shopId, deletedAt: null } });
  if (!supplier) throw new AppError("Supplier not found", 404);
  return supplier;
}

export async function createSupplier(shopId, data) {
  return db.supplier.create({ data: { ...data, shopId } });
}

export async function updateSupplier(shopId, id, data) {
  await getSupplier(shopId, id);
  return db.supplier.update({ where: { id }, data });
}

export async function softDeleteSupplier(shopId, id) {
  const supplier = await getSupplier(shopId, id);
  return db.supplier.update({ where: { id: supplier.id }, data: { deletedAt: new Date() } });
}

export async function restoreSupplier(shopId, id) {
  const supplier = await db.supplier.findFirst({ where: { id, shopId, deletedAt: { not: null } } });
  if (!supplier) throw new AppError("Deleted supplier not found", 404);
  return db.supplier.update({ where: { id: supplier.id }, data: { deletedAt: null } });
}

/**
 * Best price analysis for a product — shows cheapest supplier from history.
 */
export async function getBestPrice(shopId, productId) {
  const history = await db.purchaseHistory.findMany({
    where: { shopId, productId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  if (history.length === 0) return { productId, history: [], bestSupplier: null };

  // Group by supplier and find their most recent + average price
  const bySupplier = {};
  for (const h of history) {
    if (!bySupplier[h.supplierName]) {
      bySupplier[h.supplierName] = { prices: [], latestDate: h.createdAt };
    }
    bySupplier[h.supplierName].prices.push(h.pricePerRateUnit);
    if (h.createdAt > bySupplier[h.supplierName].latestDate) {
      bySupplier[h.supplierName].latestDate = h.createdAt;
    }
  }

  const summary = Object.entries(bySupplier).map(([name, { prices, latestDate }]) => ({
    supplierName: name,
    avgPrice: round2(sumMoney(prices) / prices.length),
    latestPrice: prices[0],
    purchases: prices.length,
    latestDate,
  }));

  summary.sort((a, b) => a.latestPrice - b.latestPrice);

  return { productId, bestSupplier: summary[0] ?? null, supplierSummary: summary, recentHistory: history.slice(0, 10) };
}

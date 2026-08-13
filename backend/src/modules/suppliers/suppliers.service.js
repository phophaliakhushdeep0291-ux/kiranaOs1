import db from "../../db.js";
import { round2, sumMoney } from "../../utils/money.js";
import { AppError } from "../../middleware/error.js";
import { createAuditLog } from "../audit/audit.service.js";

async function writeRequiredSupplierAudit(entry, client) {
  const audit = await createAuditLog({ ...entry, client });
  if (!audit) {
    throw new AppError("Supplier action was not saved because its audit record could not be stored", 503, "SUPPLIER_AUDIT_WRITE_FAILED");
  }
  return audit;
}

export async function listSuppliers(shopId) {
  return db.supplier.findMany({ where: { shopId, deletedAt: null }, orderBy: { name: "asc" } });
}

export async function getSupplier(shopId, id) {
  const supplier = await db.supplier.findFirst({ where: { id, shopId, deletedAt: null } });
  if (!supplier) throw new AppError("Supplier not found", 404);
  return supplier;
}

export async function createSupplier(shopId, data, actor = {}) {
  return db.$transaction(async (tx) => {
    const supplier = await tx.supplier.create({ data: { ...data, shopId } });
    await writeRequiredSupplierAudit({
      shopId, userId: actor.userId ?? null, deviceId: actor.deviceId ?? null,
      action: "SUPPLIER_CREATED", entityType: "Supplier", entityId: supplier.id,
      before: null, after: { id: supplier.id, name: supplier.name, mobile: supplier.mobile ?? null },
      metadata: { offlineSyncEventId: actor.syncEventId ?? null }, req: actor.req ?? null,
    }, tx);
    return supplier;
  });
}

export async function updateSupplier(shopId, id, data, actor = {}) {
  return db.$transaction(async (tx) => {
    const existing = await tx.supplier.findFirst({ where: { id, shopId, deletedAt: null } });
    if (!existing) throw new AppError("Supplier not found", 404);
    const updated = await tx.supplier.update({ where: { id }, data });
    await writeRequiredSupplierAudit({
      shopId, userId: actor.userId ?? null, deviceId: actor.deviceId ?? null,
      action: "SUPPLIER_UPDATED", entityType: "Supplier", entityId: id,
      // gstin, not gstNumber: Supplier has never had a gstNumber column, so this
      // recorded undefined on both sides and a GSTIN edit left no trace — which
      // matters now that the value decides how a purchase's tax is posted.
      before: { name: existing.name, mobile: existing.mobile, gstin: existing.gstin ?? null },
      after: { name: updated.name, mobile: updated.mobile, gstin: updated.gstin ?? null },
      metadata: { offlineSyncEventId: actor.syncEventId ?? null }, req: actor.req ?? null,
    }, tx);
    return updated;
  });
}

export async function softDeleteSupplier(shopId, id, actor = {}) {
  return db.$transaction(async (tx) => {
    const supplier = await tx.supplier.findFirst({ where: { id, shopId } });
    if (!supplier) throw new AppError("Supplier not found", 404);
    if (supplier.deletedAt) return supplier;
    const deleted = await tx.supplier.update({ where: { id: supplier.id }, data: { deletedAt: new Date() } });
    await writeRequiredSupplierAudit({
      shopId, userId: actor.userId ?? null, deviceId: actor.deviceId ?? null,
      action: "SUPPLIER_DELETED", entityType: "Supplier", entityId: supplier.id,
      before: { id: supplier.id, name: supplier.name, deletedAt: supplier.deletedAt },
      after: { id: deleted.id, name: deleted.name, deletedAt: deleted.deletedAt },
      metadata: { softDelete: true, offlineSyncEventId: actor.syncEventId ?? null }, req: actor.req ?? null,
    }, tx);
    return deleted;
  });
}

export async function restoreSupplier(shopId, id, actor = {}) {
  return db.$transaction(async (tx) => {
    const supplier = await tx.supplier.findFirst({ where: { id, shopId } });
    if (!supplier) throw new AppError("Supplier not found", 404);
    if (!supplier.deletedAt) return supplier;
    const restored = await tx.supplier.update({ where: { id: supplier.id }, data: { deletedAt: null } });
    await writeRequiredSupplierAudit({
      shopId, userId: actor.userId ?? null, deviceId: actor.deviceId ?? null,
      action: "SUPPLIER_RESTORED", entityType: "Supplier", entityId: supplier.id,
      before: { id: supplier.id, name: supplier.name, deletedAt: supplier.deletedAt },
      after: { id: restored.id, name: restored.name, deletedAt: restored.deletedAt },
      metadata: { softDelete: false, offlineSyncEventId: actor.syncEventId ?? null }, req: actor.req ?? null,
    }, tx);
    return restored;
  });
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

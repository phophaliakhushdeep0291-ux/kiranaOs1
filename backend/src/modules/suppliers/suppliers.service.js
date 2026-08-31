import db from "../../db.js";
import { round2, sumMoney } from "../../utils/money.js";
import { AppError } from "../../middleware/error.js";
import { createAuditLog } from "../audit/audit.service.js";
import { rangeEndInclusive, rangeStart } from "../../utils/dateRange.js";
import { postPurchaseHistoryLedger } from "../finance/financial-ledger.service.js";

const SUPPLIER_STATEMENT_VERSION = "supplier-statement-v1";
const PAYABLE_ENTRY_TYPES = new Set(["supplier_payable", "supplier_payable_reduction", "supplier_payment"]);

function payableDeltaPaise(row) {
  const amount = BigInt(row?.amountPaise ?? 0);
  if (row?.entryType === "supplier_payable") return amount;
  if (row?.entryType === "supplier_payable_reduction") return -amount;
  if (row?.entryType === "supplier_payment") return -amount;
  return 0n;
}

function asPublicPaise(value) {
  return Number(value ?? 0n);
}

function groupedPayableBalance(groups) {
  return groups.reduce((sum, group) => sum + payableDeltaPaise({
    entryType: group.entryType,
    amountPaise: group._sum?.amountPaise ?? 0n,
  }), 0n);
}

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

/**
 * Append-only supplier subledger derived from FinancialLedger. Purchase rows,
 * later settlements, reversals, and return credits all retain one source id and
 * supplier id, so the balance is reconstructed instead of trusting a mutable
 * total stored on Supplier.
 */
export async function getSupplierStatement(shopId, supplierId, { from, to, limit = 500 } = {}) {
  const supplier = await db.supplier.findFirst({ where: { id: supplierId, shopId } });
  if (!supplier) throw new AppError("Supplier not found", 404);
  const fromDate = rangeStart(from);
  const toDate = rangeEndInclusive(to);
  const businessDate = {
    ...(fromDate && { gte: fromDate }),
    ...(toDate && { lte: toDate }),
  };
  const scopedWhere = {
    shopId,
    supplierId,
    ...(Object.keys(businessDate).length ? { businessDate } : {}),
  };
  const [windowRows, currentPayableGroups, openingPayableGroups, historyDue, returnCredits, linkedPurchaseCount, unlinkedPurchaseCount, unlinkedPurchases] = await Promise.all([
    db.financialLedger.findMany({
      where: scopedWhere,
      orderBy: [{ businessDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      // One visible statement event may have inventory, tender and payable rows.
      // Fetch a bounded row multiple and paginate after grouping so a document
      // never appears with only half of its accounting effect.
      take: (Number(limit) * 4) + 1,
    }),
    db.financialLedger.groupBy({
      by: ["entryType"],
      where: { shopId, supplierId, entryType: { in: [...PAYABLE_ENTRY_TYPES] } },
      _sum: { amountPaise: true },
    }),
    fromDate ? db.financialLedger.groupBy({
      by: ["entryType"],
      where: { shopId, supplierId, entryType: { in: [...PAYABLE_ENTRY_TYPES] }, businessDate: { lt: fromDate } },
      _sum: { amountPaise: true },
    }) : Promise.resolve([]),
    db.purchaseHistory.aggregate({
      where: { shopId, supplierId },
      _sum: { purchaseDueAmount: true },
    }),
    db.purchaseReturn.aggregate({
      where: { shopId, supplierId, status: "active" },
      _sum: { supplierCreditAmount: true },
    }),
    db.purchaseHistory.count({ where: { shopId, supplierId } }),
    db.purchaseHistory.count({ where: { shopId, supplierId: null, supplierName: supplier.name } }),
    db.purchaseHistory.findMany({
      where: { shopId, supplierId: null, supplierName: supplier.name },
      select: { id: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50,
    }),
  ]);

  const openingBalance = groupedPayableBalance(openingPayableGroups);
  const currentBalance = groupedPayableBalance(currentPayableGroups);
  const groups = new Map();
  for (const row of windowRows) {
    const key = `${row.sourceType}:${row.sourceId}`;
    const group = groups.get(key) ?? {
      id: key,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      purchaseBillId: row.purchaseBillId ?? null,
      businessDate: row.businessDate,
      createdAt: row.createdAt,
      purchasePaise: 0n,
      immediatePaymentPaise: 0n,
      settlementPaise: 0n,
      creditPaise: 0n,
      payableChangePaise: 0n,
      paymentMode: row.paymentMode ?? null,
      ledgerRowIds: [],
    };
    const amount = BigInt(row.amountPaise ?? 0);
    if (row.entryType === "inventory_purchase") group.purchasePaise += amount;
    if (["cash_out", "upi_out", "bank_out", "other_out"].includes(row.entryType)) group.immediatePaymentPaise += amount;
    if (row.entryType === "supplier_payment") group.settlementPaise += amount;
    if (row.entryType === "supplier_payable_reduction") group.creditPaise += amount;
    group.payableChangePaise += payableDeltaPaise(row);
    group.ledgerRowIds.push(row.id);
    groups.set(key, group);
  }

  const groupedRows = [...groups.values()];
  const hasMore = groupedRows.length > Number(limit) || windowRows.length > Number(limit) * 4;
  const visibleGroups = groupedRows.slice(0, Number(limit));
  const referenceIds = [...new Set(visibleGroups.flatMap((group) => [group.purchaseBillId, group.sourceId]).filter(Boolean))];
  const [histories, returns] = await Promise.all([
    referenceIds.length ? db.purchaseHistory.findMany({
      where: { shopId, id: { in: referenceIds } },
      select: { id: true, invoiceNumber: true },
    }) : Promise.resolve([]),
    referenceIds.length ? db.purchaseReturn.findMany({
      where: { shopId, id: { in: referenceIds } },
      select: { id: true, returnNumber: true },
    }) : Promise.resolve([]),
  ]);
  const historyById = new Map(histories.map((row) => [row.id, row]));
  const returnById = new Map(returns.map((row) => [row.id, row]));
  let running = openingBalance;
  const rows = visibleGroups.map((group) => {
    running += group.payableChangePaise;
    const history = historyById.get(group.purchaseBillId) ?? historyById.get(group.sourceId);
    const purchaseReturn = returnById.get(group.sourceId);
    return {
      id: group.id,
      sourceType: group.sourceType,
      sourceId: group.sourceId,
      purchaseBillId: group.purchaseBillId,
      reference: history?.invoiceNumber ?? purchaseReturn?.returnNumber ?? group.sourceId,
      businessDate: group.businessDate,
      createdAt: group.createdAt,
      paymentMode: group.paymentMode,
      purchasePaise: asPublicPaise(group.purchasePaise),
      immediatePaymentPaise: asPublicPaise(group.immediatePaymentPaise),
      settlementPaise: asPublicPaise(group.settlementPaise),
      creditPaise: asPublicPaise(group.creditPaise),
      payableChangePaise: asPublicPaise(group.payableChangePaise),
      balancePaise: asPublicPaise(running),
      ledgerRowIds: group.ledgerRowIds,
    };
  });

  const operationalDue = BigInt(Math.round((
    Number(historyDue._sum.purchaseDueAmount ?? 0)
    - Number(returnCredits._sum.supplierCreditAmount ?? 0)
  ) * 100));
  const difference = currentBalance - operationalDue;
  const reconciliationStatus = difference === 0n && unlinkedPurchaseCount === 0
    ? "balanced"
    : "attention_required";
  return {
    version: SUPPLIER_STATEMENT_VERSION,
    supplier: { id: supplier.id, name: supplier.name, mobile: supplier.mobile, gstin: supplier.gstin },
    from: fromDate?.toISOString() ?? null,
    to: toDate?.toISOString() ?? null,
    openingBalancePaise: asPublicPaise(openingBalance),
    currentBalancePaise: asPublicPaise(currentBalance),
    operationalDuePaise: asPublicPaise(operationalDue),
    differencePaise: asPublicPaise(difference),
    reconciliationStatus,
    coverage: {
      linkedPurchaseCount,
      unlinkedPurchaseCount,
      unlinkedPurchaseIds: unlinkedPurchases.map((row) => row.id),
      complete: unlinkedPurchaseCount === 0,
    },
    rows,
    hasMore,
    limit: Number(limit),
    basis: "append_only_financial_ledger",
  };
}

/**
 * Deterministically migrates legacy direct purchases into the supplier
 * subledger. It never guesses by supplier name and never touches PO receipts,
 * which already have receipt-level postings. Owner approval and a required
 * audit make the repair explicit and reviewable.
 */
export async function rebuildSupplierStatement(shopId, supplierId, actor = {}) {
  return db.$transaction(async (tx) => {
    const supplier = await tx.supplier.findFirst({ where: { id: supplierId, shopId } });
    if (!supplier) throw new AppError("Supplier not found", 404);
    // Scan in bounded pages and repair at most 500 missing documents per call.
    // This lets established shops converge safely over repeated owner-approved
    // calls instead of failing forever merely because they have a long history.
    const missing = [];
    let cursorId = null;
    let reachedEnd = false;
    while (missing.length <= 500 && !reachedEnd) {
      // eslint-disable-next-line no-await-in-loop
      const candidates = await tx.purchaseHistory.findMany({
        where: { shopId, supplierId, purchaseReceiptId: null },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 500,
        ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      });
      reachedEnd = candidates.length < 500;
      if (!candidates.length) break;
      cursorId = candidates.at(-1).id;
      // eslint-disable-next-line no-await-in-loop
      const existingRows = await tx.financialLedger.findMany({
        where: {
          shopId,
          sourceType: "purchase",
          sourceId: { in: candidates.map((row) => row.id) },
          entryType: "inventory_purchase",
        },
        select: { sourceId: true },
      });
      const postedIds = new Set(existingRows.map((row) => row.sourceId));
      missing.push(...candidates.filter((row) => !postedIds.has(row.id)));
    }
    const selected = missing.slice(0, 500);
    const repairIncomplete = missing.length > selected.length || !reachedEnd;
    for (const purchase of selected) {
      // eslint-disable-next-line no-await-in-loop
      await postPurchaseHistoryLedger(tx, { shopId, purchase, businessDate: purchase.createdAt });
    }
    if (selected.length) {
      await writeRequiredSupplierAudit({
        shopId,
        userId: actor.userId ?? null,
        deviceId: actor.deviceId ?? null,
        action: "SUPPLIER_STATEMENT_REBUILT",
        entityType: "Supplier",
        entityId: supplier.id,
        before: { missingPurchaseCount: repairIncomplete ? "more_than_500" : selected.length },
        after: { repairedPurchaseCount: selected.length, repairIncomplete },
        metadata: { purchaseHistoryIds: selected.map((row) => row.id), repairVersion: SUPPLIER_STATEMENT_VERSION },
        req: actor.req ?? null,
      }, tx);
    }
    return {
      version: SUPPLIER_STATEMENT_VERSION,
      supplierId: supplier.id,
      repairedPurchaseCount: selected.length,
      repairedPurchaseIds: selected.map((row) => row.id),
      repairIncomplete,
      idempotentReplay: selected.length === 0,
    };
  });
}

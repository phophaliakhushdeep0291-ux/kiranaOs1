import { createHash } from "node:crypto";
import { z } from "zod";
import db from "../../db.js";
import { serializableTransaction } from "../../lib/transactions.js";
import { AppError } from "../../shared/errors/index.js";
import { moneyAmount } from "../../utils/validationSchemas.js";
import { moneyShadows, round2, toPaiseBigInt, addMoney, subtractMoney, moneyEquals } from "../../utils/money.js";
import { postFinancialLedgerRows } from "../finance/general-ledger.service.js";
import { createAuditLog } from "../audit/audit.service.js";
import { assertLocationCapability } from "../stores/location-access.service.js";
import { resolveOperationalLocation } from "../stores/location-context.service.js";

const paymentSchema = z.object({
  purchaseHistoryId: z.string().min(1), paymentId: z.string().min(1), idempotencyKey: z.string().min(8).max(180),
  amount: moneyAmount({ positive: true }), mode: z.enum(["cash", "upi", "bank", "card"]),
  reference: z.string().max(120).optional().nullable(), paidAt: z.string().datetime().optional(),
});
export const supplierPaymentApproval = preview => createHash("sha256").update(JSON.stringify(preview)).digest("hex");

async function scopedPurchase(client, shopId, id, actor, counterLocationId) {
  const row = await client.purchaseHistory.findFirst({ where: { id, shopId }, include: { product: { select: { name: true } }, supplier: { select: { name: true, deletedAt: true } } } });
  if (!row) throw new AppError("Purchase bill not found for supplier payment", 404, "PURCHASE_NOT_FOUND");
  const location = await resolveOperationalLocation(shopId, row.locationId, client);
  if (actor) await assertLocationCapability({ shopId, userId: actor.userId ?? actor.id, role: actor.role, locationId: location.id, capability: "purchase", client });
  if (counterLocationId !== undefined) {
    const counter = await resolveOperationalLocation(shopId, counterLocationId, client);
    if (location.id !== counter.id) throw new AppError("Switch to the purchase's counter branch", 403, "LOCATION_ACCESS_DENIED");
  }
  return { row, location };
}
function snapshot(row, location, data) {
  const amount = round2(data.amount);
  const due = round2(row.purchaseDueAmount ?? 0);
  if (amount > due) throw new AppError(`Supplier payment exceeds purchase due (${due})`, 409, "PAYMENT_EXCEEDS_DUE");
  if (!moneyEquals(addMoney(row.purchasePaidAmount, due), row.billAmount)) throw new AppError("Purchase balance needs review in Purchase bills", 409, "PURCHASE_BALANCE_INCONSISTENT");
  return { purchaseHistoryId: row.id, updatedAt: row.updatedAt.toISOString(), supplierId: row.supplierId, supplierName: row.supplier?.name ?? row.supplierName,
    invoiceNumber: row.invoiceNumber, productName: row.product.name, locationId: location.id, locationName: location.name,
    billAmount: round2(row.billAmount), paidBefore: round2(row.purchasePaidAmount), dueBefore: due,
    amount, mode: data.mode, reference: data.reference?.trim() || null, paidAt: data.paidAt ?? null,
    paidAfter: addMoney(row.purchasePaidAmount, amount), dueAfter: subtractMoney(due, amount) };
}
export async function previewSupplierPayment(shopId, data, actor, counterLocationId = null) {
  const parsed = paymentSchema.omit({ paymentId: true, idempotencyKey: true }).parse(data);
  const { row, location } = await scopedPurchase(db, shopId, parsed.purchaseHistoryId, actor, counterLocationId);
  if (row.supplier?.deletedAt) throw new AppError("Restore or review the deleted supplier before payment", 409, "SUPPLIER_DELETED");
  return snapshot(row, location, parsed);
}
export async function listSupplierDues(shopId, supplierId, actor, counterLocationId = null) {
  const location = await resolveOperationalLocation(shopId, counterLocationId);
  await assertLocationCapability({ shopId, userId: actor.userId, role: actor.role, locationId: location.id, capability: "purchase" });
  const where = { shopId, supplierId, purchaseDueAmount: { gt: 0 }, ...(location.isPrimary ? { OR: [{ locationId: location.id }, { locationId: null }] } : { locationId: location.id }) };
  const [count, rows] = await Promise.all([db.purchaseHistory.count({ where }), db.purchaseHistory.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 25, include: { product: { select: { name: true } } } })]);
  return { locationName: location.name, count, purchases: rows.map(row => ({ id: row.id, supplierName: row.supplierName, productName: row.product.name, invoiceNumber: row.invoiceNumber,
    createdAt: row.createdAt.toISOString(), amount: round2(row.billAmount), paid: round2(row.purchasePaidAmount), due: round2(row.purchaseDueAmount) })) };
}

/** Both sync and assistant record through this transaction. No payment provider is called. */
export async function recordSupplierPayment(shopId, input, actor = null, options = {}) {
  const data = paymentSchema.parse(input);
  const mode = data.mode === "card" ? "bank" : data.mode;
  const detailsHash = supplierPaymentApproval({ purchaseHistoryId: data.purchaseHistoryId, paymentId: data.paymentId, amount: round2(data.amount), mode: data.mode, reference: data.reference?.trim() || null, paidAt: data.paidAt ?? null });
  return serializableTransaction(async tx => {
    const { row: purchase, location } = await scopedPurchase(tx, shopId, data.purchaseHistoryId, actor, options.counterLocationId);
    const existing = await tx.financialLedger.findFirst({ where: { shopId, idempotencyKey: data.idempotencyKey } });
    if (existing) {
      const evidence = JSON.parse(existing.evidenceJson || "{}");
      if ((evidence.paymentDetailsHash && evidence.paymentDetailsHash !== detailsHash) || existing.purchaseBillId !== data.purchaseHistoryId || existing.sourceId !== data.paymentId || BigInt(existing.amountPaise) !== toPaiseBigInt(data.amount) || existing.paymentMode !== mode) {
        throw new AppError("Payment key already belongs to different details", 409, "IDEMPOTENCY_KEY_REUSED");
      }
      return { paymentId: existing.sourceId, ledgerEntryId: existing.id, purchaseHistoryId: existing.purchaseBillId, idempotentReplay: true };
    }
    if (options.approval && purchase.supplier?.deletedAt) throw new AppError("Restore or review the deleted supplier before payment", 409, "SUPPLIER_DELETED");
    const preview = snapshot(purchase, location, data);
    if (options.approval && supplierPaymentApproval(preview) !== options.approval) throw new AppError("The purchase balance changed. Review a new payment plan.", 409, "SUPPLIER_PAYMENT_APPROVAL_CHANGED");
    const businessDate = data.paidAt ? new Date(data.paidAt) : new Date();
    const paid = preview.paidAfter, due = preview.dueAfter;
    const changed = await tx.purchaseHistory.updateMany({
      where: { id: purchase.id, shopId, updatedAt: purchase.updatedAt, purchasePaidAmount: purchase.purchasePaidAmount, purchaseDueAmount: purchase.purchaseDueAmount },
      data: { purchasePaidAmount: paid, purchaseDueAmount: due, ...moneyShadows({ purchasePaidAmount: paid, purchaseDueAmount: due }), purchasePaymentStatus: due <= 0 ? "paid" : "partial" },
    });
    if (changed.count !== 1) throw new AppError("Purchase balance changed. Refresh before recording payment.", 409, "SUPPLIER_PAYMENT_BALANCE_CHANGED");
    const [ledger] = await postFinancialLedgerRows(tx, [{
      shopId, supplierId: purchase.supplierId, purchaseBillId: purchase.id, sourceType: "supplier_payment", sourceId: data.paymentId,
      entryType: "supplier_payment", direction: "debit", amountPaise: toPaiseBigInt(data.amount), paymentMode: mode, businessDate, idempotencyKey: data.idempotencyKey,
      evidenceJson: JSON.stringify({ version: 1, paymentDetailsHash: detailsHash, capturedAt: new Date().toISOString(), sourceType: "supplier_payment", sourceId: data.paymentId,
        purchaseBillId: purchase.id, supplierId: purchase.supplierId, entryType: "supplier_payment", amountPaise: String(toPaiseBigInt(data.amount)), paymentMode: mode }),
    }]);
    const audit = await createAuditLog({ shopId, userId: actor?.userId ?? actor?.id ?? null, deviceId: actor?.deviceId ?? null,
      action: "SUPPLIER_PAYMENT_RECORDED", entityType: "FinancialLedger", entityId: ledger.id,
      before: { paid: purchase.purchasePaidAmount, due: preview.dueBefore }, after: { paid, due },
      metadata: { paymentId: data.paymentId, purchaseHistoryId: purchase.id, amount: data.amount, mode, reference: data.reference ?? null }, client: tx });
    if (!audit) throw new AppError("Supplier payment was not saved because its audit record could not be stored", 503, "SUPPLIER_PAYMENT_AUDIT_WRITE_FAILED");
    return { paymentId: data.paymentId, ledgerEntryId: ledger.id, purchaseHistoryId: purchase.id, amountPaid: data.amount,
      purchaseHistory: await tx.purchaseHistory.findUnique({ where: { id: purchase.id } }), paid, due };
  });
}

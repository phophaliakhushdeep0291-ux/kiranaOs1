import { offlineDB } from "@/lib/offline/db";
import { emitLocalDataChanged, readInstantCache, upsertCachedListItem, writeInstantCache } from "@/lib/offline/instant-cache";
import { buildOutboxOperation } from "@/features/core/sync/outbox";
import { makeLocalEntity, parseOrThrow, readNumber, roundMoney } from "@/lib/offline/actions/utils";
import { ownerPinRequiredActionSchema } from "@/lib/validation";
import type { Bill, Customer, Product } from "@/types/api";
import { buildAuditLogOutboxInput, buildAuditLogRow } from "@/features/core/audit-logs/local-actions";

const BILL_CACHE_KEY = "bills";
const CUSTOMER_CACHE_KEY = "customers";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function billNumberOf(bill: Partial<Bill> & Record<string, unknown>) {
  return String(bill.billNumber ?? bill.billNo ?? bill.id ?? "bill");
}

function billCustomerIdOf(bill: Partial<Bill> & Record<string, unknown>) {
  const value = bill.customerId ?? bill.customer_id;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function billCreditAmountOf(bill: Partial<Bill> & Record<string, unknown>) {
  const explicit = readNumber(bill.creditAmount ?? bill.credit_amount, Number.NaN);
  if (Number.isFinite(explicit)) return Math.max(0, roundMoney(explicit));

  const total = readNumber(
    bill.grandTotal ?? bill.grand_total ?? bill.totalAmount ?? bill.total_amount ?? bill.netAmount ?? bill.net_amount,
    0,
  );
  const embeddedPayments = Array.isArray(bill.payments) ? bill.payments.filter(isRecord) : [];
  const paymentRowsPaid = embeddedPayments.reduce((sum, payment) =>
    String(payment.mode ?? "").toLowerCase() === "credit"
      ? sum
      : sum + Math.max(0, readNumber(payment.amount, 0)), 0);
  const billLevelPaid = readNumber(
    bill.paidAmount ?? bill.paid_amount ?? bill.buyerPaidAmount ?? bill.buyer_paid_amount,
    paymentRowsPaid,
  );
  return Math.max(0, roundMoney(total - Math.max(paymentRowsPaid, billLevelPaid)));
}

function stableCancellationId(prefix: string, bill: Partial<Bill> & Record<string, unknown>, suffix = "") {
  const identity = String(bill.local_id ?? bill.localId ?? bill.clientBillId ?? bill.client_bill_id ?? bill.id ?? "bill")
    .replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${prefix}_${identity}${suffix}`;
}

async function findBill(id: string): Promise<(Bill & Record<string, unknown>) | undefined> {
  const rows = await offlineDB.getAll<Record<string, unknown>>("bills").catch(() => []);
  const match = rows.find((row) => row.id === id || row.local_id === id || row.server_id === id || row.billNo === id || row.billNumber === id);
  if (match) return match as Bill & Record<string, unknown>;
  return readInstantCache<Array<Bill & Record<string, unknown>>>(BILL_CACHE_KEY, []).find((bill) => bill.id === id || bill.billNo === id || bill.billNumber === id);
}

function buildBillAudit(action: string, bill: Bill & Record<string, unknown>, ownerPin: string, reason?: string, oldValue?: unknown) {
  const normalizedAction = action === "cancel_bill" ? "bill_cancelled" : action === "soft_delete_bill" ? "bill_soft_deleted" : action === "restore_bill" ? "bill_restored" : action;
  return buildAuditLogRow({
    action: normalizedAction,
    entityType: "bill",
    entityId: bill.id,
    entityLabel: billNumberOf(bill),
    oldValue: oldValue ?? null,
    newValue: bill,
    reason,
    ownerPinProvided: ownerPin.length > 0,
    summary: `${normalizedAction.replaceAll("_", " ")} ${billNumberOf(bill)}`,
  });
}

function updateBillCache(updated: Bill & Record<string, unknown>) {
  const cached = readInstantCache<Array<Bill & Record<string, unknown>>>(BILL_CACHE_KEY, []);
  const next = cached.map((bill) => bill.id === updated.id ? { ...bill, ...updated } : bill);
  if (!next.some((bill) => bill.id === updated.id)) next.unshift(updated);
  writeInstantCache(BILL_CACHE_KEY, next, 30);
  upsertCachedListItem(BILL_CACHE_KEY, updated, 500);
}

interface CancellationItem extends Record<string, unknown> {
  productId?: string;
  product_id?: string;
  sellingUnitId?: string;
  selling_unit_id?: string;
  quantity?: number;
  quantityInBaseUnit?: number;
  quantity_in_base_unit?: number;
  conversionToBase?: number;
  conversion_to_base?: number;
  name?: string;
}

function cancellationItemBaseQuantity(item: CancellationItem) {
  const explicit = readNumber(item.quantityInBaseUnit ?? item.quantity_in_base_unit, Number.NaN);
  if (Number.isFinite(explicit) && explicit !== 0) return Math.abs(roundMoney(explicit));
  const quantity = Math.abs(readNumber(item.quantity, 0));
  const conversion = readNumber(item.conversionToBase ?? item.conversion_to_base, 1);
  return roundMoney(quantity * (conversion > 0 ? conversion : 1));
}

async function cancellationItemsFor(bill: Bill & Record<string, unknown>): Promise<CancellationItem[]> {
  const embedded = Array.isArray(bill.items)
    ? bill.items.filter(isRecord) as CancellationItem[]
    : [];
  if (embedded.length > 0) return embedded;

  const billIds = new Set([bill.id, bill.local_id, bill.server_id, bill.clientBillId, bill.client_bill_id].filter((value): value is string => typeof value === "string" && value.length > 0));
  const rows = await offlineDB.getAll<CancellationItem>("bill_items").catch(() => []);
  return rows.filter((row) => {
    const reference = row.billId ?? row.bill_id ?? row.localBillId ?? row.local_bill_id;
    return typeof reference === "string" && billIds.has(reference);
  });
}

async function buildCancellationStockChanges(bill: Bill & Record<string, unknown>, now: string) {
  const items = await cancellationItemsFor(bill);
  const productIds = new Set(items.map((item) => item.productId ?? item.product_id).filter((value): value is string => typeof value === "string" && value.length > 0));
  if (productIds.size === 0) return { products: [] as Array<Product & Record<string, unknown>>, movements: [] as Array<Record<string, unknown>> };

  const dbProducts = await offlineDB.getAll<Product & Record<string, unknown>>("products").catch(() => []);
  const cachedProducts = readInstantCache<Array<Product & Record<string, unknown>>>("products", []);
  const productsById = new Map<string, Product & Record<string, unknown>>();
  for (const product of [...dbProducts, ...cachedProducts]) {
    if (productIds.has(product.id) && !productsById.has(product.id)) productsById.set(product.id, product);
  }

  const runningBaseStock = new Map<string, number>();
  const runningPackStock = new Map<string, number>();
  const movements: Array<Record<string, unknown>> = [];
  for (const [itemIndex, item] of items.entries()) {
    const productId = item.productId ?? item.product_id;
    if (!productId) continue;
    const product = productsById.get(productId);
    if (!product) continue;
    const quantityBase = cancellationItemBaseQuantity(item);
    if (!(quantityBase > 0)) continue;
    const before = runningBaseStock.has(productId)
      ? runningBaseStock.get(productId)!
      : readNumber(product.stockBaseQty ?? product.stockQuantity, 0);
    const after = roundMoney(before + quantityBase);
    runningBaseStock.set(productId, after);

    const sellingUnitId = item.sellingUnitId ?? item.selling_unit_id;
    if (product.packagingMode === "per_pack" && sellingUnitId) {
      const sellingUnit = product.sellingUnits?.find((unit) => unit.id === sellingUnitId);
      if (sellingUnit) {
        const key = `${productId}:${sellingUnitId}`;
        const packBefore = runningPackStock.has(key)
          ? runningPackStock.get(key)!
          : readNumber(sellingUnit.onHandQty, 0);
        runningPackStock.set(key, roundMoney(packBefore + Math.abs(readNumber(item.quantity, 0))));
      }
    }

    movements.push(makeLocalEntity({
      id: stableCancellationId("stock_cancel", bill, `_${itemIndex}`),
      productId,
      product_id: productId,
      productName: product.name ?? item.name ?? "Product",
      product_name: product.name ?? item.name ?? "Product",
      type: "cancel_reversal",
      action: "cancel_reversal",
      quantityDelta: quantityBase,
      quantity_delta: quantityBase,
      stockBefore: before,
      stock_before: before,
      stockAfter: after,
      stock_after: after,
      reference_type: "bill",
      reference_id: bill.id,
      billId: bill.id,
      bill_id: bill.id,
      note: `Cancelled ${billNumberOf(bill)}`,
      createdAt: now,
    }, "inventory_movement", "pending_sync") as unknown as Record<string, unknown>);
  }

  const products = [...productsById.values()]
    .filter((product) => runningBaseStock.has(product.id))
    .map((product) => {
      const nextStock = runningBaseStock.get(product.id)!;
      const sellingUnits = product.packagingMode === "per_pack"
        ? product.sellingUnits?.map((unit) => {
            if (!unit.id) return unit;
            const nextPackStock = runningPackStock.get(`${product.id}:${unit.id}`);
            return nextPackStock === undefined ? unit : { ...unit, onHandQty: nextPackStock };
          })
        : product.sellingUnits;
      return {
        ...product,
        sellingUnits,
        stockBaseQty: nextStock,
        stockQuantity: nextStock,
        updatedAt: now,
        updated_at: now,
        sync_status: "pending_sync",
        negativeStockWarning: nextStock < 0 ? `Stock remains negative after cancelling ${billNumberOf(bill)}.` : undefined,
        stockNeedsReview: nextStock < 0,
      } as Product & Record<string, unknown>;
    });

  return { products, movements };
}

function buildCancellationLedgerCorrection(bill: Bill & Record<string, unknown>, reason: string | undefined, now: string) {
  const credit = billCreditAmountOf(bill);
  const customerId = billCustomerIdOf(bill);
  if (credit <= 0 || !customerId) return null;
  return makeLocalEntity({
    id: stableCancellationId("ledger_cancel", bill),
    customerId,
    customer_id: customerId,
    customerName: bill.customerName ?? bill.customer_name ?? null,
    type: "bill_cancel_correction",
    source_type: "bill",
    source_id: bill.id,
    billId: bill.id,
    bill_id: bill.id,
    amount: -Math.abs(credit),
    note: reason || `Cancelled ${billNumberOf(bill)}`,
    entry_at: now,
    createdAt: now,
    created_at: now,
  }, "ledger_entry", "pending_sync");
}

export async function cancelBillWithOwnerPinLocalFirst(id: string, ownerPin: string, reason?: string): Promise<Bill> {
  parseOrThrow(ownerPinRequiredActionSchema, { action: "cancel_bill", ownerPin, entityId: id, reason });
  const existing = await findBill(id);
  if (!existing) throw new Error("Bill not found in local records");
  if (String(existing.status).toLowerCase() === "cancelled") return existing;
  if (String(existing.billType).toLowerCase() === "sales_return") {
    throw new Error("A completed sale return cannot be cancelled from the bill screen");
  }
  const localBills = await offlineDB.getAll<Bill & Record<string, unknown>>("bills").catch(() => []);
  const hasActiveReturn = localBills.some((candidate) =>
    String(candidate.billType).toLowerCase() === "sales_return" &&
    String(candidate.status).toLowerCase() !== "cancelled" &&
    (candidate.returnOfBillId === existing.id || candidate.return_of_bill_id === existing.id),
  );
  if (hasActiveReturn) throw new Error("This bill has completed returns and can no longer be cancelled");

  const now = new Date().toISOString();
  const updated = {
    ...existing,
    status: "cancelled",
    cancelledAt: now,
    cancelled_at: now,
    cancelledReason: reason?.trim() || null,
    cancelReason: reason?.trim() || null,
    updatedAt: now,
    updated_at: now,
    sync_status: "pending_sync" as const,
    isSynced: false,
    is_synced: false,
  } as Bill & Record<string, unknown>;
  const { products, movements } = await buildCancellationStockChanges(updated, now);
  const ledgerCorrection = buildCancellationLedgerCorrection(updated, reason, now);
  const customerId = billCustomerIdOf(updated);
  const creditAmount = billCreditAmountOf(updated);
  const customer = ledgerCorrection && customerId
    ? (await offlineDB.getAll<Customer & Record<string, unknown>>("customers").catch(() => []))
      .find((row) => row.id === customerId || row.local_id === customerId || row.server_id === customerId)
    : undefined;
  const updatedCustomer = customer && ledgerCorrection
    ? {
        ...customer,
        udharAmount: Math.max(0, roundMoney(readNumber(customer.udharAmount ?? customer.udhar_amount ?? customer.totalUdhar ?? customer.total_udhar, 0) - creditAmount)),
        udhar_amount: Math.max(0, roundMoney(readNumber(customer.udharAmount ?? customer.udhar_amount ?? customer.totalUdhar ?? customer.total_udhar, 0) - creditAmount)),
        totalUdhar: Math.max(0, roundMoney(readNumber(customer.udharAmount ?? customer.udhar_amount ?? customer.totalUdhar ?? customer.total_udhar, 0) - creditAmount)),
        total_udhar: Math.max(0, roundMoney(readNumber(customer.udharAmount ?? customer.udhar_amount ?? customer.totalUdhar ?? customer.total_udhar, 0) - creditAmount)),
        updatedAt: now,
        updated_at: now,
        sync_status: "pending_sync" as const,
      }
    : null;
  const auditRow = buildAuditLogRow({
    action: "bill_cancelled",
    entityType: "bill",
    entityId: updated.id,
    entityLabel: billNumberOf(updated),
    oldValue: existing,
    newValue: updated,
    reason,
    ownerPinProvided: true,
    summary: `bill cancelled ${billNumberOf(updated)}`,
  });
  const cancelOutbox = buildOutboxOperation({
    entity_type: "bill",
    entity_id: updated.id,
    operation_type: "CANCEL_BILL_PENDING",
    idempotency_key: `cancel-bill:${updated.local_id ?? updated.id}`,
    payload: { billId: updated.id, localBillId: updated.local_id ?? updated.id, serverBillId: updated.server_id ?? null, reason: reason ?? null, ownerPin, ownerPinProvided: true },
  });
  const auditOutbox = buildOutboxOperation(buildAuditLogOutboxInput(auditRow));

  await offlineDB.transaction([
    "bills",
    "products",
    "inventory_movements",
    "customers",
    "customer_ledger",
    "local_audit_logs",
    "sync_outbox",
  ], async (tx) => {
    await tx.put("bills", updated);
    await tx.putMany("products", products);
    await tx.putMany("inventory_movements", movements);
    if (updatedCustomer) await tx.put("customers", updatedCustomer);
    if (ledgerCorrection) await tx.put("customer_ledger", ledgerCorrection);
    await tx.put("local_audit_logs", auditRow);
    await tx.enqueueOutboxOperation(cancelOutbox);
    await tx.enqueueOutboxOperation(auditOutbox);
  });

  updateBillCache(updated);
  for (const product of products) {
    upsertCachedListItem("products", product, 1000);
    upsertCachedListItem("inventory", product, 1000);
    emitLocalDataChanged({ type: "product", id: product.id, action: "stock-updated" });
  }
  if (updatedCustomer) upsertCachedListItem<Customer & Record<string, unknown>>(CUSTOMER_CACHE_KEY, updatedCustomer, 1000);
  if (ledgerCorrection) {
    upsertCachedListItem("customer_ledger", ledgerCorrection, 1500);
    emitLocalDataChanged({ type: "ledger", id: ledgerCorrection.id, customerId, action: "appended" });
  }
  emitLocalDataChanged({ type: "bill", id: updated.id, action: "cancelled" });
  return updated;
}

export async function softDeleteBillWithOwnerPinLocalFirst(id: string, ownerPin: string, reason?: string): Promise<Bill> {
  parseOrThrow(ownerPinRequiredActionSchema, { action: "delete_bill", ownerPin, entityId: id, reason });
  const existing = await findBill(id);
  if (!existing) throw new Error("Bill not found in local records");
  const now = new Date().toISOString();
  const updated = {
    ...existing,
    deleted_at: now,
    deletedAt: now,
    deleteReason: reason?.trim() || null,
    updatedAt: now,
    updated_at: now,
    sync_status: "pending_sync" as const,
    isSynced: false,
    is_synced: false,
  } as Bill & Record<string, unknown>;
  const auditRow = buildBillAudit("soft_delete_bill", updated, ownerPin, reason, existing);
  const auditOutbox = buildOutboxOperation(buildAuditLogOutboxInput(auditRow));
  const deleteOutbox = buildOutboxOperation({
    entity_type: "bill",
    entity_id: updated.id,
    operation_type: "SOFT_DELETE_BILL_PENDING",
    idempotency_key: `soft-delete-bill:${updated.local_id ?? updated.id}:${now}`,
    payload: { billId: updated.id, localBillId: updated.local_id ?? updated.id, serverBillId: updated.server_id ?? null, reason: reason ?? null, ownerPin, ownerPinProvided: true },
  });
  await offlineDB.transaction(["bills", "local_audit_logs", "sync_outbox"], async (tx) => {
    await tx.put("bills", updated);
    await tx.put("local_audit_logs", auditRow);
    await tx.enqueueOutboxOperation(auditOutbox);
    await tx.enqueueOutboxOperation(deleteOutbox);
  });
  updateBillCache(updated);
  emitLocalDataChanged({ type: "bill", id: updated.id, action: "soft_deleted" });
  return updated;
}

export async function restoreBillWithOwnerPinLocalFirst(id: string, ownerPin: string, reason?: string): Promise<Bill> {
  parseOrThrow(ownerPinRequiredActionSchema, { action: "restore_from_recycle_bin", ownerPin, entityId: id, reason });
  const existing = await findBill(id);
  if (!existing) throw new Error("Bill not found in local records");
  const now = new Date().toISOString();
  const updated = {
    ...existing,
    deleted_at: null,
    deletedAt: null,
    restoreReason: reason?.trim() || null,
    updatedAt: now,
    updated_at: now,
    sync_status: "pending_sync" as const,
    isSynced: false,
    is_synced: false,
  } as Bill & Record<string, unknown>;
  const auditRow = buildBillAudit("restore_bill", updated, ownerPin, reason, existing);
  const auditOutbox = buildOutboxOperation(buildAuditLogOutboxInput(auditRow));
  const restoreOutbox = buildOutboxOperation({
    entity_type: "bill",
    entity_id: updated.id,
    operation_type: "RESTORE_BILL_PENDING",
    idempotency_key: `restore-bill:${updated.local_id ?? updated.id}:${now}`,
    payload: { billId: updated.id, localBillId: updated.local_id ?? updated.id, serverBillId: updated.server_id ?? null, reason: reason ?? null, ownerPin, ownerPinProvided: true },
  });
  await offlineDB.transaction(["bills", "local_audit_logs", "sync_outbox"], async (tx) => {
    await tx.put("bills", updated);
    await tx.put("local_audit_logs", auditRow);
    await tx.enqueueOutboxOperation(auditOutbox);
    await tx.enqueueOutboxOperation(restoreOutbox);
  });
  updateBillCache(updated);
  emitLocalDataChanged({ type: "bill", id: updated.id, action: "restored" });
  return updated;
}

export function isDeletedBill(value: unknown) {
  return isRecord(value) && (typeof value.deleted_at === "string" || typeof value.deletedAt === "string");
}

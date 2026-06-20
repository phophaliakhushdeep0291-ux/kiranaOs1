import { offlineDB } from "@/lib/offline/db";
import { getOfflineScope } from "@/lib/offline/context";
import {
  createLocalId,
  emitLocalDataChanged,
  readInstantCache,
  upsertCachedListItem,
} from "@/lib/offline/instant-cache";
import { buildOutboxOperation } from "@/features/sync/outbox";
import { makeLocalEntity, readNumber, roundMoney } from "@/lib/offline/actions/utils";
import { normaliseLocalCustomer } from "@/features/customers/local-actions";
import { buildAuditLogOutboxInput, buildAuditLogRow } from "@/features/audit-logs/local-actions";
import type { Bill, Customer, Product } from "@/types/api";

const BILL_CACHE_KEY = "bills";
const CUSTOMER_CACHE_KEY = "customers";

export type RefundMode = "cash" | "upi" | "udhar";

export interface SaleReturnItemInput {
  productId?: string;
  name: string;
  quantity: number;
  enteredUnit: string;
  ratePerRateUnit: number;
  gstRate?: number;
  damaged?: boolean;
}

export interface SaleReturnInput {
  items: SaleReturnItemInput[];
  refundMode: RefundMode;
  gstMode?: "inclusive" | "exclusive" | "none";
  customerId?: string;
  customerName?: string;
  customerMobile?: string;
  originalBillId?: string;
  ownerPin: string;
  reason?: string;
}

const RETURN_TRANSACTION_TABLES = [
  "bills",
  "bill_items",
  "payments",
  "customer_ledger",
  "inventory_movements",
  "customers",
  "local_audit_logs",
  "sync_outbox",
];

function lineGstAmount(lineTotal: number, gstRate: number, gstMode: string): number {
  if (gstRate <= 0 || gstMode === "none") return 0;
  if (gstMode === "exclusive") return roundMoney((lineTotal * gstRate) / 100);
  return roundMoney(lineTotal - lineTotal / (1 + gstRate / 100));
}

function findCachedProduct(productId: string | undefined): Product | undefined {
  if (!productId) return undefined;
  return readInstantCache<Product[]>("products", []).find((p) => p.id === productId);
}

/**
 * Records a sales return locally-first. A return is a Bill with billType
 * "sales_return" and NEGATIVE amounts (so every report that sums bills reverses
 * the original sale). Resellable items are restocked via an inventory movement;
 * damaged items become a damage write-off. The refund goes out as a negative
 * payment row (cash/upi) or reduces the customer's udhar ledger. The full request
 * is queued as a CREATE_SALE_RETURN outbox op; the server recomputes authoritative
 * money/stock on sync. Owner PIN is required (re-verified server-side).
 */
export async function createSaleReturnLocalFirst(input: SaleReturnInput): Promise<Bill> {
  const items = (input.items ?? []).filter((item) => readNumber(item.quantity, 0) > 0);
  if (items.length === 0) throw new Error("Add at least one item to return");

  const refundMode: RefundMode = ["cash", "upi", "udhar"].includes(input.refundMode) ? input.refundMode : "cash";
  if (!/^\d{4}$/.test(String(input.ownerPin ?? ""))) {
    const err = new Error("Owner PIN (4 digits) is required to process a return");
    (err as Error & { code?: string }).code = "OWNER_PIN_REQUIRED";
    throw err;
  }
  if (refundMode === "udhar" && !input.customerId) {
    throw new Error("Select a customer to refund a return to udhar");
  }

  const gstMode = input.gstMode ?? "inclusive";
  const isCashLike = refundMode === "cash" || refundMode === "upi";
  const now = new Date().toISOString();
  const scope = getOfflineScope();
  const billId = createLocalId("bill");
  const idempotencyKey = `sale-return:${scope.tenant_id}:${scope.store_id}:${scope.device_id}:${billId}`;

  // ── Compute amounts (NEGATIVE — reverses the sale). Server recomputes authoritatively. ──
  let subtotal = 0;
  let totalGst = 0;
  let itemProfit = 0;
  const billItems = items.map((item) => {
    const product = findCachedProduct(item.productId);
    const qty = readNumber(item.quantity, 0);
    const rate = readNumber(item.ratePerRateUnit, 0);
    const gstRate = readNumber(item.gstRate ?? product?.gstRate, 0);
    const cost = readNumber((product as { costPerRateUnit?: number } | undefined)?.costPerRateUnit, 0);
    const lineTotal = roundMoney(qty * rate);
    const lineCost = roundMoney(qty * cost);
    const lineProfit = roundMoney(lineTotal - lineCost);
    subtotal = roundMoney(subtotal + lineTotal);
    totalGst = roundMoney(totalGst + lineGstAmount(lineTotal, gstRate, gstMode));
    itemProfit = roundMoney(itemProfit + lineProfit);
    return makeLocalEntity({
      id: createLocalId("bill_item"),
      billId,
      bill_id: billId,
      productId: item.productId ?? null,
      product_id: item.productId ?? null,
      name: item.name,
      quantity: -Math.abs(qty),
      enteredUnit: item.enteredUnit,
      entered_unit: item.enteredUnit,
      ratePerRateUnit: rate,
      rate_per_rate_unit: rate,
      gstRate,
      gst_rate: gstRate,
      lineTotal: -lineTotal,
      line_total: -lineTotal,
      damaged: item.damaged === true,
      createdAt: now,
    }, "bill_item", "pending_sync");
  });

  const grandTotalMagnitude = gstMode === "exclusive" ? roundMoney(subtotal + totalGst) : subtotal;
  const refundAmount = roundMoney(grandTotalMagnitude);

  // Resolve customer (for udhar refund) from cache; reduce local balance immediately.
  const cachedCustomers = readInstantCache<Customer[]>(CUSTOMER_CACHE_KEY, []).map(normaliseLocalCustomer) as Array<Customer & Record<string, unknown>>;
  const existingCustomer = input.customerId
    ? cachedCustomers.find((c) => c.id === input.customerId || c.local_id === input.customerId || c.server_id === input.customerId)
    : undefined;

  const negativeBill = makeLocalEntity({
    id: billId,
    billNo: `RET-${billId.slice(-6).toUpperCase()}`,
    billNumber: `RET-${billId.slice(-6).toUpperCase()}`,
    billType: "sales_return",
    status: "pending_sync",
    isSynced: false,
    is_synced: false,
    clientBillId: billId,
    client_bill_id: billId,
    localBillId: billId,
    local_bill_id: billId,
    idempotencyKey,
    idempotency_key: idempotencyKey,
    returnOfBillId: input.originalBillId ?? null,
    customerId: input.customerId ?? existingCustomer?.id ?? null,
    customerName: input.customerName ?? existingCustomer?.name ?? "Walk-in",
    customerMobile: input.customerMobile ?? (existingCustomer?.mobile as string | undefined) ?? null,
    subtotal: -subtotal,
    discount: 0,
    gst: -totalGst,
    gstMode,
    grandTotal: -grandTotalMagnitude,
    totalAmount: -grandTotalMagnitude,
    netAmount: -grandTotalMagnitude,
    grossProfit: -itemProfit,
    paidAmount: isCashLike ? -refundAmount : 0,
    buyerPaidAmount: isCashLike ? -refundAmount : 0,
    creditAmount: refundMode === "udhar" ? -refundAmount : 0,
    paymentMode: refundMode,
    refundMode,
    createdAt: now,
  }, "bill", "pending_sync");

  // Refund payment row (cash/upi) — negative so cash collected nets down.
  const paymentRows = isCashLike
    ? [makeLocalEntity({
        id: createLocalId("payment"),
        billId,
        bill_id: billId,
        localBillId: billId,
        customerId: negativeBill.customerId,
        mode: refundMode,
        amount: -refundAmount,
        paidAt: now,
        paid_at: now,
        createdAt: now,
        status: "active",
      }, "payment", "pending_sync")]
    : [];

  // Inventory movements: restock resellable items (+qty); damaged -> damage write-off.
  const movements = items
    .filter((item) => item.productId)
    .map((item) => {
      const qty = Math.abs(readNumber(item.quantity, 0));
      const damaged = item.damaged === true;
      return makeLocalEntity({
        id: createLocalId(damaged ? "stock_damage" : "stock_return"),
        productId: item.productId,
        product_id: item.productId,
        type: damaged ? "damage" : "return",
        action: damaged ? "damage" : "return",
        quantityDelta: damaged ? 0 : qty,
        quantity_delta: damaged ? 0 : qty,
        unit: item.enteredUnit,
        reference_type: "bill",
        reference_id: billId,
        billId,
        note: `Sale return ${negativeBill.billNo}${damaged ? " (damaged)" : ""}`,
        createdAt: now,
      }, "inventory_movement", "pending_sync");
    });

  // Udhar refund: reduce the customer's outstanding balance locally + ledger entry.
  let updatedCustomer: (Customer & Record<string, unknown>) | undefined;
  let udharLedgerEntry: (Record<string, unknown> & { id: string }) | undefined;
  if (refundMode === "udhar" && existingCustomer) {
    const previousBalance = readNumber(existingCustomer.udharAmount ?? existingCustomer.totalUdhar, 0);
    const nextBalance = roundMoney(Math.max(0, previousBalance - refundAmount));
    updatedCustomer = normaliseLocalCustomer({
      ...existingCustomer,
      udharAmount: nextBalance,
      totalUdhar: nextBalance,
      updatedAt: now,
    }) as Customer & Record<string, unknown>;
    updatedCustomer.updated_at = now;
    updatedCustomer.sync_status = "pending_sync";
    const ledgerId = `ledger_${billId}_return`;
    udharLedgerEntry = makeLocalEntity({
      id: ledgerId,
      customerId: existingCustomer.id,
      customer_id: existingCustomer.id,
      type: "PAYMENT",
      source_type: "bill",
      source_id: billId,
      billId,
      bill_id: billId,
      amount: refundAmount,
      balance_after: nextBalance,
      mode: "return",
      paymentMode: "return",
      note: `Sale return refund: ${negativeBill.billNo}`,
      entry_at: now,
      createdAt: now,
      created_at: now,
    }, "ledger_entry", "pending_sync") as unknown as Record<string, unknown> & { id: string };
  }

  const auditLog = buildAuditLogRow({
    action: "sale_return",
    entityType: "bill",
    entityId: billId,
    entityLabel: negativeBill.billNo,
    newValue: negativeBill,
    ownerPinProvided: true,
    reason: input.reason ?? `Sale return (${refundMode})`,
    summary: `Sale return ${negativeBill.billNo} for ₹${refundAmount.toLocaleString("en-IN")} (${refundMode})`,
  });

  const outbox = buildOutboxOperation({
    entity_type: "bill",
    entity_id: billId,
    operation_type: "CREATE_SALE_RETURN",
    idempotency_key: idempotencyKey,
    payload: {
      localBillId: billId,
      clientBillId: billId,
      idempotencyKey,
      // NOTE: do NOT put the device id in the payload — "device_…" matches a local-id
      // prefix and collectUnmappedLocalIds would treat it as an unresolved dependency
      // and block the push. The device id rides on the outbox event's device_id field.
      returnOfBillId: input.originalBillId ?? null,
      originalBillId: input.originalBillId ?? null,
      refundMode,
      gstMode,
      customerId: input.customerId ?? null,
      customerName: negativeBill.customerName,
      customerMobile: negativeBill.customerMobile,
      ownerPin: input.ownerPin,
      reason: input.reason ?? null,
      items: items.map((item) => ({
        productId: item.productId ?? null,
        localProductId: item.productId ?? null,
        name: item.name,
        quantity: Math.abs(readNumber(item.quantity, 0)),
        enteredUnit: item.enteredUnit,
        ratePerRateUnit: readNumber(item.ratePerRateUnit, 0),
        gstRate: readNumber(item.gstRate ?? findCachedProduct(item.productId)?.gstRate, 0),
        damaged: item.damaged === true,
      })),
    },
  });

  const auditOutbox = buildOutboxOperation(buildAuditLogOutboxInput(auditLog));

  await offlineDB.transaction(RETURN_TRANSACTION_TABLES, async (tx) => {
    await tx.put("bills", negativeBill);
    await tx.putMany("bill_items", billItems);
    if (paymentRows.length) await tx.putMany("payments", paymentRows);
    if (movements.length) await tx.putMany("inventory_movements", movements);
    if (updatedCustomer) await tx.put("customers", updatedCustomer);
    if (udharLedgerEntry) await tx.put("customer_ledger", udharLedgerEntry);
    await tx.put("local_audit_logs", auditLog);
    await tx.enqueueOutboxOperation(auditOutbox);
    await tx.enqueueOutboxOperation(outbox);
  });

  upsertCachedListItem<Bill>(BILL_CACHE_KEY, negativeBill as unknown as Bill, 500);
  if (updatedCustomer) upsertCachedListItem<Customer>(CUSTOMER_CACHE_KEY, updatedCustomer, 1000);
  if (udharLedgerEntry) upsertCachedListItem("customer_ledger", udharLedgerEntry, 1500);
  emitLocalDataChanged({ type: "bill", id: billId, action: "created" });
  if (udharLedgerEntry) emitLocalDataChanged({ type: "ledger", id: udharLedgerEntry.id, customerId: input.customerId, action: "appended" });

  return negativeBill as unknown as Bill;
}

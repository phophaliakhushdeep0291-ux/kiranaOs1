import { roundMoney } from "@/lib/money";
import { dexieDB, rowMatchesCurrentScope, type PendingSyncEvent } from "@/lib/offline/db";
import { getOfflineScope } from "@/lib/offline/context";
import { tableNameForEntity } from "@/features/sync/sync-types";

export const LOCAL_ONLY_SYNC_OPERATION_TYPES = new Set([
  "AUDIT_LOG_APPEND",
  "SUBSCRIPTION_REFRESH",
  "UPDATE_SETTINGS",
  "STAFF_ACTION",
  "DEVICE_ADD_PENDING",
  "DEVICE_REMOVE_PENDING",
]);

const BACKEND_OPERATION_TYPE_MAP: Record<string, string> = {
  CANCEL_BILL_PENDING: "CANCEL_BILL",
  RESTORE_BILL_PENDING: "RESTORE_BILL",
  SOFT_DELETE_BILL_PENDING: "CANCEL_BILL",
  CREATE_SALE_RETURN: "SALE_RETURN",
  DELETE_PRODUCT_PENDING: "DELETE_PRODUCT",
  RESTORE_PRODUCT_PENDING: "RESTORE_PRODUCT",
  DELETE_CUSTOMER_PENDING: "DELETE_CUSTOMER",
  RESTORE_CUSTOMER_PENDING: "RESTORE_CUSTOMER",
  RECORD_PAYMENT: "UDHAR_PAYMENT",
  REVERSE_PAYMENT: "REVERSE_UDHAR_PAYMENT",
  CREATE_LEDGER_ADJUSTMENT: "CREATE_LEDGER_ADJUSTMENT",
  STOCK_PURCHASE: "STOCK_PURCHASE",
  STOCK_SALE: "STOCK_SALE",
  STOCK_DAMAGE: "ADJUST_STOCK",
  STOCK_CORRECTION: "ADJUST_STOCK",
  UPDATE_PURCHASE_BILL: "UPDATE_PURCHASE_BILL",
  DELETE_PURCHASE_BILL: "DELETE_PURCHASE_BILL",
  RECORD_SUPPLIER_PAYMENT: "RECORD_SUPPLIER_PAYMENT",
  REVERSE_SUPPLIER_PAYMENT: "REVERSE_SUPPLIER_PAYMENT",
};

const BACKEND_ENTITY_TYPE_MAP: Record<string, string> = {
  UDHAR_PAYMENT: "payment",
  CREATE_LEDGER_ADJUSTMENT: "ledger_entry",
  REVERSE_UDHAR_PAYMENT: "ledger_entry",
  STOCK_PURCHASE: "inventory_movement",
  STOCK_SALE: "inventory_movement",
  ADJUST_STOCK: "inventory_movement",
  UPDATE_PURCHASE_BILL: "purchase_history",
  DELETE_PURCHASE_BILL: "purchase_history",
  RECORD_SUPPLIER_PAYMENT: "payment",
  REVERSE_SUPPLIER_PAYMENT: "payment",
  DELETE_CUSTOMER: "customer",
  RESTORE_CUSTOMER: "customer",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNumber(value: unknown, fallback = 0): number {
  const n = Number(value ?? fallback);
  return Number.isFinite(n) ? n : fallback;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

export function backendOperationTypeFor(event: PendingSyncEvent): string {
  const raw = String(event.operation_type || event.type || "").trim();
  return BACKEND_OPERATION_TYPE_MAP[raw] ?? raw;
}

export function isLocalOnlySyncEvent(event: PendingSyncEvent): boolean {
  const raw = String(event.operation_type || event.type || "").trim();
  return LOCAL_ONLY_SYNC_OPERATION_TYPES.has(raw);
}

function normaliseStockPayload(
  backendType: string,
  rawType: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  if (backendType === "ADJUST_STOCK") {
    const movementType = String(
      payload.movementType ?? payload.adjustmentType ?? rawType,
    ).toLowerCase();
    const quantityDelta = readNumber(payload.quantityDelta ?? payload.quantity_delta, 0);
    const stockAfter = payload.nextStock ?? payload.stockAfter ?? payload.stock_after;
    const isDamage = movementType.includes("damage") || rawType === "STOCK_DAMAGE";
    return {
      ...payload,
      adjustmentType: isDamage ? "damage" : "correction",
      productId: payload.productId ?? payload.product_id,
      localProductId: payload.localProductId ?? payload.local_product_id,
      quantity: isDamage
        ? Math.abs(readNumber(payload.syncQuantityBase ?? payload.quantityBase ?? payload.quantity ?? quantityDelta, quantityDelta))
        : payload.quantity,
      enteredUnit: payload.syncEnteredUnit ?? payload.enteredUnit ?? payload.unit,
      newStockBaseQty: isDamage
        ? payload.newStockBaseQty
        : readNumber(payload.newStockBaseQty ?? stockAfter, readNumber(stockAfter, 0)),
      note: payload.note ?? payload.reason,
    };
  }

  if (backendType === "STOCK_PURCHASE" || backendType === "STOCK_SALE") {
    const purchaseFields = backendType === "STOCK_PURCHASE"
      ? normalisePurchaseMoneyFields(payload)
      : {};
    return {
      ...payload,
      ...purchaseFields,
      productId: payload.productId ?? payload.product_id,
      localProductId: payload.localProductId ?? payload.local_product_id,
      quantity: Math.abs(readNumber(payload.syncQuantityBase ?? payload.quantityBase ?? payload.quantity ?? payload.quantityDelta ?? payload.quantity_delta, 0)),
      enteredUnit: payload.syncEnteredUnit ?? payload.enteredUnit ?? payload.unit,
      note: payload.note ?? payload.reason,
    };
  }

  return payload;
}




function readOptionalNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (value === "" || value === null || value === undefined) continue;
    const numberValue = Number(value);
    if (Number.isFinite(numberValue)) return numberValue;
  }
  return undefined;
}

function normaliseDateOnly(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const raw = value.trim();
  if (!raw) return undefined;
  const direct = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (direct) return direct[1];
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return undefined;
}

function normalisePurchaseMoneyFields(payload: Record<string, unknown>): Record<string, unknown> {
  const billAmount = roundMoney(readNumber(
    payload.billAmount ?? payload.bill_amount ?? payload.purchaseBillAmount ?? payload.purchase_bill_amount,
    0,
  ));
  const paidInput = readOptionalNumber(
    payload.purchasePaidAmount,
    payload.purchase_paid_amount,
    payload.paidAmount,
    payload.paid_amount,
  );
  const initialStatus = String(payload.purchasePaymentStatus ?? payload.purchase_payment_status ?? "").toLowerCase();
  const paid = roundMoney(Math.max(0, Math.min(
    paidInput ?? (initialStatus === "paid" ? billAmount : 0),
    billAmount > 0 ? billAmount : Number.MAX_SAFE_INTEGER,
  )));
  const due = roundMoney(Math.max(0, billAmount - paid));
  const status = billAmount > 0 && paid >= billAmount - 0.01
    ? "paid"
    : paid > 0
      ? "partial"
      : "due";
  const dueDate = normaliseDateOnly(payload.purchaseDueDate ?? payload.purchase_due_date);

  return {
    purchasePaymentStatus: status,
    purchase_payment_status: status,
    purchasePaidAmount: paid,
    purchase_paid_amount: paid,
    purchaseDueAmount: due,
    purchase_due_amount: due,
    purchasePaymentMode: paid > 0 ? payload.purchasePaymentMode ?? payload.purchase_payment_mode : undefined,
    purchase_payment_mode: paid > 0 ? payload.purchasePaymentMode ?? payload.purchase_payment_mode : undefined,
    purchaseDueDate: due > 0 ? dueDate : undefined,
    purchase_due_date: due > 0 ? dueDate : undefined,
  };
}

function optionalPayloadText(value: unknown): string | null | undefined {
  const text = readString(value);
  if (!text) return undefined;
  return text;
}

function normalisePurchaseLifecyclePayload(
  event: PendingSyncEvent,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const money = normalisePurchaseMoneyFields(payload);
  const localPurchaseId =
    optionalPayloadText(payload.localPurchaseHistoryId) ??
    optionalPayloadText(payload.local_purchase_history_id) ??
    optionalPayloadText(payload.localPurchaseBillId) ??
    optionalPayloadText(payload.local_purchase_bill_id) ??
    optionalPayloadText(event.entity_id);
  const purchaseId =
    optionalPayloadText(payload.purchaseHistoryId) ??
    optionalPayloadText(payload.purchase_history_id) ??
    optionalPayloadText(payload.purchaseBillId) ??
    optionalPayloadText(payload.purchase_bill_id) ??
    optionalPayloadText(payload.serverId) ??
    optionalPayloadText(payload.server_id) ??
    undefined;
  const localMovementId =
    optionalPayloadText(payload.localMovementId) ??
    optionalPayloadText(payload.local_movement_id) ??
    optionalPayloadText(payload.localInventoryMovementId) ??
    optionalPayloadText(payload.local_inventory_movement_id) ??
    optionalPayloadText(payload.movementId) ??
    optionalPayloadText(payload.movement_id);
  const stockLedgerId =
    optionalPayloadText(payload.stockLedgerId) ??
    optionalPayloadText(payload.stock_ledger_id) ??
    optionalPayloadText(payload.inventoryMovementId) ??
    optionalPayloadText(payload.inventory_movement_id);

  return {
    ...payload,
    ...money,
    purchaseHistoryId: purchaseId,
    purchase_history_id: purchaseId,
    purchaseBillId: optionalPayloadText(payload.purchaseBillId) ?? optionalPayloadText(payload.purchase_bill_id) ?? purchaseId,
    purchase_bill_id: optionalPayloadText(payload.purchaseBillId) ?? optionalPayloadText(payload.purchase_bill_id) ?? purchaseId,
    localPurchaseHistoryId: localPurchaseId,
    local_purchase_history_id: localPurchaseId,
    localPurchaseBillId: optionalPayloadText(payload.localPurchaseBillId) ?? optionalPayloadText(payload.local_purchase_bill_id) ?? localPurchaseId,
    local_purchase_bill_id: optionalPayloadText(payload.localPurchaseBillId) ?? optionalPayloadText(payload.local_purchase_bill_id) ?? localPurchaseId,
    stockLedgerId,
    stock_ledger_id: stockLedgerId,
    inventoryMovementId: optionalPayloadText(payload.inventoryMovementId) ?? optionalPayloadText(payload.inventory_movement_id) ?? stockLedgerId,
    inventory_movement_id: optionalPayloadText(payload.inventoryMovementId) ?? optionalPayloadText(payload.inventory_movement_id) ?? stockLedgerId,
    localMovementId,
    local_movement_id: localMovementId,
    productId: optionalPayloadText(payload.productId) ?? optionalPayloadText(payload.product_id),
    product_id: optionalPayloadText(payload.productId) ?? optionalPayloadText(payload.product_id),
    supplierId: optionalPayloadText(payload.supplierId) ?? optionalPayloadText(payload.supplier_id),
    supplier_id: optionalPayloadText(payload.supplierId) ?? optionalPayloadText(payload.supplier_id),
    supplierName: optionalPayloadText(payload.supplierName) ?? optionalPayloadText(payload.supplier_name) ?? null,
    supplier_name: optionalPayloadText(payload.supplierName) ?? optionalPayloadText(payload.supplier_name) ?? null,
    invoiceNumber: optionalPayloadText(payload.invoiceNumber) ?? optionalPayloadText(payload.invoice_number) ?? null,
    invoice_number: optionalPayloadText(payload.invoiceNumber) ?? optionalPayloadText(payload.invoice_number) ?? null,
    purchasePaymentMode:
      money.purchasePaidAmount && Number(money.purchasePaidAmount) > 0
        ? optionalPayloadText(payload.purchasePaymentMode) ?? optionalPayloadText(payload.purchase_payment_mode) ?? "cash"
        : null,
    purchase_payment_mode:
      money.purchasePaidAmount && Number(money.purchasePaidAmount) > 0
        ? optionalPayloadText(payload.purchasePaymentMode) ?? optionalPayloadText(payload.purchase_payment_mode) ?? "cash"
        : null,
  };
}

function isCreditPayment(payment: unknown): boolean {
  return isRecord(payment) && String(payment.mode ?? "").toLowerCase() === "credit";
}

function normaliseCreateBillPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const paymentBreakdown = payload.paymentBreakdown ?? payload.payment_breakdown;
  const originalPayments = Array.isArray(paymentBreakdown)
    ? paymentBreakdown.filter(isRecord)
    : Array.isArray(payload.payments)
      ? payload.payments.filter(isRecord)
      : [];
  const realTenderPayments = originalPayments.filter((payment) => !isCreditPayment(payment));
  const creditPayments = originalPayments.filter(isCreditPayment);
  const paidAmount = roundMoney(realTenderPayments.reduce((sum, payment) => sum + readNumber(payment.amount, 0), 0));
  const creditAmount = roundMoney(
    readNumber(
      payload.creditAmount ?? payload.credit_amount,
      creditPayments.reduce((sum, payment) => sum + readNumber(payment.amount, 0), 0),
    ),
  );
  const grandTotal = readNumber(
    payload.actualAmount ?? payload.grandTotal ?? payload.grand_total ?? payload.totalAmount ?? payload.total_amount,
    paidAmount + creditAmount,
  );

  return {
    ...payload,
    // Backend payment rows must represent only real money received.
    // Credit/udhar is debt, not cash/UPI collection. Keeping credit inside
    // `payments` makes some backends mark the bill fully paid.
    payments: realTenderPayments,
    tenderPayments: realTenderPayments,
    tender_payments: realTenderPayments,
    paymentBreakdown: originalPayments,
    payment_breakdown: originalPayments,
    creditPayments,
    credit_payments: creditPayments,
    paidAmount,
    paid_amount: paidAmount,
    buyerPaidAmount: paidAmount,
    buyer_paid_amount: paidAmount,
    creditAmount,
    credit_amount: creditAmount,
    dueAmount: roundMoney(Math.max(0, grandTotal - paidAmount)),
    due_amount: roundMoney(Math.max(0, grandTotal - paidAmount)),
    paymentStatus: creditAmount > 0 ? (paidAmount > 0 ? "partial" : "credit") : "paid",
    payment_status: creditAmount > 0 ? (paidAmount > 0 ? "partial" : "credit") : "paid",
  };
}

function normalisePaymentPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const payment = isRecord(payload.payment) ? payload.payment : {};
  const paymentId = readString(payload.paymentId) ?? readString(payload.payment_id) ?? readString(payment.paymentId) ?? readString(payment.payment_id);
  const localPaymentId =
    readString(payload.localPaymentId) ??
    readString(payload.local_payment_id) ??
    readString(payment.localPaymentId) ??
    readString(payment.local_payment_id) ??
    paymentId;
  const clientPaymentId =
    readString(payload.clientPaymentId) ??
    readString(payload.client_payment_id) ??
    readString(payment.clientPaymentId) ??
    readString(payment.client_payment_id) ??
    localPaymentId;
  const ledgerEntryId =
    readString(payload.ledgerEntryId) ??
    readString(payload.ledger_entry_id) ??
    readString(payment.ledgerEntryId) ??
    readString(payment.ledger_entry_id);
  const localLedgerEntryId =
    readString(payload.localLedgerEntryId) ??
    readString(payload.local_ledger_entry_id) ??
    readString(payment.localLedgerEntryId) ??
    readString(payment.local_ledger_entry_id) ??
    ledgerEntryId;
  const clientLedgerId =
    readString(payload.clientLedgerId) ??
    readString(payload.client_ledger_id) ??
    readString(payment.clientLedgerId) ??
    readString(payment.client_ledger_id) ??
    localLedgerEntryId ??
    ledgerEntryId ??
    clientPaymentId;
  const idempotencyKey =
    readString(payload.idempotencyKey) ??
    readString(payload.idempotency_key) ??
    readString(payment.idempotencyKey) ??
    readString(payment.idempotency_key);
  const sourceDeviceId =
    readString(payload.sourceDeviceId) ??
    readString(payload.source_device_id) ??
    readString(payment.sourceDeviceId) ??
    readString(payment.source_device_id);
  return {
    ...payload,
    customerId: payload.customerId ?? payload.customer_id,
    localCustomerId: payload.localCustomerId ?? payload.local_customer_id,
    ...(paymentId ? { paymentId, payment_id: paymentId } : {}),
    ...(localPaymentId ? { localPaymentId, local_payment_id: localPaymentId } : {}),
    ...(clientPaymentId ? { clientPaymentId, client_payment_id: clientPaymentId } : {}),
    ...(ledgerEntryId ? { ledgerEntryId, ledger_entry_id: ledgerEntryId } : {}),
    ...(localLedgerEntryId ? { localLedgerEntryId, local_ledger_entry_id: localLedgerEntryId } : {}),
    ...(clientLedgerId ? { clientLedgerId, client_ledger_id: clientLedgerId } : {}),
    ...(idempotencyKey ? { idempotencyKey, idempotency_key: idempotencyKey } : {}),
    ...(sourceDeviceId ? { sourceDeviceId, source_device_id: sourceDeviceId } : {}),
    amount: payload.amount ?? payment.amount,
    mode: payload.mode ?? payment.mode,
    note: payload.note ?? payment.note,
    payment: {
      ...payment,
      ...(paymentId ? { paymentId, payment_id: paymentId } : {}),
      ...(localPaymentId ? { localPaymentId, local_payment_id: localPaymentId } : {}),
      ...(clientPaymentId ? { clientPaymentId, client_payment_id: clientPaymentId } : {}),
      ...(ledgerEntryId ? { ledgerEntryId, ledger_entry_id: ledgerEntryId } : {}),
      ...(localLedgerEntryId ? { localLedgerEntryId, local_ledger_entry_id: localLedgerEntryId } : {}),
      ...(clientLedgerId ? { clientLedgerId, client_ledger_id: clientLedgerId } : {}),
      ...(idempotencyKey ? { idempotencyKey, idempotency_key: idempotencyKey } : {}),
      ...(sourceDeviceId ? { sourceDeviceId, source_device_id: sourceDeviceId } : {}),
      amount: payload.amount ?? payment.amount,
      mode: payload.mode ?? payment.mode,
      note: payload.note ?? payment.note,
    },
  };
}

function normaliseBillLifecyclePayload(
  backendType: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  if (backendType !== "CANCEL_BILL" && backendType !== "RESTORE_BILL") return payload;
  return {
    ...payload,
    billId: payload.serverBillId ?? payload.billId ?? payload.localBillId ?? payload.id,
    localBillId: payload.localBillId ?? payload.billId ?? payload.id,
    reason: payload.reason ?? (backendType === "RESTORE_BILL" ? "Offline restore sync" : "Offline cancellation sync"),
  };
}

function normaliseCustomerLifecyclePayload(
  backendType: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  if (backendType !== "DELETE_CUSTOMER" && backendType !== "RESTORE_CUSTOMER") return payload;
  return {
    ...payload,
    customerId: payload.serverCustomerId ?? payload.customerId ?? payload.localCustomerId ?? payload.id,
    localCustomerId: payload.localCustomerId ?? payload.customerId ?? payload.id,
    reason: payload.reason ?? (backendType === "RESTORE_CUSTOMER" ? "Offline customer restore sync" : "Offline customer delete sync"),
  };
}

function normaliseProductLifecyclePayload(
  backendType: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  if (backendType !== "DELETE_PRODUCT" && backendType !== "RESTORE_PRODUCT") return payload;
  return {
    ...payload,
    productId: payload.serverProductId ?? payload.productId ?? payload.localProductId ?? payload.id,
    localProductId: payload.localProductId ?? payload.productId ?? payload.id,
    reason: payload.reason ?? (backendType === "RESTORE_PRODUCT" ? "Offline product restore sync" : "Offline product delete sync"),
  };
}

function normaliseLedgerPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return {
    ...payload,
    ledgerEntryId: payload.ledgerEntryId ?? payload.ledger_entry_id ?? payload.correctionId ?? payload.id,
    customerId: payload.customerId ?? payload.customer_id,
    localCustomerId: payload.localCustomerId ?? payload.local_customer_id,
    amount: payload.amount,
    note: payload.note ?? payload.reason,
    ownerPin: payload.ownerPin,
  };
}

export interface BackendSyncOperationShape {
  type: string;
  operation_type: string;
  entity_type: string;
  payload: Record<string, unknown>;
}

export function buildBackendSyncOperation(
  event: PendingSyncEvent,
  resolvedPayload: unknown,
): BackendSyncOperationShape | null {
  if (isLocalOnlySyncEvent(event)) return null;

  const rawType = String(event.operation_type || event.type || "").trim();
  const backendType = backendOperationTypeFor(event);
  const basePayload = isRecord(resolvedPayload) ? resolvedPayload : {};
  let payload = basePayload;

  if (backendType === "CREATE_BILL") payload = normaliseCreateBillPayload(payload);
  if (backendType === "UDHAR_PAYMENT") payload = normalisePaymentPayload(payload);
  if (backendType === "UPDATE_PURCHASE_BILL" || backendType === "DELETE_PURCHASE_BILL" || backendType === "RECORD_SUPPLIER_PAYMENT") {
    payload = normalisePurchaseLifecyclePayload(event, payload);
  }
  payload = normaliseBillLifecyclePayload(backendType, payload);
  payload = normaliseProductLifecyclePayload(backendType, payload);
  payload = normaliseCustomerLifecyclePayload(backendType, payload);
  if (backendType === "CREATE_LEDGER_ADJUSTMENT" || backendType === "REVERSE_UDHAR_PAYMENT") payload = normaliseLedgerPayload(payload);
  payload = normaliseStockPayload(backendType, rawType, payload);

  const entityType = BACKEND_ENTITY_TYPE_MAP[backendType] ?? event.entity_type;
  return {
    type: backendType,
    operation_type: backendType,
    entity_type: entityType,
    payload,
  };
}

async function markEntityRowSynced(event: PendingSyncEvent): Promise<void> {
  const tableName = tableNameForEntity(event.entity_type);
  if (!tableName || tableName === "settings") return;
  const table = dexieDB.table(tableName);
  const candidateId = readString(event.entity_id) ?? readString(event.payload?.id);
  if (!candidateId) return;
  const row = await table.get(candidateId).catch(() => undefined);
  if (!row || !rowMatchesCurrentScope(row)) return;
  await table.put({
    ...row,
    sync_status: "synced",
    updated_at: readString(row.updated_at) ?? new Date().toISOString(),
  });
}

export async function settleLocalOnlyOutboxOperations(): Promise<number> {
  await dexieDB.open();
  if (!dexieDB.sync_outbox || typeof dexieDB.sync_outbox.where !== "function") return 0;
  const scope = getOfflineScope();
  const rows = await dexieDB.sync_outbox
    .where("[tenant_id+store_id]")
    .equals([scope.tenant_id, scope.store_id])
    .filter((event) => event.status !== "SYNCED" && isLocalOnlySyncEvent(event))
    .toArray();

  if (rows.length === 0) return 0;
  const now = new Date().toISOString();
  await dexieDB.transaction("rw", [dexieDB.sync_outbox, dexieDB.local_audit_logs, dexieDB.subscription_cache, dexieDB.device_license_cache, dexieDB.staff_users, dexieDB.settings], async () => {
    for (const event of rows) {
      await markEntityRowSynced(event).catch(() => undefined);
      await dexieDB.sync_outbox.put({
        ...event,
        status: "SYNCED",
        sync_status: "synced",
        error_message: null,
        last_error: null,
        next_retry_at: null,
        last_attempt_at: now,
      });
    }
  });
  return rows.length;
}

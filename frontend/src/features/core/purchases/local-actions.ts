import { roundMoney } from "@/lib/money";
import { filterRowsForCurrentScope, offlineDB } from "@/lib/offline/db";
import { emitLocalDataChanged } from "@/lib/offline/instant-cache";
import type { SupplierDueRow } from "@/features/core/finance/services/FinancialAggregationService";
import { withLocalPurchaseOverride } from "@/features/core/purchases/sync-guards";
import { buildOutboxOperation, createOutboxId } from "@/features/core/sync/outbox";
import { getOfflineScope } from "@/lib/offline/context";
import { toInventoryBaseQty } from "@/features/core/inventory/calculations";
import { withPurchaseFinancialLock } from "@/features/core/purchases/purchase-financial-lock";

type MutableRow = Record<string, unknown>;
type PurchaseTableName = "purchase_bills" | "inventory_movements";

export interface PurchaseEditInput {
  supplierName: string;
  invoiceNumber: string;
  amount: number;
  paid: number;
  due: number;
  paymentMode: string;
  status: string;
  // Optional quantity correction (single-product purchases). In the unit the user entered.
  quantity?: number;
  enteredUnit?: string;
}

function isRecord(value: unknown): value is MutableRow {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(row: unknown, keys: string[], fallback = ""): string {
  if (!isRecord(row)) return fallback;
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return fallback;
}

function readNumber(row: unknown, keys: string[], fallback = 0): number {
  if (!isRecord(row)) return fallback;
  for (const key of keys) {
    const value = Number(row[key]);
    if (Number.isFinite(value)) return value;
  }
  return fallback;
}



function isDeleted(row: MutableRow): boolean {
  const status = String(row.status ?? row.purchasePaymentStatus ?? row.purchase_payment_status ?? "").toLowerCase();
  return Boolean(row.deleted_at ?? row.deletedAt ?? row.merged_into_id ?? row.mergedIntoId) || status === "deleted";
}

function normalizeKey(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function purchaseAmount(row: MutableRow): number {
  return roundMoney(readNumber(row, ["billAmount", "bill_amount", "purchaseBillAmount", "purchase_bill_amount", "amount"]));
}

function purchasePaid(row: MutableRow): number {
  return roundMoney(readNumber(row, ["purchasePaidAmount", "purchase_paid_amount", "paidAmount", "paid_amount"]));
}

function purchaseDue(row: MutableRow): number {
  const explicit = readNumber(row, ["purchaseDueAmount", "purchase_due_amount", "dueAmount", "due_amount"], NaN);
  if (Number.isFinite(explicit)) return roundMoney(Math.max(0, explicit));
  return roundMoney(Math.max(0, purchaseAmount(row) - purchasePaid(row)));
}

function purchaseInvoice(row: MutableRow): string {
  return readString(row, [
    "invoiceNumber",
    "invoice_number",
    "purchaseBillNo",
    "purchase_bill_no",
    "supplierBillNo",
    "supplier_bill_no",
    "billNo",
    "bill_no",
  ], "-");
}

function rowDate(row: MutableRow): string {
  return readString(row, ["createdAt", "created_at", "billDate", "bill_date", "updatedAt", "updated_at"]);
}

function dateBucket(row: MutableRow, invoiceNumber: string): string {
  const raw = rowDate(row);
  if (!raw) return "no-date";
  const time = new Date(raw).getTime();
  if (!Number.isFinite(time)) return raw.slice(0, 16);
  if (invoiceNumber && invoiceNumber !== "-") return new Date(time).toISOString().slice(0, 10);
  return String(Math.floor(time / (15 * 60 * 1000)));
}

function businessKey(row: MutableRow): string {
  const invoiceNumber = purchaseInvoice(row);
  return [
    normalizeKey(readString(row, ["supplierId", "supplier_id"]) || readString(row, ["supplierName", "supplier_name"], "supplier")),
    normalizeKey(readString(row, ["productId", "product_id"], "product")),
    normalizeKey(invoiceNumber),
    purchaseAmount(row).toFixed(2),
    purchasePaid(row).toFixed(2),
    purchaseDue(row).toFixed(2),
    dateBucket(row, invoiceNumber),
  ].join("|");
}

function displayBusinessKey(row: SupplierDueRow): string {
  return [
    normalizeKey(row.supplierId || row.supplierName || "supplier"),
    "product",
    normalizeKey(row.invoiceNumber),
    roundMoney(row.amount).toFixed(2),
    roundMoney(row.paid).toFixed(2),
    roundMoney(row.due).toFixed(2),
    dateBucket({ created_at: row.date }, row.invoiceNumber),
  ].join("|");
}

function identityKeys(row: MutableRow): string[] {
  return [
    readString(row, ["id"]),
    readString(row, ["server_id", "serverId"]),
    readString(row, ["local_id", "localId"]),
    readString(row, ["purchaseHistoryId", "purchase_history_id"]),
    readString(row, ["purchaseBillId", "purchase_bill_id"]),
    readString(row, ["localPurchaseHistoryId", "local_purchase_history_id"]),
    readString(row, ["localPurchaseBillId", "local_purchase_bill_id"]),
  ].filter(Boolean);
}

async function getPurchaseRows() {
  const [purchaseBills, inventoryMovements] = await Promise.all([
    offlineDB.getAll<MutableRow>("purchase_bills").catch(() => []),
    offlineDB.getAll<MutableRow>("inventory_movements").catch(() => []),
  ]);
  return [
    ...filterRowsForCurrentScope(purchaseBills).map((row) => ({ tableName: "purchase_bills" as const, row })),
    ...filterRowsForCurrentScope(inventoryMovements)
      .filter((row) => String(row.action ?? row.type ?? "").toLowerCase() === "purchase")
      .map((row) => ({ tableName: "inventory_movements" as const, row })),
  ].filter(({ row }) => !isDeleted(row));
}

async function findMatchingPurchaseRows(displayRow: SupplierDueRow) {
  const rows = await getPurchaseRows();
  const sourceTable: PurchaseTableName = displayRow.source === "purchase_bill" ? "purchase_bills" : "inventory_movements";
  const target = rows.find(({ tableName, row }) =>
    tableName === sourceTable && identityKeys(row).includes(displayRow.id),
  );

  if (!target) {
    const fallbackKey = displayBusinessKey(displayRow);
    return rows.filter(({ row }) => {
      const ownKey = [
        normalizeKey(readString(row, ["supplierId", "supplier_id"]) || readString(row, ["supplierName", "supplier_name"], "supplier")),
        "product",
        normalizeKey(purchaseInvoice(row)),
        purchaseAmount(row).toFixed(2),
        purchasePaid(row).toFixed(2),
        purchaseDue(row).toFixed(2),
        dateBucket(row, purchaseInvoice(row)),
      ].join("|");
      return ownKey === fallbackKey;
    });
  }

  const targetIdentities = new Set(identityKeys(target.row));
  const targetKey = businessKey(target.row);
  return rows.filter(({ row }) =>
    identityKeys(row).some((key) => targetIdentities.has(key)) || businessKey(row) === targetKey,
  );
}

function buildPurchaseSyncPayload(
  displayRow: SupplierDueRow,
  input: PurchaseEditInput,
  matches: Awaited<ReturnType<typeof findMatchingPurchaseRows>>,
) {
  const purchaseBill = matches.find((match) => match.tableName === "purchase_bills")?.row;
  const inventoryMovement = matches.find((match) => match.tableName === "inventory_movements")?.row;
  return {
    purchaseHistoryId: readString(purchaseBill, ["server_id", "serverId", "id", "purchaseHistoryId", "purchase_history_id"]),
    localPurchaseHistoryId: readString(purchaseBill, ["local_id", "localId", "id", "localPurchaseHistoryId", "local_purchase_history_id"]),
    purchaseBillId: readString(purchaseBill, ["server_id", "serverId", "id", "purchaseBillId", "purchase_bill_id"]),
    stockLedgerId: readString(inventoryMovement, ["server_id", "serverId", "stockLedgerId", "stock_ledger_id"]),
    localMovementId: readString(inventoryMovement, ["local_id", "localId", "id", "movementId", "movement_id"]),
    inventoryMovementId: readString(inventoryMovement, ["server_id", "serverId", "stockLedgerId", "stock_ledger_id"]),
    supplierId: displayRow.supplierId ?? readString(purchaseBill ?? inventoryMovement, ["supplierId", "supplier_id"]),
    supplierName: input.supplierName,
    invoiceNumber: input.invoiceNumber || null,
    billAmount: input.amount,
    purchasePaidAmount: input.paid,
    purchaseDueAmount: Math.max(0, input.amount - input.paid),
    purchasePaymentStatus: input.status,
    purchasePaymentMode: input.paid > 0 ? input.paymentMode : null,
    // Quantity correction: backend reconciles stock idempotently (SET ledger qty, move product
    // stock by the difference from the ledger's current value).
    ...(input.quantity != null && Number.isFinite(input.quantity)
      ? { quantity: input.quantity, enteredUnit: input.enteredUnit ?? (readString(purchaseBill ?? inventoryMovement, ["unit"]) || undefined) }
      : {}),
    match: {
      source: displayRow.source,
      displayId: displayRow.id,
      productId: readString(purchaseBill ?? inventoryMovement, ["productId", "product_id"]),
      supplierId: displayRow.supplierId ?? readString(purchaseBill ?? inventoryMovement, ["supplierId", "supplier_id"]),
      supplierName: displayRow.supplierName,
      invoiceNumber: displayRow.invoiceNumber === "-" ? "" : displayRow.invoiceNumber,
      billAmount: displayRow.amount,
      purchasePaidAmount: displayRow.paid,
      purchaseDueAmount: displayRow.due,
      date: displayRow.date,
    },
    affectedRows: matches.map((match) => ({
      tableName: match.tableName,
      id: readString(match.row, ["id"]),
      serverId: readString(match.row, ["server_id", "serverId"]),
      localId: readString(match.row, ["local_id", "localId"]),
    })),
  };
}

function withPurchasePatch(row: MutableRow, input: PurchaseEditInput): MutableRow {
  const now = new Date().toISOString();
  const amount = roundMoney(Math.max(0, input.amount));
  const paid = roundMoney(Math.max(0, Math.min(input.paid, amount)));
  const due = roundMoney(Math.max(0, amount - paid));
  const status = due <= 0 ? "paid" : paid > 0 ? "partial" : "due";
  const mode = paid > 0 ? input.paymentMode : null;
  const action = due <= 0 && paid >= amount ? "paid" : "updated";
  return withLocalPurchaseOverride({
    ...row,
    supplierName: input.supplierName,
    supplier_name: input.supplierName,
    invoiceNumber: input.invoiceNumber || undefined,
    invoice_number: input.invoiceNumber || undefined,
    purchaseBillNo: input.invoiceNumber || row.purchaseBillNo,
    purchase_bill_no: input.invoiceNumber || row.purchase_bill_no,
    supplierBillNo: input.invoiceNumber || row.supplierBillNo,
    supplier_bill_no: input.invoiceNumber || row.supplier_bill_no,
    billAmount: amount,
    bill_amount: amount,
    purchaseBillAmount: amount,
    purchase_bill_amount: amount,
    purchasePaidAmount: paid,
    purchase_paid_amount: paid,
    purchaseDueAmount: due,
    purchase_due_amount: due,
    purchasePaymentStatus: status,
    purchase_payment_status: status,
    purchasePaymentMode: mode,
    purchase_payment_mode: mode,
    updatedAt: now,
    updated_at: now,
  }, action, row);
}

async function updatePurchaseLocalUnlocked(displayRow: SupplierDueRow, input: PurchaseEditInput) {
  const matches = await findMatchingPurchaseRows(displayRow);
  if (matches.length === 0) throw new Error("Purchase row not found in local records");

  // Optional quantity correction. Mirror locally what the backend reconciles idempotently:
  // restate the matched movement's quantity and move the product's stock by the delta. The server
  // is authoritative (reconciled via the UPDATE_PURCHASE_BILL payload), so the product row keeps
  // its sync_status and a later pull simply confirms the same value.
  let productPatch: MutableRow | null = null;
  let newBaseSigned: number | null = null;
  if (input.quantity != null && Number.isFinite(input.quantity)) {
    const movementMatch = matches.find((match) => match.tableName === "inventory_movements");
    const productId = readString(movementMatch?.row, ["productId", "product_id"]);
    if (movementMatch && productId) {
      const products = await offlineDB.getAll<MutableRow>("products").catch(() => []);
      const product = products.find((p) =>
        readString(p, ["id"]) === productId || readString(p, ["server_id", "serverId"]) === productId);
      if (product) {
        const baseUnit = readString(product, ["baseUnit", "base_unit"]) || undefined;
        const enteredUnit = input.enteredUnit || readString(movementMatch.row, ["unit"]) || baseUnit || "piece";
        const newBase = toInventoryBaseQty(input.quantity, enteredUnit, baseUnit);
        const signedRaw = readNumber(movementMatch.row, ["quantityDelta", "quantity_delta"]);
        const oldBase = Math.abs(signedRaw);
        const delta = roundMoney(newBase - oldBase);
        newBaseSigned = signedRaw < 0 ? -newBase : newBase;
        if (delta !== 0) {
          const now = new Date().toISOString();
          productPatch = {
            ...product,
            stockBaseQty: roundMoney(readNumber(product, ["stockBaseQty"]) + delta),
            updatedAt: now,
            updated_at: now,
          };
        }
      }
    }
  }

  const outbox = buildOutboxOperation({
    entity_type: "purchase_history",
    entity_id: displayRow.id,
    operation_type: "UPDATE_PURCHASE_BILL",
    payload: buildPurchaseSyncPayload(displayRow, input, matches),
  });
  await offlineDB.transaction(["purchase_bills", "inventory_movements", "sync_outbox", "products"], async (tx) => {
    for (const match of matches) {
      let patched = withPurchasePatch(match.row, input);
      if (newBaseSigned != null && match.tableName === "inventory_movements") {
        patched = { ...patched, quantityDelta: newBaseSigned, quantity_delta: newBaseSigned };
      }
      await tx.put(match.tableName, patched);
    }
    if (productPatch) await tx.put("products", productPatch);
    await tx.enqueueOutboxOperation(outbox);
  });
  emitLocalDataChanged({ type: "purchase", id: displayRow.id, action: "updated", count: matches.length });
  return { updated: matches.length };
}

export function updatePurchaseLocal(displayRow: SupplierDueRow, input: PurchaseEditInput) {
  return withPurchaseFinancialLock(displayRow.id, () => updatePurchaseLocalUnlocked(displayRow, input));
}

export async function markPurchasePaidLocal(displayRow: SupplierDueRow, paymentMode: string) {
  return updatePurchaseLocal(displayRow, {
    supplierName: displayRow.supplierName,
    invoiceNumber: displayRow.invoiceNumber === "-" ? "" : displayRow.invoiceNumber,
    amount: displayRow.amount,
    paid: displayRow.amount,
    due: 0,
    paymentMode,
    status: "paid",
  });
}

/**
 * Record a partial payment against an unpaid/partially-paid purchase. The shopkeeper can clear a
 * supplier due in small amounts over time — each payment bumps the cumulative paid and the same
 * idempotent UPDATE_PURCHASE_BILL sync path reconciles it on the server.
 */
async function recordPurchasePaymentLocalUnlocked(
  displayRow: SupplierDueRow,
  payment: { amount: number; mode: string; reference?: string },
) {
  const amount = roundMoney(Math.max(0, payment.amount));
  if (amount <= 0) throw new Error("Enter a payment amount greater than zero");
  const matches = await findMatchingPurchaseRows(displayRow);
  if (matches.length === 0) throw new Error("Purchase row not found in local records");
  const currentRow = matches.find((match) => match.tableName === "purchase_bills")?.row ?? matches[0].row;
  const currentAmount = purchaseAmount(currentRow);
  const currentPaid = purchasePaid(currentRow);
  const currentDue = purchaseDue(currentRow);
  if (currentDue <= 0) throw new Error("This purchase has no due left");
  if (amount > currentDue + 0.009) throw new Error(`Payment can't exceed the due amount (₹${currentDue.toLocaleString("en-IN")})`);
  const currentDisplay: SupplierDueRow = { ...displayRow, amount: currentAmount, paid: currentPaid, due: currentDue };
  const paid = roundMoney(Math.min(currentAmount, roundMoney(currentPaid + amount)));
  const remaining = roundMoney(Math.max(0, currentAmount - paid));
  const patch: PurchaseEditInput = {
    supplierName: currentDisplay.supplierName,
    invoiceNumber: currentDisplay.invoiceNumber === "-" ? "" : currentDisplay.invoiceNumber,
    amount: currentAmount,
    paid,
    due: remaining,
    paymentMode: payment.mode,
    status: remaining <= 0 ? "paid" : "partial",
  };
  const paymentId = createOutboxId("supplier_payment");
  const now = new Date().toISOString();
  const scope = getOfflineScope();
  const locator = buildPurchaseSyncPayload(currentDisplay, patch, matches);
  const paymentRow: MutableRow = {
    id: paymentId,
    local_id: paymentId,
    purchase_history_id: locator.purchaseHistoryId ?? null,
    purchase_bill_id: locator.purchaseBillId ?? null,
    local_purchase_history_id: locator.localPurchaseHistoryId ?? displayRow.id,
    supplier_id: displayRow.supplierId ?? null,
    supplier_name: displayRow.supplierName,
    invoice_number: displayRow.invoiceNumber === "-" ? null : displayRow.invoiceNumber,
    amount,
    mode: payment.mode,
    reference: payment.reference?.trim() || null,
    kind: "supplier_payment",
    status: "active",
    paid_at: now,
    created_at: now,
    sync_status: "pending_sync",
    ...scope,
  };
  const outbox = buildOutboxOperation({
    entity_type: "payment",
    entity_id: paymentId,
    operation_type: "RECORD_SUPPLIER_PAYMENT",
    payload: { ...locator, paymentId, amount, mode: payment.mode, reference: payment.reference?.trim() || null, paidAt: now },
  });
  await offlineDB.transaction(["purchase_bills", "inventory_movements", "payments", "sync_outbox"], async (tx) => {
    for (const match of matches) await tx.put(match.tableName, withPurchasePatch(match.row, patch));
    await tx.put("payments", paymentRow);
    await tx.enqueueOutboxOperation(outbox);
  });
  emitLocalDataChanged({ type: "purchase", id: displayRow.id, action: "payment_recorded", count: matches.length });
  return { paymentId, paid, due: remaining };
}

export function recordPurchasePaymentLocal(
  displayRow: SupplierDueRow,
  payment: { amount: number; mode: string; reference?: string },
) {
  return withPurchaseFinancialLock(displayRow.id, () => recordPurchasePaymentLocalUnlocked(displayRow, payment));
}

export async function listSupplierPaymentsLocal(displayRow: SupplierDueRow) {
  const rows = filterRowsForCurrentScope(await offlineDB.getAll<MutableRow>("payments").catch(() => []));
  const invoice = normalizeKey(displayRow.invoiceNumber === "-" ? "" : displayRow.invoiceNumber);
  const supplier = normalizeKey(displayRow.supplierId || displayRow.supplierName);
  const matches = rows.filter((row) => {
    if (String(row.kind ?? "") !== "supplier_payment") return false;
    if ([row.local_purchase_history_id, row.purchase_history_id, row.purchase_bill_id].map(String).includes(displayRow.id)) return true;
    const rowInvoice = normalizeKey(row.invoice_number ?? row.invoiceNumber);
    const rowSupplier = normalizeKey(row.supplier_id ?? row.supplierId ?? row.supplier_name ?? row.supplierName);
    return Boolean(invoice && rowInvoice === invoice && supplier && rowSupplier === supplier);
  });
  const unique = new Map<string, MutableRow>();
  for (const row of matches) {
    const key = readString(row, ["local_id", "localId", "id"]);
    const current = unique.get(key);
    if (!current || (String(row.sync_status) === "synced" && String(current.sync_status) !== "synced")) unique.set(key, row);
  }
  return [...unique.values()].sort((a, b) => String(b.paid_at ?? b.created_at).localeCompare(String(a.paid_at ?? a.created_at)));
}

async function reverseSupplierPaymentLocalUnlocked(
  displayRow: SupplierDueRow,
  paymentRow: MutableRow,
  input: { reason: string; ownerPin: string },
) {
  const reason = input.reason.trim();
  if (reason.length < 3) throw new Error("Enter a reversal reason");
  const paymentId = readString(paymentRow, ["id", "local_id"]);
  const paymentRows = filterRowsForCurrentScope(await offlineDB.getAll<MutableRow>("payments").catch(() => []));
  const currentPayment = paymentRows.find((row) => readString(row, ["id", "local_id"]) === paymentId) ?? paymentRow;
  const amount = roundMoney(readNumber(currentPayment, ["amount"]));
  if (amount <= 0 || String(currentPayment.status ?? "active") === "reversed") throw new Error("This payment cannot be reversed");
  const matches = await findMatchingPurchaseRows(displayRow);
  if (matches.length === 0) throw new Error("Purchase row not found in local records");
  const currentRow = matches.find((match) => match.tableName === "purchase_bills")?.row ?? matches[0].row;
  const currentAmount = purchaseAmount(currentRow);
  const currentPaid = purchasePaid(currentRow);
  const paid = roundMoney(Math.max(0, currentPaid - amount));
  const due = roundMoney(Math.max(0, currentAmount - paid));
  const patch: PurchaseEditInput = { supplierName: displayRow.supplierName, invoiceNumber: displayRow.invoiceNumber === "-" ? "" : displayRow.invoiceNumber, amount: currentAmount, paid, due, paymentMode: displayRow.paymentMode, status: paid > 0 ? "partial" : "due" };
  // The supplier-payment ledger is keyed by the immutable client payment id. Sync's generic
  // `server_id` may point at the reconciled purchase history, so it is not a payment locator.
  const outbox = buildOutboxOperation({ entity_type: "payment", entity_id: paymentId, operation_type: "REVERSE_SUPPLIER_PAYMENT", payload: { paymentId, reason, ownerPin: input.ownerPin } });
  await offlineDB.transaction(["purchase_bills", "inventory_movements", "payments", "sync_outbox"], async (tx) => {
    for (const match of matches) await tx.put(match.tableName, withPurchasePatch(match.row, patch));
    await tx.put("payments", { ...currentPayment, status: "reversed", reversed_at: new Date().toISOString(), reversal_reason: reason, sync_status: "pending_sync" });
    await tx.enqueueOutboxOperation(outbox);
  });
  emitLocalDataChanged({ type: "purchase", id: displayRow.id, action: "payment_reversed", count: matches.length });
  return { paymentId, paid, due };
}

export function reverseSupplierPaymentLocal(
  displayRow: SupplierDueRow,
  paymentRow: MutableRow,
  input: { reason: string; ownerPin: string },
) {
  return withPurchaseFinancialLock(displayRow.id, () => reverseSupplierPaymentLocalUnlocked(displayRow, paymentRow, input));
}

async function deletePurchaseLocalUnlocked(displayRow: SupplierDueRow) {
  const matches = await findMatchingPurchaseRows(displayRow);
  if (matches.length === 0) throw new Error("Purchase row not found in local records");
  const now = new Date().toISOString();
  const outbox = buildOutboxOperation({
    entity_type: "purchase_history",
    entity_id: displayRow.id,
    operation_type: "DELETE_PURCHASE_BILL",
    payload: buildPurchaseSyncPayload(displayRow, {
      supplierName: displayRow.supplierName,
      invoiceNumber: displayRow.invoiceNumber === "-" ? "" : displayRow.invoiceNumber,
      amount: displayRow.amount,
      paid: displayRow.paid,
      due: displayRow.due,
      paymentMode: displayRow.paymentMode,
      status: "deleted",
    }, matches),
  });
  await offlineDB.transaction(["purchase_bills", "inventory_movements", "sync_outbox"], async (tx) => {
    for (const match of matches) {
      await tx.put(match.tableName, {
        ...withLocalPurchaseOverride(match.row, "deleted"),
        deleted_at: match.row.deleted_at ?? now,
        deletedAt: match.row.deletedAt ?? now,
        updated_at: now,
        updatedAt: now,
        purchasePaymentStatus: "deleted",
        purchase_payment_status: "deleted",
      });
    }
    await tx.enqueueOutboxOperation(outbox);
  });
  emitLocalDataChanged({ type: "purchase", id: displayRow.id, action: "deleted", count: matches.length });
  return { deleted: matches.length };
}

export function deletePurchaseLocal(displayRow: SupplierDueRow) {
  return withPurchaseFinancialLock(displayRow.id, () => deletePurchaseLocalUnlocked(displayRow));
}

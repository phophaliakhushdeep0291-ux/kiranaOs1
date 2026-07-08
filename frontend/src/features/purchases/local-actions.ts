import { filterRowsForCurrentScope, offlineDB } from "@/lib/offline/db";
import { emitLocalDataChanged } from "@/lib/offline/instant-cache";
import type { SupplierDueRow } from "@/features/finance/services/FinancialAggregationService";
import { withLocalPurchaseOverride } from "@/features/purchases/sync-guards";
import { buildOutboxOperation } from "@/features/sync/outbox";
import { toInventoryBaseQty } from "@/features/inventory/calculations";

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

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
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

export async function updatePurchaseLocal(displayRow: SupplierDueRow, input: PurchaseEditInput) {
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
export async function recordPurchasePaymentLocal(
  displayRow: SupplierDueRow,
  payment: { amount: number; mode: string },
) {
  const amount = roundMoney(Math.max(0, payment.amount));
  if (amount <= 0) throw new Error("Enter a payment amount greater than zero");
  const due = roundMoney(Math.max(0, displayRow.due));
  if (due <= 0) throw new Error("This purchase has no due left");
  if (amount > due + 0.009) throw new Error(`Payment can't exceed the due amount (₹${due.toLocaleString("en-IN")})`);

  const paid = roundMoney(Math.min(displayRow.amount, roundMoney(displayRow.paid + amount)));
  const remaining = roundMoney(Math.max(0, displayRow.amount - paid));
  return updatePurchaseLocal(displayRow, {
    supplierName: displayRow.supplierName,
    invoiceNumber: displayRow.invoiceNumber === "-" ? "" : displayRow.invoiceNumber,
    amount: displayRow.amount,
    paid,
    due: remaining,
    paymentMode: payment.mode,
    status: remaining <= 0 ? "paid" : "partial",
  });
}

export async function deletePurchaseLocal(displayRow: SupplierDueRow) {
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

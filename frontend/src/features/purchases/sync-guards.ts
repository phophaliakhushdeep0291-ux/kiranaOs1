import { filterRowsForCurrentScope, offlineDB } from "@/lib/offline/db";

type MutableRow = Record<string, unknown>;

export type LocalPurchaseAction = "updated" | "paid" | "deleted";

export interface PurchaseOverrideMatcher {
  keys: Set<string>;
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
    const parsed = Number(row[key]);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100 || 0;
}

function normalizeKey(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function purchaseAmount(row: MutableRow): number {
  return roundMoney(
    readNumber(row, [
      "billAmount",
      "bill_amount",
      "purchaseBillAmount",
      "purchase_bill_amount",
      "grandTotal",
      "grand_total",
      "totalAmount",
      "total_amount",
      "amount",
    ]),
  );
}

function purchasePaid(row: MutableRow): number {
  const explicit = readNumber(
    row,
    ["purchasePaidAmount", "purchase_paid_amount", "paidAmount", "paid_amount"],
    NaN,
  );
  if (Number.isFinite(explicit)) return roundMoney(Math.max(0, explicit));
  const status = String(
    row.purchasePaymentStatus ??
      row.purchase_payment_status ??
      row.paymentStatus ??
      row.payment_status ??
      "paid",
  ).toLowerCase();
  if (status === "due" || status === "unpaid" || status === "pending") return 0;
  return purchaseAmount(row);
}

function purchaseDue(row: MutableRow): number {
  const explicit = readNumber(
    row,
    ["purchaseDueAmount", "purchase_due_amount", "dueAmount", "due_amount"],
    NaN,
  );
  if (Number.isFinite(explicit)) return roundMoney(Math.max(0, explicit));
  return roundMoney(Math.max(0, purchaseAmount(row) - purchasePaid(row)));
}

function purchaseInvoice(row: MutableRow): string {
  return readString(
    row,
    [
      "invoiceNumber",
      "invoice_number",
      "purchaseBillNo",
      "purchase_bill_no",
      "supplierBillNo",
      "supplier_bill_no",
      "billNo",
      "bill_no",
    ],
    "-",
  );
}

function rowDate(row: MutableRow): string {
  return readString(row, [
    "createdAt",
    "created_at",
    "billDate",
    "bill_date",
    "updatedAt",
    "updated_at",
  ]);
}

function purchaseDateBucket(row: MutableRow, invoiceNumber: string): string {
  const raw = rowDate(row);
  if (!raw) return "no-date";
  const time = new Date(raw).getTime();
  if (!Number.isFinite(time)) return raw.slice(0, 16);
  if (invoiceNumber && invoiceNumber !== "-") return new Date(time).toISOString().slice(0, 10);
  return String(Math.floor(time / (15 * 60 * 1000)));
}

function previousOverrideKeys(row: MutableRow): string[] {
  const raw = row.local_purchase_previous_keys ?? row.localPurchasePreviousKeys;
  return Array.isArray(raw)
    ? raw.filter((key): key is string => typeof key === "string" && key.length > 0)
    : [];
}

export function isPurchaseDeleted(row: MutableRow): boolean {
  const status = String(row.status ?? row.purchasePaymentStatus ?? row.purchase_payment_status ?? "").toLowerCase();
  return Boolean(row.deleted_at ?? row.deletedAt ?? row.merged_into_id ?? row.mergedIntoId) || status === "deleted";
}

export function isLocalPurchaseOverride(row: MutableRow): boolean {
  return Boolean(
    row.local_purchase_override_at ??
      row.localPurchaseOverrideAt ??
      row.local_purchase_action ??
      row.localPurchaseAction,
  );
}

export function isPurchaseMovement(row: MutableRow): boolean {
  return String(row.action ?? row.type ?? "").toLowerCase() === "purchase";
}

export function purchaseMatchKeys(row: MutableRow): string[] {
  const invoiceNumber = purchaseInvoice(row);
  const supplierKey = normalizeKey(
    readString(row, ["supplierId", "supplier_id"]) ||
      readString(row, ["supplierName", "supplier_name"], "supplier"),
  );
  const productKey = normalizeKey(readString(row, ["productId", "product_id"], "product"));
  const invoiceKey = normalizeKey(invoiceNumber || "-");
  const amount = purchaseAmount(row).toFixed(2);
  const paid = purchasePaid(row).toFixed(2);
  const due = purchaseDue(row).toFixed(2);
  const dateBucket = purchaseDateBucket(row, invoiceNumber);
  const identityKeys = [
    readString(row, ["id"]),
    readString(row, ["server_id", "serverId"]),
    readString(row, ["local_id", "localId"]),
    readString(row, ["purchaseHistoryId", "purchase_history_id"]),
    readString(row, ["purchaseBillId", "purchase_bill_id"]),
    readString(row, ["localPurchaseHistoryId", "local_purchase_history_id"]),
    readString(row, ["localPurchaseBillId", "local_purchase_bill_id"]),
  ]
    .filter(Boolean)
    .map((id) => `purchase-id:${normalizeKey(id)}`);

  return [
    ...identityKeys,
    ["purchase-stable", supplierKey, productKey, invoiceKey, amount, dateBucket].join("|"),
    ["purchase-business", supplierKey, productKey, invoiceKey, amount, paid, due, dateBucket].join("|"),
    ...previousOverrideKeys(row),
  ];
}

export function withLocalPurchaseOverride<T extends MutableRow>(
  row: T,
  action: LocalPurchaseAction,
  originalRow?: MutableRow,
): T {
  const now = new Date().toISOString();
  const keys = new Set([
    ...purchaseMatchKeys(originalRow ?? row),
    ...previousOverrideKeys(row),
  ]);
  return {
    ...row,
    local_purchase_action: action,
    localPurchaseAction: action,
    local_purchase_override_at: now,
    localPurchaseOverrideAt: now,
    local_purchase_previous_keys: [...keys],
    localPurchasePreviousKeys: [...keys],
    sync_status: "pending_sync",
  };
}

export function buildPurchaseOverrideMatcher(rows: MutableRow[]): PurchaseOverrideMatcher {
  const keys = new Set<string>();
  for (const row of rows) {
    if (!isLocalPurchaseOverride(row)) continue;
    purchaseMatchKeys(row).forEach((key) => keys.add(key));
  }
  return { keys };
}

export function rowMatchesPurchaseOverride(row: MutableRow, matcher: PurchaseOverrideMatcher): boolean {
  if (matcher.keys.size === 0) return false;
  return purchaseMatchKeys(row).some((key) => matcher.keys.has(key));
}

export async function loadPurchaseOverrideMatcher(): Promise<PurchaseOverrideMatcher> {
  const [purchaseBills, inventoryMovements] = await Promise.all([
    offlineDB.getAll<MutableRow>("purchase_bills").catch(() => []),
    offlineDB.getAll<MutableRow>("inventory_movements").catch(() => []),
  ]);
  return buildPurchaseOverrideMatcher([
    ...filterRowsForCurrentScope(purchaseBills),
    ...filterRowsForCurrentScope(inventoryMovements).filter(isPurchaseMovement),
  ]);
}

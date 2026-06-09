import {
  filterRowsForCurrentScope,
  offlineDB,
  type PendingSyncEvent,
} from "@/lib/offline/db";
import type { Bill, Product, Customer } from "@/types/api";
import {
  calculateLedgerBalance,
  dedupeLedgerEntries,
  ledgerSignedAmount,
  normaliseLedgerType,
  type CustomerLedgerEntry,
} from "@/features/ledger/accounting";
import { dedupePaymentsForDisplay } from "@/features/sync/bill-reconciliation";
import { hardenLocalFinancialData } from "@/features/sync/local-data-hardening";

export interface DateRange {
  from: string;
  to: string;
}

export interface ReportPaymentBreakdown {
  /** Cash collected from today's sales only. */
  cash: number;
  /** UPI collected from today's sales only. */
  upi: number;
  /** Udhar/credit given from today's sales. */
  udhar: number;
  /** Cash + UPI collected from today's sales only. */
  received: number;
  /** Customer old-udhar recovery received today, any mode. */
  oldUdharReceived: number;
  oldUdharCashReceived: number;
  oldUdharUpiReceived: number;
  /** Total incoming cash after adding old-udhar cash recovery. */
  cashIn: number;
  /** Total incoming UPI/bank after adding old-udhar UPI recovery. */
  upiIn: number;
  /** Inventory supplier payments made today. */
  purchaseCashPaid: number;
  purchaseUpiPaid: number;
  purchasePaid: number;
  purchaseDue: number;
  /** Cash drawer estimate = cash in - supplier cash paid. */
  netCashInHand: number;
  /** Bank/UPI estimate = UPI in - supplier UPI paid. */
  netUpiInBank: number;
}

export interface ReportMetricWindow {
  sales: number;
  bills: number;
  cashSales: number;
  upiSales: number;
  udharSales: number;
  paymentsReceived: number;
  discount: number;
  profitEstimate: number;
}

export interface ReportTopCustomer {
  customerId: string;
  name: string;
  mobile?: string | null;
  sales: number;
  balance: number;
  bills: number;
}

export interface ReportTopProduct {
  productId: string;
  name: string;
  quantitySold: number;
  revenue: number;
  profitEstimate: number;
}

export interface ReportLowStockItem {
  productId: string;
  name: string;
  category?: string | null;
  stock: number;
  threshold: number;
  unit?: string | null;
}

export interface StaffSalesRow {
  staffId: string;
  staffName: string;
  sales: number;
  bills: number;
}

export interface LocalReportSnapshot {
  generatedAt: string;
  range: DateRange;
  today: ReportMetricWindow;
  sevenDay: ReportMetricWindow;
  thirtyDay: ReportMetricWindow;
  selected: ReportMetricWindow;
  paymentBreakdown: ReportPaymentBreakdown;
  pendingUdhar: number;
  topCustomers: ReportTopCustomer[];
  topProducts: ReportTopProduct[];
  lowStock: ReportLowStockItem[];
  staffSales: StaffSalesRow[];
  pendingSyncCount: number;
  failedSyncCount: number;
  conflictCount: number;
  hasUnsyncedOperations: boolean;
  hasLocalData: boolean;
  dataSourceLabel: string;
}

export interface DailyClosingReport {
  date: string;
  totalSales: number;
  cashReceived: number;
  upiReceived: number;
  udharGiven: number;
  oldUdharPaymentReceived: number;
  purchaseCashPaid: number;
  purchaseUpiPaid: number;
  purchasePaid: number;
  purchaseDue: number;
  expectedCashInDrawer: number;
  expectedUpiInBank: number;
  topSoldProducts: ReportTopProduct[];
  lowStockItems: ReportLowStockItem[];
  pendingSyncCount: number;
  failedSyncCount: number;
  conflictCount: number;
  isLocalEstimate: boolean;
  generatedAt: string;
}

type RecordLike = Record<string, unknown>;

type LocalBill = Bill & RecordLike;

function readBoolean(row: RecordLike, keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true") return true;
      if (normalized === "false") return false;
    }
  }
  return undefined;
}

function readIdentity(row: RecordLike, keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function reportBillSyncedPriority(bill: LocalBill): number {
  const explicit = readBoolean(bill, ["isSynced", "is_synced"]);
  const status = String(bill.status ?? "").toLowerCase();
  const syncStatus = String(bill.sync_status ?? "").toLowerCase();
  if (explicit === true || syncStatus === "synced") return 4;
  if (syncStatus === "failed" || syncStatus === "conflict") return 1;
  if (explicit === false || status === "pending_sync" || syncStatus === "pending_sync" || syncStatus === "syncing") return 2;
  return 3;
}

function reportBillContentSignature(bill: LocalBill): string | null {
  const total = readNumber(
    bill.grandTotal ?? bill.totalAmount ?? bill.netAmount ?? bill.actualAmount,
    NaN,
  );
  const createdAt = String(bill.createdAt ?? bill.created_at ?? "");
  const createdTime = new Date(createdAt).getTime();
  if (!Number.isFinite(total) || !Number.isFinite(createdTime)) return null;
  const fiveMinuteBucket = Math.floor(createdTime / (5 * 60 * 1000));
  const customer = String(
    bill.customerId ?? bill.customer_id ?? bill.customerMobile ?? bill.customerName ?? "walk-in",
  ).trim().toLowerCase();
  const type = String(bill.billType ?? bill.bill_type ?? "sale").trim().toLowerCase();
  return `${fiveMinuteBucket}|${type}|${customer}|${total.toFixed(2)}`;
}

function reportBillIdentityKeys(bill: LocalBill): string[] {
  return [
    readIdentity(bill, ["id"]),
    readIdentity(bill, ["server_id", "serverId"]),
    readIdentity(bill, ["local_id", "localId"]),
    readIdentity(bill, ["merged_into_id", "mergedIntoId"]),
    readIdentity(bill, ["localBillId", "local_bill_id"]),
    readIdentity(bill, ["clientBillId", "client_bill_id"]),
    readIdentity(bill, ["idempotencyKey", "idempotency_key"]),
    readIdentity(bill, ["uniqueBillId", "unique_bill_id"]),
  ].filter((key): key is string => Boolean(key));
}

function dedupeBillsForDashboardReports(bills: LocalBill[]): LocalBill[] {
  const sorted = [...bills]
    .filter((bill) => !isDeleted(bill))
    .sort((a, b) => {
      const priority = reportBillSyncedPriority(b) - reportBillSyncedPriority(a);
      if (priority !== 0) return priority;
      return String(b.updatedAt ?? b.updated_at ?? b.createdAt ?? b.created_at ?? "")
        .localeCompare(String(a.updatedAt ?? a.updated_at ?? a.createdAt ?? a.created_at ?? ""));
    });
  const seenKeys = new Set<string>();
  const seenSyncedContent = new Set<string>();
  const picked: LocalBill[] = [];
  for (const bill of sorted) {
    const keys = reportBillIdentityKeys(bill);
    if (keys.some((key) => seenKeys.has(key))) continue;
    const signature = reportBillContentSignature(bill);
    const isSynced = reportBillSyncedPriority(bill) >= 3;
    if (!isSynced && signature && seenSyncedContent.has(signature)) continue;
    keys.forEach((key) => seenKeys.add(key));
    if (isSynced && signature) seenSyncedContent.add(signature);
    picked.push(bill);
  }
  return picked.sort((a, b) => String(b.createdAt ?? b.created_at ?? "").localeCompare(String(a.createdAt ?? a.created_at ?? "")));
}

type LocalPayment = RecordLike & {
  id?: string;
  billId?: string | null;
  bill_id?: string | null;
  customerId?: string | null;
  customer_id?: string | null;
  mode?: string;
  amount?: number;
  paidAt?: string;
  paid_at?: string;
  createdAt?: string;
  created_at?: string;
  reversed_at?: string | null;
  deleted_at?: string | null;
  deletedAt?: string | null;
};

type LocalBillItem = RecordLike & {
  id?: string;
  billId?: string | null;
  bill_id?: string | null;
  productId?: string | null;
  product_id?: string | null;
  name?: string;
  quantity?: number;
  line_total?: number;
  lineTotal?: number;
  ratePerRateUnit?: number;
  rate_per_rate_unit?: number;
  costPerRateUnit?: number;
  cost_per_rate_unit?: number;
  costPrice?: number;
  cost_price?: number;
};

type LocalInventoryMovement = RecordLike & {
  id?: string;
  productId?: string | null;
  product_id?: string | null;
  productName?: string | null;
  product_name?: string | null;
  type?: string;
  action?: string;
  billAmount?: number;
  bill_amount?: number;
  purchasePaidAmount?: number;
  purchase_paid_amount?: number;
  purchaseDueAmount?: number;
  purchase_due_amount?: number;
  purchasePaymentMode?: string | null;
  purchase_payment_mode?: string | null;
  purchasePaymentStatus?: string | null;
  purchase_payment_status?: string | null;
  supplierName?: string | null;
  supplier_name?: string | null;
  supplierId?: string | null;
  supplier_id?: string | null;
  createdAt?: string;
  created_at?: string;
  deleted_at?: string | null;
  deletedAt?: string | null;
};

function readNumber(value: unknown, fallback = 0): number {
  const num = Number(value ?? fallback);
  return Number.isFinite(num) ? num : fallback;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function startOfLocalDay(date = new Date()): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateFromInput(value: string, endOfDay = false): Date {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, (month || 1) - 1, day || 1);
  if (endOfDay) date.setHours(23, 59, 59, 999);
  return date;
}

function getDateValue(row: RecordLike): string | undefined {
  const raw =
    row.createdAt ??
    row.created_at ??
    row.paidAt ??
    row.paid_at ??
    row.entry_at ??
    row.updatedAt ??
    row.updated_at;
  return typeof raw === "string" ? raw : undefined;
}

function isWithinRange(row: RecordLike, range: DateRange): boolean {
  const raw = getDateValue(row);
  if (!raw) return false;
  const time = new Date(raw).getTime();
  if (!Number.isFinite(time)) return false;
  return (
    time >= dateFromInput(range.from).getTime() &&
    time <= dateFromInput(range.to, true).getTime()
  );
}

function isDeleted(row: RecordLike): boolean {
  return Boolean(row.deleted_at ?? row.deletedAt ?? row.merged_into_id);
}

function isCancelledBill(bill: LocalBill): boolean {
  return String(bill.status ?? "")
    .toLowerCase()
    .includes("cancel");
}

function isEstimateBill(bill: LocalBill): boolean {
  const type = String(bill.billType ?? bill.bill_type ?? "").toLowerCase();
  const status = String(bill.status ?? "").toLowerCase();
  return (
    type.includes("estimate") ||
    type.includes("rough") ||
    status.includes("rough")
  );
}

function isSaleBill(bill: LocalBill): boolean {
  return !isDeleted(bill) && !isCancelledBill(bill) && !isEstimateBill(bill);
}

function billTotal(bill: LocalBill): number {
  return roundMoney(
    readNumber(
      bill.grandTotal ??
        bill.totalAmount ??
        bill.netAmount ??
        bill.actualAmount,
      0,
    ),
  );
}

function billPaid(bill: LocalBill): number {
  return roundMoney(readNumber(bill.paidAmount ?? bill.buyerPaidAmount, 0));
}

function billDiscount(bill: LocalBill): number {
  return roundMoney(readNumber(bill.discount, 0));
}

function billCredit(bill: LocalBill): number {
  const explicit = readNumber(bill.creditAmount, NaN);
  if (Number.isFinite(explicit)) return roundMoney(Math.max(0, explicit));
  return roundMoney(Math.max(0, billTotal(bill) - billPaid(bill)));
}

function productPrice(product?: Product): number {
  return readNumber(
    product?.sellingPrice ??
      product?.defaultPricePerRateUnit ??
      product?.retailPrice ??
      product?.retailPricePerRateUnit,
    0,
  );
}

function productCost(product?: Product): number {
  return readNumber(product?.costPrice ?? product?.costPerRateUnit, 0);
}

function billItemCost(item: LocalBillItem, product?: Product): number {
  return readNumber(
    item.costPerRateUnit ??
      item.cost_per_rate_unit ??
      item.costPrice ??
      item.cost_price,
    productCost(product),
  );
}

function paymentAmount(payment: LocalPayment): number {
  return roundMoney(readNumber(payment.amount, 0));
}

function isActivePayment(payment: LocalPayment): boolean {
  return (
    !isDeleted(payment) &&
    !payment.reversed_at &&
    String(payment.status ?? "").toLowerCase() !== "reversed"
  );
}

function paymentMode(payment: LocalPayment): string {
  return String(payment.mode ?? "cash").toLowerCase();
}

type TenderTotal = { cash: number; upi: number };

function normalizeTenderMode(mode: string): "cash" | "upi" | null {
  if (mode === "cash") return "cash";
  if (mode === "upi" || mode === "bank" || mode === "card") return "upi";
  return null;
}

function addTender(total: TenderTotal, mode: string, amount: number): void {
  const tenderMode = normalizeTenderMode(mode);
  if (!tenderMode || amount <= 0) return;
  total[tenderMode] = roundMoney(total[tenderMode] + amount);
}

function billEmbeddedTender(bill: LocalBill): { cash: number; upi: number } {
  const billRecord = bill as RecordLike & { payments?: LocalPayment[] };
  const rawPayments = Array.isArray(billRecord.payments) ? billRecord.payments : [];
  const billId = getBillId(bill);
  const customerId = getCustomerId(bill);
  if (rawPayments.length > 0) {
    const normalizedPayments: LocalPayment[] = rawPayments.map((payment) => ({
      ...payment,
      billId: payment.billId ?? payment.bill_id ?? billId ?? undefined,
      bill_id: payment.bill_id ?? payment.billId ?? billId ?? undefined,
      customerId: payment.customerId ?? payment.customer_id ?? customerId ?? undefined,
      customer_id: payment.customer_id ?? payment.customerId ?? customerId ?? undefined,
      paid_at: String(payment.paid_at ?? payment.paidAt ?? payment.created_at ?? payment.createdAt ?? bill.created_at ?? bill.createdAt ?? ""),
      paidAt: String(payment.paidAt ?? payment.paid_at ?? payment.createdAt ?? payment.created_at ?? bill.createdAt ?? bill.created_at ?? ""),
    }));
    const payments = dedupePaymentsForDisplay(normalizedPayments).filter(isActivePayment);
    return {
      cash: roundMoney(
        payments
          .filter((payment) => paymentMode(payment) === "cash")
          .reduce((sum, payment) => sum + paymentAmount(payment), 0),
      ),
      upi: roundMoney(
        payments
          .filter((payment) => paymentMode(payment) === "upi")
          .reduce((sum, payment) => sum + paymentAmount(payment), 0),
      ),
    };
  }

  return {
    cash: roundMoney(readNumber(bill.cashAmount ?? bill.cash_amount, 0)),
    upi: roundMoney(readNumber(bill.upiAmount ?? bill.upi_amount, 0)),
  };
}

function sumBillEmbeddedTender(bills: LocalBill[]): { cash: number; upi: number } {
  return bills.reduce(
    (sum, bill) => {
      const tender = billEmbeddedTender(bill);
      sum.cash = roundMoney(sum.cash + tender.cash);
      sum.upi = roundMoney(sum.upi + tender.upi);
      return sum;
    },
    { cash: 0, upi: 0 },
  );
}

function paymentTimeBucket(payment: LocalPayment): string {
  const value = payment.paid_at ?? payment.paidAt ?? payment.created_at ?? payment.createdAt ?? "";
  const time = new Date(String(value)).getTime();
  if (!Number.isFinite(time)) return String(value).slice(0, 16);
  return String(Math.floor(time / (5 * 60 * 1000)));
}

function tenderEchoKeys(payment: LocalPayment): string[] {
  const mode = paymentMode(payment);
  if (mode !== "cash" && mode !== "upi" && mode !== "bank" && mode !== "card") return [];
  const amount = paymentAmount(payment);
  if (amount <= 0) return [];
  const bucket = paymentTimeBucket(payment);
  const customer = getCustomerId(payment) ?? "walk-in";
  const tenderMode = mode === "bank" || mode === "card" ? "upi" : mode;
  return [
    `${customer}|${tenderMode}|${amount.toFixed(2)}|${bucket}`,
    `*|${tenderMode}|${amount.toFixed(2)}|${bucket}`,
  ];
}

function billTenderPaymentRows(bill: LocalBill): LocalPayment[] {
  const billRecord = bill as RecordLike & { payments?: LocalPayment[] };
  const rawPayments = Array.isArray(billRecord.payments) ? billRecord.payments : [];
  const billId = getBillId(bill);
  const customerId = getCustomerId(bill);
  const paidAt = String(bill.createdAt ?? bill.created_at ?? "");
  if (rawPayments.length > 0) {
    return rawPayments.map((payment) => ({
      ...payment,
      billId: payment.billId ?? payment.bill_id ?? billId ?? undefined,
      bill_id: payment.bill_id ?? payment.billId ?? billId ?? undefined,
      customerId: payment.customerId ?? payment.customer_id ?? customerId ?? undefined,
      customer_id: payment.customer_id ?? payment.customerId ?? customerId ?? undefined,
      paidAt: String(payment.paidAt ?? payment.paid_at ?? payment.createdAt ?? payment.created_at ?? paidAt),
      paid_at: String(payment.paid_at ?? payment.paidAt ?? payment.created_at ?? payment.createdAt ?? paidAt),
      createdAt: String(payment.createdAt ?? payment.created_at ?? payment.paidAt ?? payment.paid_at ?? paidAt),
      created_at: String(payment.created_at ?? payment.createdAt ?? payment.paid_at ?? payment.paidAt ?? paidAt),
    }));
  }

  const cash = readNumber(bill.cashAmount ?? bill.cash_amount, 0);
  const upi = readNumber(bill.upiAmount ?? bill.upi_amount, 0);
  return [
    ...(cash > 0 ? [{
      id: `${billId ?? "bill"}:cash`,
      billId: billId ?? undefined,
      bill_id: billId ?? undefined,
      customerId: customerId ?? undefined,
      customer_id: customerId ?? undefined,
      mode: "cash",
      amount: cash,
      paidAt,
      paid_at: paidAt,
      createdAt: paidAt,
      created_at: paidAt,
    } as LocalPayment] : []),
    ...(upi > 0 ? [{
      id: `${billId ?? "bill"}:upi`,
      billId: billId ?? undefined,
      bill_id: billId ?? undefined,
      customerId: customerId ?? undefined,
      customer_id: customerId ?? undefined,
      mode: "upi",
      amount: upi,
      paidAt,
      paid_at: paidAt,
      createdAt: paidAt,
      created_at: paidAt,
    } as LocalPayment] : []),
  ];
}

function buildRangeSaleTenderEchoKeys(
  rangeBills: LocalBill[],
  payments: LocalPayment[],
  billIds: Set<string>,
  range: DateRange,
): Set<string> {
  const rows = [
    ...rangeBills.flatMap(billTenderPaymentRows),
    ...payments.filter((payment) => {
      if (!isActivePayment(payment) || !isWithinRange(payment, range)) return false;
      return billReferenceIds(payment).some((billId) => billIds.has(billId));
    }),
  ];
  const keys = new Set<string>();
  for (const payment of dedupeTenderPaymentRows(rows)) tenderEchoKeys(payment).forEach((key) => keys.add(key));
  return keys;
}

function dedupeTenderPaymentRows(payments: LocalPayment[]): LocalPayment[] {
  const picked = new Map<string, LocalPayment>();
  for (const payment of payments) {
    const mode = paymentMode(payment);
    if (mode !== "cash" && mode !== "upi") continue;
    const amount = paymentAmount(payment);
    if (amount <= 0) continue;
    const key = tenderEchoKeys(payment)[0];
    if (!key) continue;
    const previous = picked.get(key);
    if (!previous) {
      picked.set(key, payment);
      continue;
    }
    const previousPriority = String(previous.sync_status ?? previous.status ?? "").toLowerCase() === "synced" ? 1 : 0;
    const currentPriority = String(payment.sync_status ?? payment.status ?? "").toLowerCase() === "synced" ? 1 : 0;
    if (currentPriority > previousPriority) picked.set(key, payment);
  }
  return [...picked.values()];
}

function sumLinkedTenderPayments(payments: LocalPayment[], billIds: Set<string>, range: DateRange): { cash: number; upi: number } {
  const rows = dedupeTenderPaymentRows(
    payments.filter((payment) => {
      if (!isActivePayment(payment) || !isWithinRange(payment, range)) return false;
      return billReferenceIds(payment).some((billId) => billIds.has(billId));
    }),
  );
  return rows.reduce<{ cash: number; upi: number }>(
    (sum, payment) => {
      if (paymentMode(payment) === "cash") sum.cash = roundMoney(sum.cash + paymentAmount(payment));
      if (paymentMode(payment) === "upi") sum.upi = roundMoney(sum.upi + paymentAmount(payment));
      return sum;
    },
    { cash: 0, upi: 0 },
  );
}

function combineBillTenderWithPaymentFallback(
  bills: LocalBill[],
  payments: LocalPayment[],
  billIds: Set<string>,
  range: DateRange,
): { cash: number; upi: number } {
  const embedded = sumBillEmbeddedTender(bills);
  if (embedded.cash > 0 || embedded.upi > 0) return embedded;
  return sumLinkedTenderPayments(payments, billIds, range);
}

const BILL_REFERENCE_KEYS = [
  "billId",
  "bill_id",
  "localBillId",
  "local_bill_id",
  "clientBillId",
  "client_bill_id",
  "serverBillId",
  "server_bill_id",
] as const;

const BILL_SELF_ID_KEYS = [
  "id",
  "local_id",
  "localId",
  "server_id",
  "serverId",
  "billNo",
  "billNumber",
  "bill_no",
  "bill_number",
] as const;

function readIdentityValues(row: RecordLike, keys: readonly string[]): string[] {
  return Array.from(new Set(keys
    .map((key) => row[key])
    .map((value) => {
      if (typeof value === "string") return value.trim();
      if (typeof value === "number" && Number.isFinite(value)) return String(value);
      return "";
    })
    .filter(Boolean)));
}

function looksLikeBill(row: RecordLike): boolean {
  return Boolean(row.billNo ?? row.billNumber ?? row.billType ?? row.bill_type ?? row.grandTotal ?? row.totalAmount ?? row.netAmount);
}

function billReferenceIds(row: RecordLike): string[] {
  return readIdentityValues(row, BILL_REFERENCE_KEYS);
}

function billIdentityIds(bill: LocalBill): string[] {
  return Array.from(new Set([...billReferenceIds(bill), ...readIdentityValues(bill, BILL_SELF_ID_KEYS)]));
}

function paymentIdentityIds(payment: RecordLike): string[] {
  return readIdentityValues(payment, [
    "id",
    "local_id",
    "localId",
    "server_id",
    "serverId",
    "paymentId",
    "payment_id",
    "clientPaymentId",
    "client_payment_id",
  ]);
}

function ledgerPaymentReferenceIds(entry: RecordLike): string[] {
  return readIdentityValues(entry, [
    "paymentId",
    "payment_id",
    "source_id",
    "sourceId",
    "localPaymentId",
    "local_payment_id",
    "serverPaymentId",
    "server_payment_id",
  ]);
}

function paymentByIdentity(payments: LocalPayment[]): Map<string, LocalPayment> {
  const lookup = new Map<string, LocalPayment>();
  for (const payment of payments) {
    for (const id of paymentIdentityIds(payment)) {
      if (!lookup.has(id)) lookup.set(id, payment);
    }
  }
  return lookup;
}

function ledgerTenderMode(entry: RecordLike, paymentsByIdentity: Map<string, LocalPayment>): "cash" | "upi" {
  const direct = normalizeTenderMode(String(entry.mode ?? entry.paymentMode ?? entry.payment_mode ?? "").toLowerCase());
  if (direct) return direct;

  for (const paymentId of ledgerPaymentReferenceIds(entry)) {
    const payment = paymentsByIdentity.get(paymentId);
    const mode = payment ? normalizeTenderMode(paymentMode(payment)) : null;
    if (mode) return mode;
  }

  return "cash";
}

function buildRangeSaleTenderAllowance(rangeBills: LocalBill[]): TenderTotal {
  const allowance: TenderTotal = { cash: 0, upi: 0 };
  for (const payment of dedupeTenderPaymentRows(rangeBills.flatMap(billTenderPaymentRows))) {
    addTender(allowance, paymentMode(payment), paymentAmount(payment));
  }
  return allowance;
}

function subtractLikelySaleEcho(total: number, saleAllowance: number): number {
  if (saleAllowance > 0 && total + 0.004 >= saleAllowance) {
    return roundMoney(Math.max(0, total - saleAllowance));
  }
  return roundMoney(total);
}

function getBillId(
  row: LocalBill | LocalBillItem | LocalPayment,
): string | null {
  const record = row as RecordLike;
  return billReferenceIds(record)[0] ?? (looksLikeBill(record) ? readIdentityValues(record, BILL_SELF_ID_KEYS)[0] ?? null : null);
}

function getCustomerId(
  row: LocalBill | LocalPayment | CustomerLedgerEntry,
): string | null {
  const id = row.customerId ?? row.customer_id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function normalizeProductId(row: LocalBillItem): string | null {
  const id = row.productId ?? row.product_id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function buildBillIdSets(bills: LocalBill[], range?: DateRange) {
  const saleBillIds = new Set<string>();
  const rangeSaleBillIds = new Set<string>();
  const excludedBillIds = new Set<string>();

  for (const bill of bills) {
    const ids = billIdentityIds(bill);
    if (ids.length === 0) continue;
    if (isSaleBill(bill)) {
      ids.forEach((id) => saleBillIds.add(id));
      if (!range || isWithinRange(bill, range)) ids.forEach((id) => rangeSaleBillIds.add(id));
    } else {
      ids.forEach((id) => excludedBillIds.add(id));
    }
  }

  return { saleBillIds, rangeSaleBillIds, excludedBillIds };
}

function paymentBelongsToExcludedBill(
  payment: LocalPayment,
  excludedBillIds: Set<string>,
): boolean {
  return billReferenceIds(payment).some((billId) => excludedBillIds.has(billId));
}

function calculateBillItemProfit(
  rangeBills: LocalBill[],
  billItems: LocalBillItem[],
  products: Product[],
): number | null {
  const billIds = new Set(rangeBills.map((bill) => bill.id));
  const productById = new Map(products.map((product) => [product.id, product]));
  let profit = 0;
  let matchedItems = 0;

  for (const item of billItems.filter((row) => !isDeleted(row))) {
    const billId = getBillId(item);
    if (!billId || !billIds.has(billId)) continue;
    matchedItems += 1;
    const product = productById.get(normalizeProductId(item) ?? "");
    const quantity = Math.abs(readNumber(item.quantity, 0));
    const rate = readNumber(
      item.ratePerRateUnit ?? item.rate_per_rate_unit,
      productPrice(product),
    );
    const revenue =
      readNumber(item.line_total ?? item.lineTotal, 0) || quantity * rate;
    const cost = quantity * billItemCost(item, product);
    profit += revenue - cost;
  }

  return matchedItems > 0 ? roundMoney(profit) : null;
}

function summarizeBills(
  bills: LocalBill[],
  payments: LocalPayment[],
  range: DateRange,
  billItems: LocalBillItem[] = [],
  products: Product[] = [],
): ReportMetricWindow {
  const rangeBills = bills.filter(
    (bill) => isSaleBill(bill) && isWithinRange(bill, range),
  );
  const { rangeSaleBillIds } = buildBillIdSets(bills, range);
  // Dashboard/reports cash and UPI must come from the deduped bill set,
  // not from the raw payments table. The payments table can temporarily contain
  // both local pending rows and server rows after sync/retry, which is exactly
  // what caused cash/UPI to display 2x in one browser tab.
  const embeddedTender = combineBillTenderWithPaymentFallback(rangeBills, payments, rangeSaleBillIds, range);
  const itemProfit = calculateBillItemProfit(rangeBills, billItems, products);
  const billProfit = rangeBills.reduce(
    (sum, bill) => sum + readNumber(bill.grossProfit, 0),
    0,
  );

  return {
    sales: roundMoney(
      rangeBills.reduce((sum, bill) => sum + billTotal(bill), 0),
    ),
    bills: rangeBills.length,
    cashSales: embeddedTender.cash,
    upiSales: embeddedTender.upi,
    udharSales: roundMoney(
      rangeBills.reduce((sum, bill) => sum + billCredit(bill), 0),
    ),
    paymentsReceived: roundMoney(embeddedTender.cash + embeddedTender.upi),
    discount: roundMoney(
      rangeBills.reduce((sum, bill) => sum + billDiscount(bill), 0),
    ),
    profitEstimate: roundMoney(itemProfit ?? billProfit),
  };
}

function isPurchaseMovement(row: LocalInventoryMovement): boolean {
  return String(row.action ?? row.type ?? "").toLowerCase() === "purchase" && !isDeleted(row);
}

function purchaseBillAmount(row: LocalInventoryMovement): number {
  return roundMoney(readNumber(row.billAmount ?? row.bill_amount ?? row.purchaseBillAmount ?? row.purchase_bill_amount, 0));
}

function purchasePaidAmount(row: LocalInventoryMovement): number {
  const explicit = readNumber(row.purchasePaidAmount ?? row.purchase_paid_amount, NaN);
  if (Number.isFinite(explicit)) return roundMoney(Math.max(0, explicit));
  const status = String(row.purchasePaymentStatus ?? row.purchase_payment_status ?? "paid").toLowerCase();
  if (status === "due" || status === "unpaid") return 0;
  return purchaseBillAmount(row);
}

function purchaseDueAmount(row: LocalInventoryMovement): number {
  const explicit = readNumber(row.purchaseDueAmount ?? row.purchase_due_amount, NaN);
  if (Number.isFinite(explicit)) return roundMoney(Math.max(0, explicit));
  return roundMoney(Math.max(0, purchaseBillAmount(row) - purchasePaidAmount(row)));
}

function purchasePaymentMode(row: LocalInventoryMovement): string {
  return String(row.purchasePaymentMode ?? row.purchase_payment_mode ?? "cash").toLowerCase();
}

function calculatePurchasePaymentSummary(
  movements: LocalInventoryMovement[],
  range: DateRange,
): Pick<ReportPaymentBreakdown, "purchaseCashPaid" | "purchaseUpiPaid" | "purchasePaid" | "purchaseDue"> {
  const rows = movements.filter((row) => isPurchaseMovement(row) && isWithinRange(row, range));
  let cash = 0;
  let upi = 0;
  let paid = 0;
  let due = 0;
  for (const row of rows) {
    const paidAmount = purchasePaidAmount(row);
    const dueAmount = purchaseDueAmount(row);
    const mode = purchasePaymentMode(row);
    if (mode === "upi" || mode === "bank" || mode === "card") upi += paidAmount;
    else cash += paidAmount;
    paid += paidAmount;
    due += dueAmount;
  }
  return {
    purchaseCashPaid: roundMoney(cash),
    purchaseUpiPaid: roundMoney(upi),
    purchasePaid: roundMoney(paid),
    purchaseDue: roundMoney(due),
  };
}

function calculatePaymentBreakdown(
  bills: LocalBill[],
  payments: LocalPayment[],
  ledger: CustomerLedgerEntry[],
  purchases: LocalInventoryMovement[],
  range: DateRange,
): ReportPaymentBreakdown {
  const { saleBillIds, rangeSaleBillIds, excludedBillIds } = buildBillIdSets(
    bills,
    range,
  );
  const rangeBills = bills.filter(
    (bill) => isSaleBill(bill) && isWithinRange(bill, range),
  );
  const embeddedTender = combineBillTenderWithPaymentFallback(rangeBills, payments, rangeSaleBillIds, range);
  const saleTenderAllowance = buildRangeSaleTenderAllowance(rangeBills);
  const activePayments = payments.filter(
    (payment) =>
      isActivePayment(payment) &&
      isWithinRange(payment, range) &&
      !paymentBelongsToExcludedBill(payment, excludedBillIds),
  );
  const oldUdharLedgerEntries = ledger
    .filter(
      (entry) =>
        !isDeleted(entry) &&
        isWithinRange(entry, range) &&
        normaliseLedgerType(entry.type, entry.source_type) === "PAYMENT",
    )
    .filter((entry) => {
      const billIds = billReferenceIds(entry as RecordLike);
      return billIds.length === 0 || !billIds.some((billId) => saleBillIds.has(billId) && rangeSaleBillIds.has(billId));
    });
  const paymentsByIdentity = paymentByIdentity(activePayments);
  const oldUdharLedgerPaymentIds = new Set(oldUdharLedgerEntries.flatMap((entry) => ledgerPaymentReferenceIds(entry as RecordLike)));
  const oldUdharFromLedger = oldUdharLedgerEntries
    .reduce<TenderTotal>((sum, entry) => {
      addTender(sum, ledgerTenderMode(entry as RecordLike, paymentsByIdentity), Math.abs(ledgerSignedAmount(entry)));
      return sum;
    }, { cash: 0, upi: 0 });
  const oldBillPaymentFallback = { cash: 0, upi: 0 };
  const unlinkedPaymentFallback = { cash: 0, upi: 0 };

  for (const payment of activePayments) {
    if (paymentIdentityIds(payment).some((paymentId) => oldUdharLedgerPaymentIds.has(paymentId))) continue;
    const billIds = billReferenceIds(payment);
    if (billIds.some((billId) => saleBillIds.has(billId) && rangeSaleBillIds.has(billId))) continue;
    if (billIds.some((billId) => saleBillIds.has(billId))) {
      addTender(oldBillPaymentFallback, paymentMode(payment), paymentAmount(payment));
      continue;
    }
    if (billIds.length > 0 || !getCustomerId(payment)) continue;
    addTender(unlinkedPaymentFallback, paymentMode(payment), paymentAmount(payment));
  }

  const unlinkedOldUdharFallback = {
    cash: subtractLikelySaleEcho(unlinkedPaymentFallback.cash, saleTenderAllowance.cash),
    upi: subtractLikelySaleEcho(unlinkedPaymentFallback.upi, saleTenderAllowance.upi),
  };
  const udhar = rangeBills.reduce((sum, bill) => sum + billCredit(bill), 0);
  const oldUdharCashReceived = roundMoney(oldUdharFromLedger.cash + oldBillPaymentFallback.cash + unlinkedOldUdharFallback.cash);
  const oldUdharUpiReceived = roundMoney(oldUdharFromLedger.upi + oldBillPaymentFallback.upi + unlinkedOldUdharFallback.upi);
  const oldUdharReceived = roundMoney(oldUdharCashReceived + oldUdharUpiReceived);
  const purchaseSummary = calculatePurchasePaymentSummary(purchases, range);
  const cashIn = roundMoney(embeddedTender.cash + oldUdharCashReceived);
  const upiIn = roundMoney(embeddedTender.upi + oldUdharUpiReceived);
  return {
    cash: embeddedTender.cash,
    upi: embeddedTender.upi,
    udhar: roundMoney(udhar),
    received: roundMoney(embeddedTender.cash + embeddedTender.upi),
    oldUdharReceived: roundMoney(oldUdharReceived),
    oldUdharCashReceived: roundMoney(oldUdharCashReceived),
    oldUdharUpiReceived: roundMoney(oldUdharUpiReceived),
    cashIn,
    upiIn,
    ...purchaseSummary,
    netCashInHand: roundMoney(cashIn - purchaseSummary.purchaseCashPaid),
    netUpiInBank: roundMoney(upiIn - purchaseSummary.purchaseUpiPaid),
  };
}

function calculatePendingUdhar(ledger: CustomerLedgerEntry[], customers: Customer[] = []): number {
  const grouped = new Map<string, CustomerLedgerEntry[]>();
  for (const entry of ledger.filter((row) => !isDeleted(row))) {
    const customerId = getCustomerId(entry);
    if (!customerId) continue;
    const list = grouped.get(customerId) ?? [];
    list.push(entry);
    grouped.set(customerId, list);
  }
  let total = 0;
  for (const entries of grouped.values())
    total += Math.max(0, calculateLedgerBalance(entries));

  // Some older/local builds update customer.udharAmount before ledger rows exist.
  // Use customer balances only as a fallback so Dashboard never shows ₹0 udhar
  // while customers clearly still have pending balances.
  if (grouped.size === 0) {
    total = customers
      .filter((customer) => !isDeleted(customer as unknown as RecordLike))
      .reduce(
        (sum, customer) =>
          sum + Math.max(0, readNumber(customer.udharAmount ?? customer.totalUdhar, 0)),
        0,
      );
  }
  return roundMoney(total);
}

function calculateTopCustomers(
  bills: LocalBill[],
  ledger: CustomerLedgerEntry[],
  customers: Customer[],
  range: DateRange,
): ReportTopCustomer[] {
  const rows = new Map<string, ReportTopCustomer>();
  const customerById = new Map(
    customers.map((customer) => [customer.id, customer]),
  );
  for (const bill of bills.filter(
    (row) => isSaleBill(row) && isWithinRange(row, range),
  )) {
    const customerId = getCustomerId(bill) ?? "walk-in";
    const customer = customerById.get(customerId);
    const existing = rows.get(customerId) ?? {
      customerId,
      name:
        customer?.name ??
        bill.customerName ??
        (customerId === "walk-in" ? "Walk-in customers" : "Customer"),
      mobile: customer?.mobile ?? bill.customerMobile ?? null,
      sales: 0,
      balance: 0,
      bills: 0,
    };
    existing.sales = roundMoney(existing.sales + billTotal(bill));
    existing.bills += 1;
    rows.set(customerId, existing);
  }
  const ledgerGroups = new Map<string, CustomerLedgerEntry[]>();
  for (const entry of ledger.filter((row) => !isDeleted(row))) {
    const customerId = getCustomerId(entry);
    if (!customerId) continue;
    const group = ledgerGroups.get(customerId) ?? [];
    group.push(entry);
    ledgerGroups.set(customerId, group);
  }
  for (const [customerId, entries] of ledgerGroups.entries()) {
    const customer = customerById.get(customerId);
    const row = rows.get(customerId) ?? {
      customerId,
      name: customer?.name ?? "Customer",
      mobile: customer?.mobile ?? null,
      sales: 0,
      balance: 0,
      bills: 0,
    };
    row.balance = Math.max(0, calculateLedgerBalance(entries));
    rows.set(customerId, row);
  }
  return [...rows.values()]
    .sort((a, b) => b.sales - a.sales || b.balance - a.balance)
    .slice(0, 10);
}

function calculateTopProducts(
  bills: LocalBill[],
  billItems: LocalBillItem[],
  products: Product[],
  range: DateRange,
): ReportTopProduct[] {
  const billById = new Map(
    bills
      .filter((bill) => isSaleBill(bill) && isWithinRange(bill, range))
      .map((bill) => [bill.id, bill]),
  );
  const productById = new Map(products.map((product) => [product.id, product]));
  const rows = new Map<string, ReportTopProduct>();

  for (const item of billItems.filter((row) => !isDeleted(row))) {
    const billId = getBillId(item);
    if (!billId || !billById.has(billId)) continue;
    const productId =
      normalizeProductId(item) ?? `custom:${String(item.name ?? "item")}`;
    const product = productById.get(productId);
    const quantity = Math.abs(readNumber(item.quantity, 0));
    const revenue = roundMoney(
      readNumber(item.line_total, 0) ||
        quantity *
          readNumber(
            item.ratePerRateUnit ?? item.rate_per_rate_unit,
            productPrice(product),
          ),
    );
    const profit = roundMoney(revenue - quantity * billItemCost(item, product));
    const existing = rows.get(productId) ?? {
      productId,
      name: product?.name ?? String(item.name ?? "Custom item"),
      quantitySold: 0,
      revenue: 0,
      profitEstimate: 0,
    };
    existing.quantitySold = roundMoney(existing.quantitySold + quantity);
    existing.revenue = roundMoney(existing.revenue + revenue);
    existing.profitEstimate = roundMoney(existing.profitEstimate + profit);
    rows.set(productId, existing);
  }

  return [...rows.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 10);
}

function calculateLowStock(products: Product[]): ReportLowStockItem[] {
  return products
    .filter(
      (product) =>
        !isDeleted(product as unknown as RecordLike) &&
        (product.stockTrackingEnabled ?? product.trackStock ?? true),
    )
    .map((product) => {
      const stock = readNumber(
        product.stockBaseQty ?? product.stockQuantity,
        0,
      );
      const threshold = readNumber(
        product.lowStockThreshold ?? product.lowStockAlert,
        0,
      );
      return { product, stock, threshold };
    })
    .filter(({ threshold, stock }) => threshold > 0 && stock <= threshold)
    .sort((a, b) => a.stock - b.stock)
    .slice(0, 20)
    .map(({ product, stock, threshold }) => ({
      productId: product.id,
      name: product.name,
      category: product.category,
      stock,
      threshold,
      unit: product.stockUnit ?? product.unit ?? product.displayUnit,
    }));
}

function calculateStaffSales(
  bills: LocalBill[],
  range: DateRange,
): StaffSalesRow[] {
  const rows = new Map<string, StaffSalesRow>();
  for (const bill of bills.filter(
    (row) => isSaleBill(row) && isWithinRange(row, range),
  )) {
    const staffId = String(
      bill.staffId ??
        bill.staff_id ??
        bill.createdBy ??
        bill.created_by ??
        "owner",
    );
    const staffName = String(
      bill.staffName ??
        bill.staff_name ??
        (staffId === "owner" ? "Owner / main counter" : staffId),
    );
    const existing = rows.get(staffId) ?? {
      staffId,
      staffName,
      sales: 0,
      bills: 0,
    };
    existing.sales = roundMoney(existing.sales + billTotal(bill));
    existing.bills += 1;
    rows.set(staffId, existing);
  }
  return [...rows.values()].sort((a, b) => b.sales - a.sales).slice(0, 10);
}

function syncCounters(outbox: PendingSyncEvent[]) {
  const pending = outbox.filter(
    (op) => op.status === "PENDING" || op.sync_status === "pending_sync",
  ).length;
  const failed = outbox.filter(
    (op) => op.status === "FAILED" || op.sync_status === "failed",
  ).length;
  const conflicts = outbox.filter(
    (op) => op.status === "CONFLICT" || op.sync_status === "conflict",
  ).length;
  return { pending, failed, conflicts };
}

export async function buildLocalReportSnapshot(
  range: DateRange,
): Promise<LocalReportSnapshot> {
  // Self-heal duplicate local/server financial echoes before calculating money.
  // This keeps Dashboard/Reports/Udhar consistent even after older builds left
  // stale pending payment or ledger rows in IndexedDB.
  await hardenLocalFinancialData().catch(() => undefined);
  const [
    billsRaw,
    billItemsRaw,
    paymentsRaw,
    ledgerRaw,
    productsRaw,
    customersRaw,
    inventoryMovementsRaw,
    outboxRaw,
  ] = await Promise.all([
    offlineDB.getAll<LocalBill>("bills").catch(() => []),
    offlineDB.getAll<LocalBillItem>("bill_items").catch(() => []),
    offlineDB.getAll<LocalPayment>("payments").catch(() => []),
    offlineDB.getAll<CustomerLedgerEntry>("customer_ledger").catch(() => []),
    offlineDB.getAll<Product>("products").catch(() => []),
    offlineDB.getAll<Customer>("customers").catch(() => []),
    offlineDB.getAll<LocalInventoryMovement>("inventory_movements").catch(() => []),
    offlineDB.getAll<PendingSyncEvent>("sync_outbox").catch(() => []),
  ]);

  const bills = dedupeBillsForDashboardReports(filterRowsForCurrentScope(billsRaw));
  const billItems = filterRowsForCurrentScope(billItemsRaw);
  const payments = dedupePaymentsForDisplay(filterRowsForCurrentScope(paymentsRaw));
  // Dashboard/reports must use the same deduped ledger view as the Udhar page.
  // Otherwise a local pending bill-ledger row plus the server synced ledger row
  // can double the customer outstanding after sync.
  const ledger = dedupeLedgerEntries(filterRowsForCurrentScope(ledgerRaw));
  const products = filterRowsForCurrentScope(productsRaw);
  const customers = filterRowsForCurrentScope(customersRaw);
  const inventoryMovements = filterRowsForCurrentScope(inventoryMovementsRaw);
  const outbox = filterRowsForCurrentScope(outboxRaw);

  const today = toDateInputValue(new Date());
  const todayRange = { from: today, to: today };
  const sevenDayRange = {
    from: toDateInputValue(addDays(startOfLocalDay(), -6)),
    to: today,
  };
  const thirtyDayRange = {
    from: toDateInputValue(addDays(startOfLocalDay(), -29)),
    to: today,
  };
  const counters = syncCounters(outbox);
  const selected = summarizeBills(bills, payments, range, billItems, products);
  const paymentBreakdown = calculatePaymentBreakdown(
    bills,
    payments,
    ledger,
    inventoryMovements,
    range,
  );
  const hasLocalData =
    bills.length > 0 ||
    payments.length > 0 ||
    ledger.length > 0 ||
    products.length > 0 ||
    inventoryMovements.length > 0;

  return {
    generatedAt: new Date().toISOString(),
    range,
    today: summarizeBills(bills, payments, todayRange, billItems, products),
    sevenDay: summarizeBills(
      bills,
      payments,
      sevenDayRange,
      billItems,
      products,
    ),
    thirtyDay: summarizeBills(
      bills,
      payments,
      thirtyDayRange,
      billItems,
      products,
    ),
    selected,
    paymentBreakdown,
    pendingUdhar: calculatePendingUdhar(ledger, customers),
    topCustomers: calculateTopCustomers(bills, ledger, customers, range),
    topProducts: calculateTopProducts(bills, billItems, products, range),
    lowStock: calculateLowStock(products),
    staffSales: calculateStaffSales(bills, range),
    pendingSyncCount: counters.pending,
    failedSyncCount: counters.failed,
    conflictCount: counters.conflicts,
    hasUnsyncedOperations:
      counters.pending + counters.failed + counters.conflicts > 0,
    hasLocalData,
    dataSourceLabel:
      counters.pending + counters.failed + counters.conflicts > 0
        ? "Local estimate"
        : "Local confirmed data",
  };
}

export async function buildDailyClosingReport(
  date: string,
): Promise<DailyClosingReport> {
  const range = { from: date, to: date };
  const snapshot = await buildLocalReportSnapshot(range);
  return {
    date,
    totalSales: snapshot.selected.sales,
    cashReceived: snapshot.paymentBreakdown.cashIn,
    upiReceived: snapshot.paymentBreakdown.upiIn,
    udharGiven: snapshot.paymentBreakdown.udhar,
    oldUdharPaymentReceived: snapshot.paymentBreakdown.oldUdharReceived,
    purchaseCashPaid: snapshot.paymentBreakdown.purchaseCashPaid,
    purchaseUpiPaid: snapshot.paymentBreakdown.purchaseUpiPaid,
    purchasePaid: snapshot.paymentBreakdown.purchasePaid,
    purchaseDue: snapshot.paymentBreakdown.purchaseDue,
    expectedCashInDrawer: snapshot.paymentBreakdown.netCashInHand,
    expectedUpiInBank: snapshot.paymentBreakdown.netUpiInBank,
    topSoldProducts: snapshot.topProducts.slice(0, 8),
    lowStockItems: snapshot.lowStock.slice(0, 8),
    pendingSyncCount: snapshot.pendingSyncCount,
    failedSyncCount: snapshot.failedSyncCount,
    conflictCount: snapshot.conflictCount,
    isLocalEstimate: snapshot.hasUnsyncedOperations,
    generatedAt: snapshot.generatedAt,
  };
}

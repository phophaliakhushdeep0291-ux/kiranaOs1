import { filterRowsForCurrentScope, offlineDB } from "@/lib/offline/db";
import type { Bill, Customer, Product, Supplier } from "@/types/api";
import {
  calculateLedgerBalance,
  dedupeLedgerEntries,
  ledgerSignedAmount,
  normaliseLedgerType,
  type CustomerLedgerEntry,
} from "@/features/ledger/accounting";
import {
  dedupeBillsForDisplay,
  dedupePaymentsForDisplay,
} from "@/features/sync/bill-reconciliation";
import { hardenLocalFinancialData } from "@/features/sync/local-data-hardening";

type RecordLike = Record<string, unknown>;

type LocalBill = Bill & RecordLike;
type LocalPayment = RecordLike;
type LocalBillItem = RecordLike;
type LocalInventoryMovement = RecordLike;
type LocalPurchaseBill = RecordLike;

export interface FinancialAggregationInput {
  bills?: LocalBill[];
  billItems?: LocalBillItem[];
  payments?: LocalPayment[];
  ledger?: CustomerLedgerEntry[];
  products?: Product[];
  customers?: Customer[];
  suppliers?: Supplier[];
  inventoryMovements?: LocalInventoryMovement[];
  purchaseBills?: LocalPurchaseBill[];
  date?: string;
  generatedAt?: string;
}

export interface RevenueBreakdownRow {
  billId: string;
  billNo: string;
  customerId: string | null;
  customerName: string;
  amount: number;
  cash: number;
  upi: number;
  udhar: number;
  date: string;
  status: string;
}

export interface ProfitByProductRow {
  productId: string;
  productName: string;
  quantity: number;
  revenue: number;
  cost: number;
  profit: number;
  marginPct: number;
}

export interface CollectionBreakdown {
  cashSalesToday: number;
  upiSalesToday: number;
  cashUdharRecoveryToday: number;
  upiUdharRecoveryToday: number;
  totalCashCollectedToday: number;
  totalUpiCollectedToday: number;
}

export interface SupplierDueRow {
  id: string;
  supplierId: string | null;
  supplierName: string;
  invoiceNumber: string;
  date: string;
  amount: number;
  paid: number;
  due: number;
  paymentMode: string;
  status: string;
  source: "purchase_bill" | "inventory_movement";
}

interface SupplierDueCandidate extends SupplierDueRow {
  dedupeKeys: string[];
  priority: number;
}

export interface CashDrawerSummary {
  openingCash: number;
  cashSales: number;
  cashUdharRecovery: number;
  supplierCashPaid: number;
  expenses: number;
  ownerWithdrawals: number;
  expectedClosingCash: number;
}

export interface FinancialAggregationSnapshot {
  generatedAt: string;
  date: string;
  revenueToday: number;
  profitToday: number;
  grossMarginPct: number;
  cashSalesToday: number;
  upiSalesToday: number;
  udharSalesToday: number;
  cashUdharRecoveryToday: number;
  upiUdharRecoveryToday: number;
  totalCashCollectedToday: number;
  totalUpiCollectedToday: number;
  totalOutstandingUdhar: number;
  totalBillsToday: number;
  totalCustomersWithUdhar: number;
  revenueBreakdown: RevenueBreakdownRow[];
  profitByProduct: ProfitByProductRow[];
  collectionBreakdown: CollectionBreakdown;
  supplierDue: number;
  supplierDueRows: SupplierDueRow[];
  supplierCashPaidToday: number;
  supplierUpiPaidToday: number;
  purchaseDueToday: number;
  expensesToday: number;
  ownerWithdrawalToday: number;
  cashDrawer: CashDrawerSummary;
  outstandingCustomers: Array<{
    customerId: string;
    customerName: string;
    mobile?: string | null;
    outstanding: number;
  }>;
  hasLocalData: boolean;
  dataSourceLabel: string;
}

function todayInputValue(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function readNumber(value: unknown, fallback = 0): number {
  const num = Number(value ?? fallback);
  return Number.isFinite(num) ? num : fallback;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
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

function isRecord(value: unknown): value is RecordLike {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDeleted(row: RecordLike): boolean {
  const status = String(row.status ?? row.purchasePaymentStatus ?? row.purchase_payment_status ?? "").toLowerCase();
  return Boolean(row.deleted_at ?? row.deletedAt ?? row.merged_into_id ?? row.mergedIntoId) || status === "deleted";
}

function getDateValue(row: RecordLike): string {
  return readString(row, [
    "createdAt",
    "created_at",
    "billDate",
    "bill_date",
    "paidAt",
    "paid_at",
    "entry_at",
    "updatedAt",
    "updated_at",
  ]);
}

function isWithinDate(row: RecordLike, date: string): boolean {
  const raw = getDateValue(row);
  if (!raw) return false;
  const [year, month, day] = date.split("-").map(Number);
  const start = new Date(year, (month || 1) - 1, day || 1).getTime();
  const end = new Date(year, (month || 1) - 1, day || 1, 23, 59, 59, 999).getTime();
  const time = new Date(raw).getTime();
  return Number.isFinite(time) && time >= start && time <= end;
}

function billIdentityKeys(bill: RecordLike): string[] {
  return [
    readString(bill, ["id"]),
    readString(bill, ["local_id", "localId"]),
    readString(bill, ["server_id", "serverId"]),
    readString(bill, ["billId", "bill_id"]),
    readString(bill, ["clientBillId", "client_bill_id"]),
  ].filter(Boolean);
}

function getBillId(row: RecordLike, includeOwnId = false): string | null {
  const keys = includeOwnId
    ? ["billId", "bill_id", "reference_id", "source_id", "id"]
    : ["billId", "bill_id", "reference_id", "source_id"];
  const id = readString(row, keys);
  return id || null;
}

function getCustomerId(row: RecordLike): string | null {
  const id = readString(row, ["customerId", "customer_id"]);
  return id || null;
}

function paymentIdentityKeys(payment: RecordLike): string[] {
  return [
    readString(payment, ["id"]),
    readString(payment, ["server_id", "serverId"]),
    readString(payment, ["local_id", "localId"]),
    readString(payment, ["paymentId", "payment_id"]),
    readString(payment, ["clientPaymentId", "client_payment_id", "localPaymentId", "local_payment_id"]),
    readString(payment, ["idempotencyKey", "idempotency_key"]),
  ].filter(Boolean);
}

function ledgerPaymentReferenceKeys(entry: RecordLike): string[] {
  return [
    readString(entry, ["paymentId", "payment_id"]),
    readString(entry, ["source_id", "sourceId"]),
    readString(entry, ["localPaymentId", "local_payment_id"]),
    readString(entry, ["clientPaymentId", "client_payment_id"]),
  ].filter(Boolean);
}

function buildPaymentByIdentity(payments: LocalPayment[]): Map<string, LocalPayment> {
  const lookup = new Map<string, LocalPayment>();
  for (const payment of payments) {
    for (const key of paymentIdentityKeys(payment)) {
      if (!lookup.has(key)) lookup.set(key, payment);
    }
  }
  return lookup;
}

function getProductId(row: RecordLike): string | null {
  const id = readString(row, ["productId", "product_id"]);
  return id || null;
}

function isCancelledBill(bill: RecordLike): boolean {
  return String(bill.status ?? "").toLowerCase().includes("cancel");
}

function isEstimateBill(bill: RecordLike): boolean {
  const type = String(bill.billType ?? bill.bill_type ?? "").toLowerCase();
  const status = String(bill.status ?? "").toLowerCase();
  return type.includes("estimate") || type.includes("rough") || status.includes("rough");
}

function isSaleBill(bill: RecordLike): boolean {
  return !isDeleted(bill) && !isCancelledBill(bill) && !isEstimateBill(bill);
}

function billTotal(bill: RecordLike): number {
  return roundMoney(
    readNumber(
      bill.grandTotal ??
        bill.grand_total ??
        bill.totalAmount ??
        bill.total_amount ??
        bill.netAmount ??
        bill.net_amount ??
        bill.actualAmount ??
        bill.actual_amount,
      0,
    ),
  );
}

function billPaid(bill: RecordLike): number {
  return roundMoney(readNumber(bill.paidAmount ?? bill.paid_amount ?? bill.buyerPaidAmount ?? bill.buyer_paid_amount, 0));
}

function billCredit(bill: RecordLike): number {
  const explicit = readNumber(bill.creditAmount ?? bill.credit_amount ?? bill.dueAmount ?? bill.due_amount, NaN);
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
  return readNumber(product?.costPrice ?? product?.costPerRateUnit ?? product?.averageCostPrice, 0);
}

function itemUnitCost(item: RecordLike, product?: Product): number {
  return readNumber(
    item.costPerRateUnit ??
      item.cost_per_rate_unit ??
      item.costPrice ??
      item.cost_price,
    productCost(product),
  );
}

function paymentAmount(payment: RecordLike): number {
  return roundMoney(readNumber(payment.amount ?? payment.paidAmount ?? payment.paid_amount, 0));
}

function paymentMode(payment: RecordLike): string {
  const mode = String(payment.mode ?? payment.paymentMode ?? payment.payment_mode ?? "cash").toLowerCase();
  if (mode === "bank" || mode === "card") return "upi";
  return mode;
}

function isActivePayment(payment: RecordLike): boolean {
  const status = String(payment.status ?? payment.sync_status ?? "").toLowerCase();
  return !isDeleted(payment) && !payment.reversed_at && !payment.reversedAt && status !== "reversed" && status !== "cancelled";
}

function isActiveLedgerEntry(entry: CustomerLedgerEntry): boolean {
  return !isDeleted(entry) && !entry.reversed_at && !entry.reversedAt;
}

function normalizeEmbeddedPayments(bill: RecordLike): LocalPayment[] {
  const raw = Array.isArray(bill.payments) ? bill.payments : [];
  const billId = getBillId(bill, true) ?? undefined;
  const customerId = getCustomerId(bill) ?? undefined;
  return raw.filter(isRecord).map((payment) => ({
    ...payment,
    billId: payment.billId ?? payment.bill_id ?? billId,
    bill_id: payment.bill_id ?? payment.billId ?? billId,
    customerId: payment.customerId ?? payment.customer_id ?? customerId,
    customer_id: payment.customer_id ?? payment.customerId ?? customerId,
    paidAt: payment.paidAt ?? payment.paid_at ?? payment.createdAt ?? payment.created_at ?? bill.createdAt ?? bill.created_at,
    paid_at: payment.paid_at ?? payment.paidAt ?? payment.created_at ?? payment.createdAt ?? bill.created_at ?? bill.createdAt,
  }));
}

function sumPaymentTender(payments: LocalPayment[]): { cash: number; upi: number } {
  return dedupePaymentsForDisplay(payments)
    .filter((payment) => isActivePayment(payment))
    .reduce<{ cash: number; upi: number }>(
      (sum, payment) => {
        const mode = paymentMode(payment);
        if (mode === "cash") sum.cash = roundMoney(sum.cash + paymentAmount(payment));
        if (mode === "upi") sum.upi = roundMoney(sum.upi + paymentAmount(payment));
        return sum;
      },
      { cash: 0, upi: 0 },
    );
}

function billEmbeddedTender(bill: RecordLike): { cash: number; upi: number } {
  const embeddedPayments = normalizeEmbeddedPayments(bill);
  if (embeddedPayments.length > 0) return sumPaymentTender(embeddedPayments);
  return {
    cash: roundMoney(readNumber(bill.cashAmount ?? bill.cash_amount, 0)),
    upi: roundMoney(readNumber(bill.upiAmount ?? bill.upi_amount, 0)),
  };
}

function billLinkedTender(bill: RecordLike, payments: LocalPayment[]): { cash: number; upi: number } {
  const ids = new Set(billIdentityKeys(bill));
  if (ids.size === 0) return { cash: 0, upi: 0 };
  return sumPaymentTender(
    payments.filter((payment) => {
      const billId = getBillId(payment);
      return Boolean(billId && ids.has(billId));
    }),
  );
}

function tenderForBill(bill: RecordLike, payments: LocalPayment[]): { cash: number; upi: number } {
  const embedded = billEmbeddedTender(bill);
  if (embedded.cash > 0 || embedded.upi > 0) return embedded;
  return billLinkedTender(bill, payments);
}

function buildSaleBillIdSets(bills: LocalBill[], todayBills: LocalBill[]) {
  const saleBillIds = new Set<string>();
  const todaySaleBillIds = new Set<string>();
  for (const bill of bills.filter(isSaleBill)) {
    for (const id of billIdentityKeys(bill)) saleBillIds.add(id);
  }
  for (const bill of todayBills) {
    for (const id of billIdentityKeys(bill)) todaySaleBillIds.add(id);
  }
  return { saleBillIds, todaySaleBillIds };
}

interface TodayTenderSignature {
  customerId: string | null;
  mode: string;
  amount: number;
  timeMs: number;
}

function rowTimeMs(row: RecordLike): number {
  const raw = getDateValue(row);
  if (!raw) return NaN;
  return new Date(raw).getTime();
}

function paymentTimeMs(row: RecordLike): number {
  const raw = readString(row, ["paidAt", "paid_at", "createdAt", "created_at", "entry_at", "updatedAt", "updated_at"]);
  if (!raw) return NaN;
  return new Date(raw).getTime();
}

function pushTenderSignature(
  signatures: TodayTenderSignature[],
  customerId: string | null,
  mode: string,
  amount: number,
  timeMs: number,
) {
  if ((mode !== "cash" && mode !== "upi") || amount <= 0 || !Number.isFinite(timeMs)) return;
  signatures.push({ customerId, mode, amount: roundMoney(amount), timeMs });
}

function buildTodayTenderSignatures(todayBills: LocalBill[]): TodayTenderSignature[] {
  const signatures: TodayTenderSignature[] = [];
  for (const bill of todayBills) {
    const billCustomerId = getCustomerId(bill);
    const billTimeMs = rowTimeMs(bill);
    const embeddedPayments = normalizeEmbeddedPayments(bill).filter(isActivePayment);

    if (embeddedPayments.length > 0) {
      for (const payment of embeddedPayments) {
        pushTenderSignature(
          signatures,
          getCustomerId(payment) ?? billCustomerId,
          paymentMode(payment),
          paymentAmount(payment),
          paymentTimeMs(payment) || billTimeMs,
        );
      }
      continue;
    }

    const explicitTender = billEmbeddedTender(bill);
    pushTenderSignature(signatures, billCustomerId, "cash", explicitTender.cash, billTimeMs);
    pushTenderSignature(signatures, billCustomerId, "upi", explicitTender.upi, billTimeMs);
  }
  return signatures;
}

function paymentLooksLikeTodayBillTender(payment: LocalPayment, todayTenderSignatures: TodayTenderSignature[]): boolean {
  const mode = paymentMode(payment);
  if (mode !== "cash" && mode !== "upi") return false;
  const amount = paymentAmount(payment);
  if (amount <= 0) return false;
  const customerId = getCustomerId(payment);
  const paidTimeMs = paymentTimeMs(payment);
  if (!Number.isFinite(paidTimeMs)) return false;

  return todayTenderSignatures.some((signature) => {
    if (signature.mode !== mode) return false;
    if (Math.abs(signature.amount - amount) > 0.004) return false;
    if (customerId && signature.customerId && customerId !== signature.customerId) return false;
    return Math.abs(signature.timeMs - paidTimeMs) <= 15 * 60 * 1000;
  });
}

function addRecoveryTender(total: { cash: number; upi: number }, mode: string, amount: number) {
  if (mode === "cash") total.cash = roundMoney(total.cash + amount);
  if (mode === "upi") total.upi = roundMoney(total.upi + amount);
}

function subtractTenderAllowance(
  candidate: { cash: number; upi: number },
  allowance: { cash: number; upi: number },
): { cash: number; upi: number } {
  const subtractLikelySaleEcho = (total: number, saleAllowance: number) => {
    if (saleAllowance > 0 && total + 0.004 >= saleAllowance) return roundMoney(Math.max(0, total - saleAllowance));
    return roundMoney(total);
  };

  return {
    cash: subtractLikelySaleEcho(candidate.cash, allowance.cash),
    upi: subtractLikelySaleEcho(candidate.upi, allowance.upi),
  };
}

function buildTodayTenderAllowance(todayBills: LocalBill[], payments: LocalPayment[]): { cash: number; upi: number } {
  return todayBills.reduce<{ cash: number; upi: number }>(
    (sum, bill) => {
      const tender = tenderForBill(bill, payments);
      sum.cash = roundMoney(sum.cash + tender.cash);
      sum.upi = roundMoney(sum.upi + tender.upi);
      return sum;
    },
    { cash: 0, upi: 0 },
  );
}

function ledgerPaymentMode(entry: CustomerLedgerEntry, paymentsByIdentity: Map<string, LocalPayment>): string {
  const direct = readString(entry, ["mode", "paymentMode", "payment_mode"]);
  if (direct) return paymentMode({ mode: direct });
  for (const key of ledgerPaymentReferenceKeys(entry)) {
    const payment = paymentsByIdentity.get(key);
    if (payment) return paymentMode(payment);
  }
  return "cash";
}

function calculateOldUdharRecovery(
  payments: LocalPayment[],
  ledger: CustomerLedgerEntry[],
  bills: LocalBill[],
  todayBills: LocalBill[],
  date: string,
): { cash: number; upi: number } {
  const { saleBillIds, todaySaleBillIds } = buildSaleBillIdSets(bills, todayBills);
  const paymentsByIdentity = buildPaymentByIdentity(payments);
  const todayTenderAllowance = buildTodayTenderAllowance(todayBills, payments);
  const linkedPaymentIds = new Set<string>();
  const total = ledger
    .filter(
      (entry) =>
        isActiveLedgerEntry(entry) &&
        isWithinDate(entry, date) &&
        normaliseLedgerType(entry.type, entry.source_type) === "PAYMENT",
    )
    .filter((entry) => {
      const billId = getBillId(entry);
      return !billId || !saleBillIds.has(billId) || !todaySaleBillIds.has(billId);
    })
    .reduce<{ cash: number; upi: number }>(
      (sum, entry) => {
        for (const key of ledgerPaymentReferenceKeys(entry)) linkedPaymentIds.add(key);
        addRecoveryTender(sum, ledgerPaymentMode(entry, paymentsByIdentity), Math.abs(ledgerSignedAmount(entry)));
        return sum;
      },
      { cash: 0, upi: 0 },
    );

  const oldBillPaymentFallback = { cash: 0, upi: 0 };
  const unlinkedPaymentFallback = { cash: 0, upi: 0 };
  for (const payment of dedupePaymentsForDisplay(
    payments.filter((row) => isActivePayment(row) && isWithinDate(row, date)),
  )) {
    if (paymentIdentityKeys(payment).some((key) => linkedPaymentIds.has(key))) continue;
    const billId = getBillId(payment);
    const isKnownOldSaleBillPayment = Boolean(billId && saleBillIds.has(billId) && !todaySaleBillIds.has(billId));
    if (billId && todaySaleBillIds.has(billId)) continue;
    if (isKnownOldSaleBillPayment) {
      addRecoveryTender(oldBillPaymentFallback, paymentMode(payment), paymentAmount(payment));
      continue;
    }
    if (billId || !getCustomerId(payment)) continue;
    addRecoveryTender(unlinkedPaymentFallback, paymentMode(payment), paymentAmount(payment));
  }

  const unlinkedOldUdharFallback = subtractTenderAllowance(unlinkedPaymentFallback, todayTenderAllowance);
  return {
    cash: roundMoney(total.cash + oldBillPaymentFallback.cash + unlinkedOldUdharFallback.cash),
    upi: roundMoney(total.upi + oldBillPaymentFallback.upi + unlinkedOldUdharFallback.upi),
  };
}

function calculateOutstandingCustomers(ledger: CustomerLedgerEntry[], customers: Customer[]) {
  const customerById = new Map(customers.map((customer) => [customer.id, customer]));
  const grouped = new Map<string, CustomerLedgerEntry[]>();
  for (const entry of ledger.filter((row) => !isDeleted(row))) {
    const customerId = getCustomerId(entry);
    if (!customerId) continue;
    const list = grouped.get(customerId) ?? [];
    list.push(entry);
    grouped.set(customerId, list);
  }

  const rows: FinancialAggregationSnapshot["outstandingCustomers"] = [];
  if (grouped.size > 0) {
    for (const [customerId, entries] of grouped.entries()) {
      const outstanding = roundMoney(Math.max(0, calculateLedgerBalance(entries)));
      if (outstanding <= 0) continue;
      const customer = customerById.get(customerId);
      rows.push({
        customerId,
        customerName: customer?.name ?? "Customer",
        mobile: customer?.mobile ?? null,
        outstanding,
      });
    }
  } else {
    for (const customer of customers.filter((row) => !isDeleted(row as unknown as RecordLike))) {
      const outstanding = roundMoney(Math.max(0, readNumber(customer.udharAmount ?? customer.totalUdhar, 0)));
      if (outstanding <= 0) continue;
      rows.push({
        customerId: customer.id,
        customerName: customer.name,
        mobile: customer.mobile ?? null,
        outstanding,
      });
    }
  }

  return rows.sort((a, b) => b.outstanding - a.outstanding);
}

function buildRevenueBreakdown(
  bills: LocalBill[],
  payments: LocalPayment[],
  customers: Customer[],
): RevenueBreakdownRow[] {
  const customerById = new Map(customers.map((customer) => [customer.id, customer]));
  return bills.map((bill) => {
    const tender = tenderForBill(bill, payments);
    const customerId = getCustomerId(bill);
    const customer = customerId ? customerById.get(customerId) : undefined;
    const amount = billTotal(bill);
    return {
      billId: getBillId(bill, true) ?? readString(bill, ["id"], "unknown"),
      billNo: readString(bill, ["billNo", "billNumber", "bill_no", "number"], "Bill"),
      customerId,
      customerName:
        customer?.name ??
        readString(bill, ["customerName", "customer_name"], customerId ? "Customer" : "Walk-in customer"),
      amount,
      cash: tender.cash,
      upi: tender.upi,
      udhar: billCredit(bill),
      date: getDateValue(bill),
      status: readString(bill, ["status"], "saved"),
    };
  });
}

function calculateProfitByProduct(
  todayBills: LocalBill[],
  billItems: LocalBillItem[],
  products: Product[],
): ProfitByProductRow[] {
  const billIds = new Set<string>();
  for (const bill of todayBills) {
    for (const id of billIdentityKeys(bill)) billIds.add(id);
  }
  const productById = new Map(products.map((product) => [product.id, product]));
  const rows = new Map<string, ProfitByProductRow>();

  for (const item of billItems.filter((row) => !isDeleted(row))) {
    const billId = getBillId(item);
    if (!billId || !billIds.has(billId)) continue;
    const productId = getProductId(item) ?? `custom:${readString(item, ["name", "productName", "product_name"], "item")}`;
    const product = productById.get(productId);
    const quantity = Math.abs(readNumber(item.quantity ?? item.qty, 0));
    const rate = readNumber(
      item.ratePerRateUnit ?? item.rate_per_rate_unit ?? item.rate ?? item.price,
      productPrice(product),
    );
    const revenue = roundMoney(readNumber(item.line_total ?? item.lineTotal ?? item.total, 0) || quantity * rate);
    const cost = roundMoney(quantity * itemUnitCost(item, product));
    const profit = roundMoney(revenue - cost);
    const existing = rows.get(productId) ?? {
      productId,
      productName: product?.name ?? readString(item, ["name", "productName", "product_name"], "Custom item"),
      quantity: 0,
      revenue: 0,
      cost: 0,
      profit: 0,
      marginPct: 0,
    };
    existing.quantity = roundMoney(existing.quantity + quantity);
    existing.revenue = roundMoney(existing.revenue + revenue);
    existing.cost = roundMoney(existing.cost + cost);
    existing.profit = roundMoney(existing.profit + profit);
    existing.marginPct = existing.revenue > 0 ? Math.round((existing.profit / existing.revenue) * 100) : 0;
    rows.set(productId, existing);
  }

  return [...rows.values()].sort((a, b) => b.profit - a.profit || b.revenue - a.revenue);
}

function isPurchaseMovement(row: LocalInventoryMovement): boolean {
  return !isDeleted(row) && String(row.action ?? row.type ?? "").toLowerCase() === "purchase";
}

function purchaseAmount(row: RecordLike): number {
  return roundMoney(
    readNumber(
      row.billAmount ??
        row.bill_amount ??
        row.purchaseBillAmount ??
        row.purchase_bill_amount ??
        row.grandTotal ??
        row.grand_total ??
        row.totalAmount ??
        row.total_amount ??
        row.amount,
      0,
    ),
  );
}

function purchasePaid(row: RecordLike): number {
  const explicit = readNumber(row.purchasePaidAmount ?? row.purchase_paid_amount ?? row.paidAmount ?? row.paid_amount, NaN);
  if (Number.isFinite(explicit)) return roundMoney(Math.max(0, explicit));
  const status = String(row.purchasePaymentStatus ?? row.purchase_payment_status ?? row.paymentStatus ?? row.payment_status ?? "paid").toLowerCase();
  if (status === "due" || status === "unpaid" || status === "pending") return 0;
  return purchaseAmount(row);
}

function purchaseDue(row: RecordLike): number {
  const explicit = readNumber(row.purchaseDueAmount ?? row.purchase_due_amount ?? row.dueAmount ?? row.due_amount, NaN);
  if (Number.isFinite(explicit)) return roundMoney(Math.max(0, explicit));
  return roundMoney(Math.max(0, purchaseAmount(row) - purchasePaid(row)));
}

function purchasePaymentMode(row: RecordLike): string {
  const mode = String(row.purchasePaymentMode ?? row.purchase_payment_mode ?? row.paymentMode ?? row.payment_mode ?? "cash").toLowerCase();
  if (mode === "bank" || mode === "card") return "upi";
  return mode;
}

function normalizePurchaseKey(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function purchaseInvoiceNumber(row: RecordLike): string {
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

function purchaseDateDedupeBucket(row: RecordLike, invoiceNumber: string): string {
  const rawDate = getDateValue(row);
  if (!rawDate) return "no-date";
  const time = new Date(rawDate).getTime();
  if (!Number.isFinite(time)) return rawDate.slice(0, 16);
  if (invoiceNumber && invoiceNumber !== "-") return new Date(time).toISOString().slice(0, 10);
  return String(Math.floor(time / (15 * 60 * 1000)));
}

function purchaseBusinessKey(row: RecordLike): string {
  const invoiceNumber = purchaseInvoiceNumber(row);
  const supplierKey = normalizePurchaseKey(
    readString(row, ["supplierId", "supplier_id"]) ||
      readString(row, ["supplierName", "supplier_name"], "supplier"),
  );
  const productKey = normalizePurchaseKey(readString(row, ["productId", "product_id"], "product"));
  const amount = purchaseAmount(row).toFixed(2);
  const paid = purchasePaid(row).toFixed(2);
  const due = purchaseDue(row).toFixed(2);
  const invoiceKey = normalizePurchaseKey(invoiceNumber || "-");
  return [
    "purchase-business",
    supplierKey,
    productKey,
    invoiceKey,
    amount,
    paid,
    due,
    purchaseDateDedupeBucket(row, invoiceNumber),
  ].join("|");
}

function purchaseStableKey(row: RecordLike): string {
  const invoiceNumber = purchaseInvoiceNumber(row);
  const supplierKey = normalizePurchaseKey(
    readString(row, ["supplierId", "supplier_id"]) ||
      readString(row, ["supplierName", "supplier_name"], "supplier"),
  );
  const productKey = normalizePurchaseKey(readString(row, ["productId", "product_id"], "product"));
  const amount = purchaseAmount(row).toFixed(2);
  const invoiceKey = normalizePurchaseKey(invoiceNumber || "-");
  return [
    "purchase-stable",
    supplierKey,
    productKey,
    invoiceKey,
    amount,
    purchaseDateDedupeBucket(row, invoiceNumber),
  ].join("|");
}

function purchaseIdentityKeys(row: RecordLike): string[] {
  const purchaseIds = [
    readString(row, ["purchaseHistoryId", "purchase_history_id"]),
    readString(row, ["purchaseBillId", "purchase_bill_id"]),
    readString(row, ["localPurchaseHistoryId", "local_purchase_history_id"]),
    readString(row, ["localPurchaseBillId", "local_purchase_bill_id"]),
  ].filter(Boolean);
  return purchaseIds.map((id) => `purchase-id:${id}`);
}

function purchaseRowPriority(row: RecordLike, source: SupplierDueRow["source"]): number {
  let priority = source === "purchase_bill" ? 100 : 50;
  const status = String(row.sync_status ?? row.status ?? "").toLowerCase();
  if (status === "synced") priority += 10;
  if (status === "pending_sync" || status === "syncing") priority -= 5;
  if (readString(row, ["server_id", "serverId"])) priority += 5;
  return priority;
}

function buildSupplierDueCandidate(
  row: RecordLike,
  index: number,
  source: SupplierDueRow["source"],
  supplierById: Map<string, Supplier>,
): SupplierDueCandidate {
  const supplierId = readString(row, ["supplierId", "supplier_id"]) || null;
  const supplier = supplierId ? supplierById.get(supplierId) : undefined;
  const amount = purchaseAmount(row);
  const paid = purchasePaid(row);
  const due = purchaseDue(row);
  const statusKeys = source === "purchase_bill"
    ? ["status", "purchasePaymentStatus", "purchase_payment_status"]
    : ["purchasePaymentStatus", "purchase_payment_status", "status"];
  return {
    id: readString(row, ["id", "local_id", "server_id"], source === "purchase_bill" ? `purchase_${index}` : `movement_${index}`),
    supplierId,
    supplierName: supplier?.name ?? readString(row, ["supplierName", "supplier_name"], "Supplier"),
    invoiceNumber: purchaseInvoiceNumber(row),
    date: getDateValue(row),
    amount,
    paid,
    due,
    paymentMode: purchasePaymentMode(row),
    status: readString(row, statusKeys, due > 0 ? "due" : "paid"),
    source,
    dedupeKeys: [...purchaseIdentityKeys(row), purchaseStableKey(row), purchaseBusinessKey(row)],
    priority: purchaseRowPriority(row, source),
  };
}

function dedupeSupplierDueCandidates(candidates: SupplierDueCandidate[]): SupplierDueRow[] {
  const seen = new Set<string>();
  const picked: SupplierDueCandidate[] = [];
  const sorted = [...candidates].sort((a, b) => b.priority - a.priority || b.date.localeCompare(a.date));
  for (const candidate of sorted) {
    if (candidate.dedupeKeys.some((key) => seen.has(key))) continue;
    candidate.dedupeKeys.forEach((key) => seen.add(key));
    picked.push(candidate);
  }
  return picked
    .sort((a, b) => b.date.localeCompare(a.date))
    .map(({ dedupeKeys, priority, ...row }) => row);
}

function buildSupplierDueRows(
  purchaseBills: LocalPurchaseBill[],
  movements: LocalInventoryMovement[],
  suppliers: Supplier[],
): SupplierDueRow[] {
  const supplierById = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
  const explicitRows = purchaseBills
    .filter((row) => !isDeleted(row))
    .map((row, index) => buildSupplierDueCandidate(row, index, "purchase_bill", supplierById));

  const movementRows = movements
    .filter(isPurchaseMovement)
    .map((row, index) => buildSupplierDueCandidate(row, index, "inventory_movement", supplierById));

  return dedupeSupplierDueCandidates([...explicitRows, ...movementRows]);
}

export function aggregateFinancialRows(input: FinancialAggregationInput): FinancialAggregationSnapshot {
  const date = input.date ?? todayInputValue();
  const bills = dedupeBillsForDisplay((input.bills ?? []).filter((row) => !isDeleted(row)));
  const billItems = (input.billItems ?? []).filter((row) => !isDeleted(row));
  const payments = dedupePaymentsForDisplay((input.payments ?? []).filter((row) => !isDeleted(row)));
  const ledger = dedupeLedgerEntries((input.ledger ?? []).filter((row) => !isDeleted(row)));
  const products = (input.products ?? []).filter((row) => !isDeleted(row as unknown as RecordLike));
  const customers = (input.customers ?? []).filter((row) => !isDeleted(row as unknown as RecordLike));
  const suppliers = input.suppliers ?? [];
  const inventoryMovements = input.inventoryMovements ?? [];
  const purchaseBills = input.purchaseBills ?? [];

  const todayBills = bills.filter((bill) => isSaleBill(bill) && isWithinDate(bill, date));
  const revenueBreakdown = buildRevenueBreakdown(todayBills, payments, customers);
  const revenueToday = roundMoney(revenueBreakdown.reduce((sum, row) => sum + row.amount, 0));
  const cashSalesToday = roundMoney(revenueBreakdown.reduce((sum, row) => sum + row.cash, 0));
  const upiSalesToday = roundMoney(revenueBreakdown.reduce((sum, row) => sum + row.upi, 0));
  const udharSalesToday = roundMoney(revenueBreakdown.reduce((sum, row) => sum + row.udhar, 0));
  const profitByProduct = calculateProfitByProduct(todayBills, billItems, products);
  const itemProfit = roundMoney(profitByProduct.reduce((sum, row) => sum + row.profit, 0));
  const billProfit = roundMoney(todayBills.reduce((sum, bill) => sum + readNumber(bill.grossProfit ?? bill.gross_profit, 0), 0));
  const profitToday = itemProfit !== 0 || profitByProduct.length > 0 ? itemProfit : billProfit;
  const oldUdhar = calculateOldUdharRecovery(payments, ledger, bills, todayBills, date);
  const totalCashCollectedToday = roundMoney(cashSalesToday + oldUdhar.cash);
  const totalUpiCollectedToday = roundMoney(upiSalesToday + oldUdhar.upi);
  const outstandingCustomers = calculateOutstandingCustomers(ledger, customers);
  const supplierDueRows = buildSupplierDueRows(purchaseBills, inventoryMovements, suppliers);
  const todaySupplierRows = supplierDueRows.filter((row) => row.date && isWithinDate({ created_at: row.date }, date));
  const supplierCashPaidToday = roundMoney(todaySupplierRows.filter((row) => row.paymentMode === "cash").reduce((sum, row) => sum + row.paid, 0));
  const supplierUpiPaidToday = roundMoney(todaySupplierRows.filter((row) => row.paymentMode === "upi").reduce((sum, row) => sum + row.paid, 0));
  const purchaseDueToday = roundMoney(todaySupplierRows.reduce((sum, row) => sum + row.due, 0));
  const supplierDue = roundMoney(supplierDueRows.reduce((sum, row) => sum + row.due, 0));
  const expensesToday = 0;
  const ownerWithdrawalToday = 0;
  const cashDrawer: CashDrawerSummary = {
    openingCash: 0,
    cashSales: cashSalesToday,
    cashUdharRecovery: oldUdhar.cash,
    supplierCashPaid: supplierCashPaidToday,
    expenses: expensesToday,
    ownerWithdrawals: ownerWithdrawalToday,
    expectedClosingCash: roundMoney(totalCashCollectedToday - supplierCashPaidToday - expensesToday - ownerWithdrawalToday),
  };

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    date,
    revenueToday,
    profitToday: roundMoney(profitToday),
    grossMarginPct: revenueToday > 0 ? Math.round((profitToday / revenueToday) * 100) : 0,
    cashSalesToday,
    upiSalesToday,
    udharSalesToday,
    cashUdharRecoveryToday: oldUdhar.cash,
    upiUdharRecoveryToday: oldUdhar.upi,
    totalCashCollectedToday,
    totalUpiCollectedToday,
    totalOutstandingUdhar: roundMoney(outstandingCustomers.reduce((sum, row) => sum + row.outstanding, 0)),
    totalBillsToday: todayBills.length,
    totalCustomersWithUdhar: outstandingCustomers.length,
    revenueBreakdown,
    profitByProduct,
    collectionBreakdown: {
      cashSalesToday,
      upiSalesToday,
      cashUdharRecoveryToday: oldUdhar.cash,
      upiUdharRecoveryToday: oldUdhar.upi,
      totalCashCollectedToday,
      totalUpiCollectedToday,
    },
    supplierDue,
    supplierDueRows,
    supplierCashPaidToday,
    supplierUpiPaidToday,
    purchaseDueToday,
    expensesToday,
    ownerWithdrawalToday,
    cashDrawer,
    outstandingCustomers,
    hasLocalData:
      bills.length > 0 ||
      payments.length > 0 ||
      ledger.length > 0 ||
      products.length > 0 ||
      customers.length > 0 ||
      supplierDueRows.length > 0,
    dataSourceLabel: "FinancialAggregationService",
  };
}

async function loadScopedRows<T>(tableName: string): Promise<T[]> {
  return offlineDB
    .getAll<T>(tableName)
    .then((rows) => filterRowsForCurrentScope(rows))
    .catch(() => []);
}

export async function buildFinancialAggregationSnapshot(date = todayInputValue()): Promise<FinancialAggregationSnapshot> {
  await hardenLocalFinancialData().catch(() => undefined);
  const [
    bills,
    billItems,
    payments,
    ledger,
    products,
    customers,
    suppliers,
    inventoryMovements,
    purchaseBills,
  ] = await Promise.all([
    loadScopedRows<LocalBill>("bills"),
    loadScopedRows<LocalBillItem>("bill_items"),
    loadScopedRows<LocalPayment>("payments"),
    loadScopedRows<CustomerLedgerEntry>("customer_ledger"),
    loadScopedRows<Product>("products"),
    loadScopedRows<Customer>("customers"),
    loadScopedRows<Supplier>("suppliers"),
    loadScopedRows<LocalInventoryMovement>("inventory_movements"),
    loadScopedRows<LocalPurchaseBill>("purchase_bills"),
  ]);

  return aggregateFinancialRows({
    bills,
    billItems,
    payments,
    ledger,
    products,
    customers,
    suppliers,
    inventoryMovements,
    purchaseBills,
    date,
  });
}

export const FinancialAggregationService = {
  aggregate: aggregateFinancialRows,
  buildSnapshot: buildFinancialAggregationSnapshot,
};

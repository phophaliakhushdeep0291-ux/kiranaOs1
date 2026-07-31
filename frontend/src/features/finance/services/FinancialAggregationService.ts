import { roundMoney } from "@/lib/money";
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
  dedupeBillItemsForDisplay,
  dedupePaymentsForDisplay,
  isMergedBillTwin,
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
  range?: { from: string; to: string };
  generatedAt?: string;
  /**
   * Till adjustments that do not flow through sales. Without these the expected drawer
   * only reflects money that moved through bills, so the over/short at closing is wrong
   * for any shop that keeps a float or pays anything out of the till.
   * Expenses are server-backed (no offline table), so the caller supplies the cash total.
   */
  openingCash?: number;
  cashIn?: number;
  cashOut?: number;
  cashExpenses?: number;
}

export interface RevenueBreakdownRow {
  billId: string;
  billNo: string;
  customerId: string | null;
  customerName: string;
  amount: number;
  cash: number;
  upi: number;
  bank: number;
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
  bankSalesToday: number;
  cashUdharRecoveryToday: number;
  upiUdharRecoveryToday: number;
  bankUdharRecoveryToday: number;
  totalCashCollectedToday: number;
  totalUpiCollectedToday: number;
  totalBankCollectedToday: number;
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
  /** Cash put into or taken out of the till outside sales (pay-in / paid-out). */
  cashIn: number;
  cashOut: number;
  expectedClosingCash: number;
}

export interface FinancialAggregationSnapshot {
  generatedAt: string;
  date: string;
  revenueToday: number;
  profitToday: number;
  grossMarginPct: number;
  discountToday: number;
  cashSalesToday: number;
  upiSalesToday: number;
  bankSalesToday: number;
  udharSalesToday: number;
  cashUdharRecoveryToday: number;
  upiUdharRecoveryToday: number;
  bankUdharRecoveryToday: number;
  totalCashCollectedToday: number;
  totalUpiCollectedToday: number;
  totalBankCollectedToday: number;
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
  supplierBankPaidToday: number;
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

type TenderTotals = { cash: number; upi: number; bank: number };

function emptyTenderTotals(): TenderTotals {
  return { cash: 0, upi: 0, bank: 0 };
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

function dateFromInput(value: string, endOfDay = false): Date {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, (month || 1) - 1, day || 1);
  if (endOfDay) date.setHours(23, 59, 59, 999);
  return date;
}

function isWithinDateRange(row: RecordLike, range: { from: string; to: string }): boolean {
  const raw = getDateValue(row);
  if (!raw) return false;
  const start = dateFromInput(range.from).getTime();
  const end = dateFromInput(range.to, true).getTime();
  const time = new Date(raw).getTime();
  return Number.isFinite(time) && time >= start && time <= end;
}

function billIdentityKeys(bill: RecordLike): string[] {
  return [
    readString(bill, ["id"]),
    readString(bill, ["local_id", "localId"]),
    readString(bill, ["server_id", "serverId"]),
    readString(bill, ["billId", "bill_id"]),
    readString(bill, ["serverBillId", "server_bill_id"]),
    readString(bill, ["localBillId", "local_bill_id"]),
    readString(bill, ["clientBillId", "client_bill_id"]),
  ].filter(Boolean);
}

function getBillId(row: RecordLike, includeOwnId = false): string | null {
  const keys = includeOwnId
    ? [
        "billId",
        "bill_id",
        "serverBillId",
        "server_bill_id",
        "localBillId",
        "local_bill_id",
        "clientBillId",
        "client_bill_id",
        "reference_id",
        "source_id",
        "id",
      ]
    : [
        "billId",
        "bill_id",
        "serverBillId",
        "server_bill_id",
        "localBillId",
        "local_bill_id",
        "clientBillId",
        "client_bill_id",
        "reference_id",
        "source_id",
      ];
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

// A bill the SERVER permanently rejected must stop earning revenue locally. Only "conflict"
// is excluded: pending/failed rows are still in flight and must keep counting, or offline-first
// billing would under-report every sale until the network returns.
function isRejectedBySync(bill: RecordLike): boolean {
  return String(bill.sync_status ?? bill.syncStatus ?? "").toLowerCase() === "conflict";
}

function isSaleBill(bill: RecordLike): boolean {
  // Estimates (kacha bills) count as sales — they move stock, tender, and udhar just like a
  // pakka bill and only differ by their EST- number series.
  return !isMergedBillTwin(bill) && !isCancelledBill(bill) && !isRejectedBySync(bill);
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

function billDiscount(bill: RecordLike): number {
  return roundMoney(readNumber(bill.discount ?? bill.discountAmount ?? bill.discount_amount, 0));
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
  if (mode === "card") return "bank";
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
    paidAt: payment.paidAt ?? payment.paid_at ?? payment.createdAt ?? payment.created_at ?? bill.businessDate ?? bill.business_date ?? bill.createdAt ?? bill.created_at,
    paid_at: payment.paid_at ?? payment.paidAt ?? payment.created_at ?? payment.createdAt ?? bill.business_date ?? bill.businessDate ?? bill.created_at ?? bill.createdAt,
  }));
}

function sumPaymentTender(payments: LocalPayment[]): TenderTotals {
  return dedupePaymentsForDisplay(payments)
    .filter((payment) => isActivePayment(payment))
    .reduce<TenderTotals>(
      (sum, payment) => {
        const mode = paymentMode(payment);
        if (mode === "cash") sum.cash = roundMoney(sum.cash + paymentAmount(payment));
        if (mode === "upi") sum.upi = roundMoney(sum.upi + paymentAmount(payment));
        if (mode === "bank") sum.bank = roundMoney(sum.bank + paymentAmount(payment));
        return sum;
      },
      emptyTenderTotals(),
    );
}

function billEmbeddedTender(bill: RecordLike): TenderTotals {
  const embeddedPayments = normalizeEmbeddedPayments(bill);
  if (embeddedPayments.length > 0) return sumPaymentTender(embeddedPayments);
  return {
    cash: roundMoney(readNumber(bill.cashAmount ?? bill.cash_amount, 0)),
    upi: roundMoney(readNumber(bill.upiAmount ?? bill.upi_amount, 0)),
    bank: roundMoney(readNumber(bill.bankAmount ?? bill.bank_amount, 0)),
  };
}

function billLinkedTender(bill: RecordLike, payments: LocalPayment[]): TenderTotals {
  const ids = new Set(billIdentityKeys(bill));
  if (ids.size === 0) return emptyTenderTotals();
  return sumPaymentTender(
    payments.filter((payment) => {
      const billId = getBillId(payment);
      return Boolean(billId && ids.has(billId));
    }),
  );
}

function tenderForBill(bill: RecordLike, payments: LocalPayment[]): TenderTotals {
  const embedded = billEmbeddedTender(bill);
  if (embedded.cash > 0 || embedded.upi > 0 || embedded.bank > 0) return embedded;
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

function addRecoveryTender(total: TenderTotals, mode: string, amount: number) {
  if (mode === "cash") total.cash = roundMoney(total.cash + amount);
  if (mode === "upi") total.upi = roundMoney(total.upi + amount);
  if (mode === "bank") total.bank = roundMoney(total.bank + amount);
}

function subtractTenderAllowance(
  candidate: TenderTotals,
  allowance: TenderTotals,
): TenderTotals {
  const subtractLikelySaleEcho = (total: number, saleAllowance: number) => {
    if (saleAllowance > 0 && total + 0.004 >= saleAllowance) return roundMoney(Math.max(0, total - saleAllowance));
    return roundMoney(total);
  };

  return {
    cash: subtractLikelySaleEcho(candidate.cash, allowance.cash),
    upi: subtractLikelySaleEcho(candidate.upi, allowance.upi),
    bank: subtractLikelySaleEcho(candidate.bank, allowance.bank),
  };
}

function buildTodayTenderAllowance(todayBills: LocalBill[], payments: LocalPayment[]): TenderTotals {
  return todayBills.reduce<TenderTotals>(
    (sum, bill) => {
      const tender = tenderForBill(bill, payments);
      sum.cash = roundMoney(sum.cash + tender.cash);
      sum.upi = roundMoney(sum.upi + tender.upi);
      sum.bank = roundMoney(sum.bank + tender.bank);
      return sum;
    },
    emptyTenderTotals(),
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
  rangeBills: LocalBill[],
  range: { from: string; to: string },
): TenderTotals {
  const { saleBillIds, todaySaleBillIds: rangeSaleBillIds } = buildSaleBillIdSets(bills, rangeBills);
  const paymentsByIdentity = buildPaymentByIdentity(payments);
  const rangeTenderAllowance = buildTodayTenderAllowance(rangeBills, payments);
  const linkedPaymentIds = new Set<string>();
  const total = ledger
    .filter(
      (entry) =>
        isActiveLedgerEntry(entry) &&
        isWithinDateRange(entry, range) &&
        normaliseLedgerType(entry.type, entry.source_type) === "PAYMENT",
    )
    .filter((entry) => {
      const billId = getBillId(entry);
      return !billId || !saleBillIds.has(billId) || !rangeSaleBillIds.has(billId);
    })
    .reduce<TenderTotals>(
      (sum, entry) => {
        for (const key of ledgerPaymentReferenceKeys(entry)) linkedPaymentIds.add(key);
        addRecoveryTender(sum, ledgerPaymentMode(entry, paymentsByIdentity), Math.abs(ledgerSignedAmount(entry)));
        return sum;
      },
      emptyTenderTotals(),
    );

  const oldBillPaymentFallback = emptyTenderTotals();
  const unlinkedPaymentFallback = emptyTenderTotals();
  for (const payment of dedupePaymentsForDisplay(
    payments.filter((row) => isActivePayment(row) && isWithinDateRange(row, range)),
  )) {
    if (paymentIdentityKeys(payment).some((key) => linkedPaymentIds.has(key))) continue;
    const billId = getBillId(payment);
    const isKnownOldSaleBillPayment = Boolean(billId && saleBillIds.has(billId) && !rangeSaleBillIds.has(billId));
    if (billId && rangeSaleBillIds.has(billId)) continue;
    if (isKnownOldSaleBillPayment) {
      addRecoveryTender(oldBillPaymentFallback, paymentMode(payment), paymentAmount(payment));
      continue;
    }
    if (billId || !getCustomerId(payment)) continue;
    addRecoveryTender(unlinkedPaymentFallback, paymentMode(payment), paymentAmount(payment));
  }

  const unlinkedOldUdharFallback = subtractTenderAllowance(unlinkedPaymentFallback, rangeTenderAllowance);
  return {
    cash: roundMoney(total.cash + oldBillPaymentFallback.cash + unlinkedOldUdharFallback.cash),
    upi: roundMoney(total.upi + oldBillPaymentFallback.upi + unlinkedOldUdharFallback.upi),
    bank: roundMoney(total.bank + oldBillPaymentFallback.bank + unlinkedOldUdharFallback.bank),
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
      bank: tender.bank,
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
  const productById = new Map(products.map((product) => [product.id, product]));
  const itemsByBillId = new Map<string, LocalBillItem[]>();
  for (const item of billItems.filter((row) => !isDeleted(row))) {
    const billId = getBillId(item);
    if (!billId) continue;
    const list = itemsByBillId.get(billId) ?? [];
    list.push(item);
    itemsByBillId.set(billId, list);
  }
  const rows = new Map<string, ProfitByProductRow>();

  for (const bill of todayBills) {
    const rawItems: LocalBillItem[] = [];
    const seenRows = new Set<LocalBillItem>();
    for (const billId of billIdentityKeys(bill)) {
      for (const item of itemsByBillId.get(billId) ?? []) {
        if (seenRows.has(item)) continue;
        seenRows.add(item);
        rawItems.push(item);
      }
    }
    const expectedItemTotal = readNumber(bill.subtotal ?? bill.subtotalAmount ?? bill.subtotal_amount, billTotal(bill) + billDiscount(bill));
    const uniqueItems = dedupeBillItemsForDisplay(rawItems, expectedItemTotal) as LocalBillItem[];

    for (const item of uniqueItems) {
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
  }

  return [...rows.values()].sort((a, b) => b.revenue - a.revenue || b.profit - a.profit);
}

function billStoredProfit(bill: RecordLike): number | null {
  const raw = bill.grossProfit ?? bill.gross_profit;
  if (raw === undefined || raw === null || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? roundMoney(value) : null;
}

function calculateTotalBillProfit(
  todayBills: LocalBill[],
  billItems: LocalBillItem[],
  products: Product[],
): number {
  return roundMoney(
    todayBills.reduce((sum, bill) => {
      const stored = billStoredProfit(bill);
      if (stored !== null) return sum + stored;
      const itemProfit = calculateProfitByProduct([bill], billItems, products)
        .reduce((itemSum, row) => itemSum + row.profit, 0);
      // Older/offline bills may not have a stored grossProfit. Their item rows hold
      // pre-discount selling prices, so the bill discount must be netted once here.
      // Keeping this calculation inside the deduped bill loop prevents both item
      // echoes and local/server bill echoes from inflating dashboard profit.
      return sum + itemProfit - billDiscount(bill);
    }, 0),
  );
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
  if (mode === "card") return "bank";
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
  const range = input.range ?? { from: date, to: date };
  const bills = dedupeBillsForDisplay(input.bills ?? [], { includeUserDeleted: true });
  const billItems = (input.billItems ?? []).filter((row) => !isDeleted(row));
  const payments = dedupePaymentsForDisplay((input.payments ?? []).filter((row) => !isDeleted(row)));
  const ledger = dedupeLedgerEntries((input.ledger ?? []).filter((row) => !isDeleted(row)));
  const products = (input.products ?? []).filter((row) => !isDeleted(row as unknown as RecordLike));
  const customers = (input.customers ?? []).filter((row) => !isDeleted(row as unknown as RecordLike));
  const suppliers = input.suppliers ?? [];
  const inventoryMovements = input.inventoryMovements ?? [];
  const purchaseBills = input.purchaseBills ?? [];

  const todayBills = bills.filter((bill) => isSaleBill(bill) && isWithinDateRange(bill, range));
  const revenueBreakdown = buildRevenueBreakdown(todayBills, payments, customers);
  const revenueToday = roundMoney(revenueBreakdown.reduce((sum, row) => sum + row.amount, 0));
  const discountToday = roundMoney(todayBills.reduce((sum, bill) => sum + billDiscount(bill), 0));
  const cashSalesToday = roundMoney(revenueBreakdown.reduce((sum, row) => sum + row.cash, 0));
  const upiSalesToday = roundMoney(revenueBreakdown.reduce((sum, row) => sum + row.upi, 0));
  const bankSalesToday = roundMoney(revenueBreakdown.reduce((sum, row) => sum + row.bank, 0));
  const udharSalesToday = roundMoney(revenueBreakdown.reduce((sum, row) => sum + row.udhar, 0));
  const profitByProduct = calculateProfitByProduct(todayBills, billItems, products);
  const profitToday = calculateTotalBillProfit(todayBills, billItems, products);
  const oldUdhar = calculateOldUdharRecovery(payments, ledger, bills, todayBills, range);
  const totalCashCollectedToday = roundMoney(cashSalesToday + oldUdhar.cash);
  const totalUpiCollectedToday = roundMoney(upiSalesToday + oldUdhar.upi);
  const totalBankCollectedToday = roundMoney(bankSalesToday + oldUdhar.bank);
  const outstandingCustomers = calculateOutstandingCustomers(ledger, customers);
  const supplierDueRows = buildSupplierDueRows(purchaseBills, inventoryMovements, suppliers);
  const todaySupplierRows = supplierDueRows.filter((row) => row.date && isWithinDateRange({ created_at: row.date }, range));
  const supplierCashPaidToday = roundMoney(todaySupplierRows.filter((row) => row.paymentMode === "cash").reduce((sum, row) => sum + row.paid, 0));
  const supplierUpiPaidToday = roundMoney(todaySupplierRows.filter((row) => row.paymentMode === "upi").reduce((sum, row) => sum + row.paid, 0));
  const supplierBankPaidToday = roundMoney(todaySupplierRows.filter((row) => row.paymentMode === "bank").reduce((sum, row) => sum + row.paid, 0));
  const purchaseDueToday = roundMoney(todaySupplierRows.reduce((sum, row) => sum + row.due, 0));
  const supplierDue = roundMoney(supplierDueRows.reduce((sum, row) => sum + row.due, 0));
  // These were hardcoded to 0, so the expected drawer ignored the morning float and any
  // cash paid out during the day — it reported a short for every shop that pays rent from
  // the till, and a permanent over for every shop that keeps change in it.
  const openingCashToday = roundMoney(Math.max(0, Number(input.openingCash) || 0));
  const cashInToday = roundMoney(Math.max(0, Number(input.cashIn) || 0));
  const cashOutToday = roundMoney(Math.max(0, Number(input.cashOut) || 0));
  const expensesToday = roundMoney(Math.max(0, Number(input.cashExpenses) || 0));
  const ownerWithdrawalToday = 0;
  const cashDrawer: CashDrawerSummary = {
    openingCash: openingCashToday,
    cashSales: cashSalesToday,
    cashUdharRecovery: oldUdhar.cash,
    supplierCashPaid: supplierCashPaidToday,
    expenses: expensesToday,
    ownerWithdrawals: ownerWithdrawalToday,
    cashIn: cashInToday,
    cashOut: cashOutToday,
    expectedClosingCash: roundMoney(
      openingCashToday
      + totalCashCollectedToday
      + cashInToday
      - supplierCashPaidToday
      - expensesToday
      - cashOutToday
      - ownerWithdrawalToday,
    ),
  };

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    date,
    revenueToday,
    profitToday: roundMoney(profitToday),
    grossMarginPct: revenueToday > 0 ? Math.round((profitToday / revenueToday) * 100) : 0,
    discountToday,
    cashSalesToday,
    upiSalesToday,
    bankSalesToday,
    udharSalesToday,
    cashUdharRecoveryToday: oldUdhar.cash,
    upiUdharRecoveryToday: oldUdhar.upi,
    bankUdharRecoveryToday: oldUdhar.bank,
    totalCashCollectedToday,
    totalUpiCollectedToday,
    totalBankCollectedToday,
    totalOutstandingUdhar: roundMoney(outstandingCustomers.reduce((sum, row) => sum + row.outstanding, 0)),
    totalBillsToday: todayBills.length,
    totalCustomersWithUdhar: outstandingCustomers.length,
    revenueBreakdown,
    profitByProduct,
    collectionBreakdown: {
      cashSalesToday,
      upiSalesToday,
      bankSalesToday,
      cashUdharRecoveryToday: oldUdhar.cash,
      upiUdharRecoveryToday: oldUdhar.upi,
      bankUdharRecoveryToday: oldUdhar.bank,
      totalCashCollectedToday,
      totalUpiCollectedToday,
      totalBankCollectedToday,
    },
    supplierDue,
    supplierDueRows,
    supplierCashPaidToday,
    supplierUpiPaidToday,
    supplierBankPaidToday,
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

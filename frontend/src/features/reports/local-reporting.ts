import { roundMoney } from "@/lib/money";
import {
  filterRowsForCurrentScope,
  offlineDB,
  type PendingSyncEvent,
} from "@/lib/offline/db";
import type { Bill, Customer, Product, Supplier } from "@/types/api";
import {
  aggregateFinancialRows,
  type FinancialAggregationSnapshot,
} from "@/features/finance/services/FinancialAggregationService";
import { hardenLocalFinancialData } from "@/features/sync/local-data-hardening";
import { fromBaseQty, productDisplayUnit } from "@/features/products/pages/product-pricing";

export interface DateRange {
  from: string;
  to: string;
}

export interface ReportPaymentBreakdown {
  cash: number;
  upi: number;
  bank: number;
  udhar: number;
  received: number;
  oldUdharReceived: number;
  oldUdharCashReceived: number;
  oldUdharUpiReceived: number;
  oldUdharBankReceived: number;
  purchaseCashPaid: number;
  purchaseUpiPaid: number;
  purchaseBankPaid: number;
  purchasePaid: number;
  purchaseDue: number;
  netCashInHand: number;
  netUpiInBank: number;
  netBankInBank: number;
  cashIn: number;
  upiIn: number;
  bankIn: number;
}

export interface ReportMetricWindow {
  sales: number;
  bills: number;
  cashSales: number;
  upiSales: number;
  bankSales: number;
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
  lastPurchase?: string | null;
}

export interface ReportTopProduct {
  productId: string;
  name: string;
  category: string;
  quantitySold: number;
  revenue: number;
  profitEstimate: number;
  marginPct: number;
}

export interface ReportDailyPoint {
  date: string;
  label: string;
  sales: number;
  collection: number;
  profit: number;
  cash: number;
  upi: number;
  bank: number;
  udhar: number;
  stockIn: number;
  stockOut: number;
}

export interface ReportCategoryPerformance {
  name: string;
  revenue: number;
  profit: number;
}

export interface ReportStockMovementSummary {
  totalIn: number;
  totalOut: number;
  newProducts: number;
  lowStockItems: number;
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

export interface ReportHourlySalesRow {
  /** Local hour of day, 0–23. */
  hour: number;
  sales: number;
  bills: number;
}

export interface ReportDiscountedBill {
  billId: string;
  billNo: string;
  at: string;
  amount: number;
  reason: string | null;
}

export interface ReportDiscountSummary {
  /** All rupees given away in the range (bill-level + line-level). */
  total: number;
  /** Bill-level discount minus the coupon and loyalty portions inside it. */
  manual: number;
  coupon: number;
  loyalty: number;
  /** Per-line discounts (sum of item lineDiscount). */
  line: number;
  discountedBillCount: number;
  /** Most recent bills carrying a bill-level discount, with the typed reason. */
  recent: ReportDiscountedBill[];
}

export interface LocalReportSnapshot {
  generatedAt: string;
  range: DateRange;
  today: ReportMetricWindow;
  sevenDay: ReportMetricWindow;
  thirtyDay: ReportMetricWindow;
  selected: ReportMetricWindow;
  previousSelected: ReportMetricWindow;
  paymentBreakdown: ReportPaymentBreakdown;
  pendingUdhar: number;
  topCustomers: ReportTopCustomer[];
  topProducts: ReportTopProduct[];
  dailyTrend: ReportDailyPoint[];
  categoryPerformance: ReportCategoryPerformance[];
  stockMovement: ReportStockMovementSummary;
  lowStock: ReportLowStockItem[];
  staffSales: StaffSalesRow[];
  discounts: ReportDiscountSummary;
  hourlySales: ReportHourlySalesRow[];
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
  profitEstimate: number;
  billCount: number;
  cashSales: number;
  upiSales: number;
  bankSales: number;
  cashReceived: number;
  upiReceived: number;
  bankReceived: number;
  udharGiven: number;
  oldUdharPaymentReceived: number;
  oldUdharCashReceived: number;
  oldUdharUpiReceived: number;
  oldUdharBankReceived: number;
  purchaseCashPaid: number;
  purchaseUpiPaid: number;
  purchaseBankPaid: number;
  purchasePaid: number;
  purchaseDue: number;
  expectedCashInDrawer: number;
  expectedUpiInBank: number;
  expectedBankInBank: number;
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
type LocalBillItem = RecordLike;
type LocalPayment = RecordLike;
type LocalInventoryMovement = RecordLike;
type LocalPurchaseBill = RecordLike;

interface LocalFinanceRows {
  bills: LocalBill[];
  billItems: LocalBillItem[];
  payments: LocalPayment[];
  ledger: RecordLike[];
  products: Product[];
  customers: Customer[];
  suppliers: Supplier[];
  inventoryMovements: LocalInventoryMovement[];
  purchaseBills: LocalPurchaseBill[];
  outbox: PendingSyncEvent[];
}

function readNumber(value: unknown, fallback = 0): number {
  const num = Number(value ?? fallback);
  return Number.isFinite(num) ? num : fallback;
}



function readString(row: RecordLike, keys: string[], fallback = ""): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return fallback;
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

function rowDate(row: RecordLike): string {
  return readString(row, ["businessDate", "business_date", "createdAt", "created_at", "billDate", "bill_date", "updatedAt", "updated_at"]);
}

function isWithinRange(row: RecordLike, range: DateRange): boolean {
  const raw = rowDate(row);
  if (!raw) return false;
  const time = new Date(raw).getTime();
  if (!Number.isFinite(time)) return false;
  return time >= dateFromInput(range.from).getTime() && time <= dateFromInput(range.to, true).getTime();
}

function isDeleted(row: RecordLike): boolean {
  return Boolean(row.deleted_at ?? row.deletedAt ?? row.merged_into_id ?? row.mergedIntoId);
}

// A bill the SERVER permanently rejected must not keep earning revenue in local reports.
// Only "conflict" is excluded: pending/failed rows are still in flight and must keep counting,
// otherwise offline-first billing would under-report until the network returns.
function isRejectedBySync(row: RecordLike): boolean {
  return String(row.sync_status ?? row.syncStatus ?? "").toLowerCase() === "conflict";
}

function isSaleBill(row: LocalBill): boolean {
  // Estimates (kacha bills) count as sales — same money and stock effects as a pakka bill,
  // only the EST- number series differs.
  const status = String(row.status ?? "").toLowerCase();
  return !isDeleted(row) && !isRejectedBySync(row) && !status.includes("cancel");
}

function billTotal(row: LocalBill): number {
  return roundMoney(readNumber(row.grandTotal ?? row.grand_total ?? row.totalAmount ?? row.total_amount ?? row.netAmount ?? row.net_amount, 0));
}

/**
 * Discounts given in the range. Bill-level `discount` is all-in on server
 * bills (coupon + loyalty portions live inside it), so "manual" is derived by
 * subtracting those; line discounts are summed from the embedded items.
 */
/** Sales bucketed by local hour of day — "when is the counter busy". */
export function calculateHourlySales(bills: LocalBill[], range: DateRange): ReportHourlySalesRow[] {
  const buckets = Array.from({ length: 24 }, (_, hour) => ({ hour, sales: 0, bills: 0 }));
  for (const bill of bills) {
    if (!isSaleBill(bill) || !isWithinRange(bill as RecordLike, range)) continue;
    if (String(bill.billType ?? bill.bill_type ?? "").toLowerCase().includes("return")) continue;
    const raw = rowDate(bill as RecordLike);
    const time = new Date(raw).getTime();
    if (!Number.isFinite(time)) continue;
    const hour = new Date(time).getHours();
    buckets[hour].sales = roundMoney(buckets[hour].sales + billTotal(bill));
    buckets[hour].bills += 1;
  }
  return buckets;
}

export function calculateDiscountSummary(bills: LocalBill[], range: DateRange): ReportDiscountSummary {
  const saleBills = bills.filter((bill) =>
    isSaleBill(bill) &&
    isWithinRange(bill as RecordLike, range) &&
    !String(bill.billType ?? bill.bill_type ?? "").toLowerCase().includes("return"));

  let billLevel = 0;
  let coupon = 0;
  let loyalty = 0;
  let line = 0;
  const discounted: ReportDiscountedBill[] = [];

  for (const bill of saleBills) {
    const record = bill as RecordLike;
    const billDiscount = roundMoney(Math.max(0, readNumber(record.discount, 0)));
    const offerDiscount = roundMoney(Math.max(0, readNumber(record.offerDiscount ?? record.offer_discount, 0)));
    const loyaltyDiscount = roundMoney(Math.max(0, readNumber(record.loyaltyDiscount ?? record.loyalty_discount, 0)));
    const items = Array.isArray(record.items) ? record.items as RecordLike[] : [];
    const lineDiscount = roundMoney(items.reduce(
      (sum, item) => sum + Math.max(0, readNumber(item.lineDiscount ?? item.line_discount, 0)),
      0,
    ));
    billLevel = roundMoney(billLevel + billDiscount);
    coupon = roundMoney(coupon + Math.min(offerDiscount, billDiscount));
    loyalty = roundMoney(loyalty + Math.min(loyaltyDiscount, Math.max(0, billDiscount - offerDiscount)));
    line = roundMoney(line + lineDiscount);
    if (billDiscount > 0 || lineDiscount > 0) {
      const reason = readString(record, ["discountReason", "discount_reason"]);
      discounted.push({
        billId: String(record.id ?? ""),
        billNo: readString(record, ["billNumber", "billNo", "bill_no"]) || String(record.id ?? "Bill"),
        at: rowDate(record),
        amount: roundMoney(billDiscount + lineDiscount),
        reason: reason || null,
      });
    }
  }

  return {
    total: roundMoney(billLevel + line),
    manual: roundMoney(Math.max(0, billLevel - coupon - loyalty)),
    coupon,
    loyalty,
    line,
    discountedBillCount: discounted.length,
    recent: discounted.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8),
  };
}

function toMetricWindow(snapshot: FinancialAggregationSnapshot): ReportMetricWindow {
  return {
    sales: snapshot.revenueToday,
    bills: snapshot.totalBillsToday,
    cashSales: snapshot.cashSalesToday,
    upiSales: snapshot.upiSalesToday,
    bankSales: snapshot.bankSalesToday,
    udharSales: snapshot.udharSalesToday,
    paymentsReceived: roundMoney(snapshot.cashSalesToday + snapshot.upiSalesToday + snapshot.bankSalesToday),
    discount: snapshot.discountToday,
    profitEstimate: snapshot.profitToday,
  };
}

function toPaymentBreakdown(snapshot: FinancialAggregationSnapshot): ReportPaymentBreakdown {
  return {
    cash: snapshot.cashSalesToday,
    upi: snapshot.upiSalesToday,
    bank: snapshot.bankSalesToday,
    udhar: snapshot.udharSalesToday,
    received: roundMoney(snapshot.cashSalesToday + snapshot.upiSalesToday + snapshot.bankSalesToday),
    oldUdharReceived: roundMoney(snapshot.cashUdharRecoveryToday + snapshot.upiUdharRecoveryToday + snapshot.bankUdharRecoveryToday),
    oldUdharCashReceived: snapshot.cashUdharRecoveryToday,
    oldUdharUpiReceived: snapshot.upiUdharRecoveryToday,
    oldUdharBankReceived: snapshot.bankUdharRecoveryToday,
    purchaseCashPaid: snapshot.supplierCashPaidToday,
    purchaseUpiPaid: snapshot.supplierUpiPaidToday,
    purchaseBankPaid: snapshot.supplierBankPaidToday,
    purchasePaid: roundMoney(snapshot.supplierCashPaidToday + snapshot.supplierUpiPaidToday + snapshot.supplierBankPaidToday),
    purchaseDue: snapshot.purchaseDueToday,
    cashIn: snapshot.totalCashCollectedToday,
    upiIn: snapshot.totalUpiCollectedToday,
    bankIn: snapshot.totalBankCollectedToday,
    netCashInHand: snapshot.cashDrawer.expectedClosingCash,
    netUpiInBank: roundMoney(snapshot.totalUpiCollectedToday - snapshot.supplierUpiPaidToday),
    netBankInBank: roundMoney(snapshot.totalBankCollectedToday - snapshot.supplierBankPaidToday),
  };
}

function topCustomersFromSnapshot(snapshot: FinancialAggregationSnapshot): ReportTopCustomer[] {
  const outstandingById = new Map(snapshot.outstandingCustomers.map((row) => [row.customerId, row.outstanding]));
  const rows = new Map<string, ReportTopCustomer>();
  for (const bill of snapshot.revenueBreakdown) {
    const customerId = bill.customerId ?? "walk-in";
    const existing = rows.get(customerId) ?? {
      customerId,
      name: bill.customerName,
      mobile: null,
      sales: 0,
      balance: outstandingById.get(customerId) ?? 0,
      bills: 0,
      lastPurchase: bill.date,
    };
    existing.sales = roundMoney(existing.sales + bill.amount);
    existing.bills += 1;
    if (!existing.lastPurchase || bill.date > existing.lastPurchase) existing.lastPurchase = bill.date;
    rows.set(customerId, existing);
  }
  for (const customer of snapshot.outstandingCustomers) {
    if (rows.has(customer.customerId)) continue;
    rows.set(customer.customerId, {
      customerId: customer.customerId,
      name: customer.customerName,
      mobile: customer.mobile,
      sales: 0,
      balance: customer.outstanding,
      bills: 0,
      lastPurchase: null,
    });
  }
  return [...rows.values()].sort((a, b) => b.sales - a.sales || b.balance - a.balance).slice(0, 10);
}

function topProductsFromSnapshot(snapshot: FinancialAggregationSnapshot, products: Product[]): ReportTopProduct[] {
  const productById = new Map(products.map((product) => [product.id, product]));
  return snapshot.profitByProduct.slice(0, 10).map((row) => ({
    productId: row.productId,
    name: row.productName,
    category: productById.get(row.productId)?.category || "Uncategorised",
    quantitySold: row.quantity,
    revenue: row.revenue,
    profitEstimate: row.profit,
    marginPct: row.marginPct,
  }));
}

function categoryPerformanceFromSnapshot(
  snapshot: FinancialAggregationSnapshot,
  products: Product[],
): ReportCategoryPerformance[] {
  const categoryByProduct = new Map(products.map((product) => [product.id, product.category || "Uncategorised"]));
  const categories = new Map<string, ReportCategoryPerformance>();
  for (const row of snapshot.profitByProduct) {
    const name = categoryByProduct.get(row.productId) || "Uncategorised";
    const current = categories.get(name) ?? { name, revenue: 0, profit: 0 };
    current.revenue = roundMoney(current.revenue + row.revenue);
    current.profit = roundMoney(current.profit + row.profit);
    categories.set(name, current);
  }
  return [...categories.values()]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 6);
}

function previousRange(range: DateRange): DateRange {
  const start = dateFromInput(range.from);
  const end = dateFromInput(range.to);
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1);
  const previousTo = addDays(start, -1);
  const previousFrom = addDays(previousTo, -(days - 1));
  return { from: toDateInputValue(previousFrom), to: toDateInputValue(previousTo) };
}

function chartDays(range: DateRange): string[] {
  const start = dateFromInput(range.from);
  const end = dateFromInput(range.to);
  const result: string[] = [];
  for (let date = start; date <= end; date = addDays(date, 1)) {
    result.push(toDateInputValue(date));
  }
  return result.slice(-31);
}

function movementValue(
  movement: LocalInventoryMovement,
  productsById: Map<string, Product>,
): { inbound: number; outbound: number } {
  const action = readString(movement, ["action", "type", "movementType", "movement_type"]).toLowerCase();
  const change = readNumber(
    movement.changeBaseQty ?? movement.change_base_qty ?? movement.quantityChange ?? movement.quantity_change ?? movement.quantity,
    0,
  );
  const productId = readString(movement, ["productId", "product_id"]);
  const product = productsById.get(productId);
  const unitCost = readNumber(
    product?.costPerRateUnit ?? product?.costPrice ?? product?.averageCostPrice,
    0,
  );
  const outbound = change < 0 || /sale|out|damage|return_to_supplier|expired/.test(action);
  const inbound = change > 0 || /purchase|stock_in|add|receive|return_from_customer/.test(action);
  const explicitInboundValue = readNumber(
    movement.totalCost ?? movement.total_cost ?? movement.purchaseBillAmount ?? movement.purchase_bill_amount ?? movement.billAmount ?? movement.bill_amount,
    0,
  );
  const explicitOutboundValue = readNumber(
    movement.damageLossValue ?? movement.damage_loss_value ?? movement.valueImpact ?? movement.value_impact,
    0,
  );
  const rateUnit = product ? (product.rateUnit ?? product.displayUnit ?? productDisplayUnit(product)) : undefined;
  const quantityInRateUnit = product ? fromBaseQty(Math.abs(change), rateUnit) : Math.abs(change);
  const derivedValue = roundMoney(quantityInRateUnit * unitCost);
  const value = roundMoney(Math.abs((inbound && !outbound ? explicitInboundValue : explicitOutboundValue) || derivedValue));
  return {
    inbound: inbound && !outbound ? value : 0,
    outbound: outbound ? value : 0,
  };
}

function buildDailyTrend(rows: LocalFinanceRows, range: DateRange): ReportDailyPoint[] {
  const productsById = new Map(rows.products.map((product) => [product.id, product]));
  return chartDays(range).map((date) => {
    const dayRange = { from: date, to: date };
    const snapshot = aggregate(rows, dayRange);
    const stock = rows.inventoryMovements
      .filter((movement) => isWithinRange(movement, dayRange))
      .reduce<{ inbound: number; outbound: number }>((total, movement) => {
        const value = movementValue(movement, productsById);
        return { inbound: roundMoney(total.inbound + value.inbound), outbound: roundMoney(total.outbound + value.outbound) };
      }, { inbound: 0, outbound: 0 });
    const parsed = dateFromInput(date);
    return {
      date,
      label: parsed.toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
      sales: snapshot.revenueToday,
      collection: roundMoney(snapshot.totalCashCollectedToday + snapshot.totalUpiCollectedToday + snapshot.totalBankCollectedToday),
      profit: snapshot.profitToday,
      cash: snapshot.totalCashCollectedToday,
      upi: snapshot.totalUpiCollectedToday,
      bank: snapshot.totalBankCollectedToday,
      udhar: snapshot.udharSalesToday,
      stockIn: stock.inbound,
      stockOut: stock.outbound,
    };
  });
}

function calculateLowStock(products: Product[]): ReportLowStockItem[] {
  return products
    .filter((product) => !isDeleted(product as unknown as RecordLike) && (product.stockTrackingEnabled ?? product.trackStock ?? true))
    .map((product) => {
      // stockBaseQty AND lowStockThreshold are both stored in base units (g/ml) — the product
      // form converts the entered alert via toBaseQty. Convert BOTH to the display unit so the
      // comparison is unit-consistent and the numbers shown read naturally (2 kg, not 2000).
      // Comparing display stock against a base-unit threshold flagged every weighed item as low.
      const unit = product.stockUnit ?? productDisplayUnit(product);
      const stock = product.stockBaseQty != null
        ? fromBaseQty(product.stockBaseQty, unit)
        : readNumber(product.stockQuantity, 0);
      const threshold = fromBaseQty(readNumber(product.lowStockThreshold ?? product.lowStockAlert, 0), unit);
      return { product, stock, threshold, unit };
    })
    .filter(({ stock, threshold }) => threshold > 0 && stock <= threshold)
    .sort((a, b) => a.stock - b.stock)
    .slice(0, 20)
    .map(({ product, stock, threshold, unit }) => ({
      productId: product.id,
      name: product.name,
      category: product.category,
      stock,
      threshold,
      unit,
    }));
}

function calculateStaffSales(bills: LocalBill[], range: DateRange): StaffSalesRow[] {
  const rows = new Map<string, StaffSalesRow>();
  for (const bill of bills.filter((row) => isSaleBill(row) && isWithinRange(row, range))) {
    const staffId = readString(bill, ["staffId", "staff_id", "createdBy", "created_by"], "owner");
    const staffName = readString(bill, ["staffName", "staff_name"], staffId === "owner" ? "Owner / main counter" : staffId);
    const existing = rows.get(staffId) ?? { staffId, staffName, sales: 0, bills: 0 };
    existing.sales = roundMoney(existing.sales + billTotal(bill));
    existing.bills += 1;
    rows.set(staffId, existing);
  }
  return [...rows.values()].sort((a, b) => b.sales - a.sales).slice(0, 10);
}

function syncCounters(outbox: PendingSyncEvent[]) {
  const pending = outbox.filter((op) => op.status === "PENDING" || op.sync_status === "pending_sync").length;
  const failed = outbox.filter((op) => op.status === "FAILED" || op.sync_status === "failed").length;
  const conflicts = outbox.filter((op) => op.status === "CONFLICT" || op.sync_status === "conflict").length;
  return { pending, failed, conflicts };
}

async function loadScopedRows<T>(tableName: string): Promise<T[]> {
  return offlineDB.getAll<T>(tableName).then((rows) => filterRowsForCurrentScope(rows)).catch(() => []);
}

async function loadLocalFinanceRows(): Promise<LocalFinanceRows> {
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
    outbox,
  ] = await Promise.all([
    loadScopedRows<LocalBill>("bills"),
    loadScopedRows<LocalBillItem>("bill_items"),
    loadScopedRows<LocalPayment>("payments"),
    loadScopedRows<RecordLike>("customer_ledger"),
    loadScopedRows<Product>("products"),
    loadScopedRows<Customer>("customers"),
    loadScopedRows<Supplier>("suppliers"),
    loadScopedRows<LocalInventoryMovement>("inventory_movements"),
    loadScopedRows<LocalPurchaseBill>("purchase_bills"),
    loadScopedRows<PendingSyncEvent>("sync_outbox"),
  ]);

  // Historical safety check: const payments = dedupePaymentsForDisplay(filterRowsForCurrentScope(paymentsRaw))
  return { bills, billItems, payments, ledger, products, customers, suppliers, inventoryMovements, purchaseBills, outbox };
}

function aggregate(rows: LocalFinanceRows, range: DateRange): FinancialAggregationSnapshot {
  return aggregateFinancialRows({
    bills: rows.bills,
    billItems: rows.billItems,
    payments: rows.payments,
    ledger: rows.ledger as never,
    products: rows.products,
    customers: rows.customers,
    suppliers: rows.suppliers,
    inventoryMovements: rows.inventoryMovements,
    purchaseBills: rows.purchaseBills,
    date: range.to,
    range,
  });
}

export async function buildLocalReportSnapshot(range: DateRange): Promise<LocalReportSnapshot> {
  const rows = await loadLocalFinanceRows();
  const today = toDateInputValue(new Date());
  const todayRange = { from: today, to: today };
  const sevenDayRange = { from: toDateInputValue(addDays(startOfLocalDay(), -6)), to: today };
  const thirtyDayRange = { from: toDateInputValue(addDays(startOfLocalDay(), -29)), to: today };
  const selectedSnapshot = aggregate(rows, range);
  const previousSelectedSnapshot = aggregate(rows, previousRange(range));
  const todaySnapshot = aggregate(rows, todayRange);
  const sevenDaySnapshot = aggregate(rows, sevenDayRange);
  const thirtyDaySnapshot = aggregate(rows, thirtyDayRange);
  const counters = syncCounters(rows.outbox);
  const lowStock = calculateLowStock(rows.products);
  const dailyTrend = buildDailyTrend(rows, range);
  const hasLocalData = Boolean(
    rows.bills.length ||
      rows.payments.length ||
      rows.ledger.length ||
      rows.products.length ||
      rows.inventoryMovements.length ||
      rows.purchaseBills.length,
  );

  return {
    generatedAt: new Date().toISOString(),
    range,
    today: toMetricWindow(todaySnapshot),
    sevenDay: toMetricWindow(sevenDaySnapshot),
    thirtyDay: toMetricWindow(thirtyDaySnapshot),
    selected: toMetricWindow(selectedSnapshot),
    previousSelected: toMetricWindow(previousSelectedSnapshot),
    paymentBreakdown: toPaymentBreakdown(selectedSnapshot),
    pendingUdhar: selectedSnapshot.totalOutstandingUdhar,
    topCustomers: topCustomersFromSnapshot(selectedSnapshot),
    topProducts: topProductsFromSnapshot(selectedSnapshot, rows.products),
    dailyTrend,
    categoryPerformance: categoryPerformanceFromSnapshot(selectedSnapshot, rows.products),
    stockMovement: {
      totalIn: roundMoney(dailyTrend.reduce((sum, point) => sum + point.stockIn, 0)),
      totalOut: roundMoney(dailyTrend.reduce((sum, point) => sum + point.stockOut, 0)),
      newProducts: rows.products.filter((product) => !isDeleted(product as unknown as RecordLike) && isWithinRange(product as unknown as RecordLike, range)).length,
      lowStockItems: lowStock.length,
    },
    lowStock,
    staffSales: calculateStaffSales(rows.bills, range),
    discounts: calculateDiscountSummary(rows.bills, range),
    hourlySales: calculateHourlySales(rows.bills, range),
    pendingSyncCount: counters.pending,
    failedSyncCount: counters.failed,
    conflictCount: counters.conflicts,
    hasUnsyncedOperations: counters.pending + counters.failed + counters.conflicts > 0,
    hasLocalData,
    dataSourceLabel: counters.pending + counters.failed + counters.conflicts > 0 ? "Local estimate" : "Local confirmed data",
  };
}

export async function buildDailyClosingReport(date: string): Promise<DailyClosingReport> {
  const snapshot = await buildLocalReportSnapshot({ from: date, to: date });
  return {
    date,
    totalSales: snapshot.selected.sales,
    profitEstimate: snapshot.selected.profitEstimate,
    billCount: snapshot.selected.bills,
    cashSales: snapshot.paymentBreakdown.cash,
    upiSales: snapshot.paymentBreakdown.upi,
    bankSales: snapshot.paymentBreakdown.bank,
    cashReceived: snapshot.paymentBreakdown.cashIn,
    upiReceived: snapshot.paymentBreakdown.upiIn,
    bankReceived: snapshot.paymentBreakdown.bankIn,
    udharGiven: snapshot.paymentBreakdown.udhar,
    oldUdharPaymentReceived: snapshot.paymentBreakdown.oldUdharReceived,
    oldUdharCashReceived: snapshot.paymentBreakdown.oldUdharCashReceived,
    oldUdharUpiReceived: snapshot.paymentBreakdown.oldUdharUpiReceived,
    oldUdharBankReceived: snapshot.paymentBreakdown.oldUdharBankReceived,
    purchaseCashPaid: snapshot.paymentBreakdown.purchaseCashPaid,
    purchaseUpiPaid: snapshot.paymentBreakdown.purchaseUpiPaid,
    purchaseBankPaid: snapshot.paymentBreakdown.purchaseBankPaid,
    purchasePaid: snapshot.paymentBreakdown.purchasePaid,
    purchaseDue: snapshot.paymentBreakdown.purchaseDue,
    expectedCashInDrawer: snapshot.paymentBreakdown.netCashInHand,
    expectedUpiInBank: snapshot.paymentBreakdown.netUpiInBank,
    expectedBankInBank: snapshot.paymentBreakdown.netBankInBank,
    topSoldProducts: snapshot.topProducts.slice(0, 8),
    lowStockItems: snapshot.lowStock.slice(0, 8),
    pendingSyncCount: snapshot.pendingSyncCount,
    failedSyncCount: snapshot.failedSyncCount,
    conflictCount: snapshot.conflictCount,
    isLocalEstimate: snapshot.hasUnsyncedOperations,
    generatedAt: snapshot.generatedAt,
  };
}

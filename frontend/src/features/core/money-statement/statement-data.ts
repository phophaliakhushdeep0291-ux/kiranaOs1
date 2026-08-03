import { format } from "date-fns";
import { roundMoney } from "@/lib/money";
import { filterRowsForCurrentScope, offlineDB } from "@/lib/offline/db";
import { dedupeBillsForDisplay, dedupePaymentsForDisplay } from "@/features/core/sync/bill-reconciliation";
import type { Bill, Customer, Expense, PurchaseBill, Supplier } from "@/types/api";

export type MoneyStatementMode = "cash" | "upi" | "bank";
export type MoneyStatementDirection = "in" | "out";

export interface MoneyStatementItem {
  id: string;
  name: string;
  quantity: number;
  unit?: string;
  rate: number;
  amount: number;
}

export interface MoneyStatementDetail {
  kind: "bill" | "udhar-payment" | "purchase" | "expense";
  title: string;
  billNo?: string;
  paymentId?: string;
  subtotal?: number;
  discount?: number;
  total?: number;
  paid?: number;
  due?: number;
  items: MoneyStatementItem[];
  note?: string;
}

export interface MoneyStatementRow {
  id: string;
  occurredAt: string;
  dateLabel: string;
  timeLabel: string;
  partyName: string;
  partyMobile?: string;
  source: "Bill payment" | "Udhar payment" | "Purchase payment" | "Expense";
  reference: string;
  mode: MoneyStatementMode;
  direction: MoneyStatementDirection;
  amount: number;
  status?: string;
  note?: string;
  detail?: MoneyStatementDetail;
}

export interface MoneyStatementTotals {
  cashIn: number;
  cashOut: number;
  cashNet: number;
  upiIn: number;
  upiOut: number;
  upiNet: number;
  bankIn: number;
  bankOut: number;
  bankNet: number;
  totalIn: number;
  totalOut: number;
  totalNet: number;
  rows: number;
}

export interface MoneyStatementFilters {
  from?: string;
  to?: string;
  mode?: MoneyStatementMode | "all";
  direction?: MoneyStatementDirection | "all";
  search?: string;
}

export interface MoneyStatementInput {
  bills?: Array<Record<string, unknown>>;
  payments?: Array<Record<string, unknown>>;
  customerLedger?: Array<Record<string, unknown>>;
  customers?: Array<Record<string, unknown>>;
  billItems?: Array<Record<string, unknown>>;
  products?: Array<Record<string, unknown>>;
  purchaseBills?: Array<Record<string, unknown>>;
  suppliers?: Array<Record<string, unknown>>;
  expenses?: Array<Record<string, unknown>>;
}

export interface MoneyStatementResult {
  rows: MoneyStatementRow[];
  totals: MoneyStatementTotals;
}

function asString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function firstString(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = asString(row[key]);
    if (value) return value;
  }
  return "";
}

function firstNumber(row: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const parsed = Number(row[key]);
    if (Number.isFinite(parsed)) return roundMoney(parsed);
  }
  return 0;
}

function isDeleted(row: Record<string, unknown>): boolean {
  return Boolean(row.deletedAt ?? row.deleted_at);
}

export function normaliseMoneyMode(value: unknown): MoneyStatementMode | null {
  const mode = asString(value).toLowerCase().replace(/[\s-]+/g, "_");
  if (mode === "cash") return "cash";
  if (mode === "upi") return "upi";
  if (["bank", "bank_transfer", "net_banking", "card", "debit_card", "credit_card"].includes(mode)) return "bank";
  return null;
}

function dateValue(row: Record<string, unknown>, keys: string[]): string {
  const raw = firstString(row, keys);
  if (!raw) return new Date(0).toISOString();
  const parsed = new Date(raw);
  if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(`${raw}T00:00:00`).toISOString();
  return raw;
}

function dateKey(iso: string): string {
  const parsed = new Date(iso);
  return Number.isFinite(parsed.getTime()) ? format(parsed, "yyyy-MM-dd") : iso.slice(0, 10);
}

function dateLabel(iso: string): string {
  const parsed = new Date(iso);
  return Number.isFinite(parsed.getTime()) ? format(parsed, "dd MMM yyyy") : iso.slice(0, 10);
}

function timeLabel(iso: string): string {
  const parsed = new Date(iso);
  return Number.isFinite(parsed.getTime()) ? format(parsed, "hh:mm a") : "--";
}

function withinRange(iso: string, filters: MoneyStatementFilters): boolean {
  const key = dateKey(iso);
  return (!filters.from || key >= filters.from) && (!filters.to || key <= filters.to);
}

function matchSearch(row: MoneyStatementRow, search?: string): boolean {
  const term = asString(search).toLowerCase();
  if (!term) return true;
  return [
    row.partyName,
    row.partyMobile,
    row.source,
    row.reference,
    row.mode,
    row.status,
    row.note,
  ].some((value) => asString(value).toLowerCase().includes(term));
}

function rowKeys(row: Record<string, unknown>, keys: string[]): string[] {
  return [...new Set(keys.map((key) => firstString(row, [key])).filter(Boolean))];
}

function customerId(row: Record<string, unknown>): string {
  return firstString(row, ["customerId", "customer_id", "customerLocalId", "customer_local_id", "customerServerId", "customer_server_id"]);
}

function billId(row: Record<string, unknown>): string {
  return firstString(row, ["billId", "bill_id", "billLocalId", "bill_local_id", "id"]);
}

function billIdentityKeys(row: Record<string, unknown>): string[] {
  return rowKeys(row, [
    "id",
    "local_id",
    "server_id",
    "localId",
    "serverId",
    "billId",
    "bill_id",
    "billLocalId",
    "bill_local_id",
    "billServerId",
    "bill_server_id",
  ]);
}

function rowId(row: Record<string, unknown>, prefix: string, index: number): string {
  return firstString(row, ["id", "local_id", "server_id", "paymentId", "payment_id", "invoiceNumber", "billNo", "billNumber"]) || `${prefix}-${index}`;
}

function paymentIdentityKeys(row: Record<string, unknown>): string[] {
  return rowKeys(row, [
    "id",
    "local_id",
    "server_id",
    "paymentId",
    "payment_id",
    "localPaymentId",
    "local_payment_id",
    "clientPaymentId",
    "client_payment_id",
    "source_id",
    "sourceId",
  ]);
}

function isPaymentLedgerEntry(row: Record<string, unknown>): boolean {
  const type = firstString(row, ["type", "entryType", "entry_type"]).toLowerCase();
  const sourceType = firstString(row, ["source_type", "sourceType"]).toLowerCase();
  return type === "payment" || sourceType === "payment";
}

function compactBillReference(row: Record<string, unknown>): string {
  return firstString(row, ["billNo", "billNumber", "invoiceNumber", "reference", "id"]) || "Bill";
}

function productId(row: Record<string, unknown>): string {
  return firstString(row, ["productId", "product_id", "productLocalId", "product_local_id", "productServerId", "product_server_id"]);
}

function billItemBillKeys(row: Record<string, unknown>): string[] {
  return rowKeys(row, ["billId", "bill_id", "billLocalId", "bill_local_id", "billServerId", "bill_server_id"]);
}

function productIdentityKeys(row: Record<string, unknown>): string[] {
  return rowKeys(row, ["id", "local_id", "server_id", "localId", "serverId", "productId", "product_id"]);
}

function rowItems(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null) : [];
}

function buildItemDetail(row: Record<string, unknown>, index: number, productsById: Map<string, Record<string, unknown>>): MoneyStatementItem {
  const product = productsById.get(productId(row));
  const quantity = firstNumber(row, ["quantity", "qty", "soldQty", "sold_qty", "purchaseQty", "purchase_qty"]);
  const rate = firstNumber(row, ["ratePerRateUnit", "rate_per_rate_unit", "rate", "unitPrice", "unit_price", "sellingPrice", "selling_price", "costPrice", "cost_price"]);
  return {
    id: firstString(row, ["id", "local_id", "server_id"]) || `item-${index}`,
    name: firstString(row, ["name", "productName", "product_name", "title"]) || firstString(product ?? {}, ["name", "productName", "product_name"]) || "Item",
    quantity,
    unit: firstString(row, ["enteredUnit", "entered_unit", "unit", "rateUnit", "rate_unit"]) || firstString(product ?? {}, ["unit", "unitName", "unit_name"]) || undefined,
    rate,
    amount: firstNumber(row, ["lineTotal", "line_total", "total", "amount"]) || roundMoney(quantity * rate),
  };
}

function billFinancials(bill: Record<string, unknown>) {
  const total = firstNumber(bill, ["grandTotal", "grand_total", "totalAmount", "total_amount", "netAmount", "net_amount"]);
  const paid = firstNumber(bill, ["paidAmount", "paid_amount", "buyerPaidAmount", "buyer_paid_amount"]);
  const explicitDue = firstNumber(bill, ["dueAmount", "due_amount", "creditAmount", "credit_amount"]);
  return {
    subtotal: firstNumber(bill, ["subtotal", "subtotalAmount", "subtotal_amount"]),
    discount: firstNumber(bill, ["discount", "discountAmount", "discount_amount"]),
    total,
    paid,
    due: explicitDue || Math.max(0, roundMoney(total - paid)),
  };
}

function billDetail(
  bill: Record<string, unknown> | undefined,
  itemsByBillId: Map<string, Record<string, unknown>[]>,
  productsById: Map<string, Record<string, unknown>>,
  payment: Record<string, unknown> | undefined,
): MoneyStatementDetail | undefined {
  if (!bill) return undefined;
  const rawItems = rowItems(bill.items).length > 0
    ? rowItems(bill.items)
    : billIdentityKeys(bill).flatMap((key) => itemsByBillId.get(key) ?? []);
  const financials = billFinancials(bill);
  return {
    kind: "bill",
    title: "Bill payment details",
    billNo: compactBillReference(bill),
    paymentId: payment ? firstString(payment, ["id", "local_id", "server_id", "paymentId", "payment_id"]) || undefined : undefined,
    ...financials,
    items: rawItems.map((item, index) => buildItemDetail(item, index, productsById)),
    note: firstString(payment ?? {}, ["note", "remarks", "description"]) || firstString(bill, ["note", "remarks", "description"]),
  };
}

function purchaseDetail(purchase: Record<string, unknown>, productsById: Map<string, Record<string, unknown>>): MoneyStatementDetail {
  const total = firstNumber(purchase, ["billAmount", "bill_amount", "totalAmount", "total_amount", "grandTotal", "grand_total"]);
  const paid = firstNumber(purchase, ["paidAmount", "paid_amount", "amountPaid", "amount_paid"]);
  const due = firstNumber(purchase, ["dueAmount", "due_amount"]) || Math.max(0, roundMoney(total - paid));
  return {
    kind: "purchase",
    title: "Purchase payment details",
    billNo: firstString(purchase, ["invoiceNumber", "billNumber", "billNo", "reference"]) || "Purchase",
    total,
    paid,
    due,
    items: rowItems(purchase.items ?? purchase.products ?? purchase.lines).map((item, index) => buildItemDetail(item, index, productsById)),
    note: firstString(purchase, ["note", "remarks", "description"]),
  };
}

function partyFromCustomer(customer: Record<string, unknown> | undefined, fallback = "Customer", fallbackMobile?: string) {
  return {
    name: firstString(customer ?? {}, ["name", "customerName", "customer_name", "buyerName", "buyer_name"]) || fallback,
    mobile: firstString(customer ?? {}, ["mobile", "phone", "customerMobile", "customer_mobile"]) || fallbackMobile || undefined,
  };
}

function buildEmbeddedBillPayments(bill: Record<string, unknown>): Array<{ mode: MoneyStatementMode; amount: number; id: string }> {
  const embedded = Array.isArray(bill.payments) ? bill.payments.filter((value): value is Record<string, unknown> => typeof value === "object" && value !== null) : [];
  const rows = embedded
    .map((payment, index) => ({
      mode: normaliseMoneyMode(payment.mode ?? payment.paymentMode ?? payment.payment_mode),
      amount: firstNumber(payment, ["amount", "paidAmount", "paid_amount"]),
      id: rowId(payment, "bill-payment", index),
    }))
    .filter((payment): payment is { mode: MoneyStatementMode; amount: number; id: string } => Boolean(payment.mode) && payment.amount > 0);
  if (rows.length > 0) return rows;

  const fallbackRows: Array<{ mode: MoneyStatementMode; amount: number; id: string }> = [];
  const cash = firstNumber(bill, ["cashAmount", "cash_amount", "cashPaid", "cash_paid"]);
  const upi = firstNumber(bill, ["upiAmount", "upi_amount", "upiPaid", "upi_paid"]);
  const bank = firstNumber(bill, ["bankAmount", "bank_amount", "bankPaid", "bank_paid"]);
  if (cash > 0) fallbackRows.push({ mode: "cash", amount: cash, id: "cash" });
  if (upi > 0) fallbackRows.push({ mode: "upi", amount: upi, id: "upi" });
  if (bank > 0) fallbackRows.push({ mode: "bank", amount: bank, id: "bank" });
  if (fallbackRows.length > 0) return fallbackRows;

  const mode = normaliseMoneyMode(bill.paymentMode ?? bill.payment_mode);
  const total = firstNumber(bill, ["paidAmount", "paid_amount", "buyerPaidAmount", "buyer_paid_amount", "grandTotal", "grand_total", "totalAmount", "total_amount"]);
  return mode && total > 0 ? [{ mode, amount: total, id: mode }] : [];
}

function dedupePurchaseBills(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const byKey = new Map<string, Record<string, unknown>>();
  rows.filter((row) => !isDeleted(row)).forEach((row, index) => {
    const key = firstString(row, ["id", "server_id", "local_id", "purchaseBillId", "purchase_bill_id"])
      || [
        firstString(row, ["supplierId", "supplier_id", "supplierName", "supplier_name"]),
        firstString(row, ["invoiceNumber", "billNumber", "billNo"]),
        firstNumber(row, ["billAmount", "bill_amount", "totalAmount", "total_amount"]).toFixed(2),
        dateKey(dateValue(row, ["purchaseDate", "purchase_date", "createdAt", "created_at"])),
      ].join("|")
      || `purchase-${index}`;
    byKey.set(key, row);
  });
  return [...byKey.values()];
}

export function buildMoneyStatement(input: MoneyStatementInput, filters: MoneyStatementFilters = {}): MoneyStatementResult {
  const customers = new Map<string, Record<string, unknown>>();
  (input.customers ?? []).forEach((customer) => {
    rowKeys(customer, ["id", "local_id", "server_id", "localId", "serverId", "customerId", "customer_id"]).forEach((key) => customers.set(key, customer));
  });
  const suppliers = new Map<string, Record<string, unknown>>();
  (input.suppliers ?? []).forEach((supplier) => {
    rowKeys(supplier, ["id", "local_id", "server_id", "localId", "serverId", "supplierId", "supplier_id"]).forEach((key) => suppliers.set(key, supplier));
  });
  const productsById = new Map<string, Record<string, unknown>>();
  (input.products ?? []).forEach((product) => {
    productIdentityKeys(product).forEach((key) => productsById.set(key, product));
  });
  const itemsByBillId = new Map<string, Record<string, unknown>[]>();
  (input.billItems ?? []).filter((row) => !isDeleted(row)).forEach((item) => {
    billItemBillKeys(item).forEach((key) => {
      itemsByBillId.set(key, [...(itemsByBillId.get(key) ?? []), item]);
    });
  });
  const rows: MoneyStatementRow[] = [];
  const bills = dedupeBillsForDisplay((input.bills ?? []).filter((row) => !isDeleted(row)));
  const billsById = new Map<string, Record<string, unknown>>();
  bills.forEach((bill) => {
    billIdentityKeys(bill).forEach((key) => billsById.set(key, bill));
  });

  const payments = dedupePaymentsForDisplay((input.payments ?? []).filter((row) => !isDeleted(row)));
  const paymentBillIds = new Set<string>();
  const paymentIds = new Set<string>();
  payments.forEach((payment, index) => {
    const mode = normaliseMoneyMode(payment.mode ?? payment.paymentMode ?? payment.payment_mode);
    const amount = firstNumber(payment, ["amount", "paidAmount", "paid_amount"]);
    if (!mode || amount <= 0) return;
    paymentIdentityKeys(payment).forEach((key) => paymentIds.add(key));
    const relatedBillId = firstString(payment, ["billId", "bill_id", "billLocalId", "bill_local_id", "billServerId", "bill_server_id"]);
    const relatedBill = relatedBillId ? billsById.get(relatedBillId) : undefined;
    if (relatedBillId) paymentBillIds.add(relatedBillId);
    const cid = customerId(payment) || customerId(relatedBill ?? {});
    const party = partyFromCustomer(
      customers.get(cid),
      firstString(payment, ["customerName", "customer_name", "payerName", "payer_name", "buyerName", "buyer_name", "name"])
        || firstString(relatedBill ?? {}, ["customerName", "customer_name", "buyerName", "buyer_name", "name"])
        || "Customer",
      firstString(payment, ["customerMobile", "customer_mobile", "payerMobile", "payer_mobile", "mobile", "phone"])
        || firstString(relatedBill ?? {}, ["customerMobile", "customer_mobile", "buyerMobile", "buyer_mobile", "mobile", "phone"]),
    );
    const occurredAt = dateValue(payment, ["paid_at", "paidAt", "entry_at", "createdAt", "created_at"]);
    rows.push({
      id: `payment:${rowId(payment, "payment", index)}`,
      occurredAt,
      dateLabel: dateLabel(occurredAt),
      timeLabel: timeLabel(occurredAt),
      partyName: party.name,
      partyMobile: party.mobile,
      source: relatedBillId ? "Bill payment" : "Udhar payment",
      reference: firstString(payment, ["billNo", "billNumber", "reference", "description"]) || (relatedBill ? compactBillReference(relatedBill) : relatedBillId ? "Bill payment" : "Udhar recovery"),
      mode,
      direction: "in",
      amount,
      status: firstString(payment, ["sync_status", "status"]) || firstString(relatedBill ?? {}, ["sync_status", "paymentStatus", "payment_status", "status"]),
      note: firstString(payment, ["note", "remarks", "description"]),
      detail: relatedBill
        ? billDetail(relatedBill, itemsByBillId, productsById, payment)
        : {
            kind: "udhar-payment",
            title: "Udhar payment details",
            paymentId: firstString(payment, ["id", "local_id", "server_id", "paymentId", "payment_id"]) || undefined,
            paid: amount,
            items: [],
            note: firstString(payment, ["note", "remarks", "description"]) || "Payment received against customer outstanding balance.",
          },
    });
  });

  (input.customerLedger ?? []).filter((row) => !isDeleted(row) && isPaymentLedgerEntry(row)).forEach((ledger, index) => {
    const identityKeys = paymentIdentityKeys(ledger);
    if (identityKeys.some((key) => paymentIds.has(key))) return;
    const mode = normaliseMoneyMode(ledger.mode ?? ledger.paymentMode ?? ledger.payment_mode);
    const amount = Math.abs(firstNumber(ledger, ["amount", "paidAmount", "paid_amount", "credit", "creditAmount", "credit_amount"]));
    if (!mode || amount <= 0) return;
    identityKeys.forEach((key) => paymentIds.add(key));
    const cid = customerId(ledger);
    const party = partyFromCustomer(
      customers.get(cid),
      firstString(ledger, ["customerName", "customer_name", "payerName", "payer_name", "buyerName", "buyer_name", "name"]) || "Customer",
      firstString(ledger, ["customerMobile", "customer_mobile", "payerMobile", "payer_mobile", "mobile", "phone"]),
    );
    const occurredAt = dateValue(ledger, ["paid_at", "paidAt", "entry_at", "entryAt", "createdAt", "created_at"]);
    rows.push({
      id: `ledger-payment:${rowId(ledger, "ledger-payment", index)}`,
      occurredAt,
      dateLabel: dateLabel(occurredAt),
      timeLabel: timeLabel(occurredAt),
      partyName: party.name,
      partyMobile: party.mobile,
      source: "Udhar payment",
      reference: firstString(ledger, ["reference", "description", "note", "remarks"]) || "Udhar recovery",
      mode,
      direction: "in",
      amount,
      status: firstString(ledger, ["sync_status", "status"]) || "posted",
      note: firstString(ledger, ["note", "remarks", "description"]),
      detail: {
        kind: "udhar-payment",
        title: "Udhar payment details",
        paymentId: firstString(ledger, ["paymentId", "payment_id", "source_id", "sourceId", "id", "local_id", "server_id"]) || undefined,
        paid: amount,
        items: [],
        note: firstString(ledger, ["note", "remarks", "description"]) || "Payment received against customer outstanding balance.",
      },
    });
  });

  bills.forEach((bill, billIndex) => {
    const id = billId(bill);
    if (id && billIdentityKeys(bill).some((key) => paymentBillIds.has(key))) return;
    const occurredAt = dateValue(bill, ["createdAt", "created_at", "billDate", "bill_date"]);
    const party = partyFromCustomer(
      customers.get(customerId(bill)),
      firstString(bill, ["customerName", "customer_name", "buyerName", "buyer_name", "name"]) || "Walk-in customer",
      firstString(bill, ["customerMobile", "customer_mobile", "buyerMobile", "buyer_mobile", "mobile", "phone"]),
    );
    buildEmbeddedBillPayments(bill).forEach((payment) => {
      rows.push({
        id: `bill:${id || billIndex}:${payment.id}:${payment.mode}`,
        occurredAt,
        dateLabel: dateLabel(occurredAt),
        timeLabel: timeLabel(occurredAt),
        partyName: party.name,
        partyMobile: party.mobile,
        source: "Bill payment",
        reference: compactBillReference(bill),
        mode: payment.mode,
        direction: "in",
        amount: payment.amount,
        status: firstString(bill, ["paymentStatus", "payment_status", "status"]),
        detail: billDetail(bill, itemsByBillId, productsById, undefined),
      });
    });
  });

  dedupePurchaseBills(input.purchaseBills ?? []).forEach((purchase, index) => {
    const mode = normaliseMoneyMode(purchase.paymentMode ?? purchase.payment_mode);
    const amount = firstNumber(purchase, ["paidAmount", "paid_amount", "amountPaid", "amount_paid"]);
    if (!mode || amount <= 0) return;
    const sid = firstString(purchase, ["supplierId", "supplier_id"]);
    const supplier = suppliers.get(sid);
    const occurredAt = dateValue(purchase, ["paidAt", "paid_at", "purchaseDate", "purchase_date", "createdAt", "created_at"]);
    rows.push({
      id: `purchase:${rowId(purchase, "purchase", index)}`,
      occurredAt,
      dateLabel: dateLabel(occurredAt),
      timeLabel: timeLabel(occurredAt),
      partyName: firstString(supplier ?? {}, ["name", "supplierName", "supplier_name"]) || firstString(purchase, ["supplierName", "supplier_name"]) || "Supplier",
      partyMobile: firstString(supplier ?? {}, ["mobile", "phone"]) || undefined,
      source: "Purchase payment",
      reference: firstString(purchase, ["invoiceNumber", "billNumber", "billNo", "reference"]) || "Purchase",
      mode,
      direction: "out",
      amount,
      status: firstString(purchase, ["paymentStatus", "payment_status", "status"]),
      detail: purchaseDetail(purchase, productsById),
    });
  });

  (input.expenses ?? []).filter((row) => !isDeleted(row)).forEach((expense, index) => {
    const mode = normaliseMoneyMode(expense.paymentMode ?? expense.payment_mode ?? expense.mode);
    const amount = firstNumber(expense, ["amount", "totalAmount", "total_amount"]);
    if (!mode || amount <= 0) return;
    const occurredAt = dateValue(expense, ["spentAt", "spent_at", "date", "createdAt", "created_at"]);
    rows.push({
      id: `expense:${rowId(expense, "expense", index)}`,
      occurredAt,
      dateLabel: dateLabel(occurredAt),
      timeLabel: timeLabel(occurredAt),
      partyName: firstString(expense, ["vendor", "vendorName", "vendor_name", "payee", "title"]) || "Expense",
      source: "Expense",
      reference: firstString(expense, ["title", "category", "reference"]) || "Expense",
      mode,
      direction: "out",
      amount,
      status: firstString(expense, ["status"]) || "paid",
      note: firstString(expense, ["notes", "description"]),
      detail: {
        kind: "expense",
        title: "Expense payment details",
        billNo: firstString(expense, ["title", "category", "reference"]) || "Expense",
        total: amount,
        paid: amount,
        items: [],
        note: firstString(expense, ["notes", "description"]),
      },
    });
  });

  const filteredRows = rows
    .filter((row) => withinRange(row.occurredAt, filters))
    .filter((row) => !filters.mode || filters.mode === "all" || row.mode === filters.mode)
    .filter((row) => !filters.direction || filters.direction === "all" || row.direction === filters.direction)
    .filter((row) => matchSearch(row, filters.search))
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());

  const totals = filteredRows.reduce<MoneyStatementTotals>((acc, row) => {
    if (row.mode === "cash" && row.direction === "in") acc.cashIn = roundMoney(acc.cashIn + row.amount);
    if (row.mode === "cash" && row.direction === "out") acc.cashOut = roundMoney(acc.cashOut + row.amount);
    if (row.mode === "upi" && row.direction === "in") acc.upiIn = roundMoney(acc.upiIn + row.amount);
    if (row.mode === "upi" && row.direction === "out") acc.upiOut = roundMoney(acc.upiOut + row.amount);
    if (row.mode === "bank" && row.direction === "in") acc.bankIn = roundMoney(acc.bankIn + row.amount);
    if (row.mode === "bank" && row.direction === "out") acc.bankOut = roundMoney(acc.bankOut + row.amount);
    acc.totalIn = roundMoney(acc.totalIn + (row.direction === "in" ? row.amount : 0));
    acc.totalOut = roundMoney(acc.totalOut + (row.direction === "out" ? row.amount : 0));
    return acc;
  }, {
    cashIn: 0, cashOut: 0, cashNet: 0,
    upiIn: 0, upiOut: 0, upiNet: 0,
    bankIn: 0, bankOut: 0, bankNet: 0,
    totalIn: 0, totalOut: 0, totalNet: 0, rows: filteredRows.length,
  });
  totals.cashNet = roundMoney(totals.cashIn - totals.cashOut);
  totals.upiNet = roundMoney(totals.upiIn - totals.upiOut);
  totals.bankNet = roundMoney(totals.bankIn - totals.bankOut);
  totals.totalNet = roundMoney(totals.totalIn - totals.totalOut);
  totals.rows = filteredRows.length;

  return { rows: filteredRows, totals };
}

export async function loadMoneyStatementInput(): Promise<MoneyStatementInput> {
  const [bills, billItems, payments, customerLedger, customers, products, purchaseBills, suppliers] = await Promise.all([
    offlineDB.getAll<Bill & Record<string, unknown>>("bills").catch(() => []),
    offlineDB.getAll<Record<string, unknown>>("bill_items").catch(() => []),
    offlineDB.getAll<Record<string, unknown>>("payments").catch(() => []),
    offlineDB.getAll<Record<string, unknown>>("customer_ledger").catch(() => []),
    offlineDB.getAll<Customer & Record<string, unknown>>("customers").catch(() => []),
    offlineDB.getAll<Record<string, unknown>>("products").catch(() => []),
    offlineDB.getAll<PurchaseBill & Record<string, unknown>>("purchase_bills").catch(() => []),
    offlineDB.getAll<Supplier & Record<string, unknown>>("suppliers").catch(() => []),
  ]);
  return {
    bills: filterRowsForCurrentScope(bills),
    billItems: filterRowsForCurrentScope(billItems),
    payments: filterRowsForCurrentScope(payments),
    customerLedger: filterRowsForCurrentScope(customerLedger),
    customers: filterRowsForCurrentScope(customers),
    products: filterRowsForCurrentScope(products),
    purchaseBills: filterRowsForCurrentScope(purchaseBills),
    suppliers: filterRowsForCurrentScope(suppliers),
    expenses: [] satisfies Expense[],
  };
}

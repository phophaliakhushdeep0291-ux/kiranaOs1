import { offlineDB } from "@/lib/offline/db";
import { readInstantCache } from "@/lib/offline/instant-cache";
import type { Bill, Customer } from "@/types/api";
import { buildLedgerStatement, calculateTrustScore, dedupeLedgerEntries, roundMoney, type CustomerLedgerEntry, type LedgerMetrics, type LedgerStatementRow } from "@/features/ledger/accounting";

export interface CustomerWithLedger extends Customer, Record<string, unknown> {
  ledgerBalance: number;
  ledgerMetrics: LedgerMetrics;
}

export interface CustomerDetailData {
  customer: CustomerWithLedger;
  bills: Array<Bill & Record<string, unknown>>;
  payments: Array<Record<string, unknown>>;
  ledger: LedgerStatementRow[];
  audit: Array<Record<string, unknown>>;
}


function readNumber(value: unknown, fallback = 0): number {
  const num = Number(value ?? fallback);
  return Number.isFinite(num) ? num : fallback;
}

function metricsWithCustomerBalanceFallback(customer: Customer & Record<string, unknown>, entries: CustomerLedgerEntry[]): LedgerMetrics {
  const metrics = calculateTrustScore(customer, entries);
  if (entries.length > 0) return metrics;
  const balance = roundMoney(readNumber(customer.udharAmount ?? customer.totalUdhar, 0));
  if (balance <= 0) return metrics;
  return {
    ...metrics,
    balance,
    ageing: { ...metrics.ageing, total: balance, zeroToSeven: balance },
    billCount: 0,
    isBadCustomer: balance > readNumber((customer as Record<string, unknown>).udharLimit, Number.POSITIVE_INFINITY),
    warning: null,
  };
}

function isDeleted(row: Record<string, unknown>): boolean {
  return typeof row.deleted_at === "string" || typeof row.deletedAt === "string";
}

function getCustomerId(row: Partial<CustomerLedgerEntry>): string | null {
  const id = row.customerId ?? row.customer_id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function getBillCustomerId(row: Record<string, unknown>): string | null {
  const id = row.customerId ?? row.customer_id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function getPaymentCustomerId(row: Record<string, unknown>): string | null {
  const id = row.customerId ?? row.customer_id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function uniqueById<T extends { id: string }>(rows: T[]): T[] {
  const map = new Map<string, T>();
  for (const row of rows) map.set(row.id, { ...map.get(row.id), ...row });
  return Array.from(map.values());
}

export async function loadCustomersWithLedger(): Promise<CustomerWithLedger[]> {
  const cached = readInstantCache<Customer[]>("customers", []);
  const dbCustomers = await offlineDB.getAll<Customer & Record<string, unknown>>("customers").catch(() => []);
  const customers = uniqueById([...cached, ...dbCustomers].filter((customer) => !isDeleted(customer as unknown as Record<string, unknown>)) as Array<Customer & Record<string, unknown>>);
  const ledger = dedupeLedgerEntries(await offlineDB.getAll<CustomerLedgerEntry>("customer_ledger").catch(() => []));
  return customers.map((customer) => {
    const entries = ledger.filter((entry) => getCustomerId(entry) === customer.id || getCustomerId(entry) === customer.local_id || getCustomerId(entry) === customer.server_id);
    const metrics = metricsWithCustomerBalanceFallback(customer, entries);
    return {
      ...customer,
      ledgerBalance: metrics.balance,
      totalUdhar: metrics.balance,
      udharAmount: metrics.balance,
      ledgerMetrics: metrics,
    };
  }).sort((a, b) => b.ledgerBalance - a.ledgerBalance || a.name.localeCompare(b.name));
}

export async function loadCustomerDetail(customerId: string): Promise<CustomerDetailData | null> {
  const customers = await loadCustomersWithLedger();
  const customer = customers.find((row) => row.id === customerId || row.local_id === customerId || row.server_id === customerId);
  if (!customer) return null;
  const ids = new Set([customer.id, customer.local_id, customer.server_id].filter((value): value is string => typeof value === "string" && value.length > 0));
  const ledgerSource = dedupeLedgerEntries(await offlineDB.getAll<CustomerLedgerEntry>("customer_ledger").catch(() => []));
  const ledgerEntries = ledgerSource
    .filter((entry) => {
      const id = getCustomerId(entry);
      return id ? ids.has(id) : false;
    });
  const bills = (await offlineDB.getAll<Bill & Record<string, unknown>>("bills").catch(() => []))
    .filter((bill) => {
      const id = getBillCustomerId(bill);
      return id ? ids.has(id) : false;
    })
    .sort((a, b) => String(b.createdAt ?? b.created_at ?? "").localeCompare(String(a.createdAt ?? a.created_at ?? "")));
  const payments = (await offlineDB.getAll<Record<string, unknown>>("payments").catch(() => []))
    .filter((payment) => {
      const id = getPaymentCustomerId(payment);
      return id ? ids.has(id) : false;
    })
    .sort((a, b) => String(b.paidAt ?? b.paid_at ?? b.createdAt ?? b.created_at ?? "").localeCompare(String(a.paidAt ?? a.paid_at ?? a.createdAt ?? a.created_at ?? "")));
  const audit = (await offlineDB.getAll<Record<string, unknown>>("local_audit_logs").catch(() => []))
    .filter((row) => String(row.entity_id ?? "") === customer.id || String(row.customerId ?? row.customer_id ?? "") === customer.id)
    .sort((a, b) => String(b.createdAt ?? b.created_at ?? "").localeCompare(String(a.createdAt ?? a.created_at ?? "")));
  return { customer, bills, payments, ledger: buildLedgerStatement(ledgerEntries), audit };
}

export function formatMoney(value: number): string {
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}

export function formatShortDate(value: unknown): string {
  if (!value) return "Not set";
  const time = new Date(String(value)).getTime();
  if (!Number.isFinite(time)) return "Not set";
  return new Date(time).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatDateTime(value: unknown): string {
  if (!value) return "No date";
  const time = new Date(String(value)).getTime();
  if (!Number.isFinite(time)) return "No date";
  return new Date(time).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

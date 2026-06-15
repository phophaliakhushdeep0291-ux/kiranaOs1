import { offlineDB } from "@/lib/offline/db";
import { readInstantCache } from "@/lib/offline/instant-cache";
import type { Bill, Customer } from "@/types/api";
import { buildLedgerStatement, calculateTrustScore, dedupeLedgerEntries, roundMoney, type CustomerLedgerEntry, type LedgerMetrics, type LedgerStatementRow } from "@/features/ledger/accounting";
import { dedupeBillsForDisplay } from "@/features/sync/bill-reconciliation";

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

function readStringField(row: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function getCustomerId(row: Partial<CustomerLedgerEntry>): string | null {
  return readStringField(row as Record<string, unknown>, [
    "customerId",
    "customer_id",
    "serverCustomerId",
    "server_customer_id",
    "localCustomerId",
    "local_customer_id",
  ]);
}

function getBillCustomerId(row: Record<string, unknown>): string | null {
  return readStringField(row, [
    "customerId",
    "customer_id",
    "serverCustomerId",
    "server_customer_id",
    "localCustomerId",
    "local_customer_id",
  ]);
}

function getPaymentCustomerId(row: Record<string, unknown>): string | null {
  return readStringField(row, [
    "customerId",
    "customer_id",
    "serverCustomerId",
    "server_customer_id",
    "localCustomerId",
    "local_customer_id",
  ]);
}

function uniqueById<T extends { id: string }>(rows: T[]): T[] {
  const map = new Map<string, T>();
  for (const row of rows) map.set(row.id, { ...map.get(row.id), ...row });
  return Array.from(map.values());
}

function customerIds(customer: Customer & Record<string, unknown>): Set<string> {
  return new Set(
    [
      customer.id,
      customer.local_id,
      customer.localId,
      customer.server_id,
      customer.serverId,
    ].filter((value): value is string => typeof value === "string" && value.length > 0),
  );
}

function expandIdsWithMappings(ids: Set<string>, mappings: Array<Record<string, unknown>>): Set<string> {
  const expanded = new Set(ids);
  let changed = true;
  while (changed) {
    changed = false;
    for (const mapping of mappings) {
      const entityType = String(mapping.entity_type ?? mapping.entityType ?? "");
      if (entityType && entityType !== "customer" && entityType !== "customers") continue;
      const localId = readStringField(mapping, ["local_id", "localId"]);
      const serverId = readStringField(mapping, ["server_id", "serverId"]);
      if (!localId || !serverId) continue;
      if (expanded.has(localId) && !expanded.has(serverId)) {
        expanded.add(serverId);
        changed = true;
      }
      if (expanded.has(serverId) && !expanded.has(localId)) {
        expanded.add(localId);
        changed = true;
      }
    }
  }
  return expanded;
}

function ledgerCustomerName(entry?: CustomerLedgerEntry): string | null {
  if (!entry) return null;
  return readStringField(entry as Record<string, unknown>, [
    "customerName",
    "customer_name",
    "name",
  ]);
}

function ledgerCustomerMobile(entry?: CustomerLedgerEntry): string | null {
  if (!entry) return null;
  return readStringField(entry as Record<string, unknown>, [
    "customerMobile",
    "customer_mobile",
    "mobile",
    "phone",
  ]);
}

function syntheticCustomerFromLedger(customerId: string, entries: CustomerLedgerEntry[]): Customer & Record<string, unknown> {
  const latest = [...entries].sort((a, b) => String(b.createdAt ?? b.created_at ?? b.entry_at ?? "").localeCompare(String(a.createdAt ?? a.created_at ?? a.entry_at ?? "")))[0];
  const at = typeof latest?.createdAt === "string"
    ? latest.createdAt
    : typeof latest?.created_at === "string"
      ? latest.created_at
      : typeof latest?.entry_at === "string"
        ? latest.entry_at
        : new Date().toISOString();
  return {
    id: customerId,
    name: ledgerCustomerName(latest) ?? "Ledger customer",
    mobile: ledgerCustomerMobile(latest),
    type: "udhar",
    udharAmount: 0,
    totalUdhar: 0,
    createdAt: at,
    updatedAt: at,
    created_at: at,
    updated_at: at,
    sync_status: "synced",
    ledger_only: true,
  };
}

export async function loadCustomersWithLedger(): Promise<CustomerWithLedger[]> {
  const cached = readInstantCache<Customer[]>("customers", []);
  const dbCustomers = await offlineDB.getAll<Customer & Record<string, unknown>>("customers").catch(() => []);
  const customers = uniqueById([...cached, ...dbCustomers].filter((customer) => !isDeleted(customer as unknown as Record<string, unknown>)) as Array<Customer & Record<string, unknown>>);
  const ledger = dedupeLedgerEntries(await offlineDB.getAll<CustomerLedgerEntry>("customer_ledger").catch(() => []));
  const idMappings = await offlineDB.getAll<Record<string, unknown>>("id_mappings").catch(() => []);
  const knownCustomerIds = new Set(customers.flatMap((customer) => [...expandIdsWithMappings(customerIds(customer), idMappings)]));
  const ledgerOnlyGroups = new Map<string, CustomerLedgerEntry[]>();
  for (const entry of ledger) {
    const id = getCustomerId(entry);
    if (!id || knownCustomerIds.has(id)) continue;
    const group = ledgerOnlyGroups.get(id) ?? [];
    group.push(entry);
    ledgerOnlyGroups.set(id, group);
  }
  const allCustomers = [
    ...customers,
    ...Array.from(ledgerOnlyGroups, ([id, entries]) => syntheticCustomerFromLedger(id, entries)),
  ];
  return allCustomers.map((customer) => {
    const ids = expandIdsWithMappings(customerIds(customer), idMappings);
    const entries = ledger.filter((entry) => {
      const id = getCustomerId(entry);
      return id ? ids.has(id) : false;
    });
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
  const idMappings = await offlineDB.getAll<Record<string, unknown>>("id_mappings").catch(() => []);
  const customer = customers.find((row) => expandIdsWithMappings(customerIds(row), idMappings).has(customerId));
  if (!customer) return null;
  const ids = expandIdsWithMappings(customerIds(customer), idMappings);
  const ledgerSource = dedupeLedgerEntries(await offlineDB.getAll<CustomerLedgerEntry>("customer_ledger").catch(() => []));
  const ledgerEntries = ledgerSource
    .filter((entry) => {
      const id = getCustomerId(entry);
      return id ? ids.has(id) : false;
    });
  const cachedBills = readInstantCache<Array<Bill & Record<string, unknown>>>("bills", []);
  const dbBills = await offlineDB.getAll<Bill & Record<string, unknown>>("bills").catch(() => []);
  const bills = dedupeBillsForDisplay(uniqueById([...cachedBills, ...dbBills].filter((bill) => !isDeleted(bill)) as Array<Bill & Record<string, unknown>>))
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

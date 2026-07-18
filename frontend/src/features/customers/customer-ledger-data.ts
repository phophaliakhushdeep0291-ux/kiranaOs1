import { offlineDB } from "@/lib/offline/db";
import { readInstantCache } from "@/lib/offline/instant-cache";
import type { Bill, Customer } from "@/types/api";
import { buildLedgerStatement, calculateTrustScore, dedupeLedgerEntries, roundMoney, type CustomerLedgerEntry, type LedgerMetrics, type LedgerStatementRow } from "@/features/ledger/accounting";
import { dedupeBillsForDisplay, dedupePaymentsForDisplay } from "@/features/sync/bill-reconciliation";
import { hardenLocalFinancialData } from "@/features/sync/local-data-hardening";

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
  await hardenLocalFinancialData().catch(() => undefined);
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
  const payments = dedupePaymentsForDisplay(
    (await offlineDB.getAll<Record<string, unknown>>("payments").catch(() => []))
      .filter((payment) => {
        const id = getPaymentCustomerId(payment);
        return id ? ids.has(id) : false;
      }),
  )
    .sort((a, b) => String(b.paidAt ?? b.paid_at ?? b.createdAt ?? b.created_at ?? "").localeCompare(String(a.paidAt ?? a.paid_at ?? a.createdAt ?? a.created_at ?? "")));
  const audit = (await offlineDB.getAll<Record<string, unknown>>("local_audit_logs").catch(() => []))
    .filter((row) => String(row.entity_id ?? "") === customer.id || String(row.customerId ?? row.customer_id ?? "") === customer.id)
    .sort((a, b) => String(b.createdAt ?? b.created_at ?? "").localeCompare(String(a.createdAt ?? a.created_at ?? "")));
  return { customer, bills, payments, ledger: buildLedgerStatement(ledgerEntries), audit };
}

export type CustomerTimelineKind = "sale" | "estimate" | "return" | "payment" | "payment_reversed" | "adjustment";

export interface CustomerTimelineEvent {
  id: string;
  /** ISO timestamp used for ordering (newest first in the returned array). */
  at: string;
  kind: CustomerTimelineKind;
  title: string;
  detail: string | null;
  /**
   * Signed for the shop's view of the relationship: sales positive, returns
   * negative, payments negative (they reduce what the customer owes),
   * adjustments carry their ledger sign.
   */
  amount: number;
  /** Route to open when the event is clickable (bills only). */
  href: string | null;
}

function eventDate(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return "";
}

function billTimelineKind(bill: Record<string, unknown>): CustomerTimelineKind {
  const type = String(bill.billType ?? bill.bill_type ?? "").toLowerCase();
  if (type.includes("return")) return "return";
  if (type.includes("estimate")) return "estimate";
  return "sale";
}

/**
 * One chronological activity feed for a customer: every bill (sale, estimate,
 * return), every payment (with reversals called out), and manual ledger
 * adjustments. Bill/payment ledger echoes are deliberately EXCLUDED — those
 * rows duplicate the bill and payment sources — so nothing appears twice.
 */
export function buildCustomerTimeline(data: Pick<CustomerDetailData, "bills" | "payments" | "ledger">): CustomerTimelineEvent[] {
  const events: CustomerTimelineEvent[] = [];

  for (const bill of data.bills) {
    const kind = billTimelineKind(bill);
    const total = readNumber(bill.grandTotal ?? bill.totalAmount ?? bill.netAmount, 0);
    const itemCount = Array.isArray(bill.items) ? bill.items.length : 0;
    const status = String(bill.status ?? "").toLowerCase();
    const number = String(bill.billNumber ?? bill.billNo ?? bill.id);
    events.push({
      id: `bill:${String(bill.id)}`,
      at: eventDate(bill, ["createdAt", "created_at"]),
      kind,
      title: kind === "return" ? `Return ${number}` : kind === "estimate" ? `Estimate ${number}` : `Bill ${number}`,
      detail: [
        itemCount > 0 ? `${itemCount} item${itemCount === 1 ? "" : "s"}` : null,
        String(bill.paymentMode ?? bill.refundMode ?? "") || null,
        status === "cancelled" ? "cancelled" : null,
      ].filter(Boolean).join(" · ") || null,
      amount: kind === "return" ? -Math.abs(total) : Math.abs(total),
      href: `/bills/${String(bill.id)}`,
    });
  }

  for (const payment of data.payments) {
    const reversed = Boolean(payment.reversed_at ?? payment.reversedAt);
    const amount = readNumber(payment.amount, 0);
    // Refund payment rows (negative, written by sale returns) already show as
    // the return bill; skip them so the feed stays one-event-per-action.
    if (amount < 0) continue;
    const mode = String(payment.mode ?? "payment").toUpperCase();
    events.push({
      id: `payment:${String(payment.id)}`,
      at: eventDate(payment, ["paidAt", "paid_at", "createdAt", "created_at"]),
      kind: reversed ? "payment_reversed" : "payment",
      title: reversed ? `Payment reversed (${mode})` : `Payment received (${mode})`,
      detail: typeof payment.note === "string" && payment.note.trim() ? payment.note.trim() : null,
      amount: reversed ? Math.abs(amount) : -Math.abs(amount),
      href: null,
    });
  }

  for (const row of data.ledger) {
    const record = row as unknown as Record<string, unknown>;
    const type = String(record.display_type ?? record.type ?? "").toLowerCase();
    if (!type.includes("adjust")) continue;
    events.push({
      id: `ledger:${String(record.id)}`,
      at: eventDate(record, ["display_date", "entry_at", "createdAt", "created_at"]),
      kind: "adjustment",
      title: "Ledger adjustment",
      detail: typeof record.note === "string" && record.note.trim() ? record.note.trim() : null,
      amount: readNumber(record.signed_amount, 0),
      href: null,
    });
  }

  return events
    .filter((event) => event.at.length > 0)
    .sort((a, b) => b.at.localeCompare(a.at));
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

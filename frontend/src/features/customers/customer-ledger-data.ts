import { offlineDB } from "@/lib/offline/db";
import { readInstantCache } from "@/lib/offline/instant-cache";
import { formatMoney as formatRupees } from "@/lib/money";
import type { Bill, Customer, UdharSummary } from "@/types/api";
import { buildLedgerStatement, calculateTrustScore, dedupeLedgerEntries, getLedgerDate, isManualAdjustmentEntry, normaliseLedgerType, roundMoney, type CustomerLedgerEntry, type LedgerMetrics, type LedgerStatementRow } from "@/features/ledger/accounting";
import { dedupeBillsForDisplay, dedupePaymentsForDisplay } from "@/features/sync/bill-reconciliation";
import { hardenLocalFinancialData } from "@/features/sync/local-data-hardening";

export interface CustomerWithLedger extends Customer, Record<string, unknown> {
  /**
   * What the customer owes, never negative — matching the server, which clamps
   * at zero (`calculateCustomerUdharBalance`). A drifted device ledger can sum
   * below zero; rendering that as "−₹330 outstanding" is meaningless and was how
   * the offline view came to disagree with the server.
   */
  ledgerBalance: number;
  /** The unclamped device-ledger sum, kept for drift detection and repair. */
  rawLedgerBalance: number;
  /** True while this device holds udhar rows the server has not accepted yet. */
  hasUnsyncedLedgerEntries?: boolean;
  ledgerMetrics: LedgerMetrics;
}

export interface CustomerDetailData {
  customer: CustomerWithLedger;
  bills: Array<Bill & Record<string, unknown>>;
  payments: Array<Record<string, unknown>>;
  ledger: LedgerStatementRow[];
  audit: Array<Record<string, unknown>>;
}

const LOCAL_BALANCE_STATUSES = new Set(["pending_sync", "syncing", "failed", "conflict", "local_only"]);

function customerIdentityValues(customer: Customer & Record<string, unknown>): string[] {
  return [customer.id, customer.local_id, customer.localId, customer.server_id, customer.serverId]
    .filter((value): value is string => typeof value === "string" && value.length > 0);
}

/** True while this device holds udhar movement the server has not accepted yet. */
function hasUnsyncedLedgerEntries(entries: CustomerLedgerEntry[]): boolean {
  return entries.some((entry) => LOCAL_BALANCE_STATUSES.has(String(entry.sync_status ?? "").toLowerCase()));
}

/**
 * Whether the DEVICE's balance outranks the server's for this customer.
 *
 * Only two things earn that: a customer the server has never seen, and unsynced
 * ledger movement this device is still holding. The customer row's own
 * `sync_status` is deliberately NOT enough — a payment writes the derived
 * balance onto the row without queueing a customer edit, so a row could sit at
 * `pending_sync` forever with an empty outbox and permanently veto the server's
 * balance (the reported ₹0 that would not go away).
 */
function hasPendingLocalBalance(customer: CustomerWithLedger): boolean {
  const hasMappedServerIdentity = typeof customer.server_id === "string" || typeof customer.serverId === "string";
  if (!hasMappedServerIdentity) {
    const status = String(customer.sync_status ?? "").toLowerCase();
    if (String(customer.id).startsWith("local_") || LOCAL_BALANCE_STATUSES.has(status)) return true;
    if (customer.isSynced === false || customer.is_synced === false) return true;
  }
  return customer.hasUnsyncedLedgerEntries === true;
}

function withAuthoritativeBalance(customer: CustomerWithLedger, balance: number): CustomerWithLedger {
  const authoritative = roundMoney(Math.max(0, balance));
  const unchanged = Math.abs(authoritative - customer.ledgerBalance) < 0.005;
  const metrics = unchanged
    ? customer.ledgerMetrics
    : {
        ...customer.ledgerMetrics,
        balance: authoritative,
        ageing: { total: authoritative, zeroToSeven: authoritative, sevenToThirty: 0, thirtyPlus: 0 },
        isBadCustomer: authoritative > readNumber(customer.udharLimit, Number.POSITIVE_INFINITY),
      };
  return {
    ...customer,
    type: authoritative > 0 ? "udhar" : customer.type === "udhar" ? "regular" : customer.type,
    ledgerBalance: authoritative,
    rawLedgerBalance: customer.rawLedgerBalance ?? customer.ledgerBalance,
    totalUdhar: authoritative,
    udharAmount: authoritative,
    ledgerMetrics: metrics,
    balance_source: "server_ledger_summary",
  };
}

/**
 * Shape the loaded customers for {@link detectLedgerDrift}. Uses the UNCLAMPED
 * local sum so a ledger that has gone negative reads as the drift it is.
 */
export function toLedgerDriftCandidates(customers: CustomerWithLedger[]): Array<{
  ids: string[];
  localBalance: number;
  hasPendingLocalWork: boolean;
}> {
  return customers
    .filter((customer) => customer.ledger_only !== true)
    .map((customer) => ({
      ids: customerIdentityValues(customer),
      localBalance: Number(customer.rawLedgerBalance ?? customer.ledgerBalance ?? 0),
      hasPendingLocalWork: hasPendingLocalBalance(customer),
    }));
}

function reconcileAgainstBalances(customer: CustomerWithLedger, balances: Map<string, number>): CustomerWithLedger {
  if (hasPendingLocalBalance(customer)) return customer;
  const serverId = customerIdentityValues(customer).find((id) => balances.has(id));
  return withAuthoritativeBalance(customer, serverId ? Number(balances.get(serverId) ?? 0) : 0);
}

/**
 * Reconcile ONE already-loaded customer against the server's ledger-derived
 * summary, using the same rule as the customer list: a pending local write stays
 * device-authoritative, an unmatched customer is treated as settled (zero), and
 * every synced customer takes the server balance. Unlike
 * {@link applyAuthoritativeUdharSummary} it never appends synthetic ledger-only
 * rows, so the single-customer detail/ledger view can reuse the list's exact
 * balance instead of the raw (and possibly stale) local ledger sum.
 */
export function reconcileCustomerWithAuthoritativeSummary(
  customer: CustomerWithLedger,
  summary: UdharSummary,
): CustomerWithLedger {
  const balances = new Map(summary.customers.map((row) => [row.customerId, row.outstanding]));
  return reconcileAgainstBalances(customer, balances);
}

/**
 * Reconcile the device ledger view with the server's ledger-derived summary.
 * Pending local writes remain device-authoritative until they sync; every other
 * customer uses the server value, including an omitted summary row meaning zero.
 */
export function applyAuthoritativeUdharSummary(
  customers: CustomerWithLedger[],
  summary: UdharSummary,
): CustomerWithLedger[] {
  const balances = new Map(summary.customers.map((customer) => [customer.customerId, customer.outstanding]));
  const matchedServerIds = new Set<string>();
  const reconciled = customers.map((customer) => {
    const serverId = customerIdentityValues(customer).find((id) => balances.has(id));
    if (serverId) matchedServerIds.add(serverId);
    return reconcileAgainstBalances(customer, balances);
  });

  for (const serverCustomer of summary.customers) {
    if (matchedServerIds.has(serverCustomer.customerId)) continue;
    const balance = roundMoney(Math.max(0, Number(serverCustomer.outstanding ?? 0)));
    reconciled.push({
      id: serverCustomer.customerId,
      name: serverCustomer.customerName,
      mobile: serverCustomer.mobile ?? null,
      type: balance > 0 ? "udhar" : "regular",
      udharAmount: balance,
      totalUdhar: balance,
      ledgerBalance: balance,
      rawLedgerBalance: balance,
      sync_status: "synced",
      balance_source: "server_ledger_summary",
      ledger_only: true,
      ledgerMetrics: {
        balance,
        ageing: { total: balance, zeroToSeven: balance, sevenToThirty: 0, thirtyPlus: 0 },
        paymentCount: 0,
        billCount: 0,
        trustScore: 100,
        isBadCustomer: false,
        warning: null,
      },
    });
  }

  return reconciled.sort((a, b) => b.ledgerBalance - a.ledgerBalance || a.name.localeCompare(b.name));
}


function readNumber(value: unknown, fallback = 0): number {
  const num = Number(value ?? fallback);
  return Number.isFinite(num) ? num : fallback;
}

export function metricsWithCustomerBalanceFallback(customer: Customer & Record<string, unknown>, entries: CustomerLedgerEntry[]): LedgerMetrics {
  const metrics = calculateTrustScore(customer, entries);
  const projectedBalance = roundMoney(readNumber(customer.udharAmount ?? customer.totalUdhar, 0));
  const hasPendingMovement = hasUnsyncedLedgerEntries(entries);
  // A payment can be recorded before this device has downloaded the customer's
  // complete historical ledger. The local rows may then contain only the new
  // negative payment, whose raw sum falsely clamps the outstanding balance to
  // zero. The payment transaction persists the correct projected remainder on
  // the customer, so prefer it while that ledger movement is still pending.
  if (customer.balance_derived_from_local_ledger === true && hasPendingMovement) {
    const balance = Math.max(0, projectedBalance);
    return {
      ...metrics,
      balance,
      ageing: { ...metrics.ageing, total: balance, zeroToSeven: balance },
      isBadCustomer: balance > readNumber(customer.udharLimit, Number.POSITIVE_INFINITY),
    };
  }
  if (entries.length > 0) return metrics;
  const balance = projectedBalance;
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

function paymentFromLedger(entry: CustomerLedgerEntry): Record<string, unknown> | null {
  const record = entry as Record<string, unknown>;
  if (normaliseLedgerType(entry.type, entry.source_type) !== "PAYMENT") return null;
  if (isManualAdjustmentEntry(entry) || isDeleted(record)) return null;
  const mode = String(record.mode ?? record.payment_mode ?? "").trim().toLowerCase();
  if (!["cash", "upi", "bank"].includes(mode)) return null;
  const amount = roundMoney(Math.abs(Number(entry.amount ?? 0)));
  if (amount <= 0) return null;
  const paymentId = readStringField(record, [
    "payment_id",
    "paymentId",
    "source_id",
    "sourceId",
    "client_payment_id",
    "clientPaymentId",
  ]);
  const paidAt = getLedgerDate(entry);
  return {
    id: paymentId ?? `ledger-payment:${entry.id}`,
    customer_id: getCustomerId(entry),
    amount,
    mode,
    note: typeof entry.note === "string" ? entry.note : null,
    paid_at: paidAt,
    created_at: paidAt,
    reversed_at: entry.reversed_at ?? null,
    ledger_entry_id: entry.id,
    sync_status: entry.sync_status ?? "synced",
    derived_from_ledger: true,
  };
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
  const latest = [...entries].sort((a, b) => getLedgerDate(b).localeCompare(getLedgerDate(a)))[0];
  const at = latest ? getLedgerDate(latest) : new Date().toISOString();
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

export function readCachedCustomersWithLedger(): CustomerWithLedger[] {
  return readInstantCache<Customer[]>("customers", [])
    .filter((customer) => !isDeleted(customer as unknown as Record<string, unknown>))
    .map((customer) => {
      const balance = roundMoney(Math.max(0, Number(customer.udharAmount ?? customer.totalUdhar ?? 0)));
      const limit = Number(customer.udharLimit ?? Number.POSITIVE_INFINITY);
      return {
        ...customer,
        ledgerBalance: balance,
        rawLedgerBalance: balance,
        totalUdhar: balance,
        udharAmount: balance,
        ledgerMetrics: {
          balance,
          ageing: { total: balance, zeroToSeven: balance, sevenToThirty: 0, thirtyPlus: 0 },
          paymentCount: 0,
          billCount: 0,
          trustScore: Number((customer as unknown as Record<string, unknown>).trustScore ?? 75),
          isBadCustomer: Number.isFinite(limit) && balance > limit,
          warning: null,
        },
      } as CustomerWithLedger;
    });
}
export async function loadCustomersWithLedger(): Promise<CustomerWithLedger[]> {
  // Do not make first customer paint wait for a multi-table integrity scan.
  // Repairs emit a data-change event and refresh this query when they complete.
  void hardenLocalFinancialData().catch(() => undefined);
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
    const balance = roundMoney(Math.max(0, metrics.balance));
    return {
      ...customer,
      ledgerBalance: balance,
      rawLedgerBalance: metrics.balance,
      hasUnsyncedLedgerEntries: hasUnsyncedLedgerEntries(entries),
      totalUdhar: balance,
      udharAmount: balance,
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
    .sort((a, b) => String(b.businessDate ?? b.business_date ?? b.createdAt ?? b.created_at ?? "").localeCompare(String(a.businessDate ?? a.business_date ?? a.createdAt ?? a.created_at ?? "")));
  const storedPayments = (await offlineDB.getAll<Record<string, unknown>>("payments").catch(() => []))
    .filter((payment) => {
      const id = getPaymentCustomerId(payment);
      return id ? ids.has(id) : false;
    });
  const ledgerPayments = ledgerEntries
    .map(paymentFromLedger)
    .filter((payment): payment is Record<string, unknown> => payment !== null);
  const payments = dedupePaymentsForDisplay([...storedPayments, ...ledgerPayments])
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
      at: eventDate(bill, ["businessDate", "business_date", "createdAt", "created_at"]),
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
    // Include manual adjustments in either shape (local "ADJUSTMENT" or the synced
    // debit/payment echo carrying mode:"adjustment"). Bill/payment echoes are still
    // excluded — they're already represented by the bills/payments feeds above.
    if (!isManualAdjustmentEntry(row)) continue;
    events.push({
      id: `ledger:${String(record.id)}`,
      at: eventDate(record, ["display_date", "businessDate", "business_date", "entry_at", "createdAt", "created_at"]),
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
  return formatRupees(value);
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

import { offlineDB } from "@/lib/offline/db";
import {
  ownerPinRequiredActionSchema,
  paymentRecordingSchema,
} from "@/lib/validation";
import {
  createLocalId,
  emitLocalDataChanged,
  readInstantCache,
  upsertCachedListItem,
} from "@/lib/offline/instant-cache";
import { buildOutboxOperation } from "@/features/core/sync/outbox";
import {
  makeLocalEntity,
  parseOrThrow,
  readNumber,
  roundMoney,
} from "@/lib/offline/actions/utils";
import { formatMoney, moneyExceeds, subtractMoney } from "@/lib/money";
import { normaliseLocalCustomer } from "@/features/core/customers/local-actions";
import { readCustomerLedgerEntries } from "@/features/core/ledger/local-actions";
import {
  calculateLedgerBalance,
  buildLedgerStatement,
  dedupeLedgerEntries,
  calculateTrustScore,
  getLedgerCustomerId,
  ledgerSignedAmount,
  type CustomerLedgerEntry,
} from "@/features/core/ledger/accounting";
import {
  authoritativeOutstandingFor,
  loadCachedAuthoritativeSummary,
  readCachedAuthoritativeSummary,
} from "@/features/core/ledger/authoritative-balances";
import type { Customer, UdharPaymentInput, UdharSummary } from "@/types/api";
import {
  buildAuditLogOutboxInput,
  buildAuditLogRow,
} from "@/features/core/audit-logs/local-actions";
import { withCustomerFinancialLock } from "@/features/core/ledger/customer-financial-lock";

const CUSTOMER_CACHE_KEY = "customers";
const PAYMENT_CACHE_KEY = "payments";

export interface LocalPaymentResult {
  success: true;
  paymentId: string;
  customerId: string;
  amount: number;
  /** Durable balance after this payment, calculated inside the local transaction. */
  nextBalance: number;
  pendingSync: true;
}

const PENDING_LEDGER_STATUSES = new Set(["pending_sync", "syncing", "failed", "conflict", "local_only"]);

/**
 * Statuses whose ledger rows have NOT reached the server, so no server snapshot
 * can already contain them.
 *
 * `conflict` is deliberately absent. The server DID see those rows and refused
 * them, so applying one moves the balance away from the truth — and for a
 * rejected payment it keeps re-creating debt that was never owed.
 */
const UNSYNCED_LEDGER_STATUSES = new Set(["pending_sync", "syncing", "failed", "local_only"]);

type CustomerRecord = Customer & Record<string, unknown>;

function readStringField(row: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function customerIdentitySet(
  customer: CustomerRecord | undefined,
  fallbackId?: string,
): Set<string> {
  return new Set(
    [
      fallbackId,
      customer?.id,
      customer?.local_id,
      customer?.localId,
      customer?.server_id,
      customer?.serverId,
    ].filter((value): value is string => typeof value === "string" && value.length > 0),
  );
}

function expandIdsWithMappings(
  ids: Set<string>,
  mappings: Array<Record<string, unknown>>,
): Set<string> {
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

function uniqueById<T extends { id?: unknown }>(rows: T[]): T[] {
  const map = new Map<string, T>();
  for (const row of rows) {
    if (typeof row.id !== "string" || row.id.length === 0) continue;
    map.set(row.id, { ...map.get(row.id), ...row });
  }
  return [...map.values()];
}

function pendingDeltaForIds(deltas: Map<string, number>, ids: Set<string>): number {
  let total = 0;
  for (const id of ids) total = roundMoney(total + (deltas.get(id) ?? 0));
  return total;
}

function normaliseOutstandingRow(
  row: UdharSummary["customers"][number],
  outstanding: number,
): UdharSummary["customers"][number] {
  const value = roundMoney(Math.max(0, outstanding));
  return {
    ...row,
    amount: value,
    outstanding: value,
  };
}

/**
 * Local movement for a customer that the server snapshot cannot know about yet.
 *
 * Membership is decided by SYNC STATUS, never by a timestamp. It used to also
 * skip entries dated at or before `capturedAt`, on the theory that anything
 * older was already inside the snapshot — but the summary is re-fetched right
 * after a payment is written, so `capturedAt` routinely moves PAST a row that is
 * still `pending_sync` and the server plainly does not have. That dropped the
 * first collection of the day: a customer who paid ₹120 and then ₹80 against a
 * ₹200 bill was left owing ₹120, and the app offered to collect it again.
 *
 * An unsynced row is absent from the server's number by definition, whenever it
 * was written, so it always counts.
 */
function pendingLedgerDeltas(entries: CustomerLedgerEntry[]): Map<string, number> {
  const deltas = new Map<string, number>();
  for (const entry of entries) {
    const status = String(entry.sync_status ?? "").toLowerCase();
    if (!UNSYNCED_LEDGER_STATUSES.has(status)) continue;
    const id = getLedgerCustomerId(entry);
    if (!id) continue;
    deltas.set(id, roundMoney((deltas.get(id) ?? 0) + ledgerSignedAmount(entry)));
  }
  return deltas;
}

/**
 * The udhar summary without touching the network. Prefers the last snapshot the
 * server gave this device (plus any local movement since) over the raw device
 * ledger, which can have drifted — the offline page must show the same number
 * as the online one.
 */
function buildLocalUdharSummary(input: {
  customers: CustomerRecord[];
  ledgerEntries: CustomerLedgerEntry[];
  authoritative: ReturnType<typeof readCachedAuthoritativeSummary>;
  idMappings?: Array<Record<string, unknown>>;
}): UdharSummary {
  const customers = input.customers.map((customer) =>
    normaliseLocalCustomer(customer) as CustomerRecord,
  );
  const ledgerEntries = dedupeLedgerEntries(input.ledgerEntries);
  const idMappings = input.idMappings ?? [];
  const authoritative = input.authoritative;
  if (authoritative) {
    const deltas = pendingLedgerDeltas(ledgerEntries);
    const rows = new Map<string, UdharSummary["customers"][number]>();
    const handledCustomerIds = new Set<string>();

    for (const row of authoritative.summary.customers) {
      const customer = customers.find((candidate) =>
        expandIdsWithMappings(customerIdentitySet(candidate), idMappings).has(row.customerId),
      );
      const ids = expandIdsWithMappings(
        customerIdentitySet(customer, row.customerId),
        idMappings,
      );
      ids.forEach((id) => handledCustomerIds.add(id));
      const outstanding = roundMoney(
        Math.max(0, Number(row.outstanding ?? 0) + pendingDeltaForIds(deltas, ids)),
      );
      if (outstanding > 0) rows.set(row.customerId, normaliseOutstandingRow(row, outstanding));
    }

    for (const customer of customers) {
      const ids = expandIdsWithMappings(customerIdentitySet(customer), idMappings);
      if ([...ids].some((id) => handledCustomerIds.has(id))) continue;
      const outstanding = roundMoney(Math.max(0, pendingDeltaForIds(deltas, ids)));
      if (outstanding <= 0) continue;
      rows.set(customer.id, {
        customerId: customer.id,
        customerName: customer.name,
        mobile: customer.mobile ?? undefined,
        amount: outstanding,
        outstanding,
      });
    }
    const summaryRows = [...rows.values()].filter((row) => row.outstanding > 0);
    return {
      totalOutstanding: roundMoney(summaryRows.reduce((sum, row) => sum + row.outstanding, 0)),
      customers: summaryRows,
    };
  }

  const rows = customers
    .map((customer) => {
      const ids = expandIdsWithMappings(customerIdentitySet(customer), idMappings);
      const customerLedger = ledgerEntries.filter((entry) => {
        const id = getLedgerCustomerId(entry);
        return id ? ids.has(id) : false;
      });
      const rawBalance = customerLedger.length > 0
        ? calculateLedgerBalance(customerLedger)
        : readNumber(customer.udharAmount ?? customer.totalUdhar, 0);
      const outstanding = roundMoney(Math.max(0, rawBalance));
      return {
        customerId: customer.id,
        customerName: customer.name,
        mobile: customer.mobile ?? undefined,
        amount: outstanding,
        outstanding,
        dueDate: customer.dueDate as string | undefined,
        promiseToPayDate: customer.promiseToPayDate as string | undefined,
        trustScore: readNumber(customer.trustScore, 75),
      };
    })
    .filter((row) => row.outstanding > 0);
  return {
    totalOutstanding: roundMoney(
      rows.reduce((sum, row) => sum + row.outstanding, 0),
    ),
    customers: rows,
  };
}

export function getLocalUdharSummary(): UdharSummary {
  return buildLocalUdharSummary({
    customers: readInstantCache<CustomerRecord[]>(CUSTOMER_CACHE_KEY, []),
    ledgerEntries: readInstantCache<CustomerLedgerEntry[]>("customer_ledger", []),
    authoritative: readCachedAuthoritativeSummary(),
  });
}

export async function getLocalUdharSummaryAsync(): Promise<UdharSummary> {
  const [dbCustomers, dbLedger, idMappings, authoritative] = await Promise.all([
    offlineDB.getAll<CustomerRecord>("customers").catch(() => []),
    offlineDB.getAll<CustomerLedgerEntry>("customer_ledger").catch(() => []),
    offlineDB.getAll<Record<string, unknown>>("id_mappings").catch(() => []),
    loadCachedAuthoritativeSummary(),
  ]);
  return buildLocalUdharSummary({
    customers: uniqueById([
      ...readInstantCache<CustomerRecord[]>(CUSTOMER_CACHE_KEY, []),
      ...dbCustomers,
    ]),
    ledgerEntries: dedupeLedgerEntries([
      ...readInstantCache<CustomerLedgerEntry[]>("customer_ledger", []),
      ...dbLedger,
    ]),
    authoritative,
    idMappings,
  });
}

export function getLocalUdharLedger(limit = 50) {
  const entries = buildLedgerStatement(
    dedupeLedgerEntries(readInstantCache<CustomerLedgerEntry[]>("customer_ledger", [])),
  );
  return { entries: entries.slice(0, limit), total: entries.length };
}

async function findCustomer(customerId: string): Promise<Customer | undefined> {
  const cached = readInstantCache<Customer[]>(CUSTOMER_CACHE_KEY, []).map(
    normaliseLocalCustomer,
  );
  return (
    cached.find((customer) => customer.id === customerId) ??
    offlineDB
      .getAll<Customer>("customers")
      .then((rows) =>
        rows
          .map(normaliseLocalCustomer)
          .find(
            (row) =>
              row.id === customerId ||
              (row as unknown as Record<string, unknown>).local_id ===
                customerId ||
              (row as unknown as Record<string, unknown>).server_id ===
                customerId,
          ),
      )
      .catch(() => undefined)
  );
}

const PAYMENT_TRANSACTION_TABLES = [
  "payments",
  "customer_ledger",
  "customers",
  "local_audit_logs",
  "sync_outbox",
];

function buildPaymentLedgerEntry(input: {
  customerId: string;
  paymentId: string;
  ledgerEntryId: string;
  idempotencyKey: string;
  amount: number;
  mode: "cash" | "upi" | "bank";
  nextBalance: number;
  note?: string;
  at: string;
}) {
  return makeLocalEntity(
    {
      id: input.ledgerEntryId,
      customerId: input.customerId,
      customer_id: input.customerId,
      type: "PAYMENT",
      source_type: "payment",
      source_id: input.paymentId,
      paymentId: input.paymentId,
      payment_id: input.paymentId,
      localPaymentId: input.paymentId,
      local_payment_id: input.paymentId,
      clientPaymentId: input.paymentId,
      client_payment_id: input.paymentId,
      ledgerEntryId: input.ledgerEntryId,
      ledger_entry_id: input.ledgerEntryId,
      localLedgerEntryId: input.ledgerEntryId,
      local_ledger_entry_id: input.ledgerEntryId,
      clientLedgerId: input.ledgerEntryId,
      client_ledger_id: input.ledgerEntryId,
      idempotencyKey: input.idempotencyKey,
      idempotency_key: input.idempotencyKey,
      mode: input.mode,
      paymentMode: input.mode,
      payment_mode: input.mode,
      amount: input.amount,
      balance_after: input.nextBalance,
      note: input.note,
      entry_at: input.at,
      createdAt: input.at,
      created_at: input.at,
    },
    "ledger_entry",
    "pending_sync",
  ) as unknown as CustomerLedgerEntry;
}

export interface RecordPaymentOptions {
  /**
   * The outstanding balance the operator is actually looking at — the
   * authoritative `/udhar/summary` value the udhar pages overlay. The device
   * ledger can be stale or drifted (an old bug left balances at zero on some
   * shops), and validating only against the raw local sum then rejects a
   * legitimate collection with "Payment ₹150 exceeds outstanding udhar ₹0"
   * while the very same screen shows ₹300 due. Guard against the larger of the
   * two and let the backend's own check be the final authority on sync — the
   * same rule `createLedgerAdjustmentLocalFirst` already uses.
   */
  // This hint never overrules a cached authoritative server balance.
  expectedOutstanding?: number;
}

function hasPendingLedgerWork(entries: CustomerLedgerEntry[]): boolean {
  return entries.some((entry) =>
    PENDING_LEDGER_STATUSES.has(String(entry.sync_status ?? "").toLowerCase()),
  );
}

function isLocalOnlyCustomer(customer: CustomerRecord): boolean {
  const hasServerIdentity =
    typeof customer.server_id === "string" ||
    typeof customer.serverId === "string";
  if (hasServerIdentity) return false;
  const status = String(customer.sync_status ?? "").toLowerCase();
  return (
    String(customer.id ?? "").startsWith("local_") ||
    customer.isSynced === false ||
    customer.is_synced === false ||
    PENDING_LEDGER_STATUSES.has(status)
  );
}

async function resolveCachedAuthoritativePaymentBalance(input: {
  customerId: string;
  customer: CustomerRecord;
  ledgerEntries: CustomerLedgerEntry[];
}): Promise<number | null> {
  const cached = await loadCachedAuthoritativeSummary();
  if (!cached) return null;
  const mappings = await offlineDB
    .getAll<Record<string, unknown>>("id_mappings")
    .catch(() => []);
  const ids = expandIdsWithMappings(
    customerIdentitySet(input.customer, input.customerId),
    mappings,
  );
  const base = authoritativeOutstandingFor(cached.summary, [...ids]);
  if (base === null) return null;
  const deltas = pendingLedgerDeltas(input.ledgerEntries);
  return roundMoney(Math.max(0, base + pendingDeltaForIds(deltas, ids)));
}

async function recordPaymentLocalFirstUnlocked(
  customerId: string,
  data: UdharPaymentInput,
  options: RecordPaymentOptions = {},
): Promise<LocalPaymentResult> {
  const validated = parseOrThrow(paymentRecordingSchema, {
    ...data,
    customerId,
  });
  const now = new Date().toISOString();
  const amount = roundMoney(validated.amount);
  const paymentId = createLocalId("payment");
  const ledgerEntryId = createLocalId("ledger");
  const idempotencyKey = `record-payment:${customerId}:${paymentId}`;

  const existing = await findCustomer(customerId);
  if (!existing) throw new Error("Customer not found in local records");

  const existingLedgerEntries = await readCustomerLedgerEntries(customerId);
  const ledgerBalance = roundMoney(calculateLedgerBalance(existingLedgerEntries));
  const authoritativeBalance = await resolveCachedAuthoritativePaymentBalance({
    customerId,
    customer: existing as CustomerRecord,
    ledgerEntries: existingLedgerEntries,
  });
  const expectedOutstanding = Math.max(
    0,
    readNumber(options.expectedOutstanding, 0),
  );
  const localCanLead =
    hasPendingLedgerWork(existingLedgerEntries) ||
    isLocalOnlyCustomer(existing as CustomerRecord);
  // Guard against overpayment: a udhar payment can never exceed the customer's
  // outstanding balance. The backend already rejects this
  // (UDHAR_PAYMENT_EXCEEDS_OUTSTANDING); the offline path must enforce the same
  // rule so it can't drive the balance negative or queue an event that will fail
  // to sync. A tiny epsilon absorbs paise-level float drift.
  const projectedCustomerBalance = (existing as CustomerRecord).balance_derived_from_local_ledger === true
    ? Math.max(0, readNumber(existing.udharAmount ?? existing.totalUdhar, 0))
    : null;
  const currentBalance = roundMoney(authoritativeBalance !== null
    ? Math.max(authoritativeBalance, localCanLead ? ledgerBalance : 0)
    : projectedCustomerBalance !== null
      ? Math.max(ledgerBalance, projectedCustomerBalance)
      : Math.max(ledgerBalance, expectedOutstanding));
  const outstanding = roundMoney(Math.max(0, currentBalance));
  if (moneyExceeds(amount, outstanding)) {
    const error = new Error(
      `Payment ${formatMoney(amount)} exceeds outstanding udhar ${formatMoney(outstanding)}`,
    );
    (error as Error & { code?: string }).code = "UDHAR_PAYMENT_EXCEEDS_OUTSTANDING";
    throw error;
  }
  // Never below zero: with a drifted ledger the authoritative base is the honest
  // starting point, and a negative "balance after" would only deepen the drift.
  const nextBalance = Math.max(0, subtractMoney(currentBalance, amount));
  const note = typeof validated.note === "string" ? validated.note : undefined;
  const paidAt = typeof validated.paidAt === "string" ? validated.paidAt : now;

  const payment = makeLocalEntity(
    {
      id: paymentId,
      customerId,
      customer_id: customerId,
      localPaymentId: paymentId,
      local_payment_id: paymentId,
      clientPaymentId: paymentId,
      client_payment_id: paymentId,
      ledgerEntryId,
      ledger_entry_id: ledgerEntryId,
      localLedgerEntryId: ledgerEntryId,
      local_ledger_entry_id: ledgerEntryId,
      clientLedgerId: ledgerEntryId,
      client_ledger_id: ledgerEntryId,
      idempotencyKey,
      idempotency_key: idempotencyKey,
      mode: validated.mode,
      amount,
      note,
      paidAt,
      paid_at: paidAt,
      createdAt: now,
      created_at: now,
      status: "active",
    },
    "payment",
    "pending_sync",
  );

  const ledgerEntry = buildPaymentLedgerEntry({
    customerId,
    paymentId,
    ledgerEntryId,
    idempotencyKey,
    amount,
    mode: validated.mode,
    nextBalance,
    note,
    at: paidAt,
  });

  const updatedCustomerBase = normaliseLocalCustomer({
    ...existing,
    udharAmount: nextBalance,
    totalUdhar: nextBalance,
    updatedAt: now,
  } as Customer);
  const metrics = calculateTrustScore(updatedCustomerBase, [
    ...existingLedgerEntries,
    ledgerEntry,
  ]);
  const updatedCustomer = {
    ...updatedCustomerBase,
    updated_at: now,
    trustScore: metrics.trustScore,
    badCustomer: metrics.isBadCustomer,
    // The cached balance is an optimistic projection of the ledger entry below,
    // not an independent customer edit — no CUSTOMER op is queued for it. Marking
    // the row pending left it stuck there forever (nothing flips it back), and a
    // "pending" customer is treated as device-authoritative, which pinned the page
    // to the stale local sum even after the server had the payment.
    sync_status: String((existing as unknown as Record<string, unknown>).sync_status ?? "synced"),
    balance_derived_from_local_ledger: true,
  } as unknown as Customer & Record<string, unknown>;

  const auditLog = buildAuditLogRow({
    action: "payment_recorded",
    entityType: "payment",
    entityId: paymentId,
    entityLabel: existing.name,
    newValue: payment,
    summary: `Payment ₹${amount.toLocaleString("en-IN")} recorded from ${existing.name}`,
  });

  const auditOutbox = buildOutboxOperation(buildAuditLogOutboxInput(auditLog));
  const paymentOutbox = buildOutboxOperation({
    entity_type: "payment",
    entity_id: paymentId,
    operation_type: "RECORD_PAYMENT",
    idempotency_key: idempotencyKey,
    payload: {
      paymentId,
      localPaymentId: paymentId,
      local_payment_id: paymentId,
      clientPaymentId: paymentId,
      client_payment_id: paymentId,
      ledgerEntryId,
      ledger_entry_id: ledgerEntryId,
      localLedgerEntryId: ledgerEntryId,
      local_ledger_entry_id: ledgerEntryId,
      clientLedgerId: ledgerEntryId,
      client_ledger_id: ledgerEntryId,
      idempotencyKey,
      idempotency_key: idempotencyKey,
      customerId,
      payment: {
        ...data,
        amount,
        mode: validated.mode,
        paidAt,
        paymentId,
        localPaymentId: paymentId,
        local_payment_id: paymentId,
        clientPaymentId: paymentId,
        client_payment_id: paymentId,
        ledgerEntryId,
        ledger_entry_id: ledgerEntryId,
        localLedgerEntryId: ledgerEntryId,
        local_ledger_entry_id: ledgerEntryId,
        clientLedgerId: ledgerEntryId,
        client_ledger_id: ledgerEntryId,
        idempotencyKey,
        idempotency_key: idempotencyKey,
      },
    },
  });

  await offlineDB.transaction(PAYMENT_TRANSACTION_TABLES, async (tx) => {
    await tx.put("payments", payment);
    await tx.put("customer_ledger", ledgerEntry);
    await tx.put("customers", updatedCustomer);
    await tx.put("local_audit_logs", auditLog);
    await tx.enqueueOutboxOperation(auditOutbox);
    await tx.enqueueOutboxOperation(paymentOutbox);
  });

  upsertCachedListItem(PAYMENT_CACHE_KEY, payment, 1000);
  upsertCachedListItem<Customer & Record<string, unknown>>(
    CUSTOMER_CACHE_KEY,
    updatedCustomer,
    1000,
  );
  upsertCachedListItem<CustomerLedgerEntry>(
    "customer_ledger",
    ledgerEntry,
    1500,
  );
  emitLocalDataChanged({
    type: "payment",
    id: paymentId,
    customerId,
    action: "recorded",
  });
  emitLocalDataChanged({
    type: "ledger",
    id: ledgerEntry.id,
    customerId,
    action: "appended",
  });
  return { success: true, paymentId, customerId, amount, nextBalance, pendingSync: true };
}

export function recordPaymentLocalFirst(
  customerId: string,
  data: UdharPaymentInput,
  options: RecordPaymentOptions = {},
): Promise<LocalPaymentResult> {
  return withCustomerFinancialLock(customerId, () =>
    recordPaymentLocalFirstUnlocked(customerId, data, options));
}

interface ReversePaymentInput {
  paymentId: string;
  ownerPin: string;
  reason?: string;
}

interface ReversePaymentResult {
  success: true;
  paymentId: string;
  correctionId: string;
  pendingSync: true;
}

export async function reversePaymentWithOwnerPinLocalFirst(
  input: ReversePaymentInput,
): Promise<ReversePaymentResult> {
  parseOrThrow(ownerPinRequiredActionSchema, {
    action: "reverse_payment",
    ownerPin: input.ownerPin,
    entityId: input.paymentId,
    reason: input.reason,
  });
  const initialPayments = await offlineDB
    .getAll<Record<string, unknown>>("payments")
    .catch(() => []);
  const initialPayment = initialPayments.find(
    (row) =>
      row.id === input.paymentId ||
      row.local_id === input.paymentId ||
      row.server_id === input.paymentId,
  );
  if (!initialPayment) throw new Error("Payment not found in local records");

  const customerId = String(
    initialPayment.customerId ?? initialPayment.customer_id ?? "",
  );
  if (!customerId) throw new Error("Payment is not linked to a customer");

  return withCustomerFinancialLock(customerId, () =>
    reversePaymentWithOwnerPinLocalFirstUnlocked(input, customerId));
}

async function reversePaymentWithOwnerPinLocalFirstUnlocked(
  input: ReversePaymentInput,
  customerId: string,
): Promise<ReversePaymentResult> {
  // Re-read after acquiring the customer lock. Two taps/tabs can reach the
  // preliminary lookup together, but only the first is allowed to append the
  // correction; the second must observe the committed reversed marker.
  const now = new Date().toISOString();
  const payments = await offlineDB
    .getAll<Record<string, unknown>>("payments")
    .catch(() => []);
  const payment = payments.find(
    (row) =>
      row.id === input.paymentId ||
      row.local_id === input.paymentId ||
      row.server_id === input.paymentId,
  );
  if (!payment) throw new Error("Payment not found in local records");
  if (payment.reversed_at || payment.reversedAt)
    throw new Error("Payment is already reversed");
  if (String(payment.customerId ?? payment.customer_id ?? "") !== customerId)
    throw new Error("Payment customer changed before reversal");

  const existingCustomer = await findCustomer(customerId);
  if (!existingCustomer) throw new Error("Customer not found in local records");

  const amount = roundMoney(readNumber(payment.amount, 0));
  if (amount <= 0)
    throw new Error("Payment reversal amount must be greater than zero");

  const reason = input.reason?.trim() || "Payment reversal";
  const updatedPayment = makeLocalEntity(
    {
      ...payment,
      id: String(payment.id),
      status: "reversed",
      reversedAt: now,
      reversed_at: now,
      reverseReason: reason,
      reverse_reason: reason,
      sync_status: "pending_sync" as const,
      updatedAt: now,
      updated_at: now,
    },
    "payment",
    "pending_sync",
  );

  const existingLedgerEntries = await readCustomerLedgerEntries(customerId);
  const correction = makeLocalEntity(
    {
      id: createLocalId("ledger"),
      customerId,
      customer_id: customerId,
      type: "CORRECTION",
      source_type: "payment_reversal",
      source_id: input.paymentId,
      paymentId: input.paymentId,
      payment_id: input.paymentId,
      amount,
      note: reason,
      entry_at: now,
      createdAt: now,
      created_at: now,
    },
    "ledger_entry",
    "pending_sync",
  ) as unknown as CustomerLedgerEntry;

  const nextBalance = roundMoney(
    calculateLedgerBalance([...existingLedgerEntries, correction]),
  );
  const correctionWithBalance = {
    ...correction,
    balance_after: nextBalance,
    sync_status: "pending_sync" as const,
  } as CustomerLedgerEntry;

  const updatedCustomerBase = normaliseLocalCustomer({
    ...existingCustomer,
    type: nextBalance > 0 ? "udhar" : (existingCustomer.type ?? "regular"),
    udharAmount: nextBalance,
    totalUdhar: nextBalance,
    updatedAt: now,
  } as Customer);
  const metrics = calculateTrustScore(updatedCustomerBase, [
    ...existingLedgerEntries,
    correctionWithBalance,
  ]);
  const updatedCustomer = {
    ...updatedCustomerBase,
    updated_at: now,
    trustScore: metrics.trustScore,
    badCustomer: metrics.isBadCustomer,
    // Derived balance, not a customer edit — see recordPaymentLocalFirst.
    sync_status: String((existingCustomer as unknown as Record<string, unknown>).sync_status ?? "synced"),
    balance_derived_from_local_ledger: true,
  } as unknown as Customer & Record<string, unknown>;

  const auditLog = buildAuditLogRow({
    action: "payment_reversed",
    entityType: "payment",
    entityId: input.paymentId,
    entityLabel: String(existingCustomer.name ?? customerId),
    oldValue: payment,
    newValue: updatedPayment,
    reason,
    ownerPinProvided: input.ownerPin.length > 0,
    summary: `Payment reversal ₹${amount.toLocaleString("en-IN")}`,
  });

  const auditOutbox = buildOutboxOperation(buildAuditLogOutboxInput(auditLog));
  const reversalOutbox = buildOutboxOperation({
    entity_type: "payment",
    entity_id: input.paymentId,
    operation_type: "REVERSE_PAYMENT",
    idempotency_key: `reverse-payment:${input.paymentId}`,
    payload: {
      paymentId: input.paymentId,
      customerId,
      ledgerEntryId: String(payment.ledgerEntryId ?? payment.ledger_entry_id ?? ""),
      localLedgerEntryId: String(payment.localLedgerEntryId ?? payment.local_ledger_entry_id ?? payment.ledgerEntryId ?? payment.ledger_entry_id ?? ""),
      correctionId: correctionWithBalance.id,
      amount,
      reason,
      ownerPin: input.ownerPin,
      ownerPinProvided: true,
    },
  });

  await offlineDB.transaction(PAYMENT_TRANSACTION_TABLES, async (tx) => {
    await tx.put("payments", updatedPayment);
    await tx.put("customer_ledger", correctionWithBalance);
    await tx.put("customers", updatedCustomer);
    await tx.put("local_audit_logs", auditLog);
    await tx.enqueueOutboxOperation(auditOutbox);
    await tx.enqueueOutboxOperation(reversalOutbox);
  });

  upsertCachedListItem(PAYMENT_CACHE_KEY, updatedPayment, 1000);
  upsertCachedListItem<Customer & Record<string, unknown>>(
    CUSTOMER_CACHE_KEY,
    updatedCustomer,
    1000,
  );
  upsertCachedListItem<CustomerLedgerEntry>(
    "customer_ledger",
    correctionWithBalance,
    1500,
  );
  emitLocalDataChanged({
    type: "payment",
    id: input.paymentId,
    customerId,
    action: "reversed",
  });
  emitLocalDataChanged({
    type: "ledger",
    id: correctionWithBalance.id,
    customerId,
    action: "appended",
  });
  return {
    success: true,
    paymentId: input.paymentId,
    correctionId: correctionWithBalance.id,
    pendingSync: true,
  };
}

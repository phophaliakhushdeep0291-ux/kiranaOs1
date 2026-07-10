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
import { buildOutboxOperation } from "@/features/sync/outbox";
import {
  makeLocalEntity,
  parseOrThrow,
  readNumber,
  roundMoney,
} from "@/lib/offline/actions/utils";
import { normaliseLocalCustomer } from "@/features/customers/local-actions";
import { readCustomerLedgerEntries } from "@/features/ledger/local-actions";
import {
  calculateLedgerBalance,
  buildLedgerStatement,
  dedupeLedgerEntries,
  calculateTrustScore,
  type CustomerLedgerEntry,
} from "@/features/ledger/accounting";
import type { Customer, UdharPaymentInput } from "@/types/api";
import {
  buildAuditLogOutboxInput,
  buildAuditLogRow,
} from "@/features/audit-logs/local-actions";

const CUSTOMER_CACHE_KEY = "customers";
const PAYMENT_CACHE_KEY = "payments";

export interface LocalPaymentResult {
  success: true;
  paymentId: string;
  customerId: string;
  amount: number;
  pendingSync: true;
}

export function getLocalUdharSummary() {
  const customers = readInstantCache<Customer[]>(CUSTOMER_CACHE_KEY, []).map(
    normaliseLocalCustomer,
  );
  const ledgerEntries = dedupeLedgerEntries(
    readInstantCache<CustomerLedgerEntry[]>("customer_ledger", []),
  );
  const ledgerGroups = new Map<string, CustomerLedgerEntry[]>();
  for (const entry of ledgerEntries) {
    const id = typeof entry.customerId === "string" && entry.customerId.length > 0
      ? entry.customerId
      : typeof entry.customer_id === "string" && entry.customer_id.length > 0
        ? entry.customer_id
        : null;
    if (!id) continue;
    const group = ledgerGroups.get(id) ?? [];
    group.push(entry);
    ledgerGroups.set(id, group);
  }
  const ledgerBalances = new Map(
    [...ledgerGroups.entries()].map(([customerId, entries]) => [
      customerId,
      roundMoney(calculateLedgerBalance(entries)),
    ]),
  );
  const rows = customers
    .map((customer) => ({
      customerId: customer.id,
      customerName: customer.name,
      mobile: customer.mobile ?? undefined,
      amount: roundMoney(
        ledgerBalances.get(customer.id) ?? readNumber(customer.udharAmount ?? customer.totalUdhar, 0),
      ),
      outstanding: roundMoney(
        ledgerBalances.get(customer.id) ?? readNumber(customer.udharAmount ?? customer.totalUdhar, 0),
      ),
      dueDate: (customer as unknown as Record<string, unknown>).dueDate as
        | string
        | undefined,
      promiseToPayDate: (customer as unknown as Record<string, unknown>)
        .promiseToPayDate as string | undefined,
      trustScore: readNumber(
        (customer as unknown as Record<string, unknown>).trustScore,
        75,
      ),
    }))
    .filter((row) => row.outstanding > 0);
  return {
    totalOutstanding: roundMoney(
      rows.reduce((sum, row) => sum + row.outstanding, 0),
    ),
    customers: rows,
  };
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

export async function recordPaymentLocalFirst(
  customerId: string,
  data: UdharPaymentInput,
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
  const currentBalance = calculateLedgerBalance(existingLedgerEntries);
  // Guard against overpayment: a udhar payment can never exceed the customer's
  // outstanding balance. The backend already rejects this
  // (UDHAR_PAYMENT_EXCEEDS_OUTSTANDING); the offline path must enforce the same
  // rule so it can't drive the balance negative or queue an event that will fail
  // to sync. A tiny epsilon absorbs paise-level float drift.
  const outstanding = roundMoney(Math.max(0, currentBalance));
  if (amount > outstanding + 0.001) {
    const error = new Error(
      `Payment ₹${amount.toLocaleString("en-IN")} exceeds outstanding udhar ₹${outstanding.toLocaleString("en-IN")}`,
    );
    (error as Error & { code?: string }).code = "UDHAR_PAYMENT_EXCEEDS_OUTSTANDING";
    throw error;
  }
  const nextBalance = roundMoney(currentBalance - amount);
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
    sync_status: "pending_sync" as const,
  } as Customer & Record<string, unknown>;

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
  return { success: true, paymentId, customerId, amount, pendingSync: true };
}

export async function reversePaymentWithOwnerPinLocalFirst(input: {
  paymentId: string;
  ownerPin: string;
  reason?: string;
}): Promise<{
  success: true;
  paymentId: string;
  correctionId: string;
  pendingSync: true;
}> {
  parseOrThrow(ownerPinRequiredActionSchema, {
    action: "reverse_payment",
    ownerPin: input.ownerPin,
    entityId: input.paymentId,
    reason: input.reason,
  });
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

  const customerId = String(payment.customerId ?? payment.customer_id ?? "");
  if (!customerId) throw new Error("Payment is not linked to a customer");

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
    sync_status: "pending_sync" as const,
  } as Customer & Record<string, unknown>;

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

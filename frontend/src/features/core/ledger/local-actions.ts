import { offlineDB } from "@/lib/offline/db";
import { addMoney, formatMoney, toPaise } from "@/lib/money";
import { createLocalId, emitLocalDataChanged, upsertCachedListItem } from "@/lib/offline/instant-cache";
import { makeLocalEntity, parseOrThrow, readNumber, roundMoney } from "@/lib/offline/actions/utils";
import { buildOutboxOperation } from "@/features/core/sync/outbox";
import { ownerPinRequiredActionSchema } from "@/lib/validation";
import type { Customer } from "@/types/api";
import { calculateLedgerBalance, dedupeLedgerEntries, type CustomerLedgerEntry } from "@/features/core/ledger/accounting";
import { buildAuditLogOutboxInput, buildAuditLogRow } from "@/features/core/audit-logs/local-actions";
import { withCustomerFinancialLock } from "@/features/core/ledger/customer-financial-lock";

const CUSTOMER_CACHE_KEY = "customers";
const LEDGER_CACHE_KEY = "customer_ledger";

function customerIdentitySet(customer: (Customer & Record<string, unknown>) | undefined): Set<string> {
  return new Set(
    [
      customer?.id,
      customer?.local_id,
      customer?.localId,
      customer?.server_id,
      customer?.serverId,
    ].filter((value): value is string => typeof value === "string" && value.length > 0),
  );
}

function readStringField(row: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
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
      if (expanded.has(localId) && !expanded.has(serverId)) { expanded.add(serverId); changed = true; }
      if (expanded.has(serverId) && !expanded.has(localId)) { expanded.add(localId); changed = true; }
    }
  }
  return expanded;
}

async function resolveCustomerIdentitySet(customerId: string): Promise<Set<string>> {
  const [customers, mappings] = await Promise.all([
    offlineDB.getAll<Customer & Record<string, unknown>>("customers").catch(() => []),
    offlineDB.getAll<Record<string, unknown>>("id_mappings").catch(() => []),
  ]);
  const customer = customers.find((row) => {
    const ids = expandIdsWithMappings(customerIdentitySet(row), mappings);
    return ids.has(customerId);
  });
  return new Set([customerId, ...expandIdsWithMappings(customerIdentitySet(customer), mappings)]);
}

export async function readCustomerLedgerEntries(customerId: string): Promise<CustomerLedgerEntry[]> {
  const customerIds = await resolveCustomerIdentitySet(customerId);
  const rows = await offlineDB.getAll<CustomerLedgerEntry>("customer_ledger").catch(() => []);
  return dedupeLedgerEntries(rows).filter((row) => {
    const id = row.customerId ?? row.customer_id;
    return typeof id === "string" && customerIds.has(id);
  });
}

export interface CreateLedgerAdjustmentInput {
  customerId: string;
  amount: number;
  note?: string;
  ownerPin: string;
  /**
   * The outstanding balance the operator is actually looking at (the authoritative
   * `/udhar/summary` value the udhar page overlays). The local ledger can be stale
   * or diverged from the server, so validating a reduction against the raw local
   * sum alone wrongly blocks a legitimate adjustment (e.g. "Maximum reduction is
   * Rs 0" while ₹630 is displayed). We guard against the max of the two and let the
   * backend's own negative-balance check be the final authority on sync.
   */
  expectedOutstanding?: number;
}

async function createLedgerAdjustmentLocalFirstUnlocked(
  input: CreateLedgerAdjustmentInput,
): Promise<CustomerLedgerEntry> {
  parseOrThrow(ownerPinRequiredActionSchema, {
    action: "ledger_adjustment",
    ownerPin: input.ownerPin,
    entityId: input.customerId,
    reason: input.note,
  });
  const amount = roundMoney(readNumber(input.amount, 0));
  if (amount === 0) throw new Error("Adjustment amount cannot be zero");
  const [existingLedgerEntries, customers, mappings] = await Promise.all([
    readCustomerLedgerEntries(input.customerId),
    offlineDB.getAll<Customer & Record<string, unknown>>("customers").catch(() => []),
    offlineDB.getAll<Record<string, unknown>>("id_mappings").catch(() => []),
  ]);
  const customer = customers.find((row) =>
    expandIdsWithMappings(customerIdentitySet(row), mappings).has(input.customerId),
  );
  if (!customer) throw new Error("Customer not found in local records");

  const ledgerBalance = roundMoney(Math.max(0, calculateLedgerBalance(existingLedgerEntries)));
  const projectedBalance = customer.balance_derived_from_local_ledger === true
    ? Math.max(0, readNumber(customer.udharAmount ?? customer.totalUdhar, 0))
    : null;
  // A provided value is the authoritative amount visible to the operator. Do
  // not take max(local, authoritative): historical local-ledger drift can be
  // larger and would make a ₹30 correction against ₹630 jump to ₹970.
  // Once this device has committed a newer local financial write, its durable
  // customer projection wins so concurrent/stale dialogs cannot overwrite it.
  const currentBalance = roundMoney(projectedBalance !== null
    ? projectedBalance
    : input.expectedOutstanding !== undefined
      ? Math.max(0, readNumber(input.expectedOutstanding, 0))
      : ledgerBalance);
  if (toPaise(addMoney(currentBalance, amount)) < 0) {
    const error = new Error(`Adjustment would make udhar negative. Maximum reduction is ${formatMoney(currentBalance)}`);
    (error as Error & { code?: string }).code = "UDHAR_ADJUSTMENT_NEGATIVE_BALANCE";
    throw error;
  }
  const now = new Date().toISOString();
  const entryId = createLocalId("ledger");
  const sourceId = createLocalId("manual_adjustment");
  const idempotencyKey = `ledger-adjustment:${input.customerId}:${entryId}`;
  const nextBalance = roundMoney(Math.max(0, addMoney(currentBalance, amount)));
  const note = input.note?.trim() || "Manual ledger adjustment";
  const entry = makeLocalEntity({
    id: entryId,
    customerId: input.customerId,
    customer_id: input.customerId,
    type: "ADJUSTMENT",
    source_type: "manual_adjustment",
    source_id: sourceId,
    amount,
    balance_after: nextBalance,
    note,
    idempotencyKey,
    idempotency_key: idempotencyKey,
    localLedgerEntryId: entryId,
    local_ledger_entry_id: entryId,
    clientLedgerId: entryId,
    client_ledger_id: entryId,
    entry_at: now,
    createdAt: now,
    created_at: now,
  }, "ledger_entry", "pending_sync") as unknown as CustomerLedgerEntry;
  const updatedCustomer = {
    ...customer,
    type: nextBalance > 0 ? "udhar" : customer.type ?? "regular",
    udharAmount: nextBalance,
    totalUdhar: nextBalance,
    updatedAt: now,
    updated_at: now,
    sync_status: String(customer.sync_status ?? "synced"),
    balance_derived_from_local_ledger: true,
  } as Customer & Record<string, unknown>;
  const auditLog = buildAuditLogRow({
    action: "ledger_adjusted",
    entityType: "ledger_entry",
    entityId: entryId,
    entityLabel: customer.name,
    newValue: entry,
    reason: note,
    ownerPinProvided: true,
    summary: `Udhar adjusted by ${formatMoney(amount)} for ${customer.name}`,
  });
  const auditOutbox = buildOutboxOperation(buildAuditLogOutboxInput(auditLog));
  const adjustmentOutbox = buildOutboxOperation({
    entity_type: "ledger_entry",
    entity_id: entryId,
    operation_type: "CREATE_LEDGER_ADJUSTMENT",
    idempotency_key: idempotencyKey,
    payload: {
      ledgerEntryId: entryId,
      localLedgerEntryId: entryId,
      local_ledger_entry_id: entryId,
      clientLedgerId: entryId,
      client_ledger_id: entryId,
      idempotencyKey,
      idempotency_key: idempotencyKey,
      customerId: input.customerId,
      amount,
      note,
      ownerPin: input.ownerPin,
      ownerPinProvided: true,
    },
  });

  await offlineDB.transaction(
    ["customer_ledger", "customers", "local_audit_logs", "sync_outbox"],
    async (tx) => {
      await tx.put("customer_ledger", entry);
      await tx.put("customers", updatedCustomer);
      await tx.put("local_audit_logs", auditLog);
      await tx.enqueueOutboxOperation(auditOutbox);
      await tx.enqueueOutboxOperation(adjustmentOutbox);
    },
  );

  upsertCachedListItem<CustomerLedgerEntry>(LEDGER_CACHE_KEY, entry, 1500);
  upsertCachedListItem<Customer & Record<string, unknown>>(CUSTOMER_CACHE_KEY, updatedCustomer, 1000);
  emitLocalDataChanged({ type: "ledger", id: entry.id, customerId: input.customerId, action: "appended" });
  return entry;
}

export function createLedgerAdjustmentLocalFirst(
  input: CreateLedgerAdjustmentInput,
): Promise<CustomerLedgerEntry> {
  return withCustomerFinancialLock(input.customerId, () =>
    createLedgerAdjustmentLocalFirstUnlocked(input));
}

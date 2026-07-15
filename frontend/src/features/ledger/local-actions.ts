import { offlineDB } from "@/lib/offline/db";
import { createLocalId, emitLocalDataChanged, upsertCachedListItem } from "@/lib/offline/instant-cache";
import { makeLocalEntity, parseOrThrow, readNumber, roundMoney } from "@/lib/offline/actions/utils";
import { enqueueOutboxOperation } from "@/features/sync/outbox";
import { ownerPinRequiredActionSchema } from "@/lib/validation";
import type { Customer } from "@/types/api";
import { calculateLedgerBalance, dedupeLedgerEntries, type CustomerLedgerEntry } from "@/features/ledger/accounting";

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
  for (const mapping of mappings) {
    const entityType = String(mapping.entity_type ?? mapping.entityType ?? "");
    if (entityType && entityType !== "customer" && entityType !== "customers") continue;
    const localId = readStringField(mapping, ["local_id", "localId"]);
    const serverId = readStringField(mapping, ["server_id", "serverId"]);
    if (!localId || !serverId) continue;
    if (expanded.has(localId)) expanded.add(serverId);
    if (expanded.has(serverId)) expanded.add(localId);
  }
  return expanded;
}

async function resolveCustomerIdentitySet(customerId: string): Promise<Set<string>> {
  const customers = await offlineDB.getAll<Customer & Record<string, unknown>>("customers").catch(() => []);
  const mappings = await offlineDB.getAll<Record<string, unknown>>("id_mappings").catch(() => []);
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

export async function refreshCustomerBalanceFromLedger(customerId: string): Promise<number> {
  const ledger = await readCustomerLedgerEntries(customerId);
  const balance = roundMoney(Math.max(0, calculateLedgerBalance(ledger)));
  const customers = await offlineDB.getAll<Customer & Record<string, unknown>>("customers").catch(() => []);
  const mappings = await offlineDB.getAll<Record<string, unknown>>("id_mappings").catch(() => []);
  const customer = customers.find((row) => expandIdsWithMappings(customerIdentitySet(row), mappings).has(customerId));
  if (customer) {
    const updated = {
      ...customer,
      type: balance > 0 ? "udhar" : customer.type ?? "regular",
      udharAmount: balance,
      totalUdhar: balance,
      updatedAt: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      sync_status: customer.sync_status === "synced" ? "synced" : "pending_sync",
    };
    await offlineDB.put("customers", updated);
    upsertCachedListItem<Customer & Record<string, unknown>>(CUSTOMER_CACHE_KEY, updated, 1000);
  }
  return balance;
}

export async function appendCustomerLedgerEntry(entry: Omit<CustomerLedgerEntry, "id" | "createdAt" | "created_at" | "entry_at"> & { id?: string; entry_at?: string; createdAt?: string; created_at?: string }): Promise<CustomerLedgerEntry> {
  const now = new Date().toISOString();
  const customerId = entry.customerId ?? entry.customer_id;
  const row = makeLocalEntity({
    ...entry,
    id: entry.id ?? createLocalId("ledger"),
    customerId,
    customer_id: customerId,
    entry_at: entry.entry_at ?? now,
    createdAt: entry.createdAt ?? now,
    created_at: entry.created_at ?? now,
  }, "ledger_entry", "pending_sync") as unknown as CustomerLedgerEntry;

  await offlineDB.put("customer_ledger", row);
  upsertCachedListItem<CustomerLedgerEntry>(LEDGER_CACHE_KEY, row, 1500);
  if (typeof customerId === "string" && customerId.length > 0) {
    const balance = await refreshCustomerBalanceFromLedger(customerId);
    await offlineDB.put("customer_ledger", { ...row, balance_after: balance, sync_status: "pending_sync" });
  }
  emitLocalDataChanged({ type: "ledger", id: row.id, customerId, action: "appended" });
  return row;
}

export async function createLedgerAdjustmentLocalFirst(input: {
  customerId: string;
  amount: number;
  note?: string;
  ownerPin: string;
}): Promise<CustomerLedgerEntry> {
  parseOrThrow(ownerPinRequiredActionSchema, {
    action: "ledger_adjustment",
    ownerPin: input.ownerPin,
    entityId: input.customerId,
    reason: input.note,
  });
  const amount = roundMoney(readNumber(input.amount, 0));
  if (amount === 0) throw new Error("Adjustment amount cannot be zero");
  const currentBalance = roundMoney(Math.max(0, calculateLedgerBalance(await readCustomerLedgerEntries(input.customerId))));
  if (roundMoney(currentBalance + amount) < 0) {
    const error = new Error(`Adjustment would make udhar negative. Maximum reduction is Rs ${currentBalance.toLocaleString("en-IN")}`);
    (error as Error & { code?: string }).code = "UDHAR_ADJUSTMENT_NEGATIVE_BALANCE";
    throw error;
  }
  const entry = await appendCustomerLedgerEntry({
    customerId: input.customerId,
    customer_id: input.customerId,
    type: "ADJUSTMENT",
    source_type: "manual_adjustment",
    source_id: createLocalId("manual_adjustment"),
    amount,
    note: input.note?.trim() || "Manual ledger adjustment",
  });
  await enqueueOutboxOperation({
    entity_type: "ledger_entry",
    entity_id: entry.id,
    operation_type: "CREATE_LEDGER_ADJUSTMENT",
    payload: { ledgerEntryId: entry.id, customerId: input.customerId, amount, note: input.note ?? null, ownerPin: input.ownerPin, ownerPinProvided: true },
  });
  return entry;
}

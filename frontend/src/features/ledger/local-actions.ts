import { offlineDB } from "@/lib/offline/db";
import { createLocalId, emitLocalDataChanged, upsertCachedListItem } from "@/lib/offline/instant-cache";
import { makeLocalEntity, parseOrThrow, readNumber, roundMoney } from "@/lib/offline/actions/utils";
import { enqueueOutboxOperation } from "@/features/sync/outbox";
import { ownerPinRequiredActionSchema } from "@/lib/validation";
import type { Customer } from "@/types/api";
import { calculateLedgerBalance, dedupeLedgerEntries, type CustomerLedgerEntry } from "@/features/ledger/accounting";

const CUSTOMER_CACHE_KEY = "customers";
const LEDGER_CACHE_KEY = "customer_ledger";

export async function readCustomerLedgerEntries(customerId: string): Promise<CustomerLedgerEntry[]> {
  const rows = await offlineDB.getAll<CustomerLedgerEntry>("customer_ledger").catch(() => []);
  return dedupeLedgerEntries(rows.filter((row) => row.customerId === customerId || row.customer_id === customerId));
}

export async function refreshCustomerBalanceFromLedger(customerId: string): Promise<number> {
  const ledger = await readCustomerLedgerEntries(customerId);
  const balance = roundMoney(Math.max(0, calculateLedgerBalance(ledger)));
  const customers = await offlineDB.getAll<Customer & Record<string, unknown>>("customers").catch(() => []);
  const customer = customers.find((row) => row.id === customerId || row.local_id === customerId || row.server_id === customerId);
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
  if (amount < 0) {
    const currentBalance = roundMoney(Math.max(0, calculateLedgerBalance(await readCustomerLedgerEntries(input.customerId))));
    if (Math.abs(amount) > currentBalance + 0.005) {
      throw new Error(`Adjustment ₹${Math.abs(amount).toLocaleString("en-IN")} exceeds outstanding udhar ₹${currentBalance.toLocaleString("en-IN")}`);
    }
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

import { dexieDB, filterRowsForCurrentScope, rowMatchesCurrentScope, type OfflineRow, type PendingSyncEvent } from "@/lib/offline/db";
import { nowIso } from "@/lib/offline/context";

export interface LocalDataHardeningResult {
  paymentsMerged: number;
  ledgerMerged: number;
  outboxResolved: number;
  conflictsResolved: number;
  total: number;
}

type MutableRow = Record<string, unknown>;
type FinancialTableName = "payments" | "customer_ledger";

const LOCAL_ID_PATTERNS = [
  "local_",
  "tmp_",
  "temp_",
  "pending",
  "payment_",
  "ledger_",
  "bill_",
  "customer_",
  "stock_",
];

function isRecord(value: unknown): value is MutableRow {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function readStringFrom(row: unknown, keys: string[]): string | undefined {
  if (!isRecord(row)) return undefined;
  for (const key of keys) {
    const value = readString(row[key]);
    if (value) return value;
  }
  return undefined;
}

function readNumberFrom(row: unknown, keys: string[]): number | undefined {
  if (!isRecord(row)) return undefined;
  for (const key of keys) {
    const value = row[key];
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function isDeleted(row: MutableRow): boolean {
  return Boolean(row.deleted_at ?? row.deletedAt ?? row.merged_into_id ?? row.mergedIntoId);
}

function normalizedIdText(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function looksLocalId(value: unknown): boolean {
  const id = normalizedIdText(value);
  if (!id) return false;
  return LOCAL_ID_PATTERNS.some((pattern) => id.startsWith(pattern) || id.includes(pattern));
}

function rowHasServerProof(row: MutableRow): boolean {
  const status = normalizedIdText(row.sync_status ?? row.status);
  if (status === "synced") return true;
  if (readStringFrom(row, ["server_id", "serverId"])) return true;
  const id = readStringFrom(row, ["id"]);
  if (!id) return false;
  return !looksLocalId(id);
}

function rowLooksLocalEcho(row: MutableRow): boolean {
  const status = normalizedIdText(row.sync_status ?? row.status);
  if (["pending_sync", "syncing", "failed", "conflict", "local_only"].includes(status)) return true;
  if (looksLocalId(row.id) || looksLocalId(row.local_id) || looksLocalId(row.localId)) return true;
  if (looksLocalId(row.bill_id) || looksLocalId(row.billId) || looksLocalId(row.source_id) || looksLocalId(row.sourceId)) return true;
  return Boolean((row.local_id ?? row.localId) && !(row.server_id ?? row.serverId));
}

function rowPriority(row: MutableRow): number {
  const status = normalizedIdText(row.sync_status ?? row.status);
  let score = 0;
  if (rowHasServerProof(row)) score += 100;
  if (status === "synced") score += 20;
  if (status === "failed" || status === "conflict") score -= 20;
  if (rowLooksLocalEcho(row)) score -= 5;
  const updated = readStringFrom(row, ["updated_at", "updatedAt", "created_at", "createdAt", "paid_at", "paidAt", "entry_at", "entryAt"]);
  if (updated) score += Math.min(10, Math.floor(new Date(updated).getTime() / 1_000_000_000_000));
  return score;
}

function timeBucket(row: MutableRow): string {
  const raw = readStringFrom(row, ["paid_at", "paidAt", "entry_at", "entryAt", "created_at", "createdAt", "updated_at", "updatedAt"]);
  if (!raw) return "unknown-time";
  const time = new Date(raw).getTime();
  if (!Number.isFinite(time)) return raw.slice(0, 16);
  // Fifteen minutes is intentionally wider than bill creation matching because
  // local rows and server rows may be stamped a few minutes apart after retry.
  return String(Math.floor(time / (15 * 60 * 1000)));
}

function amountKey(value: number | undefined): string | undefined {
  if (value === undefined || !Number.isFinite(value) || Math.abs(value) <= 0.004) return undefined;
  return Math.abs(roundMoney(value)).toFixed(2);
}

function paymentEchoSignature(row: MutableRow): string | undefined {
  const mode = normalizedIdText(readStringFrom(row, ["mode", "paymentMode", "payment_mode"]));
  if (mode !== "cash" && mode !== "upi" && mode !== "card") return undefined;
  const amount = amountKey(readNumberFrom(row, ["amount", "paidAmount", "paid_amount"]));
  if (!amount) return undefined;
  const customer = normalizedIdText(readStringFrom(row, ["customer_id", "customerId"]) ?? "walk-in");
  return `payment|${customer}|${mode}|${amount}|${timeBucket(row)}`;
}

function ledgerKind(row: MutableRow): "bill" | "payment" | "correction" | undefined {
  const type = normalizedIdText(readStringFrom(row, ["type", "entryType", "entry_type"]));
  const source = normalizedIdText(readStringFrom(row, ["source_type", "sourceType"]));
  if (type.includes("payment") || source.includes("payment")) return "payment";
  if (type.includes("bill") || source.includes("bill") || type === "debit" || source.includes("udhar")) return "bill";
  if (type.includes("correction") || type.includes("adjust")) return "correction";
  return undefined;
}

function ledgerEchoSignature(row: MutableRow): string | undefined {
  const kind = ledgerKind(row);
  if (!kind) return undefined;
  const amount = amountKey(readNumberFrom(row, ["amount", "creditAmount", "credit_amount", "debitAmount", "debit_amount"]));
  if (!amount) return undefined;
  const customer = normalizedIdText(readStringFrom(row, ["customer_id", "customerId"]) ?? "unknown-customer");
  return `ledger|${customer}|${kind}|${amount}|${timeBucket(row)}`;
}

export function financialEchoSignature(tableName: FinancialTableName, row: MutableRow): string | undefined {
  return tableName === "payments" ? paymentEchoSignature(row) : ledgerEchoSignature(row);
}

function shouldMergeEchoRows(group: MutableRow[]): boolean {
  const active = group.filter((row) => !isDeleted(row));
  if (active.length < 2) return false;
  const hasServer = active.some(rowHasServerProof);
  const hasLocal = active.some(rowLooksLocalEcho);
  return hasServer && hasLocal;
}

function tombstoneEchoRow(row: MutableRow, winner: MutableRow): MutableRow {
  const now = nowIso();
  const winnerId = readStringFrom(winner, ["id", "server_id", "serverId"]) ?? readStringFrom(row, ["server_id", "serverId"]);
  return {
    ...row,
    merged_into_id: winnerId ?? row.merged_into_id ?? null,
    mergedIntoId: winnerId ?? row.mergedIntoId ?? null,
    server_id: winnerId ?? row.server_id,
    sync_status: "synced",
    isSynced: true,
    is_synced: true,
    deleted_at: row.deleted_at ?? now,
    deletedAt: row.deletedAt ?? now,
    updated_at: now,
    updatedAt: now,
    hardening_reason: "duplicate local/server financial echo merged",
  };
}

async function repairDuplicateFinancialEchoTable(tableName: FinancialTableName): Promise<number> {
  await dexieDB.open();
  const table = dexieDB.table(tableName);
  const rows = filterRowsForCurrentScope(
    await table.filter(rowMatchesCurrentScope).toArray().catch(() => []),
  ) as MutableRow[];
  const groups = new Map<string, MutableRow[]>();

  for (const row of rows) {
    if (isDeleted(row)) continue;
    const signature = financialEchoSignature(tableName, row);
    if (!signature) continue;
    const group = groups.get(signature) ?? [];
    group.push(row);
    groups.set(signature, group);
  }

  let merged = 0;
  for (const group of groups.values()) {
    if (!shouldMergeEchoRows(group)) continue;
    const [winner, ...losers] = [...group].sort((a, b) => rowPriority(b) - rowPriority(a));
    const winnerId = readStringFrom(winner, ["id"]);
    for (const loser of losers) {
      const loserId = readStringFrom(loser, ["id"]);
      if (!loserId || loserId === winnerId) continue;
      await table.put(tombstoneEchoRow(loser, winner));
      merged += 1;
    }
  }
  return merged;
}

function outboxStatusSynced(row: PendingSyncEvent): boolean {
  return row.status === "SYNCED" || row.sync_status === "synced";
}

function outboxStatusBlocking(row: PendingSyncEvent): boolean {
  return row.status === "FAILED" || row.status === "CONFLICT" || row.sync_status === "failed" || row.sync_status === "conflict";
}

function outboxPayload(row: PendingSyncEvent): MutableRow {
  return isRecord(row.payload) ? row.payload : {};
}

function outboxFinancialSignature(event: PendingSyncEvent): string | undefined {
  const kind = normalizedIdText(event.operation_type || event.type);
  const payload = outboxPayload(event);
  const payment = isRecord(payload.payment) ? payload.payment : payload;
  if (kind.includes("PAYMENT") || event.entity_type === "payment") return paymentEchoSignature(payment);
  if (kind.includes("BILL") || event.entity_type === "bill") return undefined;
  return undefined;
}

async function repairFinancialDuplicateOutboxFailures(): Promise<number> {
  await dexieDB.open();
  const outbox = filterRowsForCurrentScope(
    await dexieDB.sync_outbox.filter(rowMatchesCurrentScope).toArray().catch(() => []),
  );
  const activePaymentRows = filterRowsForCurrentScope(
    await dexieDB.payments.filter(rowMatchesCurrentScope).toArray().catch(() => []),
  ) as MutableRow[];
  const serverPaymentSignatures = new Set(
    activePaymentRows
      .filter((row) => !isDeleted(row) && rowHasServerProof(row))
      .map((row) => paymentEchoSignature(row))
      .filter((signature): signature is string => Boolean(signature)),
  );
  const now = nowIso();
  let resolved = 0;
  for (const event of outbox) {
    if (outboxStatusSynced(event) || !outboxStatusBlocking(event)) continue;
    const signature = outboxFinancialSignature(event);
    if (!signature || !serverPaymentSignatures.has(signature)) continue;
    await dexieDB.sync_outbox.put({
      ...event,
      status: "SYNCED",
      sync_status: "synced",
      error_message: null,
      last_error: null,
      next_retry_at: null,
      last_attempt_at: now,
    });
    resolved += 1;
  }
  return resolved;
}

async function repairConflictsWithoutBlockingOutbox(): Promise<number> {
  await dexieDB.open();
  const conflicts = filterRowsForCurrentScope(
    await dexieDB.sync_conflicts.filter(rowMatchesCurrentScope).toArray().catch(() => []),
  ) as OfflineRow[];
  const blockingOutbox = filterRowsForCurrentScope(
    await dexieDB.sync_outbox.filter(rowMatchesCurrentScope).toArray().catch(() => []),
  ).filter((row) => !outboxStatusSynced(row));
  if (conflicts.length === 0 || blockingOutbox.length > 0) return 0;
  const now = nowIso();
  let resolved = 0;
  for (const conflict of conflicts) {
    if (!(conflict.sync_status === "conflict" || conflict.resolution === "unresolved")) continue;
    await dexieDB.sync_conflicts.put({
      ...conflict,
      sync_status: "synced",
      resolution: "auto_resolved",
      resolved_at: now,
      updated_at: now,
    });
    resolved += 1;
  }
  return resolved;
}

let hardeningInFlight: Promise<LocalDataHardeningResult> | null = null;

export async function hardenLocalFinancialData(): Promise<LocalDataHardeningResult> {
  if (hardeningInFlight) return hardeningInFlight;
  hardeningInFlight = (async () => {
    const paymentsMerged = await repairDuplicateFinancialEchoTable("payments").catch(() => 0);
    const ledgerMerged = await repairDuplicateFinancialEchoTable("customer_ledger").catch(() => 0);
    const outboxResolved = await repairFinancialDuplicateOutboxFailures().catch(() => 0);
    const conflictsResolved = await repairConflictsWithoutBlockingOutbox().catch(() => 0);
    const total = paymentsMerged + ledgerMerged + outboxResolved + conflictsResolved;
    if (total > 0 && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("kirana:local-data-changed"));
      window.dispatchEvent(new CustomEvent("kirana:sync-queue-updated"));
    }
    return { paymentsMerged, ledgerMerged, outboxResolved, conflictsResolved, total };
  })();
  try {
    return await hardeningInFlight;
  } finally {
    hardeningInFlight = null;
  }
}

import { dexieDB, filterRowsForCurrentScope, rowMatchesCurrentScope, type OfflineRow, type PendingSyncEvent } from "@/lib/offline/db";
import { nowIso } from "@/lib/offline/context";
import { isLikelySyncedCopyOfPendingBill } from "@/features/sync/bill-reconciliation";
import {
  calculateLedgerBalance,
  dedupeLedgerEntries,
  normaliseLedgerType,
  type CustomerLedgerEntry,
} from "@/features/ledger/accounting";

export interface LocalDataHardeningResult {
  billsMerged: number;
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
  return (
    LOCAL_ID_PATTERNS.some((pattern) => id.startsWith(pattern) || id.includes(pattern)) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
  );
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

export function paymentDuplicateSignature(row: MutableRow): string | undefined {
  const mode = normalizedIdText(readStringFrom(row, ["mode", "paymentMode", "payment_mode"]));
  if (mode !== "cash" && mode !== "upi" && mode !== "card") return undefined;
  const amount = amountKey(readNumberFrom(row, ["amount", "paidAmount", "paid_amount"]));
  if (!amount) return undefined;
  const billId = readStringFrom(row, [
    "bill_id",
    "billId",
    "localBillId",
    "local_bill_id",
    "serverBillId",
    "server_bill_id",
  ]);
  const customer = readStringFrom(row, ["customer_id", "customerId"]);
  const scope = billId ? `bill:${billId}` : `customer:${customer ?? "walk-in"}`;
  const rawTime = readStringFrom(row, ["paid_at", "paidAt", "created_at", "createdAt", "updated_at", "updatedAt"]);
  if (!rawTime) return undefined;
  const time = new Date(rawTime).getTime();
  if (!Number.isFinite(time)) return undefined;
  const fiveMinuteBucket = Math.floor(time / (5 * 60 * 1000));
  return `payment-duplicate|${scope}|${mode}|${amount}|${fiveMinuteBucket}`;
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

function billServerId(row: MutableRow): string | undefined {
  return readStringFrom(row, ["server_id", "serverId", "id"]);
}

function billLocalId(row: MutableRow): string | undefined {
  return readStringFrom(row, [
    "local_id",
    "localId",
    "localBillId",
    "local_bill_id",
    "clientBillId",
    "client_bill_id",
    "id",
  ]);
}

function mergeBillWinnerIdentity(winner: MutableRow, localEcho: MutableRow): MutableRow {
  const now = nowIso();
  const localId = billLocalId(localEcho);
  const serverId = billServerId(winner);
  return {
    ...winner,
    local_id: readStringFrom(winner, ["local_id", "localId"]) ?? localId,
    localId: readStringFrom(winner, ["localId", "local_id"]) ?? localId,
    localBillId: readStringFrom(winner, ["localBillId", "local_bill_id"]) ?? localId,
    local_bill_id: readStringFrom(winner, ["local_bill_id", "localBillId"]) ?? localId,
    clientBillId: readStringFrom(winner, ["clientBillId", "client_bill_id"]) ?? localId,
    client_bill_id: readStringFrom(winner, ["client_bill_id", "clientBillId"]) ?? localId,
    server_id: serverId ?? winner.server_id,
    serverId: serverId ?? winner.serverId,
    sync_status: "synced",
    isSynced: true,
    is_synced: true,
    deleted_at: null,
    deletedAt: null,
    updated_at: now,
    updatedAt: now,
  };
}

function tombstoneBillEchoRow(row: MutableRow, winner: MutableRow): MutableRow {
  const now = nowIso();
  const winnerId = billServerId(winner);
  return {
    ...row,
    server_id: winnerId ?? row.server_id,
    serverId: winnerId ?? row.serverId,
    merged_into_id: winnerId ?? row.merged_into_id ?? null,
    mergedIntoId: winnerId ?? row.mergedIntoId ?? null,
    sync_status: "synced",
    isSynced: true,
    is_synced: true,
    deleted_at: row.deleted_at ?? now,
    deletedAt: row.deletedAt ?? now,
    updated_at: now,
    updatedAt: now,
    hardening_reason: "duplicate local/server bill echo merged",
  };
}

async function repairDuplicateBillEchoRows(): Promise<number> {
  await dexieDB.open();
  const rows = filterRowsForCurrentScope(
    await dexieDB.bills.filter(rowMatchesCurrentScope).toArray().catch(() => []),
  ) as MutableRow[];
  const activeRows = rows.filter((row) => !isDeleted(row));
  const serverRows = activeRows
    .filter(rowHasServerProof)
    .sort((a, b) => rowPriority(b) - rowPriority(a));
  const localEchoRows = activeRows
    .filter((row) => rowLooksLocalEcho(row) && !rowHasServerProof(row))
    .sort((a, b) => rowPriority(a) - rowPriority(b));

  let merged = 0;
  const usedLocalIds = new Set<string>();
  const usedServerIds = new Set<string>();
  for (const localRow of localEchoRows) {
    const localRowId = readStringFrom(localRow, ["id"]);
    if (!localRowId || usedLocalIds.has(localRowId)) continue;
    const winner = serverRows.find((serverRow) => {
      const serverRowId = readStringFrom(serverRow, ["id"]);
      return (
        serverRowId &&
        serverRowId !== localRowId &&
        !usedServerIds.has(serverRowId) &&
        isLikelySyncedCopyOfPendingBill(localRow, serverRow)
      );
    });
    if (!winner) continue;

    const serverId = billServerId(winner);
    const localId = billLocalId(localRow);
    await dexieDB.bills.put(mergeBillWinnerIdentity(winner, localRow) as never);
    await dexieDB.bills.put(tombstoneBillEchoRow(localRow, winner) as never);
    if (serverId && localId && serverId !== localId) {
      await dexieDB.id_mappings.put({
        local_id: localId,
        server_id: serverId,
        entity_type: "bill",
        tenant_id: readStringFrom(localRow, ["tenant_id", "tenantId"]) ?? readStringFrom(winner, ["tenant_id", "tenantId"]),
        store_id: readStringFrom(localRow, ["store_id", "storeId"]) ?? readStringFrom(winner, ["store_id", "storeId"]),
        updated_at: nowIso(),
      } as never);
    }
    usedLocalIds.add(localRowId);
    if (serverId) usedServerIds.add(serverId);
    merged += 1;
  }
  return merged;
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

async function repairExactDuplicatePaymentRows(): Promise<number> {
  await dexieDB.open();
  const rows = filterRowsForCurrentScope(
    await dexieDB.payments.filter(rowMatchesCurrentScope).toArray().catch(() => []),
  ) as MutableRow[];
  const groups = new Map<string, MutableRow[]>();

  for (const row of rows) {
    if (isDeleted(row)) continue;
    const signature = paymentDuplicateSignature(row);
    if (!signature) continue;
    const group = groups.get(signature) ?? [];
    group.push(row);
    groups.set(signature, group);
  }

  let merged = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const [winner, ...losers] = [...group].sort((a, b) => rowPriority(b) - rowPriority(a));
    const winnerId = readStringFrom(winner, ["id"]);
    for (const loser of losers) {
      const loserId = readStringFrom(loser, ["id"]);
      if (!loserId || loserId === winnerId) continue;
      await dexieDB.payments.put({
        ...tombstoneEchoRow(loser, winner),
        hardening_reason: "exact duplicate payment row merged",
      } as never);
      merged += 1;
    }
  }
  return merged;
}

function getLedgerCustomerId(row: MutableRow): string | undefined {
  return readStringFrom(row, ["customer_id", "customerId", "serverCustomerId", "server_customer_id", "localCustomerId", "local_customer_id"]);
}

function isOpeningBalanceLedger(row: MutableRow): boolean {
  const note = normalizedIdText(row.note);
  const source = normalizedIdText(readStringFrom(row, ["source_type", "sourceType", "source_id", "sourceId"]));
  return (
    (note.includes("opening") && (note.includes("udhar") || note.includes("balance"))) ||
    source.includes("opening_balance") ||
    source.includes("opening-udhar") ||
    source.includes("opening_udhar")
  );
}

function openingLedgerSignature(row: MutableRow): string | undefined {
  const customerId = getLedgerCustomerId(row);
  const amount = amountKey(readNumberFrom(row, ["amount", "creditAmount", "credit_amount", "debitAmount", "debit_amount"]));
  if (!customerId || !amount) return undefined;
  return `${customerId}|${amount}|${timeBucket(row)}`;
}

function isBillDebtLedger(row: MutableRow): boolean {
  return normaliseLedgerType(readStringFrom(row, ["type", "entryType", "entry_type"]), readStringFrom(row, ["source_type", "sourceType"])) === "BILL";
}

async function refreshCustomerBalancesFromLedger(customerIds: Set<string>): Promise<number> {
  if (customerIds.size === 0) return 0;
  const ledgerRows = filterRowsForCurrentScope(
    await dexieDB.customer_ledger.filter(rowMatchesCurrentScope).toArray().catch(() => []),
  ) as unknown as CustomerLedgerEntry[];
  const customers = filterRowsForCurrentScope(
    await dexieDB.customers.filter(rowMatchesCurrentScope).toArray().catch(() => []),
  ) as MutableRow[];
  const now = nowIso();
  let updated = 0;

  for (const customer of customers) {
    const ids = [
      readStringFrom(customer, ["id"]),
      readStringFrom(customer, ["local_id", "localId"]),
      readStringFrom(customer, ["server_id", "serverId"]),
    ].filter((id): id is string => Boolean(id));
    if (!ids.some((id) => customerIds.has(id))) continue;

    const customerLedger = dedupeLedgerEntries(
      ledgerRows.filter((row) => {
        const customerId = getLedgerCustomerId(row as unknown as MutableRow);
        return Boolean(customerId && ids.includes(customerId));
      }),
    );
    const balance = Math.max(0, calculateLedgerBalance(customerLedger));
    await dexieDB.customers.put({
      ...customer,
      type: balance > 0 ? "udhar" : typeof customer.type === "string" ? customer.type : "regular",
      udharAmount: balance,
      totalUdhar: balance,
      updatedAt: now,
      updated_at: now,
    } as never);
    updated += 1;
  }

  return updated;
}

async function repairDuplicateOpeningBalanceLedgerRows(): Promise<number> {
  await dexieDB.open();
  const rows = filterRowsForCurrentScope(
    await dexieDB.customer_ledger.filter(rowMatchesCurrentScope).toArray().catch(() => []),
  ) as MutableRow[];
  const activeRows = rows.filter((row) => !isDeleted(row));
  const billDebtSignatures = new Set(
    activeRows
      .filter((row) => !isOpeningBalanceLedger(row) && isBillDebtLedger(row))
      .map(openingLedgerSignature)
      .filter((signature): signature is string => Boolean(signature)),
  );
  const now = nowIso();
  const touchedCustomerIds = new Set<string>();
  let merged = 0;

  for (const row of activeRows) {
    if (!isOpeningBalanceLedger(row)) continue;
    const signature = openingLedgerSignature(row);
    if (!signature || !billDebtSignatures.has(signature)) continue;
    const id = readStringFrom(row, ["id"]);
    if (!id) continue;
    const customerId = getLedgerCustomerId(row);
    if (customerId) touchedCustomerIds.add(customerId);
    await dexieDB.customer_ledger.put({
      ...row,
      merged_into_id: row.merged_into_id ?? "duplicate_bill_credit",
      mergedIntoId: row.mergedIntoId ?? "duplicate_bill_credit",
      deleted_at: typeof row.deleted_at === "string" ? row.deleted_at : now,
      deletedAt: typeof row.deletedAt === "string" ? row.deletedAt : now,
      sync_status: "synced",
      isSynced: true,
      is_synced: true,
      updated_at: now,
      updatedAt: now,
      hardening_reason: "duplicate opening udhar balance merged into bill credit",
    } as never);
    merged += 1;
  }

  if (merged > 0) await refreshCustomerBalancesFromLedger(touchedCustomerIds).catch(() => 0);
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
    const billsMerged = await repairDuplicateBillEchoRows().catch(() => 0);
    const paymentsMerged = (await repairDuplicateFinancialEchoTable("payments").catch(() => 0)) +
      (await repairExactDuplicatePaymentRows().catch(() => 0));
    const ledgerMerged = (await repairDuplicateFinancialEchoTable("customer_ledger").catch(() => 0)) +
      (await repairDuplicateOpeningBalanceLedgerRows().catch(() => 0));
    const outboxResolved = await repairFinancialDuplicateOutboxFailures().catch(() => 0);
    const conflictsResolved = await repairConflictsWithoutBlockingOutbox().catch(() => 0);
    const total = billsMerged + paymentsMerged + ledgerMerged + outboxResolved + conflictsResolved;
    if (total > 0 && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("kirana:local-data-changed"));
      window.dispatchEvent(new CustomEvent("kirana:sync-queue-updated"));
    }
    return { billsMerged, paymentsMerged, ledgerMerged, outboxResolved, conflictsResolved, total };
  })();
  try {
    return await hardeningInFlight;
  } finally {
    hardeningInFlight = null;
  }
}

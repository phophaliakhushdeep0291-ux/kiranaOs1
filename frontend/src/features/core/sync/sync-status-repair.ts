import { roundMoney } from "@/lib/money";
import { dexieDB, filterRowsForCurrentScope, MAX_AUTOMATIC_RETRY_ATTEMPTS, offlineDB, rowMatchesCurrentScope, type OfflineRow, type PendingSyncEvent } from "@/lib/offline/db";
import { nowIso } from "@/lib/offline/context";
import { hardenLocalFinancialData } from "@/features/core/sync/local-data-hardening";
import { buildBackendSyncOperation } from "@/features/core/sync/sync-operation-normalizer";

export interface SyncQueueCounts {
  pending: number;
  failed: number;
  conflict: number;
  retryable: number;
  totalBlocking: number;
}

type MutableRow = Record<string, unknown>;
const STALE_SYNCING_TIMEOUT_MS = 2 * 60 * 1000;

function isRecord(value: unknown): value is MutableRow {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function readStringFrom(record: unknown, keys: string[]): string | undefined {
  if (!isRecord(record)) return undefined;
  for (const key of keys) {
    const value = readString(record[key]);
    if (value) return value;
  }
  return undefined;
}

function addString(set: Set<string>, value: unknown): void {
  const text = readString(value);
  if (text) set.add(text);
}

function isSyncedOutbox(event: PendingSyncEvent): boolean {
  return event.status === "SYNCED" || event.sync_status === "synced";
}

function isFailedOutbox(event: PendingSyncEvent): boolean {
  return event.status === "FAILED" || event.sync_status === "failed";
}

function isConflictOutbox(event: PendingSyncEvent): boolean {
  return event.status === "CONFLICT" || event.sync_status === "conflict";
}

function isPendingOutbox(event: PendingSyncEvent): boolean {
  return (
    event.status === "PENDING" ||
    event.status === "SYNCING" ||
    event.sync_status === "pending_sync" ||
    event.sync_status === "syncing"
  );
}

function isSyncingOutbox(event: PendingSyncEvent): boolean {
  return event.status === "SYNCING" || event.sync_status === "syncing";
}

function eventAttemptTime(event: PendingSyncEvent): number {
  const raw = event.last_attempt_at ?? event.client_created_at;
  if (typeof raw !== "string") return 0;
  const parsed = new Date(raw).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

async function repairStaleSyncingOutboxEvents(): Promise<number> {
  const nowMs = Date.now();
  const stale = filterRowsForCurrentScope(
    await offlineDB.getAll<PendingSyncEvent>("sync_outbox").catch(() => []),
  ).filter((event) => {
    if (!isSyncingOutbox(event)) return false;
    const attemptedAt = eventAttemptTime(event);
    return attemptedAt === 0 || nowMs - attemptedAt > STALE_SYNCING_TIMEOUT_MS;
  });
  if (stale.length === 0) return 0;

  let repaired = 0;
  await dexieDB.transaction("rw", dexieDB.sync_outbox, async () => {
    for (const event of stale) {
      await dexieDB.sync_outbox.put({
        ...event,
        status: "PENDING",
        sync_status: "pending_sync",
        error_message: null,
        last_error: null,
        next_retry_at: null,
      });
      repaired += 1;
    }
  });
  return repaired;
}

export function eventTargetsBill(event: PendingSyncEvent): boolean {
  const type = String(event.operation_type || event.type || "").toUpperCase();
  const entityType = String(event.entity_type || "").toLowerCase();
  return entityType === "bill" || type.includes("BILL");
}

export function billIdentitySet(bill: MutableRow): Set<string> {
  const ids = new Set<string>();
  [
    "id",
    "local_id",
    "localId",
    "server_id",
    "serverId",
    "merged_into_id",
    "mergedIntoId",
    "billId",
    "bill_id",
    "localBillId",
    "local_bill_id",
    "serverBillId",
    "server_bill_id",
    "clientBillId",
    "client_bill_id",
    "idempotency_key",
    "idempotencyKey",
  ].forEach((key) => addString(ids, bill[key]));
  return ids;
}

export function eventIdentitySet(event: PendingSyncEvent): Set<string> {
  const ids = new Set<string>();
  addString(ids, event.entity_id);
  addString(ids, event.clientEventId);
  addString(ids, event.op_id);
  addString(ids, event.idempotency_key);

  const payload = isRecord(event.payload) ? event.payload : {};
  [
    "id",
    "billId",
    "bill_id",
    "localBillId",
    "local_bill_id",
    "clientBillId",
    "client_bill_id",
    "serverBillId",
    "server_bill_id",
    "clientBillId",
    "client_bill_id",
    "idempotency_key",
    "idempotencyKey",
  ].forEach((key) => addString(ids, payload[key]));

  const bill = payload.bill;
  if (isRecord(bill)) {
    [
      "id",
      "billId",
      "bill_id",
      "localBillId",
      "local_bill_id",
      "clientBillId",
      "client_bill_id",
      "serverBillId",
      "server_bill_id",
      "clientBillId",
      "client_bill_id",
      "idempotency_key",
      "idempotencyKey",
    ].forEach((key) => addString(ids, bill[key]));
  }

  return ids;
}

function intersects(a: Set<string>, b: Set<string>): boolean {
  for (const value of a) if (b.has(value)) return true;
  return false;
}

export function eventMatchesBill(event: PendingSyncEvent, bill: MutableRow): boolean {
  if (!eventTargetsBill(event)) return false;
  return intersects(eventIdentitySet(event), billIdentitySet(bill));
}

export function deriveBillSyncStatus(
  bill: MutableRow,
  outboxRows: PendingSyncEvent[],
): "synced" | "pending_sync" | "syncing" | "failed" | "conflict" | string {
  const matching = filterRowsForCurrentScope(outboxRows).filter(
    (event) => !isSyncedOutbox(event) && eventMatchesBill(event, bill),
  );
  if (matching.some(isConflictOutbox)) return "conflict";
  if (matching.some(isFailedOutbox)) return "failed";
  if (matching.some((event) => event.status === "SYNCING" || event.sync_status === "syncing")) return "syncing";
  if (matching.some(isPendingOutbox)) return "pending_sync";
  return String(bill.sync_status ?? bill.status ?? "synced");
}

export function annotateBillSyncStatuses<T extends MutableRow>(
  bills: T[],
  outboxRows: PendingSyncEvent[],
): T[] {
  return bills.map((bill) => {
    const syncStatus = deriveBillSyncStatus(bill, outboxRows);
    const isSynced = syncStatus === "synced";
    return {
      ...bill,
      sync_status: syncStatus,
      isSynced,
      is_synced: isSynced,
    };
  });
}

async function findBillForEvent(event: PendingSyncEvent): Promise<MutableRow | undefined> {
  const ids = [...eventIdentitySet(event)];
  for (const id of ids) {
    const direct = await dexieDB.bills.get(id).catch(() => undefined);
    if (direct && rowMatchesCurrentScope(direct)) return direct as MutableRow;
  }
  for (const id of ids) {
    const byLocal = await dexieDB.bills.where("local_id").equals(id).first().catch(() => undefined);
    if (byLocal && rowMatchesCurrentScope(byLocal)) return byLocal as MutableRow;
    const byServer = await dexieDB.bills.where("server_id").equals(id).first().catch(() => undefined);
    if (byServer && rowMatchesCurrentScope(byServer)) return byServer as MutableRow;
  }
  return undefined;
}

async function hasBillServerProof(event: PendingSyncEvent, bill: MutableRow): Promise<boolean> {
  if (readStringFrom(bill, ["server_id", "serverId"])) return true;
  if (String(bill.sync_status ?? "") === "synced" && readStringFrom(bill, ["id"])) return true;
  const ids = [...eventIdentitySet(event), ...billIdentitySet(bill)];
  for (const id of ids) {
    const mapping = await dexieDB.id_mappings.get(id).catch(() => undefined);
    if (mapping && rowMatchesCurrentScope(mapping)) return true;
  }
  return false;
}


function failedBecauseLocalDuplicateAlreadyExists(event: PendingSyncEvent): boolean {
  const message = String(event.error_message ?? event.last_error ?? "").toLowerCase();
  return message.includes("constrainterror") || message.includes("key already exists");
}

function eventErrorMessage(event: PendingSyncEvent): string {
  return String(event.error_message ?? event.last_error ?? "").toLowerCase();
}

function operationKind(event: PendingSyncEvent): string {
  return String(event.operation_type || event.type || "").toUpperCase();
}

function payloadRecord(event: PendingSyncEvent): MutableRow {
  return isRecord(event.payload) ? event.payload : {};
}

function readNumberFrom(record: unknown, keys: string[]): number | undefined {
  if (!isRecord(record)) return undefined;
  for (const key of keys) {
    const value = Number(record[key]);
    if (Number.isFinite(value)) return value;
  }
  return undefined;
}



function positiveMoneyFrom(record: unknown, keys: string[]): boolean {
  const value = readNumberFrom(record, keys);
  return typeof value === "number" && roundMoney(value) > 0;
}

function recordHasCreditAmount(record: unknown): boolean {
  if (!isRecord(record)) return false;
  if (positiveMoneyFrom(record, ["creditAmount", "credit_amount", "udharAmount", "udhar_amount", "dueAmount", "due_amount"])) {
    return true;
  }

  const paymentGroups = [record.payments, record.creditPayments, record.credit_payments];
  return paymentGroups.some((group) => {
    if (!Array.isArray(group)) return false;
    return group.some((payment) => {
      if (!isRecord(payment)) return false;
      const mode = readStringFrom(payment, ["mode", "paymentMode", "payment_mode"])?.toLowerCase();
      return mode === "credit" && positiveMoneyFrom(payment, ["amount", "creditAmount", "credit_amount"]);
    });
  });
}

function eventHasCreditAmount(event: PendingSyncEvent): boolean {
  const payload = payloadRecord(event);
  return recordHasCreditAmount(payload) || recordHasCreditAmount(payload.bill);
}

function retryableBillPaymentValidationConflict(event: PendingSyncEvent): boolean {
  const message = eventErrorMessage(event);
  return (
    eventTargetsBill(event) &&
    operationKind(event) === "CREATE_BILL" &&
    (isConflictOutbox(event) || isFailedOutbox(event)) &&
    eventHasCreditAmount(event) &&
    message.includes("at least one") &&
    message.includes("payment")
  );
}

/**
 * Builds before the guest-line identity hardening could queue a CREATE_BILL with
 * one intact QR line and one unlinked sibling. The backend now repairs that
 * narrow legacy shape from its canonical order snapshot, so the old rejection
 * can be retried. Keep the match on the exact public refusal: other guest-order
 * mismatches are genuine owner-review cases and must not loop automatically.
 */
export function retryableGuestOrderBillValidationConflict(event: PendingSyncEvent): boolean {
  const message = eventErrorMessage(event);
  return (
    eventTargetsBill(event) &&
    operationKind(event) === "CREATE_BILL" &&
    (isConflictOutbox(event) || isFailedOutbox(event)) &&
    message.includes("include every guest order line before settling the table")
  );
}

function retryablePurchaseValidationConflict(event: PendingSyncEvent): boolean {
  const kind = operationKind(event);
  const entityType = String(event.entity_type || "").toLowerCase();
  const message = eventErrorMessage(event);
  const isPurchaseOperation =
    kind === "STOCK_PURCHASE" ||
    kind === "UPDATE_PURCHASE_BILL" ||
    kind === "DELETE_PURCHASE_BILL" ||
    entityType === "purchase_history" ||
    (entityType.includes("inventory") && message.includes("purchase"));
  if (!isPurchaseOperation || (!isConflictOutbox(event) && !isFailedOutbox(event))) return false;
  return (
    message.includes("purchaseduedate") ||
    message.includes("purchase due date") ||
    message.includes("purchasepaidamount") ||
    message.includes("partial purchase") ||
    message.includes("purchasehistoryid") ||
    message.includes("purchasebillid") ||
    message.includes("stockledgerid") ||
    message.includes("localpurchasehistoryid") ||
    message.includes("localpurchasebillid") ||
    message.includes("invalid_string") ||
    message.includes("too_small")
  );
}

function retryableLedgerAdjustmentValidationConflict(event: PendingSyncEvent): boolean {
  const kind = operationKind(event);
  const message = eventErrorMessage(event);
  const amount = readNumberFrom(payloadRecord(event), ["amount"]);
  return (
    kind === "CREATE_LEDGER_ADJUSTMENT" &&
    (isConflictOutbox(event) || isFailedOutbox(event)) &&
    typeof amount === "number" &&
    amount !== 0 &&
    (message.includes("amount") ||
      message.includes("too_small") ||
      message.includes("greater than or equal to 0"))
  );
}

/**
 * A bill cancelled/restored before it had ever reached the server carries
 * `serverBillId: null`. The server's payload schema used `.optional()`, which
 * tolerates a missing key but not an explicit null, so these were rejected with
 * INVALID_EVENT and `retryable: false` — parking a real cancellation in the
 * conflict queue forever, where no existing repair sweep could see it.
 *
 * The server now accepts a nullish id, so the event is valid as-is and only needs
 * re-queueing. Re-pushing is safe: applying a cancellation twice is idempotent
 * server-side (the status claim is conditional and the reversal is posted under a
 * fixed idempotency key), so a duplicate push cannot double-reverse a bill.
 *
 * Deliberately narrow — it matches only the serverBillId/null validation failure,
 * so a cancellation rejected for any other reason stays in the queue for review.
 */
export function retryableBillCancellationValidationConflict(event: PendingSyncEvent): boolean {
  const kind = operationKind(event);
  const originalKind = String(
    (event as unknown as MutableRow).original_operation_type ?? "",
  ).toUpperCase();
  const isCancellation =
    kind === "CANCEL_BILL" ||
    kind === "RESTORE_BILL" ||
    originalKind === "SOFT_DELETE_BILL_PENDING";
  if (!isCancellation || (!isConflictOutbox(event) && !isFailedOutbox(event))) return false;

  const message = eventErrorMessage(event);
  const mentionsServerBillId = message.includes("serverbillid");
  const mentionsNullType = message.includes("received") && message.includes("null");
  return mentionsServerBillId || (mentionsNullType && message.includes("invalid_type"));
}

/**
 * A repair sweep re-queues an event by flipping it back to PENDING. That
 * deliberately bypasses the automatic retry cap, because the sweep only fires
 * once it believes the *cause* is gone (a server fix shipped, a dependency
 * arrived) — so the attempts already burned against the old cause shouldn't
 * count against the fresh one.
 *
 * The hazard is that the sweep's belief can be wrong. If the cause is still
 * present the server rejects again, the event goes back to CONFLICT/FAILED, and
 * the next sweep re-queues it: an unbounded sweep↔push loop that pushes on every
 * sync cycle forever. A production device reached retry_count 108 this way while
 * the server-side fix was still unreleased.
 *
 * So a re-queue resets the retry budget (the cause is believed fixed) but is
 * itself bounded. After MAX_REPAIR_REQUEUES failed attempts to rescue the same
 * event, we stop and leave it for the owner to retry by hand — an honest "needs
 * attention" beats a loop that silently burns battery and data.
 */
export const MAX_REPAIR_REQUEUES = 3;

function requeuedForRetry(event: PendingSyncEvent, now: string): PendingSyncEvent | null {
  const requeues = Number(event.repair_requeues ?? 0);
  if (requeues >= MAX_REPAIR_REQUEUES) return null;
  return {
    ...event,
    status: "PENDING",
    sync_status: "pending_sync",
    error_message: null,
    last_error: null,
    next_retry_at: null,
    last_attempt_at: now,
    // The blocking cause is believed gone, so the old attempts no longer apply.
    retry_count: 0,
    attempts: 0,
    repair_requeues: requeues + 1,
  };
}

async function repairRetryableBillCancellationConflicts(): Promise<number> {
  await dexieDB.open();
  const rows = filterRowsForCurrentScope(
    await offlineDB.getAll<PendingSyncEvent>("sync_outbox").catch(() => []),
  ).filter(retryableBillCancellationValidationConflict);

  if (rows.length === 0) return 0;
  const now = nowIso();
  let repaired = 0;
  for (const event of rows) {
    const requeued = requeuedForRetry(event, now);
    if (!requeued) continue;
    const normalizedPayload = buildBackendSyncOperation(event, payloadRecord(event))?.payload ?? event.payload;
    await dexieDB.sync_outbox.put({ ...requeued, payload: normalizedPayload });
    repaired += 1;
  }
  return repaired;
}

async function repairRetryablePurchaseAndLedgerValidationConflicts(): Promise<number> {
  await dexieDB.open();
  const rows = filterRowsForCurrentScope(
    await offlineDB.getAll<PendingSyncEvent>("sync_outbox").catch(() => []),
  ).filter((event) => retryablePurchaseValidationConflict(event) || retryableLedgerAdjustmentValidationConflict(event));

  if (rows.length === 0) return 0;
  const now = nowIso();
  let repaired = 0;
  for (const event of rows) {
    const requeued = requeuedForRetry(event, now);
    if (!requeued) continue;
    const normalizedPayload = buildBackendSyncOperation(event, payloadRecord(event))?.payload ?? event.payload;
    await dexieDB.sync_outbox.put({ ...requeued, payload: normalizedPayload });
    repaired += 1;
  }
  return repaired;
}

function hasServerProof(row: MutableRow | undefined): boolean {
  if (!row) return false;
  if (readStringFrom(row, ["server_id", "serverId"])) return true;
  if (String(row.sync_status ?? "").toLowerCase() === "synced") return true;
  const id = readStringFrom(row, ["id"]);
  return Boolean(id && !id.toLowerCase().includes("pending") && !id.toLowerCase().startsWith("local_") && !id.toLowerCase().startsWith("tmp_"));
}

async function findPaymentProofForEvent(event: PendingSyncEvent): Promise<MutableRow | undefined> {
  const payload = payloadRecord(event);
  const payment = isRecord(payload.payment) ? payload.payment : payload;
  const amount = readNumberFrom(payment, ["amount", "paidAmount", "paid_amount"]);
  const mode = readStringFrom(payment, ["mode", "paymentMode", "payment_mode"])?.toLowerCase();
  const customerId = readStringFrom(payment, ["customer_id", "customerId"]) ?? readStringFrom(payload, ["customer_id", "customerId"]);
  const candidates = await dexieDB.payments.filter(rowMatchesCurrentScope).toArray().catch(() => []);
  return (candidates as unknown as MutableRow[]).find((row) => {
    if (!hasServerProof(row)) return false;
    const rowMode = readStringFrom(row, ["mode", "paymentMode", "payment_mode"])?.toLowerCase();
    const rowAmount = readNumberFrom(row, ["amount", "paidAmount", "paid_amount"]);
    const rowCustomer = readStringFrom(row, ["customer_id", "customerId"]);
    const sameMode = !mode || !rowMode || mode === rowMode;
    const sameAmount = amount === undefined || rowAmount === undefined || Math.abs(roundMoney(amount) - roundMoney(rowAmount)) < 0.005;
    const sameCustomer = !customerId || !rowCustomer || customerId === rowCustomer;
    return sameMode && sameAmount && sameCustomer;
  });
}

async function findInventoryProofForEvent(event: PendingSyncEvent): Promise<MutableRow | undefined> {
  const payload = payloadRecord(event);
  const productId = readStringFrom(payload, ["product_id", "productId"]);
  const qty = readNumberFrom(payload, ["quantity", "qty", "stockBaseQty", "stock_base_qty"]);
  const rows = await dexieDB.inventory_movements.filter(rowMatchesCurrentScope).toArray().catch(() => []);
  return (rows as unknown as MutableRow[]).find((row) => {
    if (!hasServerProof(row)) return false;
    const rowProduct = readStringFrom(row, ["product_id", "productId"]);
    const rowQty = readNumberFrom(row, ["quantity", "qty", "stockBaseQty", "stock_base_qty"]);
    const sameProduct = !productId || !rowProduct || productId === rowProduct;
    const sameQty = qty === undefined || rowQty === undefined || Math.abs(roundMoney(qty) - roundMoney(rowQty)) < 0.005;
    return sameProduct && sameQty;
  });
}

async function failedDuplicateEventAlreadyHasServerProof(event: PendingSyncEvent): Promise<boolean> {
  const kind = operationKind(event);
  if (!failedBecauseLocalDuplicateAlreadyExists(event)) return false;
  if (kind === "CREATE_BILL") {
    const bill = await findBillForEvent(event);
    return Boolean(bill && await hasBillServerProof(event, bill));
  }
  if (kind.includes("PAYMENT") || String(event.entity_type).toLowerCase() === "payment") {
    return Boolean(await findPaymentProofForEvent(event));
  }
  if (kind.includes("STOCK") || kind.includes("INVENTORY") || String(event.entity_type).toLowerCase().includes("inventory")) {
    return Boolean(await findInventoryProofForEvent(event));
  }
  return false;
}

async function repairResolvedDuplicateKeyOutboxFailures(): Promise<number> {
  await dexieDB.open();
  const rows = filterRowsForCurrentScope(
    await offlineDB.getAll<PendingSyncEvent>("sync_outbox").catch(() => []),
  ).filter((event) => !isSyncedOutbox(event) && isFailedOutbox(event) && failedBecauseLocalDuplicateAlreadyExists(event));

  if (rows.length === 0) return 0;
  const now = nowIso();
  let repaired = 0;
  for (const event of rows) {
    if (!(await failedDuplicateEventAlreadyHasServerProof(event))) continue;
    await dexieDB.sync_outbox.put({
      ...event,
      status: "SYNCED",
      sync_status: "synced",
      error_message: null,
      last_error: null,
      next_retry_at: null,
      last_attempt_at: now,
    });
    repaired += 1;
  }
  return repaired;
}

export async function repairRetryableBillValidationConflicts(): Promise<number> {
  await dexieDB.open();
  const rows = filterRowsForCurrentScope(
    await offlineDB.getAll<PendingSyncEvent>("sync_outbox").catch(() => []),
  ).filter((event) => retryableBillPaymentValidationConflict(event) || retryableGuestOrderBillValidationConflict(event));

  if (rows.length === 0) return 0;
  const now = nowIso();
  let repaired = 0;
  for (const event of rows) {
    const requeued = requeuedForRetry(event, now);
    if (!requeued) continue;
    await dexieDB.sync_outbox.put(requeued);
    repaired += 1;
  }
  return repaired;
}

function conflictIdentitySet(conflict: OfflineRow): Set<string> {
  const ids = new Set<string>();
  addString(ids, conflict.id);
  addString(ids, conflict.entity_id);
  addString(ids, conflict.sourceId);
  addString(ids, conflict.source_id);
  const local = isRecord(conflict.local_snapshot) ? conflict.local_snapshot : {};
  const server = isRecord(conflict.server_snapshot) ? conflict.server_snapshot : {};
  [local, server].forEach((row) => {
    ["id", "local_id", "localId", "server_id", "serverId", "entity_id", "entityId", "billId", "bill_id", "customerId", "customer_id", "productId", "product_id"].forEach((key) => addString(ids, row[key]));
  });
  return ids;
}

async function repairResolvedStoredConflicts(): Promise<number> {
  await dexieDB.open();
  const conflicts = filterRowsForCurrentScope(
    await offlineDB.getAll<OfflineRow>("sync_conflicts").catch(() => []),
  ).filter((row) => row.sync_status === "conflict" || row.resolution === "unresolved");
  if (conflicts.length === 0) return 0;
  const activeOutbox = filterRowsForCurrentScope(
    await offlineDB.getAll<PendingSyncEvent>("sync_outbox").catch(() => []),
  ).filter((event) => !isSyncedOutbox(event));
  const activeIds = activeOutbox.map(eventIdentitySet);
  const now = nowIso();
  let repaired = 0;
  for (const conflict of conflicts) {
    const ids = conflictIdentitySet(conflict);
    const stillBlocked = activeIds.some((outboxIds) => intersects(ids, outboxIds));
    if (stillBlocked) continue;
    await dexieDB.sync_conflicts.put({
      ...conflict,
      resolution: "auto_resolved",
      sync_status: "synced",
      resolved_at: now,
      updated_at: now,
    });
    repaired += 1;
  }
  return repaired;
}

/**
 * Drops the retry backoff on failed operations when the connection comes back.
 *
 * Backoff exists to stop a client hammering a server that is failing. It is the
 * wrong tool for a client whose *network* dropped: the schedule for a non-bill
 * operation runs 2.5s, 5, 10, 20, 40, 80 and then two minutes between attempts,
 * so a product edit made just before the wifi blinked can sit for two minutes
 * after the wifi is fine again. That is the shop watching a warning bar and
 * reaching for the Sync button — the queue is not stuck, it is serving a
 * sentence for an outage that is already over.
 *
 * Only `next_retry_at` is cleared. `retry_count` is deliberately preserved, so
 * the twelve-attempt cap still retires an operation the server genuinely refuses
 * (a validation failure, a missing owner PIN) instead of letting it loop forever
 * across a flapping connection.
 */
export async function clearRetryBackoffAfterReconnect(): Promise<number> {
  await dexieDB.open();
  const rows = filterRowsForCurrentScope(
    await offlineDB.getAll<PendingSyncEvent>("sync_outbox").catch(() => []),
  );
  const now = Date.now();
  let cleared = 0;
  for (const event of rows) {
    if (!isFailedOutbox(event)) continue;
    if ((event.retry_count ?? event.attempts ?? 0) >= MAX_AUTOMATIC_RETRY_ATTEMPTS) continue;
    const waitingUntil = event.next_retry_at ? new Date(event.next_retry_at).getTime() : 0;
    if (!Number.isFinite(waitingUntil) || waitingUntil <= now) continue;
    await dexieDB.sync_outbox.put({ ...event, next_retry_at: null });
    cleared += 1;
  }
  if (cleared > 0 && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("kirana:sync-queue-updated", {
      detail: { reason: "reconnect-backoff-cleared", cleared },
    }));
  }
  return cleared;
}

export async function repairResolvedSyncStatusNoise(): Promise<number> {
  const staleSyncingRepaired = await repairStaleSyncingOutboxEvents().catch(() => 0);
  const retryableValidationRepaired = await repairRetryableBillValidationConflicts().catch(() => 0);
  const retryablePurchaseAndLedgerRepaired = await repairRetryablePurchaseAndLedgerValidationConflicts().catch(() => 0);
  const cancellationRepaired = await repairRetryableBillCancellationConflicts().catch(() => 0);
  const financialRepaired = await hardenLocalFinancialData().then((result) => result.total).catch(() => 0);
  const billRepaired = await repairStaleSyncedBillOutboxFailures().catch(() => 0);
  const duplicateKeyRepaired = await repairResolvedDuplicateKeyOutboxFailures().catch(() => 0);
  const conflictsRepaired = await repairResolvedStoredConflicts().catch(() => 0);
  const repaired = staleSyncingRepaired + retryableValidationRepaired + retryablePurchaseAndLedgerRepaired + cancellationRepaired + financialRepaired + billRepaired + duplicateKeyRepaired + conflictsRepaired;
  if (repaired > 0 && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("kirana:sync-queue-updated"));
  }
  return repaired;
}

export async function repairStaleSyncedBillOutboxFailures(): Promise<number> {
  await dexieDB.open();
  const rows = filterRowsForCurrentScope(
    await offlineDB.getAll<PendingSyncEvent>("sync_outbox").catch(() => []),
  ).filter(
    (event) =>
      !isSyncedOutbox(event) &&
      eventTargetsBill(event) &&
      String(event.operation_type || event.type || "").toUpperCase() === "CREATE_BILL",
  );

  if (rows.length === 0) return 0;
  const now = nowIso();
  let repaired = 0;
  await dexieDB.transaction("rw", [dexieDB.sync_outbox, dexieDB.bills, dexieDB.id_mappings], async () => {
    for (const event of rows) {
      const bill = await findBillForEvent(event);
      if (!bill) continue;
      if (!(await hasBillServerProof(event, bill))) continue;
      await dexieDB.sync_outbox.put({
        ...event,
        status: "SYNCED",
        sync_status: "synced",
        error_message: null,
        last_error: null,
        next_retry_at: null,
        last_attempt_at: now,
      });
      repaired += 1;
    }
  });
  if (repaired > 0 && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("kirana:sync-queue-updated"));
  }
  return repaired;
}

export async function readSyncQueueCounts(): Promise<SyncQueueCounts> {
  await repairResolvedSyncStatusNoise().catch(() => 0);
  const outbox = filterRowsForCurrentScope(
    await offlineDB.getAll<PendingSyncEvent>("sync_outbox").catch(() => []),
  ).filter((row) => !isSyncedOutbox(row));
  const syncConflicts = await offlineDB.getAll<OfflineRow>("sync_conflicts").catch(() => []);
  const pending = outbox.filter(isPendingOutbox).length;
  const failed = outbox.filter(isFailedOutbox).length;
  const outboxConflicts = outbox.filter(isConflictOutbox).length;
  const storedConflicts = filterRowsForCurrentScope(syncConflicts).filter(
    (row) => row.sync_status === "conflict" || row.resolution === "unresolved",
  ).length;
  const conflict = outboxConflicts + storedConflicts;
  const retryable = failed + outboxConflicts;
  return {
    pending,
    failed,
    conflict,
    retryable,
    totalBlocking: pending + failed + conflict,
  };
}

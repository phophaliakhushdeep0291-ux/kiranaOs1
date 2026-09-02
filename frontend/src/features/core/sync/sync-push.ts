import {
  filterRowsForCurrentScope,
  offlineDB,
  type PendingSyncEvent,
  type SyncOutboxStatus,
} from "@/lib/offline/db";
import { dexieDB } from "@/lib/offline/db";
import { getOfflineScope } from "@/lib/offline/context";
import { emitLocalDataChanged } from "@/lib/offline/instant-cache";
import { syncPush } from "@/features/core/sync/api";
import { reconcileSyncedBillFromPush } from "@/features/core/sync/bill-reconciliation";
import { storeConflict } from "@/features/core/sync/sync-conflicts";
import {
  isTransientSyncFailure,
  transientRetryDelayMs,
} from "@/features/core/sync/sync-failure-classification";
import {
  applyIdMappingsFromResponse,
  collectUnmappedLocalIds,
  deepReplaceMappedIds,
  loadIdMap,
  markEntitySynced,
  putIdMapping,
  replaceLocalEntityId,
} from "@/features/core/sync/sync-id-mapping";
import { getStoredCursor, setStoredCursor } from "@/features/core/sync/sync-pull";
import { refreshBusinessCaches } from "@/features/core/sync/sync-reconcile";
import {
  entityTypeFromOperation,
  extractIdPair,
  tableNameForEntity,
  normalizeResultStatus,
  nextCursorFromResponse,
  resultListFromPush,
  SYNC_BATCH_SIZE,
  SYNC_BATCH_MAX_BYTES,
  type PreparedOperation,
} from "@/features/core/sync/sync-types";
import {
  buildBackendSyncOperation,
  isLocalOnlySyncEvent,
  settleLocalOnlyOutboxOperations,
} from "@/features/core/sync/sync-operation-normalizer";
import type { SyncPushOperationPayload, SyncPushEventResult } from "@/types/api";

function businessSyncStatusFromOutbox(status: SyncOutboxStatus): "syncing" | "synced" | "failed" | "conflict" | "pending_sync" {
  if (status === "SYNCING") return "syncing";
  if (status === "SYNCED") return "synced";
  if (status === "FAILED") return "failed";
  if (status === "CONFLICT") return "conflict";
  return "pending_sync";
}

async function updateBusinessRowsForOutboxStatus(
  events: PendingSyncEvent[],
  status: SyncOutboxStatus,
): Promise<void> {
  const syncStatus = businessSyncStatusFromOutbox(status);
  await dexieDB.open();
  for (const event of events) {
    const entityType = entityTypeFromOperation(event.operation_type, event.entity_type);
    const tableName = tableNameForEntity(entityType);
    if (!tableName || tableName === "settings") continue;
    const table = dexieDB.table(tableName);
    const candidate = await table.get(event.entity_id).catch(() => undefined);
    if (!candidate) continue;
    await table.put({
      ...candidate,
      sync_status: syncStatus,
      isSynced: tableName === "bills" ? syncStatus === "synced" : candidate.isSynced,
      is_synced: tableName === "bills" ? syncStatus === "synced" : candidate.is_synced,
    });
  }
}

async function updateOutboxStatus(
  events: PendingSyncEvent[],
  status: SyncOutboxStatus,
  message?: string,
  options?: { deferMs?: number },
): Promise<void> {
  await offlineDB.updatePendingEventStatus(
    events.map((event) => event.clientEventId),
    status,
    message,
    options,
  );
  if (status !== "SYNCED") await updateBusinessRowsForOutboxStatus(events, status).catch(() => undefined);
}

const utf8 = typeof TextEncoder === "undefined" ? null : new TextEncoder();

/**
 * The size this operation will actually add to the request body.
 *
 * Measured in UTF-8 bytes rather than `String.length`, which counts UTF-16
 * units. The starter catalog carries Devanagari search aliases on every row and
 * one of those characters is three bytes, so `.length` would undercount them
 * threefold and wave through a batch the 2 MB body limit then rejects.
 */
function operationByteSize(operation: SyncPushOperationPayload): number {
  let json: string;
  try {
    json = JSON.stringify(operation);
  } catch {
    // Unserializable, so unsizable. Charge it the whole budget: it travels
    // alone and the server gives the real verdict, instead of this silently
    // deciding a row can never be sent.
    return SYNC_BATCH_MAX_BYTES;
  }
  return utf8 ? utf8.encode(json).length : json.length * 3;
}

export async function preparePendingOperations(
  limit = SYNC_BATCH_SIZE,
  maxBytes = SYNC_BATCH_MAX_BYTES,
): Promise<{ prepared: PreparedOperation[]; skipped: number }> {
  await dexieDB.open();
  const idMap = await loadIdMap();
  await settleLocalOnlyOutboxOperations();
  const pending = filterRowsForCurrentScope(await offlineDB.getPendingEvents()).filter(
    (event) => !isLocalOnlySyncEvent(event),
  );
  const prepared: PreparedOperation[] = [];
  const preparedEventIds = new Set<string>();
  const preparedLocalIds = new Set<string>();

  // Dependency-aware batching: an offline bill may reference a customer/product
  // created offline in the same batch. We allow those local references only after
  // their owning create/update event is included in this push request, so the
  // Phase 30 backend can resolve localId -> serverId in one transaction.
  let madeProgress = true;
  let bytes = 0;
  let budgetSpent = false;
  while (prepared.length < limit && madeProgress && !budgetSpent) {
    madeProgress = false;

    for (const event of pending) {
      if (prepared.length >= limit) break;
      if (preparedEventIds.has(event.clientEventId)) continue;

      const entityType = entityTypeFromOperation(
        event.operation_type,
        event.entity_type,
      );
      const batchLineLocalIds = event.operation_type === "STOCK_PURCHASE_BATCH" && Array.isArray(event.payload.lines)
        ? event.payload.lines.filter(isRecord).flatMap((line) => [
          readString(line.movementId),
          readString(line.localMovementId),
          readString(line.clientMovementId),
        ]).filter((id): id is string => Boolean(id))
        : [];
      const allowedLocalIds = new Set<string>([
        event.entity_id,
        ...batchLineLocalIds,
        ...preparedLocalIds,
      ]);
      const resolvedPayload = deepReplaceMappedIds(
        event.payload,
        idMap,
      ) as Record<string, unknown>;
      const backendShape = buildBackendSyncOperation(event, resolvedPayload);
      if (!backendShape) continue;
      const unresolved = collectUnmappedLocalIds(
        backendShape.payload,
        idMap,
        allowedLocalIds,
      );
      if (unresolved.length > 0) continue;

      const operation: SyncPushOperationPayload = {
        op_id: event.op_id,
        clientEventId: event.clientEventId,
        eventId: event.clientEventId,
        idempotency_key: event.idempotency_key,
        type: backendShape.type,
        operation_type: backendShape.operation_type,
        original_operation_type: event.operation_type,
        entity_type: backendShape.entity_type || entityType,
        entity_id: idMap[event.entity_id] ?? event.entity_id,
        tenant_id: event.tenant_id,
        store_id: event.store_id,
        device_id: event.device_id,
        client_created_at: event.client_created_at,
        retry_count: event.retry_count,
        payload: backendShape.payload,
      };
      // The first operation always goes, whatever it weighs. A single row
      // larger than the entire budget must still reach the server and get a
      // real answer; refusing to batch it would wedge the queue behind it
      // forever, which is worse than one oversized request.
      const size = operationByteSize(operation);
      if (prepared.length > 0 && bytes + size > maxBytes) {
        budgetSpent = true;
        break;
      }
      bytes += size;

      prepared.push({ event, operation });
      preparedEventIds.add(event.clientEventId);
      if (event.entity_id) preparedLocalIds.add(event.entity_id);
      madeProgress = true;
    }
  }

  const skipped = pending.filter(
    (event) => !preparedEventIds.has(event.clientEventId),
  ).length;

  return { prepared, skipped };
}


function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function collectIdentityKeysFromRecord(record: unknown): string[] {
  if (!isRecord(record)) return [];
  const keys = [
    "clientEventId",
    "eventId",
    "op_id",
    "opId",
    "idempotency_key",
    "idempotencyKey",
    "entity_id",
    "entityId",
    "id",
    "local_id",
    "localId",
    "server_id",
    "serverId",
    "billId",
    "bill_id",
    "localBillId",
    "local_bill_id",
    "clientBillId",
    "client_bill_id",
    "serverBillId",
    "server_bill_id",
    "paymentId",
    "payment_id",
    "localPaymentId",
    "local_payment_id",
    "clientPaymentId",
    "client_payment_id",
    "serverPaymentId",
    "server_payment_id",
    "ledgerEntryId",
    "ledger_entry_id",
    "localLedgerEntryId",
    "local_ledger_entry_id",
    "serverLedgerEntryId",
    "server_ledger_entry_id",
    "purchaseHistoryId",
    "purchase_history_id",
    "localPurchaseHistoryId",
    "local_purchase_history_id",
    "purchaseBillId",
    "purchase_bill_id",
    "localPurchaseBillId",
    "local_purchase_bill_id",
    "stockLedgerId",
    "stock_ledger_id",
    "movementId",
    "movement_id",
    "localMovementId",
    "local_movement_id",
    "clientMovementId",
    "client_movement_id",
    "inventoryMovementId",
    "inventory_movement_id",
    "localInventoryMovementId",
    "local_inventory_movement_id",
    "customerId",
    "customer_id",
    "localCustomerId",
    "local_customer_id",
    "serverCustomerId",
    "server_customer_id",
    "productId",
    "product_id",
    "localProductId",
    "local_product_id",
    "serverProductId",
    "server_product_id",
    "expenseId",
    "expense_id",
    "localExpenseId",
    "local_expense_id",
    "batchId",
    "batch_id",
  ];
  return keys.map((key) => readString(record[key])).filter((key): key is string => Boolean(key));
}

function collectPreparedIdentityKeys(item: PreparedOperation): string[] {
  const payload = isRecord(item.event.payload) ? item.event.payload : {};
  const nestedPayment = isRecord(payload.payment) ? payload.payment : {};
  const nestedBill = isRecord(payload.bill) ? payload.bill : {};
  const keys = [
    item.event.clientEventId,
    item.event.op_id,
    item.event.idempotency_key,
    item.event.entity_id,
    ...collectIdentityKeysFromRecord(payload),
    ...collectIdentityKeysFromRecord(nestedPayment),
    ...collectIdentityKeysFromRecord(nestedBill),
  ];
  return [...new Set(keys.filter((key): key is string => typeof key === "string" && key.length > 0))];
}

function collectResultIdentityKeys(result: SyncPushEventResult): string[] {
  const resultRecord = isRecord(result.result) ? result.result : {};
  const entity = isRecord(result.entity) ? result.entity : {};
  const data = isRecord(result.data) ? result.data : {};
  const nested = [
    result,
    resultRecord,
    entity,
    data,
    isRecord(resultRecord.entity) ? resultRecord.entity : undefined,
    isRecord(resultRecord.payment) ? resultRecord.payment : undefined,
    isRecord(resultRecord.bill) ? resultRecord.bill : undefined,
    isRecord(data.payment) ? data.payment : undefined,
    isRecord(data.bill) ? data.bill : undefined,
  ];
  return [...new Set(nested.flatMap(collectIdentityKeysFromRecord))];
}

function isRejectedNegativeUdharAdjustment(
  event: PendingSyncEvent,
  result: SyncPushEventResult,
): boolean {
  if (event.operation_type !== "CREATE_LEDGER_ADJUSTMENT") return false;
  const responseText = JSON.stringify(result).toLowerCase();
  return responseText.includes("udhar_adjustment_negative_balance") ||
    (responseText.includes("udhar") && responseText.includes("negative"));
}

async function discardRejectedOptimisticAdjustment(
  event: PendingSyncEvent,
  result: SyncPushEventResult,
): Promise<void> {
  if (!isRejectedNegativeUdharAdjustment(event, result)) return;
  const row = await dexieDB.customer_ledger
    .get(event.entity_id)
    .catch(() => undefined);
  if (row && String(row.sync_status ?? "").toLowerCase() !== "synced") {
    await dexieDB.customer_ledger.delete(event.entity_id);
  }
}

async function handlePushResults(
  prepared: PreparedOperation[],
  results: SyncPushEventResult[],
): Promise<{ pushed: number; failed: number; conflicts: number }> {
  const byId = new Map<string, PreparedOperation>();
  prepared.forEach((item) => {
    collectPreparedIdentityKeys(item).forEach((key) => byId.set(key, item));
  });

  const handled = new Set<string>();
  let pushed = 0;
  let failed = 0;
  let conflicts = 0;

  for (const result of results) {
    const resultIds = collectResultIdentityKeys(result);
    const item = resultIds.map((key) => byId.get(key)).find(Boolean);
    if (!item) continue;
    handled.add(item.event.clientEventId);

    const normalized = normalizeResultStatus(result);
    const { entityType, localId, serverId, serverEntity } = extractIdPair(
      result,
      item.event,
    );

    if (normalized === "success") {
      if (item.event.operation_type === "STOCK_PURCHASE_BATCH") {
        const response = isRecord(result.result) ? result.result : result;
        const movements = Array.isArray(response.movements) ? response.movements.filter(isRecord) : [];
        const payloadLines = Array.isArray(item.event.payload.lines) ? item.event.payload.lines.filter(isRecord) : [];
        for (let index = 0; index < payloadLines.length; index += 1) {
          const line = payloadLines[index];
          const movement = movements[index] ?? {};
          const movementLocalId = readString(line.localMovementId)
            ?? readString(line.movementId)
            ?? readString(line.clientMovementId);
          const movementServerId = readString(movement.stockLedgerId)
            ?? readString(movement.movementId);
          if (!movementLocalId || !movementServerId) continue;
          await putIdMapping("inventory_movement", movementLocalId, movementServerId);
          await replaceLocalEntityId("inventory_movement", movementLocalId, movementServerId, movement);
          await markEntitySynced({ ...item.event, entity_id: movementLocalId }, movement, movementServerId);
        }
        await updateOutboxStatus([item.event], "SYNCED");
        pushed += 1;
        continue;
      }
      const reconciledBill = await reconcileSyncedBillFromPush(
        item.event,
        result,
      );
      if (!reconciledBill) {
        await putIdMapping(entityType, localId, serverId);
        await replaceLocalEntityId(entityType, localId, serverId, serverEntity);
        await markEntitySynced(item.event, serverEntity, serverId);
      }
      await updateOutboxStatus([item.event], "SYNCED");
      pushed += 1;
      continue;
    }

    if (normalized === "conflict") {
      await discardRejectedOptimisticAdjustment(item.event, result);
      await updateOutboxStatus(
        [item.event],
        "CONFLICT",
        result.error_message ?? result.error ?? "Sync conflict",
      );
      const resultEnvelope = isRecord(result.result) ? result.result : {};
      const serverConflict =
        isRecord(result.conflict)
          ? result.conflict
          : isRecord(resultEnvelope.conflict)
            ? resultEnvelope.conflict
            : null;
      const serverSnapshot = serverConflict && "server_snapshot" in serverConflict
        ? serverConflict.server_snapshot
        : serverConflict && isRecord(serverConflict.server_record)
          ? serverConflict.server_record
          : result.entity ?? resultEnvelope.entity ?? resultEnvelope.server_record ?? result.result ?? null;
      const serverConflictId =
        readString(result.conflict_id) ??
        readString(resultEnvelope.conflict_id) ??
        readString(serverConflict?.id);
      const rawServerRecordVersion = Number(serverConflict?.version);
      const rawServerVersion = serverConflict?.server_version ?? result.server_version;
      await storeConflict({
        entityType,
        entityId: localId ?? item.event.entity_id,
        sourceId: item.event.op_id,
        localSnapshot: item.event.payload,
        serverSnapshot,
        errorMessage: result.error_message ?? result.error ?? "Sync conflict",
        serverConflictId,
        serverRecordVersion: Number.isInteger(rawServerRecordVersion) ? rawServerRecordVersion : undefined,
        serverVersion: typeof rawServerVersion === "string" || typeof rawServerVersion === "number" ? rawServerVersion : null,
      });
      conflicts += 1;
      continue;
    }

    await discardRejectedOptimisticAdjustment(item.event, result);
    await updateOutboxStatus(
      [item.event],
      "FAILED",
      result.error_message ?? result.error ?? "Sync failed",
    );
    failed += 1;
  }

  const unreported = prepared
    .map((item) => item.event)
    .filter((event) => !handled.has(event.clientEventId));
  if (unreported.length > 0) {
    const idMap = await loadIdMap();
    const mapped = unreported.filter((event) => typeof idMap[event.entity_id] === "string");
    const unmapped = unreported.filter((event) => typeof idMap[event.entity_id] !== "string");

    for (const event of mapped) {
      const entityType = entityTypeFromOperation(event.operation_type, event.entity_type);
      const serverId = idMap[event.entity_id];
      await putIdMapping(entityType, event.entity_id, serverId);
      await replaceLocalEntityId(entityType, event.entity_id, serverId);
      await markEntitySynced(event, undefined, serverId);
    }
    if (mapped.length > 0) {
      await updateOutboxStatus(mapped, "SYNCED");
      pushed += mapped.length;
    }
    if (unmapped.length > 0) {
      await updateOutboxStatus(
        unmapped,
        "FAILED",
        "No sync result returned by server",
      );
      failed += unmapped.length;
    }
  }

  return { pushed, failed, conflicts };
}

/**
 * Applies a successful protected server replay to the same local rows as a
 * normal push response. The retry endpoint uses a fresh server event id, so
 * pin the response back to the original local event identity before running
 * the standard bill/id-mapping reconciliation.
 */
export async function applyRecoveredSyncEventResult(
  event: PendingSyncEvent,
  replay: SyncPushEventResult,
): Promise<boolean> {
  const result = {
    ...replay,
    op_id: event.op_id || event.clientEventId,
    clientEventId: event.clientEventId,
    eventId: event.clientEventId,
  };
  const outcome = await handlePushResults(
    [{ event, operation: {} as SyncPushOperationPayload }],
    [result],
  );
  return outcome.pushed === 1;
}

export async function pushPendingOutboxOperations(): Promise<{
  pushed: number;
  failed: number;
  conflicts: number;
  skipped: number;
}> {
  const { prepared, skipped } = await preparePendingOperations();
  if (prepared.length === 0)
    return { pushed: 0, failed: 0, conflicts: 0, skipped };

  const cursor = await getStoredCursor();
  await updateOutboxStatus(
    prepared.map((item) => item.event),
    "SYNCING",
  );

  try {
    const operations = prepared.map((item) => item.operation);
    const scope = getOfflineScope();
    const response = await syncPush({
      operations,
      events: operations,
      cursor,
      device_id: scope.device_id,
    });
    await applyIdMappingsFromResponse(response.idMappings);
    const results = resultListFromPush(response);
    const outcome = await handlePushResults(prepared, results);
    const nextCursor = nextCursorFromResponse(response);
    await setStoredCursor(nextCursor);
    await refreshBusinessCaches();
    emitLocalDataChanged({
      type: "sync",
      action: "push",
      pushed: outcome.pushed,
      failed: outcome.failed,
      conflicts: outcome.conflicts,
    });
    return { ...outcome, skipped };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Network/server error during push sync";
    const events = prepared.map((item) => item.event);

    // The whole batch failed, so nothing here was individually judged. If the
    // cause is transient — the request never got a verdict, or the server did
    // not answer properly — these operations are not suspect and must not spend
    // an attempt from the twelve that retire one for good. A shop on patchy wifi
    // was otherwise able to strand a morning of sales in about a dozen blips,
    // recoverable only from a screen nobody opens until something is wrong.
    if (isTransientSyncFailure(error)) {
      const attempt = Math.max(0, ...events.map((event) => event.retry_count ?? event.attempts ?? 0));
      await updateOutboxStatus(events, "PENDING", message, {
        deferMs: transientRetryDelayMs(attempt),
      });
      // Reported as skipped, not failed: nothing was rejected, and counting it as
      // a failure is what lights the "needs review" banner for a wifi blip.
      return { pushed: 0, failed: 0, conflicts: 0, skipped: skipped + events.length };
    }

    await updateOutboxStatus(events, "FAILED", message);
    return { pushed: 0, failed: prepared.length, conflicts: 0, skipped };
  }
}

/**
 * How many pushes one drain may make before handing back to the scheduler.
 *
 * A ceiling, not a target: at 200 operations a batch this is 8,000 rows, far
 * more than any real backlog, and it exists so that a bug which somehow reports
 * progress without shrinking the queue costs one long cycle rather than a
 * wedged tab.
 */
const MAX_DRAIN_PASSES = 40;

export interface PushOutcome {
  pushed: number;
  failed: number;
  conflicts: number;
  skipped: number;
}

/**
 * Push until the outbox is empty, rather than one batch per scheduled tick.
 *
 * The scheduler in `useOfflineStatus` fires on the cadence ladder, which starts
 * at 2.5s, and each tick sent exactly one batch. That is the right shape for a
 * till with a queued sale and the wrong one for a bulk load: loading the built-in
 * starter catalog queues 1,134 rows, so the queue drained one batch per timer
 * tick with the timer's delay as dead air in between — and stopped completely
 * whenever the shopkeeper switched tabs or the screen locked, because
 * `runScheduledTick` only runs while `visibilityState === "visible"`.
 *
 * Looping here keeps the timer for deciding *when to start* and takes it out of
 * the middle of a backlog.
 */
export async function drainPendingOutboxOperations(
  // Injectable so the stopping rules can be tested as rules, against a scripted
  // sequence of outcomes, rather than only through a mocked IndexedDB where the
  // interesting cases are hard to stage.
  pushOnce: () => Promise<PushOutcome> = pushPendingOutboxOperations,
): Promise<PushOutcome> {
  let pushed = 0;
  let failed = 0;
  let conflicts = 0;
  // Not accumulated. `skipped` is a snapshot of what could not be prepared on a
  // pass — on the first pass of a 1,134-row backlog that is everything over the
  // batch limit — so summing it would report thousands of skips for a queue that
  // drained cleanly. The last pass's figure is the one that means anything: what
  // was still unpreparable when the drain stopped.
  let skipped = 0;

  for (let pass = 0; pass < MAX_DRAIN_PASSES; pass += 1) {
    const result = await pushOnce();
    pushed += result.pushed;
    failed += result.failed;
    conflicts += result.conflicts;
    skipped = result.skipped;

    // Stop on anything that is not clean progress. A pass that pushed nothing
    // has either emptied the queue or hit something an identical next pass would
    // hit again; a transient failure already carries its own defer and a
    // rejection is already FAILED. Both belong to the scheduler, not to a loop
    // that would only retry them faster.
    if (result.pushed === 0 || result.failed > 0 || result.conflicts > 0) break;
  }

  return { pushed, failed, conflicts, skipped };
}

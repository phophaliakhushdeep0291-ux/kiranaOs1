/**
 * KiranaOS offline sync queue foundation.
 *
 * This is intentionally UI-agnostic. The current frontend can import these
 * helpers without any visual/layout change.
 */

import {
  STORE_NAMES,
  LOCAL_BILL_STATUS,
  SYNC_EVENT_TYPES,
  createPendingSyncEvent,
  cacheBill,
  getAllRecords,
  putRecord,
  deleteRecord,
  makeIsoNow,
} from './offline-db.js';

export async function saveBillOffline(bill) {
  const localBill = await cacheBill(bill, LOCAL_BILL_STATUS.PENDING_SYNC);
  const event = createPendingSyncEvent(SYNC_EVENT_TYPES.CREATE_BILL, {
    localBillId: bill.localId || bill.id || localBill,
    bill,
  });

  await putRecord(STORE_NAMES.PENDING_SYNC_QUEUE, event);
  return { localBillId: localBill, eventId: event.eventId, status: LOCAL_BILL_STATUS.PENDING_SYNC };
}

export async function enqueueSyncEvent(type, payload) {
  const event = createPendingSyncEvent(type, payload);
  await putRecord(STORE_NAMES.PENDING_SYNC_QUEUE, event);
  return event;
}

export async function getPendingSyncEvents() {
  const events = await getAllRecords(STORE_NAMES.PENDING_SYNC_QUEUE);
  return events
    .filter((event) => event.status === LOCAL_BILL_STATUS.PENDING_SYNC || event.status === LOCAL_BILL_STATUS.SYNC_FAILED)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

export async function markSyncEventSynced(eventId, serverResult = null) {
  await putRecord(STORE_NAMES.PENDING_SYNC_QUEUE, {
    eventId,
    type: serverResult?.type || 'SYNCED_EVENT',
    payload: serverResult,
    status: LOCAL_BILL_STATUS.SYNCED,
    attempts: serverResult?.attempts || 0,
    lastError: null,
    createdAt: serverResult?.createdAt || makeIsoNow(),
    updatedAt: makeIsoNow(),
  });

  // Keep queue small: successful events do not need to stay pending.
  await deleteRecord(STORE_NAMES.PENDING_SYNC_QUEUE, eventId);
}

export async function markSyncEventFailed(event, error) {
  const message = error?.message || String(error || 'Sync failed');
  await putRecord(STORE_NAMES.PENDING_SYNC_QUEUE, {
    ...event,
    status: LOCAL_BILL_STATUS.SYNC_FAILED,
    attempts: (event.attempts || 0) + 1,
    lastError: message,
    updatedAt: makeIsoNow(),
  });
}

export async function flushPendingSyncQueue({ pushUrl = '/api/sync/push', token } = {}) {
  if (!navigator.onLine) {
    return { ok: false, reason: 'offline', results: [] };
  }

  const events = await getPendingSyncEvents();
  if (events.length === 0) {
    return { ok: true, results: [] };
  }

  const response = await fetch(pushUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ events }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    for (const event of events) {
      await markSyncEventFailed(event, new Error(errorText || `HTTP ${response.status}`));
    }
    return { ok: false, reason: 'server_error', status: response.status, results: [] };
  }

  const data = await response.json();
  const results = Array.isArray(data.results) ? data.results : [];

  for (const result of results) {
    const matchingEvent = events.find((event) => event.eventId === result.eventId);
    if (!matchingEvent) continue;

    if (result.status === 'synced' || result.success === true) {
      await markSyncEventSynced(matchingEvent.eventId, result);
    } else {
      await markSyncEventFailed(matchingEvent, new Error(result.error || 'Sync failed'));
    }
  }

  return { ok: true, results };
}

export function registerOnlineSync({ tokenProvider, pushUrl = '/api/sync/push', onResult, onError } = {}) {
  const run = async () => {
    try {
      const token = typeof tokenProvider === 'function' ? await tokenProvider() : undefined;
      const result = await flushPendingSyncQueue({ pushUrl, token });
      if (typeof onResult === 'function') onResult(result);
      return result;
    } catch (error) {
      if (typeof onError === 'function') onError(error);
      return { ok: false, reason: 'exception', error };
    }
  };

  window.addEventListener('online', run);
  return () => window.removeEventListener('online', run);
}

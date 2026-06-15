export const SYNC_EVENT_TYPES = Object.freeze({
  CREATE_BILL: 'CREATE_BILL',
  CANCEL_BILL: 'CANCEL_BILL',
  RESTORE_BILL: 'RESTORE_BILL',
  CREATE_PRODUCT: 'CREATE_PRODUCT',
  UPDATE_PRODUCT: 'UPDATE_PRODUCT',
  DELETE_PRODUCT: 'DELETE_PRODUCT',
  RESTORE_PRODUCT: 'RESTORE_PRODUCT',
  ADJUST_STOCK: 'ADJUST_STOCK',
  CREATE_CUSTOMER: 'CREATE_CUSTOMER',
  UPDATE_CUSTOMER: 'UPDATE_CUSTOMER',
  UDHAR_PAYMENT: 'UDHAR_PAYMENT',
  REVERSE_UDHAR_PAYMENT: 'REVERSE_UDHAR_PAYMENT',
  CREATE_LEDGER_ADJUSTMENT: 'CREATE_LEDGER_ADJUSTMENT',
  DELETE_CUSTOMER: 'DELETE_CUSTOMER',
  RESTORE_CUSTOMER: 'RESTORE_CUSTOMER',
  STOCK_PURCHASE: 'STOCK_PURCHASE',
  STOCK_SALE: 'STOCK_SALE',
  UPDATE_PURCHASE_BILL: 'UPDATE_PURCHASE_BILL',
  DELETE_PURCHASE_BILL: 'DELETE_PURCHASE_BILL',
  CREATE_SUPPLIER: 'CREATE_SUPPLIER',
  UPDATE_SUPPLIER: 'UPDATE_SUPPLIER',
  DELETE_SUPPLIER: 'DELETE_SUPPLIER',
  RESTORE_SUPPLIER: 'RESTORE_SUPPLIER',
});

export const SYNC_EVENT_STATUSES = Object.freeze({
  PROCESSING: 'processing',
  SYNCED: 'synced',
  FAILED: 'failed',
  CONFLICT: 'conflict',
});

export const OWNER_SYNC_EVENT_TYPES = new Set([
  SYNC_EVENT_TYPES.CANCEL_BILL,
  SYNC_EVENT_TYPES.RESTORE_BILL,
  SYNC_EVENT_TYPES.DELETE_PRODUCT,
  SYNC_EVENT_TYPES.RESTORE_PRODUCT,
  SYNC_EVENT_TYPES.ADJUST_STOCK,
  SYNC_EVENT_TYPES.REVERSE_UDHAR_PAYMENT,
  SYNC_EVENT_TYPES.DELETE_CUSTOMER,
  SYNC_EVENT_TYPES.RESTORE_CUSTOMER,
  SYNC_EVENT_TYPES.DELETE_SUPPLIER,
  SYNC_EVENT_TYPES.RESTORE_SUPPLIER,
]);

export function isSupportedSyncEventType(type) {
  return Object.values(SYNC_EVENT_TYPES).includes(type);
}

export function isDuplicateSyncedEvent(existingEvent) {
  return existingEvent?.status === SYNC_EVENT_STATUSES.SYNCED;
}

export function getClientEventId(event) {
  return String(event?.clientEventId ?? event?.eventId ?? '').trim();
}

export function getEventPayload(event) {
  return event?.payload && typeof event.payload === 'object' ? event.payload : {};
}

export function getEventOwnerPin(event) {
  const payload = getEventPayload(event);
  const raw = event?.ownerPin ?? payload.ownerPin;
  return raw === undefined || raw === null ? '' : String(raw).trim();
}

export function removeSensitiveSyncFields(value) {
  if (Array.isArray(value)) {
    return value.map(removeSensitiveSyncFields);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const sanitized = {};
  for (const [key, childValue] of Object.entries(value)) {
    if (key.toLowerCase().includes('pin')) continue;
    sanitized[key] = removeSensitiveSyncFields(childValue);
  }
  return sanitized;
}

export function buildSyncResult({ eventId, clientEventId, type, status, success, result = null, error = null, code = null, serverId = null }) {
  const resolvedClientEventId = clientEventId ?? eventId;
  const resolvedServerId = serverId ?? deriveServerId(result);
  const promotedFields = promoteSyncResultFields(result);
  return {
    clientEventId: resolvedClientEventId,
    eventId: resolvedClientEventId,
    type,
    status,
    success,
    serverId: resolvedServerId,
    error: error ?? null,
    ...promotedFields,
    ...(code && { code }),
    ...(result !== null && result !== undefined && { result }),
  };
}

function deriveServerId(result) {
  if (!result || typeof result !== 'object') return null;
  return result.billId ?? result.productId ?? result.customerId ?? result.supplierId ?? result.purchaseHistoryId ?? result.stockLedgerId ?? result.ledgerEntryId ?? result.reversalLedgerEntryId ?? null;
}

function promoteSyncResultFields(result) {
  if (!result || typeof result !== 'object') return {};
  const keys = [
    'serverBillId',
    'localBillId',
    'clientBillId',
    'idempotencyKey',
    'bill',
    'billItems',
    'payments',
    'customer',
    'udharLedgerEntry',
    'stockLedgerEntries',
    'ledgerEntryId',
    'localLedgerEntryId',
    'localPaymentId',
    'amountPaid',
    'newBalance',
    'idempotentReplay',
  ];
  return Object.fromEntries(keys.filter((key) => result[key] !== undefined).map((key) => [key, result[key]]));
}

export function classifySyncError(error) {
  const message = String(error?.message ?? '');
  const messageCode = getConflictCodeFromMessage(message);
  const explicitCode = error?.code || null;

  if (explicitCode === 'SYNC_DEPENDENCY_PENDING' || explicitCode === 'SYNC_EVENT_IN_PROGRESS') {
    return {
      syncStatus: SYNC_EVENT_STATUSES.FAILED,
      resultStatus: 'failed',
      code: explicitCode,
      retryable: true,
    };
  }

  if (error?.name === 'ZodError') {
    return {
      syncStatus: SYNC_EVENT_STATUSES.CONFLICT,
      resultStatus: 'conflict',
      code: 'INVALID_EVENT',
      retryable: false,
    };
  }

  const statusCode = error?.statusCode ?? 500;

  if ([400, 404, 409].includes(statusCode)) {
    return {
      syncStatus: SYNC_EVENT_STATUSES.CONFLICT,
      resultStatus: 'conflict',
      code: explicitCode || messageCode || (statusCode === 404 ? 'NOT_FOUND' : statusCode === 409 ? 'CONFLICT' : 'INVALID_EVENT'),
      retryable: false,
    };
  }

  if (statusCode === 401 || statusCode === 403) {
    return {
      syncStatus: SYNC_EVENT_STATUSES.FAILED,
      resultStatus: 'failed',
      code: 'PERMISSION_DENIED',
      retryable: false,
    };
  }

  return {
    syncStatus: SYNC_EVENT_STATUSES.FAILED,
    resultStatus: 'failed',
    code: 'SERVER_ERROR',
    retryable: true,
  };
}


function getConflictCodeFromMessage(message) {
  const normalized = message.toLowerCase();
  if (!normalized) return null;
  if (normalized.includes('insufficient stock')) return 'STOCK_INSUFFICIENT';
  if (normalized.includes('already cancelled')) return 'BILL_ALREADY_CANCELLED';
  if (normalized.includes('already restored') || normalized.includes('not cancelled')) return 'BILL_ALREADY_RESTORED';
  if (normalized.includes('customer with this mobile already exists')) return 'CUSTOMER_MOBILE_DUPLICATE';
  if (normalized.includes('product deleted') || normalized.includes('product is deleted')) return 'PRODUCT_DELETED';
  if (normalized.includes('product not found') || normalized.includes('invalid product')) return 'INVALID_PRODUCT_ID';
  return null;
}

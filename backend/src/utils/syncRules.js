export const SYNC_EVENT_TYPES = Object.freeze({
  CREATE_BILL: 'CREATE_BILL',
  CANCEL_BILL: 'CANCEL_BILL',
  RESTORE_BILL: 'RESTORE_BILL',
  DELETE_BILL: 'DELETE_BILL',
  RESTORE_DELETED_BILL: 'RESTORE_DELETED_BILL',
  SALE_RETURN: 'SALE_RETURN',
  CREATE_PRODUCT: 'CREATE_PRODUCT',
  UPDATE_PRODUCT: 'UPDATE_PRODUCT',
  // Capture-on-first-scan. Deliberately its own event rather than an UPDATE_PRODUCT
  // carrying a barcode: this one is queued by a cashier mid-queue, so it must be able
  // to say exactly one thing, and a duplicate code has to come back as a conflict
  // naming the owning product instead of silently losing to last-write-wins.
  BIND_PRODUCT_BARCODE: 'BIND_PRODUCT_BARCODE',
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
  STOCK_PURCHASE_BATCH: 'STOCK_PURCHASE_BATCH',
  STOCK_SALE: 'STOCK_SALE',
  UPDATE_PURCHASE_BILL: 'UPDATE_PURCHASE_BILL',
  DELETE_PURCHASE_BILL: 'DELETE_PURCHASE_BILL',
  RECORD_SUPPLIER_PAYMENT: 'RECORD_SUPPLIER_PAYMENT',
  REVERSE_SUPPLIER_PAYMENT: 'REVERSE_SUPPLIER_PAYMENT',
  CREATE_SUPPLIER: 'CREATE_SUPPLIER',
  UPDATE_SUPPLIER: 'UPDATE_SUPPLIER',
  DELETE_SUPPLIER: 'DELETE_SUPPLIER',
  RESTORE_SUPPLIER: 'RESTORE_SUPPLIER',
  CREATE_EXPENSE: 'CREATE_EXPENSE',
  UPDATE_EXPENSE: 'UPDATE_EXPENSE',
  DELETE_EXPENSE: 'DELETE_EXPENSE',
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
  SYNC_EVENT_TYPES.DELETE_BILL,
  SYNC_EVENT_TYPES.RESTORE_DELETED_BILL,
  SYNC_EVENT_TYPES.SALE_RETURN,
  SYNC_EVENT_TYPES.DELETE_PRODUCT,
  SYNC_EVENT_TYPES.RESTORE_PRODUCT,
  SYNC_EVENT_TYPES.ADJUST_STOCK,
  SYNC_EVENT_TYPES.REVERSE_UDHAR_PAYMENT,
  SYNC_EVENT_TYPES.CREATE_LEDGER_ADJUSTMENT,
  SYNC_EVENT_TYPES.REVERSE_SUPPLIER_PAYMENT,
  SYNC_EVENT_TYPES.DELETE_CUSTOMER,
  SYNC_EVENT_TYPES.RESTORE_CUSTOMER,
  SYNC_EVENT_TYPES.DELETE_SUPPLIER,
  SYNC_EVENT_TYPES.RESTORE_SUPPLIER,
  SYNC_EVENT_TYPES.DELETE_EXPENSE,
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

  // Conflict and result snapshots must remain useful for owner review. Treat
  // Dates as values before walking generic objects (Date has no enumerable
  // fields and otherwise becomes `{}` in the persisted JSON snapshot).
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  // Prisma money shadows are BigInt. Conflict/result snapshots are JSON, so
  // preserve their exact decimal value as a string instead of throwing or
  // coercing a potentially unsafe integer to Number.
  if (typeof value === 'bigint') return value.toString();

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
  return result.billId ?? result.productId ?? result.customerId ?? result.supplierId ?? result.expenseId ?? result.ledgerEntryId ?? result.reversalLedgerEntryId ?? result.purchaseHistoryId ?? result.stockLedgerId ?? null;
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
    'purchaseHistoryId',
    'localPurchaseHistoryId',
    'purchaseBillId',
    'localPurchaseBillId',
    'stockLedgerId',
    'localMovementId',
    'movementId',
    'inventoryMovementId',
    'amountPaid',
    'newBalance',
    'idempotentReplay',
    'expenseId',
    'localExpenseId',
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

  if (statusCode === 401 || statusCode === 403) {
    return {
      syncStatus: SYNC_EVENT_STATUSES.FAILED,
      resultStatus: 'failed',
      code: 'PERMISSION_DENIED',
      retryable: false,
    };
  }

  // A few 4xx really are worth another attempt: the request was fine, the server
  // just wasn't ready for it yet.
  if (statusCode === 408 || statusCode === 425 || statusCode === 429) {
    return {
      syncStatus: SYNC_EVENT_STATUSES.FAILED,
      resultStatus: 'failed',
      code: 'SERVER_ERROR',
      retryable: true,
    };
  }

  // Every other 4xx is the server saying "this request is wrong and will stay
  // wrong" — retrying it unchanged can never succeed.
  //
  // This used to be an allowlist of [400, 404, 409], so the 41 different 422s the
  // app throws (and 402, 413) fell through to the SERVER_ERROR default below and
  // came back retryable. A shop with no GSTIN on its location hit
  // SELLER_GSTIN_REQUIRED (422) on every GST invoice and was told "Saving a bill
  // failed because of a temporary server problem — this will retry automatically",
  // forever, when the actual fix was to enter a GSTIN. Classify by status class so
  // a newly introduced 4xx can't silently become an infinite retry again.
  if (statusCode >= 400 && statusCode < 500) {
    return {
      syncStatus: SYNC_EVENT_STATUSES.CONFLICT,
      resultStatus: 'conflict',
      // Prefer the AppError's own code (SELLER_GSTIN_REQUIRED, OFFER_DISCOUNT_MISMATCH,
      // …) so the owner is told what to actually fix.
      code:
        explicitCode ||
        messageCode ||
        (statusCode === 404
          ? 'NOT_FOUND'
          : statusCode === 409
            ? 'CONFLICT'
            : statusCode === 402
              ? 'SUBSCRIPTION_REQUIRED'
              : statusCode === 422
                ? 'BUSINESS_RULE_FAILED'
                : 'INVALID_EVENT'),
      retryable: false,
    };
  }

  // 5xx and anything with no status at all: genuinely worth retrying.
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

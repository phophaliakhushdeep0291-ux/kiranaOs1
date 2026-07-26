import bcrypt from "bcryptjs";
import { z } from "zod";
import db from "../../db.js";
import { env } from "../../config/env.js";
import { AppError } from "../../middleware/error.js";
import { confirmBillSchema } from "../bills/bills.schema.js";
import { cancelBill, confirmBill, createSaleReturn, restoreCancelledBill } from "../bills/bills.service.js";
import { createCustomerSchema, updateCustomerSchema, udharPaymentSchema } from "../customers/customers.schema.js";
import { createCustomer, recordUdharPayment, reverseUdharPayment, softDeleteCustomer, updateCustomer } from "../customers/customers.service.js";
import { damageSchema, correctionSchema, purchaseSchema } from "../inventory/inventory.schema.js";
import { correctStock, recordDamage, recordPurchase } from "../inventory/inventory.service.js";
import { createProductSchema, updateProductSchema } from "../products/products.schema.js";
import { createProduct, restoreDeletedProduct, softDeleteProduct, updateProduct } from "../products/products.service.js";
import { createSupplierSchema, updateSupplierSchema } from "../suppliers/suppliers.schema.js";
import { createSupplier, restoreSupplier, softDeleteSupplier, updateSupplier } from "../suppliers/suppliers.service.js";
import { doesBodyTouchProtectedFields } from "../../utils/permissionRules.js";
import { createAuditLog } from "../audit/audit.service.js";
import { recordBillLoyalty, reverseBillLoyalty } from "../loyalty/loyalty.service.js";
import {
  buildSyncResult,
  classifySyncError,
  getClientEventId,
  getEventOwnerPin,
  getEventPayload,
  isDuplicateSyncedEvent,
  removeSensitiveSyncFields,
  SYNC_EVENT_STATUSES,
  SYNC_EVENT_TYPES,
} from "../../utils/syncRules.js";
import { decodeCursor, encodeCursor, PULL_DEFAULT_LIMIT, PULL_MAX_LIMIT } from "./sync.schema.js";
import { moneyAmount, quantityAmount } from "../../utils/validationSchemas.js";
import { addMoney, moneyShadows, round2, toPaise, toPaiseBigInt } from "../../utils/money.js";
import { toBaseQty } from "../../utils/units.js";
import { calculateCustomerUdharBalance, syncCustomerUdharBalance } from "../udhar/udharBalance.service.js";
import {
  decrementLocationInventory,
  resolveOperationalLocation,
} from "../stores/location-context.service.js";

const protectedProductFields = [
  "defaultPricePerRateUnit",
  "costPerRateUnit",
  "minPricePerRateUnit",
  "gstRate",
  "hsn",
];

const SYNC_CONFLICT_RETENTION_DAYS = 90;
const SYNC_CONFLICT_SNAPSHOT_MAX_CHARS = 64 * 1024;
const SYNC_DEVICE_STALE_AFTER_MS = 15 * 60 * 1000;
const SYNC_DEVICE_ONLINE_WINDOW_MS = 5 * 60 * 1000;

function syncConflictExpiry() {
  return new Date(Date.now() + SYNC_CONFLICT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

function snapshotJson(value, fallback = null) {
  if (value === undefined || value === null) return fallback;
  const sanitized = removeSensitiveSyncFields(value);
  const serialized = JSON.stringify(sanitized);
  if (serialized.length <= SYNC_CONFLICT_SNAPSHOT_MAX_CHARS) return serialized;
  return JSON.stringify({
    truncated: true,
    originalCharacters: serialized.length,
    reason: "Conflict snapshot exceeded the 64 KiB privacy and storage limit",
  });
}

function publicSyncConflict(row) {
  if (!row) return null;
  return {
    id: row.id,
    source_event_id: row.sourceEventId,
    client_conflict_id: row.clientConflictId,
    device_id: row.deviceId,
    reported_by_user_id: row.reportedByUserId,
    entity_type: row.entityType,
    entity_id: row.entityId,
    reason_code: row.reasonCode,
    message: row.message,
    status: row.status,
    local_snapshot: safeJsonParse(row.localSnapshotJson),
    server_snapshot: safeJsonParse(row.serverSnapshotJson),
    base_snapshot: safeJsonParse(row.baseSnapshotJson),
    server_version: row.serverVersion,
    resolution: row.resolution,
    merged_payload: safeJsonParse(row.mergedPayloadJson),
    resolution_note: row.resolutionNote,
    resolved_by_user_id: row.resolvedByUserId,
    resolved_by_device_id: row.resolvedByDeviceId,
    version: row.version,
    detected_at: row.detectedAt?.toISOString?.() ?? row.detectedAt,
    resolved_at: row.resolvedAt?.toISOString?.() ?? row.resolvedAt,
    expires_at: row.expiresAt?.toISOString?.() ?? row.expiresAt,
    created_at: row.createdAt?.toISOString?.() ?? row.createdAt,
    updated_at: row.updatedAt?.toISOString?.() ?? row.updatedAt,
  };
}

function conflictEntityFromEvent(event) {
  const type = String(event?.type ?? "UNKNOWN");
  const payload = getEventPayload(event);
  const nested = payload.product ?? payload.customer ?? payload.bill ?? payload.supplier ?? {};
  const entityType = type.includes("PRODUCT")
    ? "product"
    : type.includes("CUSTOMER") || type.includes("UDHAR")
      ? "customer"
      : type.includes("BILL")
        ? "bill"
        : type.includes("SUPPLIER")
          ? "supplier"
          : type.includes("STOCK") || type.includes("DAMAGE")
            ? "stock_ledger"
            : "sync_event";
  const entityId = [
    payload.productId,
    payload.localProductId,
    payload.customerId,
    payload.localCustomerId,
    payload.billId,
    payload.localBillId,
    payload.supplierId,
    payload.localSupplierId,
    nested.id,
    nested.localId,
    nested.local_id,
    getClientEventId(event),
  ].find((value) => typeof value === "string" && value.length > 0);
  return { entityType, entityId: entityId ?? "unknown" };
}

function canonicalConflictResolution(value) {
  if (value === "resolved_by_owner") return "use_server";
  if (value === "ignored_by_owner") return "dismiss";
  return value;
}

export async function reportSyncConflict(shopId, input, actor = {}) {
  const create = {
    shopId,
    clientConflictId: input.client_conflict_id,
    deviceId: actor.deviceId ?? null,
    reportedByUserId: actor.userId ?? null,
    entityType: input.entity_type,
    entityId: input.entity_id,
    reasonCode: input.reason_code,
    message: input.message,
    status: "open",
    localSnapshotJson: snapshotJson(input.local_snapshot, "{}"),
    serverSnapshotJson: snapshotJson(input.server_snapshot),
    baseSnapshotJson: snapshotJson(input.base_snapshot),
    serverVersion: input.server_version == null ? null : String(input.server_version),
    expiresAt: syncConflictExpiry(),
  };
  const row = await db.syncConflict.upsert({
    where: {
      shopId_clientConflictId: {
        shopId,
        clientConflictId: input.client_conflict_id,
      },
    },
    create,
    update: {
      deviceId: create.deviceId,
      reportedByUserId: create.reportedByUserId,
      reasonCode: create.reasonCode,
      message: create.message,
      localSnapshotJson: create.localSnapshotJson,
      serverSnapshotJson: create.serverSnapshotJson,
      baseSnapshotJson: create.baseSnapshotJson,
      serverVersion: create.serverVersion,
      expiresAt: create.expiresAt,
    },
  });
  return publicSyncConflict(row);
}

export async function listSyncConflicts(shopId, options = {}) {
  const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 100);
  const decoded = decodeCursor(options.cursor);
  const where = {
    shopId,
    ...(options.status && options.status !== "all" ? { status: options.status } : {}),
    ...(options.entity_type ? { entityType: options.entity_type } : {}),
    ...(decoded
      ? {
          OR: [
            { createdAt: { lt: decoded.date } },
            { createdAt: decoded.date, id: { lt: decoded.id } },
          ],
        }
      : {}),
  };
  const [rows, open, resolved, dismissed] = await Promise.all([
    db.syncConflict.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    }),
    db.syncConflict.count({ where: { shopId, status: "open" } }),
    db.syncConflict.count({ where: { shopId, status: "resolved" } }),
    db.syncConflict.count({ where: { shopId, status: "dismissed" } }),
  ]);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    conflicts: page.map(publicSyncConflict),
    summary: { open, resolved, dismissed },
    pagination: {
      hasMore,
      nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
      limit,
    },
  };
}

export async function resolveSyncConflict(shopId, input, actor = {}) {
  const existing = await db.syncConflict.findFirst({
    where: {
      shopId,
      OR: [
        { id: input.conflict_id },
        { clientConflictId: input.conflict_id },
      ],
    },
  });
  if (!existing) throw new AppError("Sync conflict not found", 404, "SYNC_CONFLICT_NOT_FOUND");

  const resolution = canonicalConflictResolution(input.resolution);
  const targetStatus = resolution === "dismiss" ? "dismissed" : "resolved";
  if (existing.status !== "open") {
    if (existing.status === targetStatus && existing.resolution === resolution) {
      return publicSyncConflict(existing);
    }
    throw new AppError("Sync conflict was already resolved by another device", 409, "SYNC_CONFLICT_ALREADY_RESOLVED");
  }

  const expectedVersion = input.expected_version ?? existing.version;
  const resolvedAt = new Date();
  const changed = await db.syncConflict.updateMany({
    where: {
      id: existing.id,
      shopId,
      status: "open",
      version: expectedVersion,
    },
    data: {
      status: targetStatus,
      resolution,
      mergedPayloadJson: snapshotJson(input.merged_payload),
      resolutionNote: input.note ?? null,
      resolvedByUserId: actor.userId ?? null,
      resolvedByDeviceId: actor.deviceId ?? null,
      resolvedAt,
      version: { increment: 1 },
      expiresAt: syncConflictExpiry(),
    },
  });
  if (changed.count !== 1) {
    throw new AppError("Sync conflict changed on another device; refresh before resolving", 409, "SYNC_CONFLICT_VERSION_MISMATCH");
  }
  const updated = await db.syncConflict.findUnique({ where: { id: existing.id } });
  await createAuditLog({
    shopId,
    userId: actor.userId ?? null,
    action: "SYNC_CONFLICT_RESOLVED",
    entityType: "SyncConflict",
    entityId: existing.id,
    before: { status: existing.status, version: existing.version },
    after: { status: updated.status, resolution: updated.resolution, version: updated.version },
    metadata: {
      deviceId: actor.deviceId ?? null,
      entityType: existing.entityType,
      entityId: existing.entityId,
      reasonCode: existing.reasonCode,
    },
  });
  return publicSyncConflict(updated);
}

async function recordSyncEventConflict(shopId, event, classified, error, user) {
  const eventId = getClientEventId(event);
  const entity = conflictEntityFromEvent(event);
  const message = error?.message || "Sync event conflict";
  const row = await db.syncConflict.upsert({
    where: { shopId_sourceEventId: { shopId, sourceEventId: eventId } },
    create: {
      shopId,
      sourceEventId: eventId,
      deviceId: user?.deviceId ?? null,
      reportedByUserId: user?.userId ?? null,
      entityType: entity.entityType,
      entityId: entity.entityId,
      reasonCode: classified.code,
      message,
      localSnapshotJson: snapshotJson(event, "{}"),
      serverSnapshotJson: snapshotJson(error?.serverSnapshot ?? error?.server_record),
      serverVersion: await getCurrentServerSeq(shopId),
      expiresAt: syncConflictExpiry(),
    },
    update: {
      reasonCode: classified.code,
      message,
      localSnapshotJson: snapshotJson(event, "{}"),
      serverSnapshotJson: snapshotJson(error?.serverSnapshot ?? error?.server_record),
      serverVersion: await getCurrentServerSeq(shopId),
      expiresAt: syncConflictExpiry(),
    },
  });
  return publicSyncConflict(row);
}

const cancelPayloadSchema = z.object({
  billId: z.string().min(1).optional(),
  serverBillId: z.string().min(1).optional(),
  reason: z.string().min(3).default("Offline cancellation sync"),
}).passthrough();


const restoreBillPayloadSchema = z.object({
  billId: z.string().min(1).optional(),
  serverBillId: z.string().min(1).optional(),
  reason: z.string().min(3).default("Offline restore sync"),
}).passthrough();

const createProductPayloadSchema = z.object({
  product: createProductSchema.optional(),
}).passthrough();

const productIdPayloadSchema = z.object({
  productId: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
  reason: z.string().optional(),
}).passthrough();

const updateProductPayloadSchema = z.object({
  productId: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
  changes: updateProductSchema.optional(),
}).passthrough();

const adjustStockPayloadSchema = z.object({
  adjustmentType: z.enum(["correction", "damage"]).default("correction"),
  productId: z.string().min(1),
  newStockBaseQty: quantityAmount().optional(),
  quantity: quantityAmount({ positive: true }).optional(),
  enteredUnit: z.string().optional(),
  note: z.string().optional(),
}).passthrough();

const udharPaymentPayloadSchema = z.object({
  customerId: z.string().min(1),
  amount: moneyAmount({ positive: true }).optional(),
  mode: z.enum(["cash", "upi", "bank"]).optional(),
  note: z.string().optional(),
  payment: udharPaymentSchema.optional(),
}).passthrough();

const ledgerAdjustmentPayloadSchema = z.object({
  ledgerEntryId: z.string().min(1).optional(),
  customerId: z.string().min(1),
  amount: moneyAmount({ min: -100_000_000 }),
  note: z.string().optional(),
}).passthrough();

const reverseUdharPaymentPayloadSchema = z.object({
  ledgerEntryId: z.string().min(1).optional(),
  serverLedgerEntryId: z.string().min(1).optional(),
  customerId: z.string().min(1),
  reason: z.string().min(3).default("Offline udhar payment reversal sync"),
}).passthrough();

const customerLifecyclePayloadSchema = z.object({
  customerId: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
  reason: z.string().optional(),
}).passthrough();

const createSupplierPayloadSchema = z.object({
  supplier: createSupplierSchema.optional(),
}).passthrough();

const updateSupplierPayloadSchema = z.object({
  supplierId: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
  changes: updateSupplierSchema.optional(),
}).passthrough();

const supplierLifecyclePayloadSchema = z.object({
  supplierId: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
  reason: z.string().optional(),
}).passthrough();

const stockPurchasePayloadSchema = purchaseSchema;

const stockSalePayloadSchema = z.object({
  productId: z.string().min(1),
  quantity: quantityAmount({ positive: true }),
  enteredUnit: z.string().min(1),
  note: z.string().optional(),
  allowNegativeStock: z.boolean().optional(),
  allowStockShortfall: z.boolean().optional(),
  negativeStockAllowed: z.boolean().optional(),
}).passthrough();

const purchaseBillLifecyclePayloadSchema = z.object({
  purchaseHistoryId: z.string().min(1).optional().nullable(),
  purchaseBillId: z.string().min(1).optional().nullable(),
  stockLedgerId: z.string().min(1).optional().nullable(),
  movementId: z.string().min(1).optional().nullable(),
  inventoryMovementId: z.string().min(1).optional().nullable(),
  localPurchaseHistoryId: z.string().min(1).optional().nullable(),
  localMovementId: z.string().min(1).optional().nullable(),
  productId: z.string().min(1).optional().nullable(),
  supplierId: z.string().min(1).optional().nullable(),
  supplierName: z.string().optional().nullable(),
  invoiceNumber: z.string().optional().nullable(),
  billAmount: moneyAmount().optional(),
  purchasePaidAmount: moneyAmount().optional(),
  purchaseDueAmount: moneyAmount().optional(),
  purchasePaymentStatus: z.string().optional(),
  purchasePaymentMode: z.string().optional().nullable(),
  match: z.record(z.any()).optional(),
}).passthrough();

const supplierPaymentPayloadSchema = z.object({
  purchaseHistoryId: z.string().min(1).optional().nullable(),
  purchaseBillId: z.string().min(1).optional().nullable(),
  localPurchaseHistoryId: z.string().min(1).optional().nullable(),
  paymentId: z.string().min(1),
  amount: moneyAmount({ positive: true }),
  mode: z.enum(["cash", "upi", "bank", "card"]).default("cash"),
  reference: z.string().max(120).optional().nullable(),
  paidAt: z.string().datetime().optional(),
  match: z.record(z.any()).optional(),
}).passthrough();

const reverseSupplierPaymentPayloadSchema = z.object({
  paymentId: z.string().min(1),
  reason: z.string().trim().min(3).max(240),
}).passthrough();


const updateCustomerPayloadSchema = z.object({
  customerId: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
  changes: updateCustomerSchema.optional(),
}).passthrough();

const SYNC_ENTITY_TYPES = Object.freeze({
  PRODUCT: "product",
  CUSTOMER: "customer",
  BILL: "bill",
  SUPPLIER: "supplier",
  LEDGER_ENTRY: "ledger_entry",
  PURCHASE_HISTORY: "purchase_history",
  STOCK_LEDGER: "inventory_movement",
});

const SYNC_PROCESSING_STALE_MS = 2 * 60 * 1000;

/**
 * Pull all data changed on or after `since`, with optional cursor-keyset pagination.
 *
 * Pagination design:
 *   - Each entity is independently limited to `limit` rows (default 500, max 1000).
 *   - Records are ordered by (updatedAt ASC, id ASC) — deterministic, no skips.
 *   - Keyset clause: (updatedAt > cursorDate) OR (updatedAt = cursorDate AND id > cursorId)
 *   - `hasMore` is true if ANY entity returned exactly `limit` rows (may have more pages).
 *   - `nextCursor` is the updatedAt|id of the last record returned across all entities.
 *   - The `sync` metadata object is a NEW top-level field in data; all existing fields
 *     (products, customers, bills, stockLedger, udharLedger, syncedAt) are unchanged.
 *
 * StockLedger: previously filtered by createdAt. Changed to updatedAt for consistency.
 *   StockLedger is append-only, so updatedAt == createdAt on all existing rows —
 *   this change is safe and produces identical results for current data.
 *
 * Soft-deleted products/customers are included when their updatedAt >= since,
 * so the frontend can remove/mark them locally.
 *
 * Tenant isolation: every query is scoped by shopId from the JWT.
 */
/**
 * Bills carry their durable client identity — clientBillId, idempotencyKey,
 * sourceDeviceId — as real columns, persisted by confirmBill. pullSince returns
 * those columns directly on EVERY bill (Prisma findMany with no `select` includes
 * them), so the client can always collapse a pending local bill into its synced
 * server twin by clientBillId, with no dependence on any recent-events window.
 *
 * This fallback exists ONLY for legacy rows whose clientBillId column is still
 * null (created before the durable-identity migration). For those — and only
 * those — it reconstructs the identity from the original CREATE_BILL sync event.
 * Bills that already have the column are returned untouched and never re-query
 * the event log. Capped at a recent window because null-id rows are old and rare;
 * any that fall outside it are still covered by the client's content/time
 * heuristic. Never clobbers a real column value.
 */
async function backfillLegacyBillIdentity(shopId, bills) {
  const legacy = bills.filter((bill) => !bill.clientBillId && !bill.idempotencyKey);
  if (legacy.length === 0) return bills; // common path: every bill already carries the columns
  const events = await db.offlineSyncEvent.findMany({
    where: { shopId, type: SYNC_EVENT_TYPES.CREATE_BILL, status: SYNC_EVENT_STATUSES.SYNCED },
    orderBy: { updatedAt: "desc" },
    take: 500,
    select: { resultJson: true, requestJson: true },
  });
  const identityByBillId = new Map();
  for (const event of events) {
    const result = safeJsonParse(event.resultJson);
    const request = safeJsonParse(event.requestJson);
    const billId = result?.billId ?? result?.serverBillId ?? result?.bill?.id;
    if (!billId || identityByBillId.has(billId)) continue;
    const clientBillId = result?.clientBillId ?? result?.client_bill_id
      ?? request?.payload?.clientBillId ?? request?.payload?.localBillId
      ?? request?.payload?.local_bill_id ?? null;
    const idempotencyKey = result?.idempotencyKey ?? result?.idempotency_key
      ?? request?.payload?.idempotencyKey ?? request?.payload?.idempotency_key ?? null;
    const sourceDeviceId = result?.sourceDeviceId ?? request?.payload?.sourceDeviceId ?? null;
    if (clientBillId || idempotencyKey) {
      identityByBillId.set(billId, { clientBillId, idempotencyKey, sourceDeviceId });
    }
  }
  if (identityByBillId.size === 0) return bills;
  return bills.map((bill) => {
    if (bill.clientBillId || bill.idempotencyKey) return bill; // never overwrite a real column
    const identity = identityByBillId.get(bill.id);
    if (!identity) return bill;
    return {
      ...bill,
      clientBillId: identity.clientBillId ?? bill.clientBillId ?? null,
      idempotencyKey: identity.idempotencyKey ?? bill.idempotencyKey ?? null,
      sourceDeviceId: bill.sourceDeviceId ?? identity.sourceDeviceId ?? null,
    };
  });
}

export async function pullSince(shopId, since, { cursor, limit, cursors, role, afterSeq } = {}) {
  if (afterSeq !== undefined) return pullBySequence(shopId, afterSeq, { limit, role });
  const sinceDate = new Date(since);
  limit = Math.min(
    typeof limit === "number" ? limit : PULL_DEFAULT_LIMIT,
    PULL_MAX_LIMIT
  );

  // Kept explicit for the legacy static/runtime contract: old clients pass a single cursor.
  const legacyCursorParsed = decodeCursor(cursor);
  const entityCursorMap = buildEntityCursorMap({ legacyCursor: legacyCursorParsed ? cursor : null, cursors });

  function buildWhere(entityName, extraWhere = {}) {
    const base = { shopId, updatedAt: { gte: sinceDate }, ...extraWhere };
    const cursorParsed = decodeCursor(entityCursorMap[entityName]);
    if (!cursorParsed) return base;
    return {
      ...base,
      OR: [
        { updatedAt: { gt: cursorParsed.date } },
        { updatedAt: cursorParsed.date, id: { gt: cursorParsed.id } },
      ],
    };
  }

  const orderBy = [{ updatedAt: "asc" }, { id: "asc" }];

  const [products, customers, rawBills, stockLedger, udharLedger, suppliers, purchaseHistory] = await Promise.all([
    db.product.findMany({
      where: buildWhere("products"),
      include: { sellingUnits: { orderBy: [{ isDefault: "desc" }, { name: "asc" }] } },
      orderBy,
      take: limit,
    }),
    db.customer.findMany({ where: buildWhere("customers"), orderBy, take: limit }),
    db.bill.findMany({ where: buildWhere("bills"), include: { items: true, payments: true }, orderBy, take: limit }),
    db.stockLedger.findMany({ where: buildWhere("stockLedger"), orderBy, take: limit }),
    db.udharLedger.findMany({ where: buildWhere("udharLedger"), orderBy, take: limit }),
    db.supplier.findMany({ where: buildWhere("suppliers"), orderBy, take: limit }),
    db.purchaseHistory.findMany({ where: buildWhere("purchaseHistory"), orderBy, take: limit }),
  ]);
  const bills = await backfillLegacyBillIdentity(shopId, rawBills);

  const entitySets = { products, customers, bills, stockLedger, udharLedger, suppliers, purchaseHistory };
  const hasMoreByEntity = Object.fromEntries(
    Object.entries(entitySets).map(([entity, rows]) => [entity, rows.length === limit])
  );
  const hasMore = Object.values(hasMoreByEntity).some(Boolean);

  // Production-safe pagination: every entity advances independently. This prevents
  // a large customers page, for example, from being skipped when products/bills
  // advance a shared cursor. Empty entity pages keep their prior cursor.
  const entityCursors = Object.fromEntries(
    Object.entries(entitySets).map(([entity, rows]) => [
      entity,
      rows.length ? encodeCursor(rows[rows.length - 1].updatedAt, rows[rows.length - 1].id) : (entityCursorMap[entity] ?? null),
    ])
  );

  const lastRecord = findLastRecord(Object.values(entitySets));
  const nextCursor = lastRecord ? encodeCursor(lastRecord.updatedAt, lastRecord.id) : null;
  const returnedCount = Object.values(entitySets).reduce((sum, rows) => sum + rows.length, 0);

  // Role-aware redaction: a cashier/staff device must not receive cost or profit data (it
  // lives in inspectable IndexedDB even when the UI hides it). Cursors already advanced off
  // the real rows above, so the device keeps syncing; it just never accumulates margins,
  // supplier records, or purchase-cost history. The server stays authoritative on profit.
  const privileged = role === "owner" || role === "admin";

  return {
    syncedAt: new Date().toISOString(),
    products: privileged ? products : products.map(redactProductCostForCashier),
    customers,
    bills: privileged ? bills : bills.map(redactBillProfitForCashier),
    stockLedger,
    udharLedger,
    suppliers: privileged ? suppliers : [],
    purchaseHistory: privileged ? purchaseHistory : [],
    sync: {
      hasMore,
      hasMoreByEntity,
      nextCursor, // legacy single cursor for old clients; new clients should use entityCursors.
      entityCursors,
      serverTime: new Date().toISOString(),
      limit,
      returnedCount,
    },
  };
}

const CASHIER_HIDDEN_PRODUCT_FIELDS = ["costPerRateUnit", "costPerRateUnitPaise"];
const CASHIER_HIDDEN_SELLING_UNIT_FIELDS = ["costPrice", "costPricePaise"];
const CASHIER_HIDDEN_BILL_FIELDS = ["grossProfit", "grossProfitPaise"];
const CASHIER_HIDDEN_BILL_ITEM_FIELDS = [
  "costPerRateUnit", "costPerRateUnitPaise",
  "lineCost", "lineCostPaise",
  "lineProfit", "lineProfitPaise",
];

function omitFields(row, fields) {
  if (!row || typeof row !== "object") return row;
  const clone = { ...row };
  for (const field of fields) delete clone[field];
  return clone;
}

function redactProductCostForCashier(product) {
  const redacted = omitFields(product, CASHIER_HIDDEN_PRODUCT_FIELDS);
  if (Array.isArray(redacted.sellingUnits)) {
    redacted.sellingUnits = redacted.sellingUnits.map((unit) => omitFields(unit, CASHIER_HIDDEN_SELLING_UNIT_FIELDS));
  }
  return redacted;
}

export async function getCurrentServerSeq(shopId) {
  const aggregate = await db.changeLog.aggregate({ where: { shopId }, _max: { seq: true } });
  return String(aggregate._max.seq ?? 0n);
}

function databaseSequence(value) {
  if (!/^\d+$/.test(String(value))) {
    throw new AppError("Server sequence must be a non-negative integer", 400, "SYNC_ACK_INVALID");
  }
  if (!env.DATABASE_URL.startsWith("file:")) return BigInt(value);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new AppError("Server sequence exceeds the supported local range", 400, "SYNC_ACK_INVALID");
  }
  return parsed;
}

export async function acknowledgeDeviceSequence(shopId, deviceId, serverSeq) {
  if (!deviceId) throw new AppError("Device id required", 400, "DEVICE_REQUIRED");
  const acknowledged = databaseSequence(serverSeq);
  const currentServerSeq = databaseSequence(await getCurrentServerSeq(shopId));
  if (acknowledged > currentServerSeq) {
    throw new AppError(
      "Cannot acknowledge a sequence that the server has not issued",
      409,
      "SYNC_ACK_AHEAD_OF_SERVER"
    );
  }

  const now = new Date();
  const updated = await db.device.updateMany({
    where: {
      shopId,
      deviceId,
      status: "active",
      OR: [
        { lastAppliedServerSeq: null },
        { lastAppliedServerSeq: { lte: acknowledged } },
      ],
    },
    data: {
      lastAppliedServerSeq: acknowledged,
      lastSyncAckAt: now,
      lastSyncAt: now,
      lastSeenAt: now,
      lastActiveAt: now,
    },
  });

  const device = await db.device.findUnique({
    where: { shopId_deviceId: { shopId, deviceId } },
    select: {
      deviceId: true,
      status: true,
      lastAppliedServerSeq: true,
      lastSyncAckAt: true,
    },
  });
  if (!device || device.status !== "active") {
    throw new AppError("Active device not found", 404, "DEVICE_NOT_FOUND");
  }

  const applied = BigInt(device.lastAppliedServerSeq ?? 0);
  const current = BigInt(currentServerSeq);
  return {
    device_id: device.deviceId,
    accepted: updated.count === 1,
    stale_ack_ignored: updated.count === 0,
    applied_server_seq: String(applied),
    server_seq: String(current),
    lag: String(current > applied ? current - applied : 0n),
    acknowledged_at: device.lastSyncAckAt?.toISOString() ?? null,
  };
}

export async function getDeviceSyncFleet(shopId) {
  const serverSeq = BigInt(await getCurrentServerSeq(shopId));
  const now = Date.now();
  const devices = await db.device.findMany({
    where: { shopId, status: "active" },
    orderBy: [{ lastSeenAt: "desc" }, { createdAt: "asc" }],
    select: {
      deviceId: true,
      deviceName: true,
      platform: true,
      appVersion: true,
      lastSeenAt: true,
      lastSyncAt: true,
      lastSyncAckAt: true,
      lastAppliedServerSeq: true,
    },
  });

  const rows = devices.map((device) => {
    const applied = BigInt(device.lastAppliedServerSeq ?? 0);
    const lag = serverSeq > applied ? serverSeq - applied : 0n;
    const ackAgeMs = device.lastSyncAckAt ? Math.max(0, now - device.lastSyncAckAt.getTime()) : null;
    const seenAgeMs = device.lastSeenAt ? Math.max(0, now - device.lastSeenAt.getTime()) : null;
    const state = device.lastAppliedServerSeq === null
      ? "never_acknowledged"
      : lag === 0n
        ? "current"
        : ackAgeMs !== null && ackAgeMs > SYNC_DEVICE_STALE_AFTER_MS
          ? "stale"
          : "behind";
    return {
      device_id: device.deviceId,
      device_name: device.deviceName,
      platform: device.platform,
      app_version: device.appVersion,
      state,
      online: seenAgeMs !== null && seenAgeMs <= SYNC_DEVICE_ONLINE_WINDOW_MS,
      applied_server_seq: String(applied),
      server_seq: String(serverSeq),
      lag: String(lag),
      last_seen_at: device.lastSeenAt?.toISOString() ?? null,
      last_sync_at: device.lastSyncAt?.toISOString() ?? null,
      acknowledged_at: device.lastSyncAckAt?.toISOString() ?? null,
    };
  });

  const count = (state) => rows.filter((row) => row.state === state).length;
  const summary = {
    total: rows.length,
    current: count("current"),
    behind: count("behind"),
    stale: count("stale"),
    never_acknowledged: count("never_acknowledged"),
  };
  return {
    server_seq: String(serverSeq),
    generated_at: new Date(now).toISOString(),
    stale_after_seconds: SYNC_DEVICE_STALE_AFTER_MS / 1000,
    summary: { ...summary, attention: summary.behind + summary.stale + summary.never_acknowledged },
    devices: rows,
  };
}

async function pullBySequence(shopId, afterSeq, { limit, role } = {}) {
  const cursor = env.DATABASE_URL.startsWith("file:") ? Number(afterSeq || 0) : BigInt(afterSeq || "0");
  const pageLimit = Math.min(typeof limit === "number" ? limit : PULL_DEFAULT_LIMIT, PULL_MAX_LIMIT);
  const logs = await db.changeLog.findMany({
    where: { shopId, seq: { gt: cursor } },
    orderBy: { seq: "asc" },
    take: pageLimit + 1,
  });
  const page = logs.slice(0, pageLimit);
  const hasMore = logs.length > pageLimit;
  const privileged = role === "owner" || role === "admin";
  const rowsByIdentity = await loadSequenceEntities(shopId, page);
  const changes = [];
  for (const log of page) {
    if (!privileged && (log.entityType === "supplier" || log.entityType === "purchase_history")) continue;
    let entity = rowsByIdentity.get(`${log.entityType}:${log.entityId}`) ?? null;
    if (entity && !privileged && log.entityType === "product") entity = redactProductCostForCashier(entity);
    if (entity && !privileged && log.entityType === "bill") entity = redactBillProfitForCashier(entity);
    const deleted = log.operation === "delete" || !entity;
    changes.push({
      change_id: String(log.seq),
      entity_type: log.entityType,
      entity_id: log.entityId,
      operation_type: deleted ? "delete" : log.operation,
      entity,
      server_version: String(log.seq),
      deleted_at: deleted ? log.createdAt.toISOString() : null,
    });
  }
  const nextServerSeq = String(page.length ? page[page.length - 1].seq : cursor);
  const currentServerSeq = await getCurrentServerSeq(shopId);
  return {
    syncedAt: new Date().toISOString(),
    changes,
    sync: {
      protocol: "server_sequence_v2",
      hasMore,
      nextCursor: nextServerSeq,
      nextServerSeq,
      serverVersion: currentServerSeq,
      serverTime: new Date().toISOString(),
      limit: pageLimit,
      returnedCount: changes.length,
      scannedCount: page.length,
    },
  };
}

async function loadSequenceEntities(shopId, logs) {
  const ids = (type) => [...new Set(logs.filter((log) => log.entityType === type && log.operation !== "delete").map((log) => log.entityId))];
  const [products, customers, rawBills, stockLedger, udharLedger, suppliers, purchaseHistory] = await Promise.all([
    db.product.findMany({ where: { shopId, id: { in: ids("product") } }, include: { sellingUnits: { orderBy: [{ isDefault: "desc" }, { name: "asc" }] } } }),
    db.customer.findMany({ where: { shopId, id: { in: ids("customer") } } }),
    db.bill.findMany({ where: { shopId, id: { in: ids("bill") } }, include: { items: true, payments: true } }),
    db.stockLedger.findMany({ where: { shopId, id: { in: ids("stock_ledger") } } }),
    db.udharLedger.findMany({ where: { shopId, id: { in: ids("udhar_ledger") } } }),
    db.supplier.findMany({ where: { shopId, id: { in: ids("supplier") } } }),
    db.purchaseHistory.findMany({ where: { shopId, id: { in: ids("purchase_history") } } }),
  ]);
  const bills = await backfillLegacyBillIdentity(shopId, rawBills);
  const map = new Map();
  for (const [type, rows] of Object.entries({ product: products, customer: customers, bill: bills, stock_ledger: stockLedger, udhar_ledger: udharLedger, supplier: suppliers, purchase_history: purchaseHistory })) {
    for (const row of rows) map.set(`${type}:${row.id}`, row);
  }
  return map;
}

function redactBillProfitForCashier(bill) {
  // Only profit/cost fields are stripped. The durable client identity
  // (clientBillId, idempotencyKey, sourceDeviceId) is NOT cost data and MUST
  // survive — the cashier device relies on it to collapse its pending local
  // bill into this synced twin instead of double-counting it on the dashboard.
  const redacted = omitFields(bill, CASHIER_HIDDEN_BILL_FIELDS);
  if (Array.isArray(redacted.items)) {
    redacted.items = redacted.items.map((item) => omitFields(item, CASHIER_HIDDEN_BILL_ITEM_FIELDS));
  }
  return redacted;
}

function buildEntityCursorMap({ legacyCursor = null, cursors = null } = {}) {
  const entities = ["products", "customers", "bills", "stockLedger", "udharLedger", "suppliers", "purchaseHistory"];
  const map = Object.fromEntries(entities.map((entity) => [entity, legacyCursor || null]));
  if (!cursors) return map;
  const parsed = typeof cursors === "string" ? safeJsonParse(cursors) : cursors;
  if (!parsed || typeof parsed !== "object") return map;
  for (const entity of entities) {
    if (Object.prototype.hasOwnProperty.call(parsed, entity) && parsed[entity] === null) {
      map[entity] = null;
    } else if (typeof parsed[entity] === "string" && decodeCursor(parsed[entity])) {
      map[entity] = parsed[entity];
    }
  }
  return map;
}

function findLastRecord(entityArrays) {
  let last = null;
  for (const arr of entityArrays) {
    if (arr.length === 0) continue;
    const candidate = arr[arr.length - 1];
    if (!last) { last = candidate; continue; }
    const lastTs = last.updatedAt instanceof Date ? last.updatedAt.getTime() : new Date(last.updatedAt).getTime();
    const candTs = candidate.updatedAt instanceof Date ? candidate.updatedAt.getTime() : new Date(candidate.updatedAt).getTime();
    if (candTs > lastTs || (candTs === lastTs && candidate.id > last.id)) last = candidate;
  }
  return last;
}

/**
 * Replays IndexedDB pending sync events.
 *
 * Important guarantees:
 * - Validates every event payload before applying.
 * - Every result is per-event, so one failed event does not block the full batch.
 * - Stores OfflineSyncEvent rows for idempotency, so duplicate event replay does
 *   not create duplicate bills/payments/stock changes.
 * - Applies shopId filtering through the existing services to block cross-shop access.
 */
export async function pushOfflineActions(shopId, events, user = null) {
  const context = createPushContext(shopId, user);
  const results = [];

  for (const event of events) {
    results.push(await processOneSyncEvent(shopId, event, user, context));
  }

  const applied = results.filter((r) => r.success === true).length;
  const failed  = results.length - applied;
  const synced     = results.filter((r) => r.status === "synced").length;
  const duplicates = results.filter((r) => r.status === "duplicate").length;
  const conflicts  = results.filter((r) => r.status === "conflict").length;
  const retryable  = results.filter((r) => !r.success && r.result?.retryable === true).length;

  return {
    received: events.length,
    applied,
    failed,
    results,
    summary: {
      received: events.length,
      synced,
      duplicates,
      failed,
      conflicts,
      retryable,
    },
    idMappings: exportContextMappings(context),
    serverTime: new Date().toISOString(),
  };
}

async function processOneSyncEvent(shopId, event, user, context) {
  const eventId = getClientEventId(event);
  const type = event.type;

  if (!eventId) {
    return buildSyncResult({
      eventId: "",
      type,
      status: "conflict",
      success: false,
      code: "INVALID_EVENT",
      error: "eventId or clientEventId required",
    });
  }

  const requestJson = JSON.stringify(removeSensitiveSyncFields(event));
  const claim = await claimSyncEventForProcessing(shopId, eventId, type, requestJson);

  if (claim.duplicate) {
    const existingResult = safeJsonParse(claim.existing.resultJson);
    await rememberMappingsFromResult(shopId, event, existingResult, context);
    return buildSyncResult({
      eventId,
      type,
      status: "duplicate",
      success: true,
      code: "ALREADY_SYNCED",
      serverId: getServerId(existingResult),
      result: existingResult,
    });
  }

  if (claim.conflict) {
    const existingResult = safeJsonParse(claim.existing.resultJson) ?? {};
    const conflictRow = await db.syncConflict.findFirst({
      where: { shopId, sourceEventId: eventId },
    });
    return buildSyncResult({
      eventId,
      type,
      status: "conflict",
      success: false,
      code: existingResult.code ?? "SYNC_EVENT_CONFLICT",
      error: claim.existing.error ?? "Sync event already ended in conflict. Create a new event after fixing it.",
      result: {
        retryable: false,
        ...existingResult,
        ...(conflictRow ? { conflict: publicSyncConflict(conflictRow), conflict_id: conflictRow.id } : {}),
      },
    });
  }

  if (claim.inProgress) {
    return buildSyncResult({
      eventId,
      type,
      status: "failed",
      success: false,
      code: "SYNC_EVENT_IN_PROGRESS",
      error: "This sync event is already being processed. Retry later.",
      result: { retryable: true },
    });
  }

  try {
    const result = await applySyncEvent(shopId, event, user, context);
    const safeResult = removeSensitiveSyncFields(result);
    await rememberMappingsFromResult(shopId, event, safeResult, context);

    await db.offlineSyncEvent.update({
      where: { shopId_eventId: { shopId, eventId } },
      data: {
        status: SYNC_EVENT_STATUSES.SYNCED,
        resultJson: JSON.stringify(safeResult),
        error: null,
      },
    });

    return buildSyncResult({
      eventId,
      type,
      status: "synced",
      success: true,
      serverId: getServerId(safeResult),
      result: safeResult,
    });
  } catch (error) {
    const classified = classifySyncError(error);
    const message = error?.message || "Sync event failed";
    let durableConflict = null;

    if (classified.syncStatus === SYNC_EVENT_STATUSES.CONFLICT) {
      durableConflict = await recordSyncEventConflict(shopId, event, classified, error, user);
      await createAuditLog({
        shopId,
        userId: user?.userId,
        action: "OFFLINE_SYNC_CONFLICT",
        entityType: "SyncConflict",
        entityId: durableConflict.id,
        metadata: { eventId, type, code: classified.code, message },
      });
    }

    const conflictResult = {
      code: classified.code,
      retryable: classified.retryable,
      ...(durableConflict ? { conflict: durableConflict, conflict_id: durableConflict.id } : {}),
    };

    await db.offlineSyncEvent.update({
      where: { shopId_eventId: { shopId, eventId } },
      data: {
        status: classified.syncStatus,
        error: message,
        resultJson: JSON.stringify(conflictResult),
      },
    });

    return buildSyncResult({
      eventId,
      type,
      status: classified.resultStatus,
      success: false,
      error: message,
      code: classified.code,
      result: conflictResult,
    });
  }
}

async function applySyncEvent(shopId, event, user, context) {
  switch (event.type) {
    case SYNC_EVENT_TYPES.CREATE_BILL:
      // Static contract: applyCreateBill(shopId, event, user) receives authenticated sync user.
      return applyCreateBill(shopId, event, user, context);
    case SYNC_EVENT_TYPES.CANCEL_BILL:
      await assertOwnerPermission(shopId, user, getEventOwnerPin(event));
      return applyCancelBill(shopId, event, context);
    case SYNC_EVENT_TYPES.RESTORE_BILL:
      await assertOwnerPermission(shopId, user, getEventOwnerPin(event));
      return applyRestoreBill(shopId, event, context);
    case SYNC_EVENT_TYPES.SALE_RETURN:
      await assertOwnerPermission(shopId, user, getEventOwnerPin(event));
      return applyCreateSaleReturn(shopId, event, user, context);
    case SYNC_EVENT_TYPES.CREATE_PRODUCT:
      return applyCreateProduct(shopId, event, user);
    case SYNC_EVENT_TYPES.UPDATE_PRODUCT:
      return applyUpdateProduct(shopId, event, user, context);
    case SYNC_EVENT_TYPES.DELETE_PRODUCT:
      await assertOwnerPermission(shopId, user, getEventOwnerPin(event));
      return applyDeleteProduct(shopId, event, context);
    case SYNC_EVENT_TYPES.RESTORE_PRODUCT:
      await assertOwnerPermission(shopId, user, getEventOwnerPin(event));
      return applyRestoreProduct(shopId, event, context);
    case SYNC_EVENT_TYPES.ADJUST_STOCK:
      await assertOwnerPermission(shopId, user, getEventOwnerPin(event));
      return applyAdjustStock(shopId, event, context);
    case SYNC_EVENT_TYPES.CREATE_CUSTOMER:
      return applyCreateCustomer(shopId, event);
    case SYNC_EVENT_TYPES.UPDATE_CUSTOMER:
      return applyUpdateCustomer(shopId, event, context);
    case SYNC_EVENT_TYPES.UDHAR_PAYMENT:
      return applyUdharPayment(shopId, event, context);
    case SYNC_EVENT_TYPES.REVERSE_UDHAR_PAYMENT:
      await assertOwnerPermission(shopId, user, getEventOwnerPin(event));
      return applyReverseUdharPayment(shopId, event, user, context);
    case SYNC_EVENT_TYPES.CREATE_LEDGER_ADJUSTMENT:
      return applyLedgerAdjustment(shopId, event, context);
    case SYNC_EVENT_TYPES.DELETE_CUSTOMER:
      await assertOwnerPermission(shopId, user, getEventOwnerPin(event));
      return applyDeleteCustomer(shopId, event, user, context);
    case SYNC_EVENT_TYPES.RESTORE_CUSTOMER:
      await assertOwnerPermission(shopId, user, getEventOwnerPin(event));
      return applyRestoreCustomer(shopId, event, context);
    case SYNC_EVENT_TYPES.STOCK_PURCHASE:
      return applyStockPurchase(shopId, event, context);
    case SYNC_EVENT_TYPES.STOCK_SALE:
      return applyStockSale(shopId, event, context);
    case SYNC_EVENT_TYPES.UPDATE_PURCHASE_BILL:
      return applyUpdatePurchaseBill(shopId, event, context);
    case SYNC_EVENT_TYPES.DELETE_PURCHASE_BILL:
      return applyDeletePurchaseBill(shopId, event, context);
    case SYNC_EVENT_TYPES.RECORD_SUPPLIER_PAYMENT:
      return applyRecordSupplierPayment(shopId, event, user, context);
    case SYNC_EVENT_TYPES.REVERSE_SUPPLIER_PAYMENT:
      await assertOwnerPermission(shopId, user, getEventOwnerPin(event));
      return applyReverseSupplierPayment(shopId, event, user);
    case SYNC_EVENT_TYPES.CREATE_SUPPLIER:
      return applyCreateSupplier(shopId, event);
    case SYNC_EVENT_TYPES.UPDATE_SUPPLIER:
      return applyUpdateSupplier(shopId, event, context);
    case SYNC_EVENT_TYPES.DELETE_SUPPLIER:
      await assertOwnerPermission(shopId, user, getEventOwnerPin(event));
      return applyDeleteSupplier(shopId, event, context);
    case SYNC_EVENT_TYPES.RESTORE_SUPPLIER:
      await assertOwnerPermission(shopId, user, getEventOwnerPin(event));
      return applyRestoreSupplier(shopId, event, context);
    default:
      throw new AppError(`Unsupported sync event type: ${event.type}`, 400);
  }
}

async function applyCreateBill(shopId, event, user, context) {
  const payload = getEventPayload(event);
  const billBody = payload.bill ?? payload;
  const existingResult = await findExistingCreateBillResultByIdempotency(shopId, event, payload, billBody);
  if (existingResult) return existingResult;

  const billIdentity = getCreateBillIdentity(event, payload, billBody);
  const resolvedBillBody = {
    ...(await resolveBillBodyReferences(shopId, billBody, context)),
    ...billIdentity.billBodyFields,
  };
  await validateBillProductExpectations(shopId, resolvedBillBody.items ?? []);

  const parsed = confirmBillSchema.parse(resolvedBillBody);
  const creditLedgerClientId = getCreateBillCreditLedgerClientId(payload, billBody);
  // Cashier attribution is server-authoritative. Ignore any frontend-created createdByUserId.
  const bill = await confirmBill(shopId, parsed, {
    userId: user?.userId ?? null,
    deviceId: billIdentity.sourceDeviceId ?? user?.deviceId ?? null,
    // Replayed offline sale: the goods already left the counter, so never drop it for
    // being stock-short — record it and flag any shortfall for reconciliation.
    allowStockShortfall: true,
    // Preserve the optimistic ledger row identity so push and pull echoes replace
    // that row instead of posting the same udhar effect a second time locally.
    creditLedgerClientId,
  });
  await recordBillLoyalty(shopId, bill).catch(() => null);
  return buildCreateBillSyncPayload(shopId, bill, payload, billBody);
}

function getCreateBillCreditLedgerClientId(...sources) {
  const arrayKeys = [
    "ledgerEntries",
    "ledger_entries",
    "customerLedgerEntries",
    "customer_ledger_entries",
    "udharLedgerEntries",
    "udhar_ledger_entries",
    "local_ledger_entries",
  ];
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    for (const key of arrayKeys) {
      const rows = Array.isArray(source[key]) ? source[key] : [];
      for (const row of rows) {
        const identity = pickString(
          row?.localLedgerEntryId,
          row?.local_ledger_entry_id,
          row?.localLedgerId,
          row?.local_ledger_id,
          row?.clientLedgerId,
          row?.client_ledger_id,
          row?.ledgerEntryId,
          row?.ledger_entry_id,
        );
        if (identity) return identity;
      }
    }
  }
  return null;
}

async function findExistingCreateBillResultByIdempotency(shopId, event, payload, billBody) {
  const billIdentity = getCreateBillIdentity(event, payload, billBody);
  const existingBill = await findExistingBillByCreateIdentity(shopId, billIdentity);
  if (existingBill) return buildCreateBillSyncPayload(shopId, existingBill, payload, billBody);

  const identities = collectCreateBillIdentityValues(event, payload, billBody);
  if (identities.size === 0) return null;

  const events = await db.offlineSyncEvent.findMany({
    where: {
      shopId,
      type: SYNC_EVENT_TYPES.CREATE_BILL,
      status: SYNC_EVENT_STATUSES.SYNCED,
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });

  for (const event of events) {
    const result = safeJsonParse(event.resultJson);
    const request = safeJsonParse(event.requestJson);
    const eventIdentities = collectCreateBillIdentityValues(
      event,
      result,
      result?.bill,
      request,
      request?.payload,
      request?.payload?.bill,
    );
    if ([...identities].some((identity) => eventIdentities.has(identity))) {
      return result;
    }
  }

  return null;
}

async function buildCreateBillSyncPayload(shopId, bill, payload, billBody) {
  const [customer, udharLedgerEntry, stockLedgerEntries] = await Promise.all([
    bill.customerId
      ? db.customer.findFirst({ where: { id: bill.customerId, shopId } })
      : null,
    bill.creditAmount > 0
      ? db.udharLedger.findFirst({
          where: { shopId, billId: bill.id, type: "debit" },
          orderBy: { createdAt: "desc" },
        })
      : null,
    db.stockLedger.findMany({
      where: { shopId, billId: bill.id, action: "sale" },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const localBillId =
    payload.localBillId ??
    payload.local_bill_id ??
    billBody.localBillId ??
    billBody.local_bill_id ??
    billBody.localId ??
    billBody.local_id ??
    bill.clientBillId ??
    null;
  const clientBillId =
    payload.clientBillId ??
    payload.client_bill_id ??
    billBody.clientBillId ??
    billBody.client_bill_id ??
    bill.clientBillId ??
    localBillId;
  const idempotencyKey =
    payload.idempotencyKey ??
    payload.idempotency_key ??
    billBody.idempotencyKey ??
    billBody.idempotency_key ??
    bill.idempotencyKey ??
    null;
  const localLedgerEntryId = getCreateBillCreditLedgerClientId(payload, billBody);
  const syncUdharLedgerEntry = udharLedgerEntry
    ? {
        ...udharLedgerEntry,
        ...(localLedgerEntryId && {
          localLedgerEntryId,
          local_ledger_entry_id: localLedgerEntryId,
        }),
      }
    : null;

  return {
    entity: "bill",
    action: "CREATE_BILL",
    type: SYNC_EVENT_TYPES.CREATE_BILL,
    billId: bill.id,
    serverBillId: bill.id,
    billNo: bill.billNo,
    localBillId,
    clientBillId,
    idempotencyKey,
    idempotency_key: idempotencyKey,
    bill: toSyncJsonSafe({
      ...bill,
      payments: bill.payments.filter((payment) => payment.mode !== "credit"),
    }),
    billItems: toSyncJsonSafe(bill.items),
    payments: toSyncJsonSafe(bill.payments.filter((payment) => payment.mode !== "credit")),
    customer: toSyncJsonSafe(customer),
    udharLedgerEntry: toSyncJsonSafe(syncUdharLedgerEntry),
    stockLedgerEntries: toSyncJsonSafe(stockLedgerEntries),
    grandTotal: bill.grandTotal,
  };
}

async function applyCancelBill(shopId, event, context) {
  const payload = cancelPayloadSchema.parse(getEventPayload(event));
  const billId = await resolveEntityReference(shopId, SYNC_ENTITY_TYPES.BILL, payload.serverBillId ?? payload.billId ?? payload.localBillId, context);
  if (!billId) throw new AppError("billId required for CANCEL_BILL sync event", 400);

  const bill = await cancelBill(shopId, billId, { reason: payload.reason, idempotentRaceOk: true });
  await reverseBillLoyalty(shopId, bill.id).catch(() => null);
  return {
    type: event.type,
    billId: bill.id,
    status: bill.status,
    cancelledAt: bill.cancelledAt,
  };
}


async function applyCreateSaleReturn(shopId, event, user, context) {
  const payload = getEventPayload(event);
  // Resolve client product/customer ids to server ids (reuses the CREATE_BILL resolver).
  const resolved = await resolveBillBodyReferences(shopId, payload, context);
  // The original sale this return reverses (bill-linked); standalone returns omit it.
  const originalRef = payload.returnOfBillId ?? payload.originalBillId ?? payload.serverBillId ?? payload.localBillId ?? payload.billId;
  let returnOfBillId = null;
  if (originalRef) {
    returnOfBillId = await resolveEntityReference(shopId, SYNC_ENTITY_TYPES.BILL, originalRef, context).catch(() => null);
  }

  const bill = await createSaleReturn(shopId, {
    ...resolved,
    returnOfBillId,
  }, {
    userId: user?.userId ?? null,
    deviceId: pickString(payload.sourceDeviceId, payload.source_device_id, user?.deviceId) || null,
  });

  return buildSaleReturnSyncPayload(bill, payload);
}

function buildSaleReturnSyncPayload(bill, payload) {
  const localBillId =
    payload.localBillId ?? payload.local_bill_id ?? payload.clientBillId ?? payload.client_bill_id ?? bill.clientBillId ?? null;
  const clientBillId =
    payload.clientBillId ?? payload.client_bill_id ?? bill.clientBillId ?? localBillId;
  const idempotencyKey =
    payload.idempotencyKey ?? payload.idempotency_key ?? bill.idempotencyKey ?? null;
  return {
    entity: "bill",
    action: "SALE_RETURN",
    type: SYNC_EVENT_TYPES.SALE_RETURN,
    billId: bill.id,
    serverBillId: bill.id,
    billNo: bill.billNo,
    localBillId,
    clientBillId,
    idempotencyKey,
    idempotency_key: idempotencyKey,
    bill: toSyncJsonSafe(bill),
    billItems: toSyncJsonSafe(bill.items ?? []),
    payments: toSyncJsonSafe(bill.payments ?? []),
    grandTotal: bill.grandTotal,
  };
}

async function applyRestoreBill(shopId, event, context) {
  const payload = restoreBillPayloadSchema.parse(getEventPayload(event));
  const billId = await resolveEntityReference(shopId, SYNC_ENTITY_TYPES.BILL, payload.serverBillId ?? payload.billId ?? payload.localBillId, context);
  if (!billId) throw new AppError("billId required for RESTORE_BILL sync event", 400);

  const bill = await restoreCancelledBill(shopId, billId, { reason: payload.reason });
  return {
    type: event.type,
    billId: bill.id,
    status: bill.status,
    restoredAt: bill.updatedAt,
  };
}

async function applyCreateProduct(shopId, event, user = null) {
  const payload = createProductPayloadSchema.parse(getEventPayload(event));
  const productBody = payload.product ?? stripKnownSyncPayloadKeys(payload);
  const parsed = createProductSchema.parse(productBody);
  const identity = getCreateProductIdentity(event, payload, productBody, user);
  // Durable identity makes the create idempotent across retries and cross-device replays.
  const product = await createProduct(shopId, parsed, { identity });
  return {
    type: event.type,
    productId: product.id,
    localProductId: payload.localProductId ?? productBody.localId ?? identity.clientProductId ?? null,
    updatedAt: product.updatedAt,
  };
}

function getCreateProductIdentity(event, payload, productBody, user = null) {
  const clientProductId = pickString(
    payload?.clientProductId,
    payload?.client_product_id,
    productBody?.clientProductId,
    productBody?.client_product_id,
    payload?.localProductId,
    payload?.local_product_id,
    productBody?.localProductId,
    productBody?.local_product_id,
    productBody?.localId,
    productBody?.local_id,
    event?.entity_id
  );
  const idempotencyKey = pickString(
    payload?.idempotencyKey,
    payload?.idempotency_key,
    productBody?.idempotencyKey,
    productBody?.idempotency_key,
    event?.idempotencyKey,
    event?.idempotency_key
  );
  const sourceDeviceId = pickString(
    payload?.sourceDeviceId,
    payload?.source_device_id,
    productBody?.sourceDeviceId,
    productBody?.source_device_id,
    event?.deviceId,
    event?.device_id,
    user?.deviceId,
    user?.device_id
  );
  return { clientProductId, idempotencyKey, sourceDeviceId };
}

async function applyUpdateProduct(shopId, event, user, context) {
  const payload = updateProductPayloadSchema.parse(getEventPayload(event));
  const productId = await resolveEntityReference(shopId, SYNC_ENTITY_TYPES.PRODUCT, payload.serverProductId ?? payload.productId ?? payload.localProductId ?? payload.id, context);
  if (!productId) throw new AppError("productId required for UPDATE_PRODUCT sync event", 400);

  // The offline client nests the edited fields under `payload.product` (same shape as
  // CREATE_PRODUCT). Without reading it here the update parsed to {} and silently persisted
  // nothing — stock/price/barcode edits never reached the server.
  const changes = updateProductSchema.parse(payload.changes ?? payload.product ?? stripKnownSyncPayloadKeys(payload));

  // NOTE: no blanket owner-PIN gate here. The client sends the full product on every edit
  // (price/cost/gst always present), so a presence-based protected-field check would force a
  // PIN on routine stock/price edits. CREATE_PRODUCT has no such gate either, so this keeps
  // create/update consistent. Product editing is already gated by the `manage_products`
  // permission, and below-minimum pricing is owner-PIN-gated client-side.
  const product = await updateProduct(shopId, productId, changes);
  return {
    type: event.type,
    productId: product.id,
    updatedAt: product.updatedAt,
  };
}


async function applyDeleteProduct(shopId, event, context) {
  const payload = productIdPayloadSchema.parse(getEventPayload(event));
  const productId = await resolveEntityReference(shopId, SYNC_ENTITY_TYPES.PRODUCT, payload.serverProductId ?? payload.productId ?? payload.localProductId ?? payload.id, context);
  if (!productId) throw new AppError("productId required for DELETE_PRODUCT sync event", 400);

  const product = await softDeleteProduct(shopId, productId);
  return {
    type: event.type,
    productId: product.id,
    deletedAt: product.deletedAt,
  };
}

async function applyRestoreProduct(shopId, event, context) {
  const payload = productIdPayloadSchema.parse(getEventPayload(event));
  const productId = await resolveEntityReference(shopId, SYNC_ENTITY_TYPES.PRODUCT, payload.serverProductId ?? payload.productId ?? payload.localProductId ?? payload.id, context);
  if (!productId) throw new AppError("productId required for RESTORE_PRODUCT sync event", 400);

  const product = await restoreDeletedProduct(shopId, productId);
  return {
    type: event.type,
    productId: product.id,
    updatedAt: product.updatedAt,
  };
}

// Stable per-event identity so a replayed ADJUST_STOCK (committed but not marked SYNCED,
// then re-claimed) is recognised by inventory.service and never double-applies. The client
// id (idempotencyKey/clientMovementId) is preferred; otherwise we derive a deterministic key
// from the event id, which is stable across retries of the same logical event.
function getAdjustStockIdentity(event, payload) {
  const eventId = getClientEventId(event);
  const idempotencyKey = pickString(
    payload?.idempotencyKey,
    payload?.idempotency_key,
    payload?.clientMovementId,
    payload?.client_movement_id,
    event?.idempotencyKey,
    event?.idempotency_key
  ) ?? (eventId ? `adjust-stock:${eventId}` : null);
  const clientMovementId = pickString(
    payload?.clientMovementId,
    payload?.client_movement_id,
    payload?.localMovementId,
    payload?.local_movement_id
  ) ?? idempotencyKey;
  const sourceDeviceId = pickString(
    payload?.sourceDeviceId,
    payload?.source_device_id,
    event?.deviceId,
    event?.device_id
  );
  return { idempotencyKey, clientMovementId, sourceDeviceId };
}

// Same stable-identity contract as ADJUST_STOCK, for STOCK_PURCHASE. A replayed purchase must
// not increment stock twice, recompute weighted-average cost twice, or write a second
// PurchaseHistory row (which would double the supplier's outstanding due).
function getPurchaseIdentity(event, payload) {
  const eventId = getClientEventId(event);
  const idempotencyKey = pickString(
    payload?.idempotencyKey,
    payload?.idempotency_key,
    payload?.clientMovementId,
    payload?.client_movement_id,
    payload?.movementId,
    payload?.localMovementId,
    payload?.local_movement_id,
    event?.idempotencyKey,
    event?.idempotency_key
  ) ?? (eventId ? `stock-purchase:${eventId}` : null);
  const clientMovementId = pickString(
    payload?.clientMovementId,
    payload?.client_movement_id,
    payload?.movementId,
    payload?.localMovementId,
    payload?.local_movement_id
  ) ?? idempotencyKey;
  const sourceDeviceId = pickString(
    payload?.sourceDeviceId,
    payload?.source_device_id,
    event?.deviceId,
    event?.device_id
  );
  return { idempotencyKey, clientMovementId, sourceDeviceId };
}

async function applyAdjustStock(shopId, event, context) {
  const payload = adjustStockPayloadSchema.parse(getEventPayload(event));
  payload.productId = await resolveEntityReference(shopId, SYNC_ENTITY_TYPES.PRODUCT, payload.serverProductId ?? payload.productId ?? payload.localProductId, context);
  const identity = getAdjustStockIdentity(event, payload);

  if (payload.adjustmentType === "damage") {
    if (!payload.quantity || !payload.enteredUnit) {
      throw new AppError("quantity and enteredUnit required for damage stock sync event", 400);
    }

    const parsed = damageSchema.parse({
      productId: payload.productId,
      quantity: payload.quantity,
      enteredUnit: payload.enteredUnit,
      note: payload.note,
    });
    const data = await recordDamage(shopId, parsed, identity);
    return { type: event.type, adjustmentType: "damage", ...data };
  }

  if (payload.newStockBaseQty === undefined) {
    throw new AppError("newStockBaseQty required for correction stock sync event", 400);
  }

  const parsed = correctionSchema.parse({
    productId: payload.productId,
    newStockBaseQty: payload.newStockBaseQty,
    note: payload.note,
  });
  const data = await correctStock(shopId, parsed, identity);
  return { type: event.type, adjustmentType: "correction", ...data };
}

async function applyCreateCustomer(shopId, event) {
  const payload = getEventPayload(event);
  const customerBody = payload.customer ?? payload;
  const parsed = createCustomerSchema.parse(stripKnownSyncPayloadKeys(customerBody));
  // Sync replays must converge on an existing customer (same mobile) rather than
  // throw, so a retried/cross-device create maps the local id onto one server
  // customer instead of duplicating or sticking as a permanently failed event.
  const customer = await createCustomer(shopId, parsed, { reuseExistingMobile: true });
  return {
    type: event.type,
    customerId: customer.id,
    localCustomerId: payload.localCustomerId ?? customerBody.localId ?? null,
  };
}


async function applyUpdateCustomer(shopId, event, context) {
  const payload = updateCustomerPayloadSchema.parse(getEventPayload(event));
  const customerId = await resolveEntityReference(shopId, SYNC_ENTITY_TYPES.CUSTOMER, payload.serverCustomerId ?? payload.customerId ?? payload.localCustomerId ?? payload.id, context);
  if (!customerId) throw new AppError("customerId required for UPDATE_CUSTOMER sync event", 400);

  // Client nests edited fields under `payload.customer` (see CREATE_CUSTOMER). Reading only
  // `payload.changes`/stripped top-level meant edits parsed to {} and never persisted.
  const changes = updateCustomerSchema.parse(payload.changes ?? payload.customer ?? stripKnownSyncPayloadKeys(payload));
  // Udhar balance is ledger-derived. Offline customer updates must not overwrite it.
  delete changes.udharAmount;
  delete changes.udharAmountPaise;

  if (changes.mobile) {
    const duplicate = await db.customer.findFirst({
      where: {
        shopId,
        mobile: changes.mobile,
        deletedAt: null,
        NOT: { id: customerId },
      },
      select: { id: true },
    });
    if (duplicate) throw new AppError("Customer with this mobile already exists", 409);
  }

  const customer = await updateCustomer(shopId, customerId, changes);
  return {
    type: event.type,
    customerId: customer.id,
    updatedAt: customer.updatedAt,
  };
}

async function applyUdharPayment(shopId, event, context) {
  const payload = udharPaymentPayloadSchema.parse(getEventPayload(event));
  payload.customerId = await resolveEntityReference(shopId, SYNC_ENTITY_TYPES.CUSTOMER, payload.serverCustomerId ?? payload.customerId ?? payload.localCustomerId, context);
  const payment = payload.payment ?? {
    amount: payload.amount,
    mode: payload.mode,
    note: payload.note,
  };
  const paymentIdentity = getUdharPaymentIdentity(event, payload, payment);
  const parsedPayment = udharPaymentSchema.parse({
    ...payment,
    ...paymentIdentity.paymentFields,
  });
  const data = await recordUdharPayment(shopId, payload.customerId, parsedPayment, {
    deviceId: paymentIdentity.sourceDeviceId ?? context?.user?.deviceId ?? null,
    locationId: payload.locationId ?? payload.location_id ?? payment.locationId ?? payment.location_id ?? null,
  });
  return {
    type: event.type,
    localLedgerEntryId: getUdharPaymentLocalReference(event, payload, payment, paymentIdentity),
    localPaymentId: pickString(
      payload.localPaymentId,
      payload.local_payment_id,
      payment.localPaymentId,
      payment.local_payment_id,
      payload.paymentId,
      payload.payment_id,
      payment.paymentId,
      payment.payment_id,
      event.entity_id
    ),
    idempotencyKey: paymentIdentity.idempotencyKey,
    ...data,
  };
}

function getUdharPaymentLocalReference(event, payload, payment, identity) {
  return pickString(
    payload?.localLedgerEntryId,
    payload?.local_ledger_entry_id,
    payload?.ledgerEntryId,
    payload?.ledger_entry_id,
    payment?.localLedgerEntryId,
    payment?.local_ledger_entry_id,
    payment?.ledgerEntryId,
    payment?.ledger_entry_id,
    payload?.clientLedgerId,
    payload?.client_ledger_id,
    payment?.clientLedgerId,
    payment?.client_ledger_id,
    identity?.clientLedgerId,
    payload?.localPaymentId,
    payload?.local_payment_id,
    payment?.localPaymentId,
    payment?.local_payment_id,
    payload?.paymentId,
    payload?.payment_id,
    payment?.paymentId,
    payment?.payment_id,
    event?.entity_id,
    payload?.localId,
    payload?.local_id
  );
}


async function applyReverseUdharPayment(shopId, event, user, context) {
  const payload = reverseUdharPaymentPayloadSchema.parse(getEventPayload(event));
  payload.customerId = await resolveEntityReference(shopId, SYNC_ENTITY_TYPES.CUSTOMER, payload.serverCustomerId ?? payload.customerId ?? payload.localCustomerId, context);
  const ledgerEntryId = await resolveEntityReference(shopId, SYNC_ENTITY_TYPES.LEDGER_ENTRY, payload.serverLedgerEntryId ?? payload.ledgerEntryId ?? payload.localLedgerEntryId, context);
  if (!payload.customerId) throw new AppError("customerId required for REVERSE_UDHAR_PAYMENT sync event", 400);
  if (!ledgerEntryId) throw new AppError("ledgerEntryId required for REVERSE_UDHAR_PAYMENT sync event", 400);
  const data = await reverseUdharPayment(
    shopId,
    payload.customerId,
    ledgerEntryId,
    { reason: payload.reason },
    { actorUserId: user?.userId ?? null }
  );
  return { type: event.type, ...data };
}

// Stable identity for a replayed CREATE_LEDGER_ADJUSTMENT so a retried/replayed udhar adjustment
// (committed but not marked SYNCED, or re-pushed under a new event id) is recognised by the
// durable UdharLedger.idempotencyKey and never double-applies to the customer's balance.
function getLedgerAdjustmentIdentity(event, payload) {
  const eventId = getClientEventId(event);
  const idempotencyKey = pickString(
    payload?.idempotencyKey,
    payload?.idempotency_key,
    payload?.clientLedgerId,
    payload?.client_ledger_id,
    payload?.ledgerEntryId,
    payload?.localLedgerEntryId,
    payload?.local_ledger_entry_id,
    payload?.localId,
    event?.idempotencyKey,
    event?.idempotency_key
  ) ?? (eventId ? `ledger-adjust:${eventId}` : null);
  const clientLedgerId = pickString(
    payload?.clientLedgerId,
    payload?.client_ledger_id,
    payload?.ledgerEntryId,
    payload?.localLedgerEntryId,
    payload?.local_ledger_entry_id,
    payload?.localId
  ) ?? idempotencyKey;
  const sourceDeviceId = pickString(
    payload?.sourceDeviceId,
    payload?.source_device_id,
    event?.deviceId,
    event?.device_id
  );
  return { idempotencyKey, clientLedgerId, sourceDeviceId };
}

async function applyLedgerAdjustment(shopId, event, context) {
  const rawPayload = getEventPayload(event);
  const payload = ledgerAdjustmentPayloadSchema.parse(rawPayload);
  payload.customerId = await resolveEntityReference(shopId, SYNC_ENTITY_TYPES.CUSTOMER, payload.serverCustomerId ?? payload.customerId ?? payload.localCustomerId, context);
  if (!payload.customerId) throw new AppError("customerId required for CREATE_LEDGER_ADJUSTMENT sync event", 400);
  const amount = round2(payload.amount);
  if (amount === 0) throw new AppError("Ledger adjustment amount cannot be zero", 400);
  // Identity from the raw payload (the schema may strip unknown keys) so a replay converges.
  const { idempotencyKey, clientLedgerId, sourceDeviceId } = getLedgerAdjustmentIdentity(event, rawPayload);

  const buildReplay = async (client, existing) => {
    const balance = await calculateCustomerUdharBalance(client, shopId, existing.customerId);
    return {
      type: event.type,
      ledgerEntryId: existing.id,
      localLedgerEntryId: payload.ledgerEntryId ?? payload.localLedgerEntryId ?? payload.localId ?? null,
      customerId: existing.customerId,
      newBalance: balance.balance,
      amount,
      idempotentReplay: true,
    };
  };

  try {
    return await db.$transaction(async (tx) => {
      if (idempotencyKey) {
        const existing = await tx.udharLedger.findFirst({ where: { shopId, idempotencyKey } });
        if (existing) return buildReplay(tx, existing);
      }

      const customer = await tx.customer.findFirst({ where: { id: payload.customerId, shopId, deletedAt: null } });
      if (!customer) throw new AppError("Customer not found", 404);

      const currentBalance = await calculateCustomerUdharBalance(tx, shopId, customer.id);
      const nextBalance = addMoney(currentBalance.balance, amount);
      if (toPaise(nextBalance) < 0) {
        const err = new AppError("Ledger adjustment would make udhar balance negative", 409);
        err.code = "UDHAR_ADJUSTMENT_NEGATIVE_BALANCE";
        err.meta = { outstanding: currentBalance.balance, attemptedAdjustment: amount, rawBalance: currentBalance.rawBalance };
        throw err;
      }

      const ledgerAmount = round2(Math.abs(amount));
      const ledger = await tx.udharLedger.create({
        data: {
          shopId,
          customerId: customer.id,
          customerName: customer.name,
          type: amount >= 0 ? "debit" : "payment",
          amount: ledgerAmount,
          ...moneyShadows({ amount: ledgerAmount }),
          mode: "adjustment",
          note: payload.note ?? "Offline ledger adjustment",
          idempotencyKey,
          clientLedgerId,
          sourceDeviceId,
          sourceType: idempotencyKey ? "adjustment" : null,
          sourceId: idempotencyKey ? customer.id : null,
        },
      });

      const refreshed = await syncCustomerUdharBalance(tx, shopId, customer.id, {
        repairNegative: true,
        repairNote: `System repair after ledger adjustment ${ledger.id}: udhar balance went negative`,
      });

      return {
        type: event.type,
        ledgerEntryId: ledger.id,
        localLedgerEntryId: payload.ledgerEntryId ?? payload.localLedgerEntryId ?? payload.localId ?? null,
        customerId: customer.id,
        newBalance: refreshed.balance,
        amount,
      };
    });
  } catch (error) {
    if (error?.code === "P2002" && idempotencyKey) {
      const existing = await db.udharLedger.findFirst({ where: { shopId, idempotencyKey } });
      if (existing) return buildReplay(db, existing);
    }
    throw error;
  }
}

async function applyDeleteCustomer(shopId, event, user, context) {
  const payload = customerLifecyclePayloadSchema.parse(getEventPayload(event));
  const customerId = await resolveEntityReference(shopId, SYNC_ENTITY_TYPES.CUSTOMER, payload.serverCustomerId ?? payload.customerId ?? payload.localCustomerId ?? payload.id, context);
  if (!customerId) throw new AppError("customerId required for DELETE_CUSTOMER sync event", 400);
  const customer = await softDeleteCustomer(shopId, customerId, { actorUserId: user?.userId ?? null });
  return {
    type: event.type,
    customerId: customer.id,
    deletedAt: customer.deletedAt,
  };
}

async function applyRestoreCustomer(shopId, event, context) {
  const payload = customerLifecyclePayloadSchema.parse(getEventPayload(event));
  const customerId = await resolveEntityReference(shopId, SYNC_ENTITY_TYPES.CUSTOMER, payload.serverCustomerId ?? payload.customerId ?? payload.localCustomerId ?? payload.id, context);
  if (!customerId) throw new AppError("customerId required for RESTORE_CUSTOMER sync event", 400);
  const customer = await db.customer.findFirst({ where: { id: customerId, shopId } });
  if (!customer) throw new AppError("Customer not found", 404);
  const restored = await db.customer.update({ where: { id: customer.id }, data: { deletedAt: null } });
  return {
    type: event.type,
    customerId: restored.id,
    updatedAt: restored.updatedAt,
  };
}

async function applyStockPurchase(shopId, event, context) {
  const rawPayload = normalizeStockPurchaseSyncPayload(getEventPayload(event));
  const payload = stockPurchasePayloadSchema.parse(rawPayload);
  payload.productId = await resolveEntityReference(shopId, SYNC_ENTITY_TYPES.PRODUCT, payload.serverProductId ?? payload.productId ?? payload.localProductId, context);
  if (!payload.productId) throw new AppError("productId required for STOCK_PURCHASE sync event", 400);
  // Derive identity from the raw payload (purchaseSchema may strip unknown keys) so a replayed
  // purchase is recognised and never doubles stock, cost, or the supplier due.
  const identity = getPurchaseIdentity(event, rawPayload);
  const data = await recordPurchase(shopId, payload, identity);
  return {
    type: event.type,
    movementId: data.stockLedgerId,
    stockLedgerId: data.stockLedgerId,
    localMovementId: payload.movementId ?? payload.localMovementId ?? payload.localId ?? null,
    productId: data.productId,
    ...data,
  };
}

function compactText(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizedText(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function readPurchaseLocator(payload, key) {
  return payload[key] ?? payload.match?.[key] ?? null;
}

async function resolvePurchaseLocatorIds(shopId, entityType, payload, keys, context) {
  const resolved = [];
  for (const key of keys) {
    const raw = compactText(payload[key]);
    if (!raw) continue;
    try {
      const id = await resolveEntityReference(shopId, entityType, raw, context);
      if (id && !looksLikeClientLocalId(id)) resolved.push(id);
    } catch (error) {
      if (error?.code !== "SYNC_DEPENDENCY_PENDING") throw error;
    }
  }
  return [...new Set(resolved)];
}

function normalizeStockPurchaseSyncPayload(payload) {
  const source = payload && typeof payload === "object" ? payload : {};
  const billAmount = round2(Number(source.billAmount ?? source.bill_amount ?? source.purchaseBillAmount ?? source.purchase_bill_amount ?? 0));
  const statusHint = normalizedText(source.purchasePaymentStatus ?? source.purchase_payment_status);
  const rawPaid = source.purchasePaidAmount ?? source.purchase_paid_amount ?? source.paidAmount ?? source.paid_amount;
  const numericPaid = rawPaid === undefined || rawPaid === null || rawPaid === "" ? null : Number(rawPaid);
  const paid = round2(Math.max(0, Math.min(
    Number.isFinite(numericPaid) ? numericPaid : statusHint === "paid" ? billAmount : 0,
    Math.max(0, billAmount),
  )));
  const due = round2(Math.max(0, billAmount - paid));
  const status = due <= 0 ? "paid" : paid > 0 ? "partial" : "due";
  const dueDateText = compactText(source.purchaseDueDate ?? source.purchase_due_date);
  const dueDate = dueDateText && /^\d{4}-\d{2}-\d{2}/.test(dueDateText)
    ? dueDateText.slice(0, 10)
    : undefined;

  return {
    ...source,
    purchasePaymentStatus: status,
    purchasePaidAmount: paid,
    purchaseDueAmount: due,
    purchasePaymentMode: paid > 0 ? source.purchasePaymentMode ?? source.purchase_payment_mode : undefined,
    purchaseDueDate: due > 0 ? dueDate : undefined,
  };
}

function purchaseDateBucket(value) {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return null;
  return new Date(time).toISOString().slice(0, 10);
}

function moneyClose(left, right) {
  const a = Number(left);
  const b = Number(right);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return true;
  return Math.abs(a - b) <= 0.009;
}

function purchaseCandidateMatches(row, match, amountKey) {
  if (!row || !match) return false;
  const productId = compactText(match.productId);
  if (productId && !looksLikeClientLocalId(productId) && row.productId !== productId) return false;

  const supplierId = compactText(match.supplierId);
  if (supplierId && !looksLikeClientLocalId(supplierId) && row.supplierId && row.supplierId !== supplierId) return false;

  const supplierName = compactText(match.supplierName);
  if (supplierName && row.supplierName && normalizedText(row.supplierName) !== normalizedText(supplierName)) return false;

  const invoiceNumber = compactText(match.invoiceNumber);
  if (invoiceNumber && row.invoiceNumber && normalizedText(row.invoiceNumber) !== normalizedText(invoiceNumber)) return false;

  const amount = match.billAmount ?? match.purchaseBillAmount ?? match.amount;
  if (amount !== undefined && amount !== null && !moneyClose(row[amountKey], amount)) return false;

  const date = purchaseDateBucket(match.date ?? match.createdAt ?? match.created_at);
  if (date && purchaseDateBucket(row.createdAt) !== date) return false;

  return true;
}

async function findPurchaseHistoryTarget(shopId, payload, context) {
  const ids = await resolvePurchaseLocatorIds(shopId, SYNC_ENTITY_TYPES.PURCHASE_HISTORY, payload, [
    "purchaseHistoryId",
    "purchaseBillId",
    "localPurchaseHistoryId",
    "localPurchaseBillId",
    "serverId",
    "id",
  ], context);
  for (const id of ids) {
    const row = await db.purchaseHistory.findFirst({ where: { shopId, id } });
    if (row) return row;
  }

  const match = payload.match ?? payload;
  const productId = compactText(readPurchaseLocator(payload, "productId"));
  const invoiceNumber = compactText(readPurchaseLocator(payload, "invoiceNumber"));
  const candidates = await db.purchaseHistory.findMany({
    where: {
      shopId,
      ...(productId && !looksLikeClientLocalId(productId) ? { productId } : {}),
      ...(invoiceNumber ? { invoiceNumber } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  return candidates.find((row) => purchaseCandidateMatches(row, match, "billAmount")) ?? null;
}

async function findStockLedgerPurchaseTarget(shopId, payload, context) {
  const ids = await resolvePurchaseLocatorIds(shopId, SYNC_ENTITY_TYPES.STOCK_LEDGER, payload, [
    "stockLedgerId",
    "inventoryMovementId",
    "movementId",
    "localMovementId",
    "localInventoryMovementId",
    "serverId",
    "id",
  ], context);
  for (const id of ids) {
    const row = await db.stockLedger.findFirst({ where: { shopId, id, action: "purchase" } });
    if (row) return row;
  }

  const match = payload.match ?? payload;
  const productId = compactText(readPurchaseLocator(payload, "productId"));
  const invoiceNumber = compactText(readPurchaseLocator(payload, "invoiceNumber"));
  const candidates = await db.stockLedger.findMany({
    where: {
      shopId,
      action: "purchase",
      ...(productId && !looksLikeClientLocalId(productId) ? { productId } : {}),
      ...(invoiceNumber ? { invoiceNumber } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  return candidates.find((row) => purchaseCandidateMatches(row, match, "purchaseBillAmount")) ?? null;
}

function parsePurchaseLifecycleDueDate(value, dueAmount) {
  if (!value || dueAmount <= 0) return null;
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) ? date : null;
}

function normalizePurchaseLifecycleFields(payload, { deleted = false } = {}) {
  if (deleted) {
    return {
      invoiceNumber: compactText(payload.invoiceNumber),
      supplierName: compactText(payload.supplierName),
      billAmount: 0,
      purchasePaidAmount: 0,
      purchaseDueAmount: 0,
      purchasePaymentStatus: "deleted",
      purchasePaymentMode: null,
      purchaseDueDate: null,
    };
  }

  const billAmount = round2(Number(payload.billAmount ?? payload.purchaseBillAmount ?? payload.amount ?? 0));
  const paid = round2(Math.max(0, Number(payload.purchasePaidAmount ?? payload.paidAmount ?? payload.paid ?? 0)));
  const safePaid = round2(Math.min(paid, Math.max(0, billAmount)));
  const due = round2(Math.max(0, billAmount - safePaid));
  const status = due <= 0 ? "paid" : safePaid > 0 ? "partial" : "due";
  const mode = safePaid > 0 ? normalizedText(payload.purchasePaymentMode ?? payload.paymentMode ?? "cash") : null;

  return {
    invoiceNumber: compactText(payload.invoiceNumber),
    supplierName: compactText(payload.supplierName),
    billAmount,
    purchasePaidAmount: safePaid,
    purchaseDueAmount: due,
    purchasePaymentStatus: status,
    purchasePaymentMode: mode === "card" ? "bank" : mode,
    purchaseDueDate: parsePurchaseLifecycleDueDate(payload.purchaseDueDate, due),
  };
}

function purchaseHistoryUpdateData(fields) {
  return {
    ...(fields.supplierName ? { supplierName: fields.supplierName } : {}),
    ...(fields.invoiceNumber !== undefined ? { invoiceNumber: fields.invoiceNumber } : {}),
    billAmount: fields.billAmount,
    ...moneyShadows({ billAmount: fields.billAmount }),
    purchasePaidAmount: fields.purchasePaidAmount,
    purchaseDueAmount: fields.purchaseDueAmount,
    ...moneyShadows({
      purchasePaidAmount: fields.purchasePaidAmount,
      purchaseDueAmount: fields.purchaseDueAmount,
    }),
    purchasePaymentStatus: fields.purchasePaymentStatus,
    purchasePaymentMode: fields.purchasePaymentMode,
    purchaseDueDate: fields.purchaseDueDate,
  };
}

function stockLedgerPurchaseUpdateData(fields) {
  return {
    ...(fields.supplierName ? { supplierName: fields.supplierName } : {}),
    ...(fields.invoiceNumber !== undefined ? { invoiceNumber: fields.invoiceNumber } : {}),
    purchaseBillAmount: fields.billAmount,
    ...moneyShadows({ purchaseBillAmount: fields.billAmount }),
    purchasePaidAmount: fields.purchasePaidAmount,
    purchaseDueAmount: fields.purchaseDueAmount,
    ...moneyShadows({
      purchasePaidAmount: fields.purchasePaidAmount,
      purchaseDueAmount: fields.purchaseDueAmount,
    }),
    purchasePaymentStatus: fields.purchasePaymentStatus,
    purchasePaymentMode: fields.purchasePaymentMode,
    purchaseDueDate: fields.purchaseDueDate,
  };
}

async function applyPurchaseBillLifecycle(shopId, event, context, { deleted = false } = {}) {
  const payload = purchaseBillLifecyclePayloadSchema.parse(getEventPayload(event));
  const [purchaseHistory, stockLedger] = await Promise.all([
    findPurchaseHistoryTarget(shopId, payload, context),
    findStockLedgerPurchaseTarget(shopId, payload, context),
  ]);
  if (!purchaseHistory && !stockLedger) {
    throw new AppError("Purchase bill not found for sync event", 404);
  }

  const fields = normalizePurchaseLifecycleFields(payload, { deleted });
  // Optional quantity correction (editing a purchase's quantity). We SET the ledger to the new
  // base qty and move product stock by the difference from the ledger's CURRENT value, so a
  // replay of this same event is idempotent (the second time, oldBase === newBase => delta 0).
  const newQuantity = !deleted && payload.quantity != null && Number.isFinite(Number(payload.quantity))
    ? Number(payload.quantity)
    : null;
  return db.$transaction(async (tx) => {
    const updatedPurchaseHistory = purchaseHistory
      ? await tx.purchaseHistory.update({
          where: { id: purchaseHistory.id },
          data: purchaseHistoryUpdateData(fields),
        })
      : null;

    let stockLedgerData = stockLedgerPurchaseUpdateData(fields);
    if (newQuantity != null && stockLedger?.productId) {
      const product = await tx.product.findFirst({ where: { id: stockLedger.productId, shopId, deletedAt: null } });
      if (product) {
        const enteredUnit = pickString(payload.enteredUnit, payload.unit) ?? product.baseUnit;
        const newBase = round2(toBaseQty(newQuantity, enteredUnit, product.baseUnit));
        const oldBase = round2(Number(stockLedger.changeBaseQty ?? 0));
        const delta = round2(newBase - oldBase);
        if (delta !== 0) {
          const newProductStock = round2(Number(product.stockBaseQty ?? 0) + delta);
          await tx.product.update({ where: { id: product.id }, data: { stockBaseQty: newProductStock } });
          stockLedgerData = { ...stockLedgerData, changeBaseQty: newBase, newStockBaseQty: newProductStock };
        }
      }
    }

    const updatedStockLedger = stockLedger
      ? await tx.stockLedger.update({
          where: { id: stockLedger.id },
          data: stockLedgerData,
        })
      : null;

    return {
      type: event.type,
      purchaseHistoryId: updatedPurchaseHistory?.id ?? purchaseHistory?.id ?? null,
      stockLedgerId: updatedStockLedger?.id ?? stockLedger?.id ?? null,
      localPurchaseHistoryId: payload.localPurchaseHistoryId ?? null,
      localMovementId: payload.localMovementId ?? null,
      entity: toSyncJsonSafe(updatedPurchaseHistory),
      purchaseHistory: toSyncJsonSafe(updatedPurchaseHistory),
      stockLedger: toSyncJsonSafe(updatedStockLedger),
      deleted,
      updatedAt: new Date().toISOString(),
    };
  });
}

function applyUpdatePurchaseBill(shopId, event, context) {
  return applyPurchaseBillLifecycle(shopId, event, context, { deleted: false });
}

function applyDeletePurchaseBill(shopId, event, context) {
  return applyPurchaseBillLifecycle(shopId, event, context, { deleted: true });
}

async function applyRecordSupplierPayment(shopId, event, user, context) {
  const payload = supplierPaymentPayloadSchema.parse(getEventPayload(event));
  const purchase = await findPurchaseHistoryTarget(shopId, payload, context);
  if (!purchase) throw new AppError("Purchase bill not found for supplier payment", 404);
  const amount = round2(payload.amount);
  const currentDue = round2(Number(purchase.purchaseDueAmount ?? 0));
  if (amount > currentDue) {
    throw new AppError(`Supplier payment exceeds purchase due (${currentDue})`, 409, "PAYMENT_EXCEEDS_DUE");
  }
  const eventId = getClientEventId(event);
  const idempotencyKey = `supplier-payment:${eventId}`;
  const mode = payload.mode === "card" ? "bank" : payload.mode;
  const businessDate = payload.paidAt ? new Date(payload.paidAt) : new Date();

  return db.$transaction(async (tx) => {
    const existing = await tx.financialLedger.findFirst({ where: { shopId, idempotencyKey } });
    if (existing) {
      return { type: event.type, paymentId: existing.sourceId, ledgerEntryId: existing.id, purchaseHistoryId: existing.purchaseBillId, idempotentReplay: true };
    }
    const ledger = await tx.financialLedger.create({
      data: {
        shopId,
        supplierId: purchase.supplierId,
        purchaseBillId: purchase.id,
        sourceType: "supplier_payment",
        sourceId: payload.paymentId,
        entryType: "supplier_payment",
        direction: "debit",
        amountPaise: toPaiseBigInt(amount),
        paymentMode: mode,
        businessDate,
        idempotencyKey,
      },
    });
    const paid = round2(Number(purchase.purchasePaidAmount ?? 0) + amount);
    const due = round2(Math.max(0, Number(purchase.billAmount ?? 0) - paid));
    const updated = await tx.purchaseHistory.update({
      where: { id: purchase.id },
      data: {
        purchasePaidAmount: paid,
        purchaseDueAmount: due,
        ...moneyShadows({ purchasePaidAmount: paid, purchaseDueAmount: due }),
        purchasePaymentStatus: due <= 0 ? "paid" : "partial",
        purchasePaymentMode: mode,
      },
    });
    await createAuditLog({
      shopId,
      userId: user?.userId,
      action: "SUPPLIER_PAYMENT_RECORDED",
      entityType: "FinancialLedger",
      entityId: ledger.id,
      before: { paid: purchase.purchasePaidAmount, due: currentDue },
      after: { paid, due },
      metadata: { paymentId: payload.paymentId, purchaseHistoryId: purchase.id, amount, mode, reference: payload.reference ?? null },
      client: tx,
    });
    return { type: event.type, paymentId: payload.paymentId, ledgerEntryId: ledger.id, purchaseHistoryId: purchase.id, amountPaid: amount, purchaseHistory: toSyncJsonSafe(updated) };
  });
}

async function applyReverseSupplierPayment(shopId, event, user) {
  const payload = reverseSupplierPaymentPayloadSchema.parse(getEventPayload(event));
  const original = await db.financialLedger.findFirst({
    where: { shopId, sourceType: "supplier_payment", OR: [{ id: payload.paymentId }, { sourceId: payload.paymentId }] },
  });
  if (!original || original.amountPaise <= 0n) throw new AppError("Supplier payment not found", 404);
  const eventId = getClientEventId(event);
  const idempotencyKey = `supplier-payment-reversal:${eventId}`;

  return db.$transaction(async (tx) => {
    const existing = await tx.financialLedger.findFirst({ where: { shopId, idempotencyKey } });
    if (existing) return { type: event.type, paymentId: original.sourceId, reversalLedgerEntryId: existing.id, purchaseHistoryId: existing.purchaseBillId, idempotentReplay: true };
    const priorReversal = await tx.financialLedger.findFirst({
      where: { shopId, sourceType: "supplier_payment_reversal", sourceId: original.id },
    });
    if (priorReversal) throw new AppError("Supplier payment is already reversed", 409, "PAYMENT_ALREADY_REVERSED");
    const purchase = await tx.purchaseHistory.findFirst({ where: { id: original.purchaseBillId, shopId } });
    if (!purchase) throw new AppError("Purchase bill not found for supplier payment", 404);
    const amount = Number(original.amountPaise) / 100;
    const reversal = await tx.financialLedger.create({
      data: {
        shopId,
        supplierId: original.supplierId,
        purchaseBillId: purchase.id,
        sourceType: "supplier_payment_reversal",
        sourceId: original.id,
        entryType: "supplier_payment",
        direction: "credit",
        amountPaise: -original.amountPaise,
        paymentMode: original.paymentMode,
        businessDate: new Date(),
        idempotencyKey,
      },
    });
    const paid = round2(Math.max(0, Number(purchase.purchasePaidAmount ?? 0) - amount));
    const due = round2(Math.max(0, Number(purchase.billAmount ?? 0) - paid));
    const updated = await tx.purchaseHistory.update({
      where: { id: purchase.id },
      data: {
        purchasePaidAmount: paid,
        purchaseDueAmount: due,
        ...moneyShadows({ purchasePaidAmount: paid, purchaseDueAmount: due }),
        purchasePaymentStatus: paid > 0 ? "partial" : "due",
      },
    });
    await createAuditLog({
      shopId,
      userId: user?.userId,
      action: "SUPPLIER_PAYMENT_REVERSED",
      entityType: "FinancialLedger",
      entityId: reversal.id,
      before: { paid: purchase.purchasePaidAmount, due: purchase.purchaseDueAmount },
      after: { paid, due },
      metadata: { paymentId: original.sourceId, originalLedgerEntryId: original.id, amount, reason: payload.reason },
      client: tx,
    });
    return { type: event.type, paymentId: original.sourceId, reversalLedgerEntryId: reversal.id, purchaseHistoryId: purchase.id, amountPaid: -amount, purchaseHistory: toSyncJsonSafe(updated) };
  });
}

// Same stable-identity contract as ADJUST_STOCK/STOCK_PURCHASE, for a manual STOCK_SALE
// (offline stock-out not tied to a bill). A replay must not decrement stock twice.
function getStockSaleIdentity(event, payload) {
  const eventId = getClientEventId(event);
  const idempotencyKey = pickString(
    payload?.idempotencyKey,
    payload?.idempotency_key,
    payload?.clientMovementId,
    payload?.client_movement_id,
    payload?.movementId,
    payload?.localMovementId,
    payload?.local_movement_id,
    event?.idempotencyKey,
    event?.idempotency_key
  ) ?? (eventId ? `stock-sale:${eventId}` : null);
  const clientMovementId = pickString(
    payload?.clientMovementId,
    payload?.client_movement_id,
    payload?.movementId,
    payload?.localMovementId,
    payload?.local_movement_id
  ) ?? idempotencyKey;
  const sourceDeviceId = pickString(
    payload?.sourceDeviceId,
    payload?.source_device_id,
    event?.deviceId,
    event?.device_id
  );
  return { idempotencyKey, clientMovementId, sourceDeviceId };
}

async function applyStockSale(shopId, event, context) {
  const rawPayload = getEventPayload(event);
  const payload = stockSalePayloadSchema.parse(rawPayload);
  payload.productId = await resolveEntityReference(shopId, SYNC_ENTITY_TYPES.PRODUCT, payload.serverProductId ?? payload.productId ?? payload.localProductId, context);
  if (!payload.productId) throw new AppError("productId required for STOCK_SALE sync event", 400);
  const { idempotencyKey, clientMovementId, sourceDeviceId } = getStockSaleIdentity(event, rawPayload);

  const buildReplay = (existing) => ({
    type: event.type,
    movementId: existing.id,
    localMovementId: payload.movementId ?? payload.localMovementId ?? payload.localId ?? null,
    productId: existing.productId,
    qtyRemoved: round2(Math.abs(existing.changeBaseQty)),
    oldStock: existing.oldStockBaseQty,
    newStock: existing.newStockBaseQty,
    idempotentReplay: true,
  });

  try {
    return await db.$transaction(async (tx) => {
      if (idempotencyKey) {
        const existing = await tx.stockLedger.findFirst({ where: { shopId, idempotencyKey } });
        if (existing) return buildReplay(existing);
      }

      const product = await tx.product.findFirst({ where: { id: payload.productId, shopId, deletedAt: null } });
      if (!product) throw new AppError("Product not found", 404);
      const location = await resolveOperationalLocation(
        shopId,
        payload.locationId ?? payload.location_id ?? null,
        tx,
      );
      const qtyInBase = toBaseQty(payload.quantity, payload.enteredUnit, product.baseUnit);
      const stock = await decrementLocationInventory(tx, {
        shopId,
        location,
        product,
        quantityBase: qtyInBase,
        // Offline sales must remain mergeable. A branch shortfall is recorded and
        // surfaced for reconciliation instead of silently consuming another branch.
        allowShortfall: true,
      });
      const ledger = await tx.stockLedger.create({
        data: {
          shopId,
          locationId: location.id,
          productId: product.id,
          productName: product.name,
          action: "sale",
          changeBaseQty: -qtyInBase,
          oldStockBaseQty: stock.oldStock,
          newStockBaseQty: stock.newStock,
          idempotencyKey,
          clientMovementId,
          sourceDeviceId,
          sourceType: idempotencyKey ? "sale" : null,
          sourceId: idempotencyKey ? product.id : null,
          note: stock.shortfallBaseQty > 0
            ? `${payload.note ?? "Offline manual stock sale"} | ${location.name} stock negative by ${stock.shortfallBaseQty} ${product.baseUnit}; reconcile inventory`
            : payload.note ?? "Offline manual stock sale",
        },
      });
      return {
        type: event.type,
        movementId: ledger.id,
        localMovementId: payload.movementId ?? payload.localMovementId ?? payload.localId ?? null,
        productId: product.id,
        qtyRemoved: qtyInBase,
        oldStock: stock.oldStock,
        newStock: stock.newStock,
        locationId: location.id,
      };
    });
  } catch (error) {
    if (error?.code === "P2002" && idempotencyKey) {
      const existing = await db.stockLedger.findFirst({ where: { shopId, idempotencyKey } });
      if (existing) return buildReplay(existing);
    }
    throw error;
  }
}

async function applyCreateSupplier(shopId, event) {
  const payload = createSupplierPayloadSchema.parse(getEventPayload(event));
  const supplierBody = payload.supplier ?? stripKnownSyncPayloadKeys(payload);
  const parsed = createSupplierSchema.parse(supplierBody);
  const supplier = await createSupplier(shopId, parsed);
  return {
    type: event.type,
    supplierId: supplier.id,
    localSupplierId: payload.localSupplierId ?? supplierBody.localId ?? null,
    updatedAt: supplier.updatedAt,
  };
}

async function applyUpdateSupplier(shopId, event, context) {
  const payload = updateSupplierPayloadSchema.parse(getEventPayload(event));
  const supplierId = await resolveEntityReference(shopId, SYNC_ENTITY_TYPES.SUPPLIER, payload.serverSupplierId ?? payload.supplierId ?? payload.localSupplierId ?? payload.id, context);
  if (!supplierId) throw new AppError("supplierId required for UPDATE_SUPPLIER sync event", 400);
  // Client nests edited fields under `payload.supplier` (see CREATE_SUPPLIER). Reading only
  // `payload.changes`/stripped top-level meant edits parsed to {} and never persisted.
  const changes = updateSupplierSchema.parse(payload.changes ?? payload.supplier ?? stripKnownSyncPayloadKeys(payload));
  const supplier = await updateSupplier(shopId, supplierId, changes);
  return {
    type: event.type,
    supplierId: supplier.id,
    updatedAt: supplier.updatedAt,
  };
}

async function applyDeleteSupplier(shopId, event, context) {
  const payload = supplierLifecyclePayloadSchema.parse(getEventPayload(event));
  const supplierId = await resolveEntityReference(shopId, SYNC_ENTITY_TYPES.SUPPLIER, payload.serverSupplierId ?? payload.supplierId ?? payload.localSupplierId ?? payload.id, context);
  if (!supplierId) throw new AppError("supplierId required for DELETE_SUPPLIER sync event", 400);
  const supplier = await softDeleteSupplier(shopId, supplierId);
  return {
    type: event.type,
    supplierId: supplier.id,
    deletedAt: supplier.deletedAt,
  };
}

async function applyRestoreSupplier(shopId, event, context) {
  const payload = supplierLifecyclePayloadSchema.parse(getEventPayload(event));
  const supplierId = await resolveEntityReference(shopId, SYNC_ENTITY_TYPES.SUPPLIER, payload.serverSupplierId ?? payload.supplierId ?? payload.localSupplierId ?? payload.id, context);
  if (!supplierId) throw new AppError("supplierId required for RESTORE_SUPPLIER sync event", 400);
  const supplier = await restoreSupplier(shopId, supplierId);
  return {
    type: event.type,
    supplierId: supplier.id,
    updatedAt: supplier.updatedAt,
  };
}

async function validateBillProductExpectations(shopId, items) {
  const expectedItems = items.filter((item) => item.productId && item.expectedProductUpdatedAt);
  if (expectedItems.length === 0) return;

  const productIds = expectedItems.map((item) => item.productId);
  const products = await db.product.findMany({
    where: { shopId, id: { in: productIds }, deletedAt: null },
    select: { id: true, name: true, updatedAt: true },
  });
  const productMap = Object.fromEntries(products.map((product) => [product.id, product]));

  for (const item of expectedItems) {
    const product = productMap[item.productId];
    if (!product) {
      throw new AppError(`Product deleted or mismatched on server: ${item.productId}`, 409);
    }

    if (product.updatedAt.toISOString() !== item.expectedProductUpdatedAt) {
      throw new AppError(`Product changed on server before sync: ${product.name}`, 409);
    }
  }
}

async function claimSyncEventForProcessing(shopId, eventId, type, requestJson) {
  try {
    await db.offlineSyncEvent.create({
      data: {
        shopId,
        eventId,
        type,
        status: SYNC_EVENT_STATUSES.PROCESSING,
        attempts: 1,
        requestJson,
      },
    });
    return { claimed: true };
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
  }

  const existing = await db.offlineSyncEvent.findUnique({
    where: { shopId_eventId: { shopId, eventId } },
  });

  if (!existing) return { inProgress: true };
  if (existing.status === SYNC_EVENT_STATUSES.SYNCED) {
    return { duplicate: true, existing };
  }
  if (existing.status === SYNC_EVENT_STATUSES.CONFLICT) {
    return { conflict: true, existing };
  }

  const isProcessing = existing.status === SYNC_EVENT_STATUSES.PROCESSING;
  const isStaleProcessing = isProcessing && isStaleSyncProcessing(existing.updatedAt);
  const canRetry = existing.status === SYNC_EVENT_STATUSES.FAILED || isStaleProcessing;
  if (!canRetry) return { inProgress: true, existing };

  const updated = await db.offlineSyncEvent.updateMany({
    where: {
      shopId,
      eventId,
      status: existing.status,
      updatedAt: existing.updatedAt,
    },
    data: {
      type,
      status: SYNC_EVENT_STATUSES.PROCESSING,
      attempts: { increment: 1 },
      requestJson,
      error: null,
    },
  });

  if (updated.count !== 1) return { inProgress: true, existing };
  return { claimed: true, existing };
}

function isUniqueConstraintError(error) {
  return error?.code === "P2002";
}

function isStaleSyncProcessing(updatedAt) {
  const updatedMs = updatedAt instanceof Date ? updatedAt.getTime() : new Date(updatedAt).getTime();
  if (!Number.isFinite(updatedMs)) return true;
  return Date.now() - updatedMs > SYNC_PROCESSING_STALE_MS;
}

function createPushContext(shopId, user) {
  return {
    shopId,
    user,
    mappings: new Map(),
  };
}

function mappingKey(entityType, localId) {
  return `${entityType}:${String(localId)}`;
}

function rememberMappingInContext(context, entityType, localId, serverId) {
  if (!context || !localId || !serverId) return;
  context.mappings.set(mappingKey(entityType, localId), {
    entityType,
    localId: String(localId),
    serverId: String(serverId),
  });
}

function exportContextMappings(context) {
  const grouped = { products: {}, customers: {}, bills: {}, suppliers: {}, ledgerEntries: {} };
  grouped.purchaseHistory = {};
  grouped.stockLedger = {};
  for (const mapping of context?.mappings?.values?.() ?? []) {
    const bucket = mapping.entityType === SYNC_ENTITY_TYPES.PRODUCT
      ? grouped.products
      : mapping.entityType === SYNC_ENTITY_TYPES.CUSTOMER
        ? grouped.customers
        : mapping.entityType === SYNC_ENTITY_TYPES.BILL
          ? grouped.bills
          : mapping.entityType === SYNC_ENTITY_TYPES.SUPPLIER
            ? grouped.suppliers
            : mapping.entityType === SYNC_ENTITY_TYPES.LEDGER_ENTRY
              ? grouped.ledgerEntries
              : mapping.entityType === SYNC_ENTITY_TYPES.PURCHASE_HISTORY
                ? grouped.purchaseHistory
                : mapping.entityType === SYNC_ENTITY_TYPES.STOCK_LEDGER
                  ? grouped.stockLedger
                  : null;
    if (bucket) bucket[mapping.localId] = mapping.serverId;
  }
  return grouped;
}

async function rememberMappingsFromResult(shopId, event, result, context) {
  const payload = getEventPayload(event);
  const mappings = [];

  if (result?.productId) {
    const localProductId = result.localProductId ?? payload.localProductId ?? payload.product?.localId ?? payload.localId;
    if (localProductId) mappings.push({ entityType: SYNC_ENTITY_TYPES.PRODUCT, localId: localProductId, serverId: result.productId });
  }
  if (result?.customerId) {
    const localCustomerId = result.localCustomerId ?? payload.localCustomerId ?? payload.customer?.localId ?? payload.localId;
    if (localCustomerId) mappings.push({ entityType: SYNC_ENTITY_TYPES.CUSTOMER, localId: localCustomerId, serverId: result.customerId });
  }
  if (result?.billId) {
    const localBillId = result.localBillId ?? payload.localBillId ?? payload.bill?.localId ?? payload.localId;
    if (localBillId) mappings.push({ entityType: SYNC_ENTITY_TYPES.BILL, localId: localBillId, serverId: result.billId });
  }
  if (result?.supplierId) {
    const localSupplierId = result.localSupplierId ?? payload.localSupplierId ?? payload.supplier?.localId ?? payload.localId;
    if (localSupplierId) mappings.push({ entityType: SYNC_ENTITY_TYPES.SUPPLIER, localId: localSupplierId, serverId: result.supplierId });
  }
  if (result?.ledgerEntryId) {
    const payment = payload?.payment && typeof payload.payment === "object" && !Array.isArray(payload.payment)
      ? payload.payment
      : {};
    const localLedgerEntryIds = [
      result.localLedgerEntryId,
      result.local_ledger_entry_id,
      payload.localLedgerEntryId,
      payload.local_ledger_entry_id,
      payload.ledgerEntryId,
      payload.ledger_entry_id,
      payload.clientLedgerId,
      payload.client_ledger_id,
      payment.localLedgerEntryId,
      payment.local_ledger_entry_id,
      payment.ledgerEntryId,
      payment.ledger_entry_id,
      payment.clientLedgerId,
      payment.client_ledger_id,
      payload.paymentId,
      payload.payment_id,
      payload.localPaymentId,
      payload.local_payment_id,
      payload.clientPaymentId,
      payload.client_payment_id,
      payment.paymentId,
      payment.payment_id,
      payment.localPaymentId,
      payment.local_payment_id,
      payment.clientPaymentId,
      payment.client_payment_id,
      event.entity_id,
      payload.localId,
      payload.local_id,
    ].filter((value) => typeof value === "string" && value.trim().length > 0);
    for (const localLedgerEntryId of [...new Set(localLedgerEntryIds)]) {
      mappings.push({ entityType: SYNC_ENTITY_TYPES.LEDGER_ENTRY, localId: localLedgerEntryId, serverId: result.ledgerEntryId });
    }
  }
  if (result?.purchaseHistoryId) {
    const localPurchaseHistoryId = result.localPurchaseHistoryId ?? payload.localPurchaseHistoryId ?? payload.purchaseHistoryId ?? payload.purchaseBillId ?? payload.localId;
    if (localPurchaseHistoryId) mappings.push({ entityType: SYNC_ENTITY_TYPES.PURCHASE_HISTORY, localId: localPurchaseHistoryId, serverId: result.purchaseHistoryId });
  }
  if (result?.stockLedgerId) {
    const localMovementId = result.localMovementId ?? payload.localMovementId ?? payload.movementId ?? payload.inventoryMovementId ?? payload.localId;
    if (localMovementId) mappings.push({ entityType: SYNC_ENTITY_TYPES.STOCK_LEDGER, localId: localMovementId, serverId: result.stockLedgerId });
  }

  for (const mapping of mappings) {
    rememberMappingInContext(context, mapping.entityType, mapping.localId, mapping.serverId);
    await db.syncIdMapping.upsert({
      where: {
        shopId_entityType_localId: {
          shopId,
          entityType: mapping.entityType,
          localId: String(mapping.localId),
        },
      },
      create: {
        shopId,
        entityType: mapping.entityType,
        localId: String(mapping.localId),
        serverId: String(mapping.serverId),
        sourceEventId: getClientEventId(event) || null,
        deviceId: context?.user?.deviceId ?? null,
      },
      update: {
        serverId: String(mapping.serverId),
        sourceEventId: getClientEventId(event) || null,
        deviceId: context?.user?.deviceId ?? null,
      },
    });
  }
}

async function resolveBillBodyReferences(shopId, billBody, context) {
  const resolved = structuredCloneSafe(billBody);
  const customerRef = resolved.serverCustomerId ?? resolved.customerId ?? resolved.localCustomerId;
  if (customerRef) {
    resolved.customerId = await resolveEntityReference(shopId, SYNC_ENTITY_TYPES.CUSTOMER, customerRef, context, { required: true });
  }

  resolved.items = await Promise.all((resolved.items ?? []).map(async (item) => {
    const copy = { ...item };
    const productRef = copy.serverProductId ?? copy.productId ?? copy.localProductId ?? copy.productLocalId;
    if (productRef) {
      copy.productId = await resolveEntityReference(shopId, SYNC_ENTITY_TYPES.PRODUCT, productRef, context, { required: true });
    }
    delete copy.serverProductId;
    delete copy.localProductId;
    delete copy.productLocalId;
    return copy;
  }));

  delete resolved.serverCustomerId;
  delete resolved.localCustomerId;
  return resolved;
}

async function resolveEntityReference(shopId, entityType, rawId, context, { required = false } = {}) {
  if (!rawId) return rawId;
  const id = String(rawId);

  const cached = context?.mappings?.get(mappingKey(entityType, id));
  if (cached?.serverId) return cached.serverId;

  const exists = await entityExists(shopId, entityType, id);
  if (exists) return id;

  const mapping = await db.syncIdMapping.findUnique({
    where: { shopId_entityType_localId: { shopId, entityType, localId: id } },
  });
  if (mapping?.serverId) {
    rememberMappingInContext(context, entityType, id, mapping.serverId);
    return mapping.serverId;
  }

  if (looksLikeClientLocalId(id)) {
    const err = new AppError(`Server id not available yet for local ${entityType} id: ${id}`, 425);
    err.code = "SYNC_DEPENDENCY_PENDING";
    throw err;
  }

  return id;
}

async function entityExists(shopId, entityType, id) {
  if (entityType === SYNC_ENTITY_TYPES.PRODUCT) {
    return Boolean(await db.product.findFirst({ where: { shopId, id, deletedAt: null }, select: { id: true } }));
  }
  if (entityType === SYNC_ENTITY_TYPES.CUSTOMER) {
    return Boolean(await db.customer.findFirst({ where: { shopId, id, deletedAt: null }, select: { id: true } }));
  }
  if (entityType === SYNC_ENTITY_TYPES.BILL) {
    return Boolean(await db.bill.findFirst({ where: { shopId, id }, select: { id: true } }));
  }
  if (entityType === SYNC_ENTITY_TYPES.SUPPLIER) {
    return Boolean(await db.supplier.findFirst({ where: { shopId, id, deletedAt: null }, select: { id: true } }));
  }
  if (entityType === SYNC_ENTITY_TYPES.LEDGER_ENTRY) {
    return Boolean(await db.udharLedger.findFirst({ where: { shopId, id }, select: { id: true } }));
  }
  if (entityType === SYNC_ENTITY_TYPES.PURCHASE_HISTORY) {
    return Boolean(await db.purchaseHistory.findFirst({ where: { shopId, id }, select: { id: true } }));
  }
  if (entityType === SYNC_ENTITY_TYPES.STOCK_LEDGER) {
    return Boolean(await db.stockLedger.findFirst({ where: { shopId, id }, select: { id: true } }));
  }
  return false;
}

function looksLikeClientLocalId(id) {
  const normalized = String(id).toLowerCase();
  return normalized.startsWith("local")
    || normalized.startsWith("tmp")
    || normalized.startsWith("temp")
    || normalized.startsWith("offline")
    || normalized.startsWith("client")
    || normalized.startsWith("customer_")
    || normalized.startsWith("product_")
    || normalized.startsWith("bill_")
    || normalized.startsWith("payment_")
    || normalized.startsWith("ledger_")
    || normalized.startsWith("stock_")
    || normalized.startsWith("supplier_")
    || normalized.startsWith("device_")
    || normalized.startsWith("audit_")
    || normalized.includes("indexeddb")
    || normalized.includes("pending")
    || /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized);
}

function collectCreateBillIdentityValues(...sources) {
  const keys = [
    "idempotencyKey",
    "idempotency_key",
    "localBillId",
    "local_bill_id",
    "clientBillId",
    "client_bill_id",
    "localId",
    "local_id",
    "entity_id",
  ];
  const values = new Set();
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    for (const key of keys) {
      const value = source[key];
      if (typeof value === "string" && value.trim().length > 0) values.add(value.trim());
    }
  }
  return values;
}

function getCreateBillIdentity(event, payload, billBody) {
  const clientBillId = pickString(
    payload?.clientBillId,
    payload?.client_bill_id,
    billBody?.clientBillId,
    billBody?.client_bill_id,
    payload?.localBillId,
    payload?.local_bill_id,
    billBody?.localBillId,
    billBody?.local_bill_id,
    payload?.localId,
    payload?.local_id,
    billBody?.localId,
    billBody?.local_id,
    event?.entity_id
  );
  const idempotencyKey = pickString(
    payload?.idempotencyKey,
    payload?.idempotency_key,
    billBody?.idempotencyKey,
    billBody?.idempotency_key,
    event?.idempotencyKey,
    event?.idempotency_key
  );
  const sourceDeviceId = pickString(
    payload?.sourceDeviceId,
    payload?.source_device_id,
    billBody?.sourceDeviceId,
    billBody?.source_device_id,
    event?.deviceId,
    event?.device_id
  );

  return {
    clientBillId,
    idempotencyKey,
    sourceDeviceId,
    billBodyFields: {
      ...(clientBillId ? { clientBillId, localBillId: clientBillId } : {}),
      ...(idempotencyKey ? { idempotencyKey } : {}),
      ...(sourceDeviceId ? { sourceDeviceId } : {}),
    },
  };
}

async function findExistingBillByCreateIdentity(shopId, identity) {
  if (!identity?.idempotencyKey && !(identity?.sourceDeviceId && identity?.clientBillId)) return null;
  const include = { items: true, payments: true };
  if (identity.idempotencyKey) {
    const byKey = await db.bill.findFirst({
      where: { shopId, idempotencyKey: identity.idempotencyKey },
      include,
    });
    if (byKey) return byKey;
  }
  if (identity.sourceDeviceId && identity.clientBillId) {
    return db.bill.findFirst({
      where: {
        shopId,
        sourceDeviceId: identity.sourceDeviceId,
        clientBillId: identity.clientBillId,
      },
      include,
    });
  }
  return null;
}

function getUdharPaymentIdentity(event, payload, payment) {
  const eventId = getClientEventId(event);
  const clientLedgerId = pickString(
    payment?.clientLedgerId,
    payment?.client_ledger_id,
    payload?.clientLedgerId,
    payload?.client_ledger_id,
    payload?.localLedgerEntryId,
    payload?.local_ledger_entry_id,
    payload?.ledgerEntryId,
    payload?.ledger_entry_id,
    payment?.clientPaymentId,
    payment?.client_payment_id,
    payload?.clientPaymentId,
    payload?.client_payment_id,
    payment?.localPaymentId,
    payment?.local_payment_id,
    payload?.localPaymentId,
    payload?.local_payment_id,
    payment?.paymentId,
    payment?.payment_id,
    payload?.paymentId,
    payload?.payment_id,
    payload?.localId,
    payload?.local_id,
    event?.entity_id
  );
  const idempotencyKey = pickString(
    payment?.idempotencyKey,
    payment?.idempotency_key,
    payload?.idempotencyKey,
    payload?.idempotency_key,
    event?.idempotencyKey,
    event?.idempotency_key
  ) ?? (clientLedgerId ? `udhar-payment:${clientLedgerId}` : eventId ? `udhar-payment:${eventId}` : null);
  const sourceDeviceId = pickString(
    payment?.sourceDeviceId,
    payment?.source_device_id,
    payload?.sourceDeviceId,
    payload?.source_device_id,
    event?.deviceId,
    event?.device_id
  );
  return {
    clientLedgerId,
    idempotencyKey,
    sourceDeviceId,
    paymentFields: {
      ...(clientLedgerId ? { clientLedgerId, localLedgerEntryId: clientLedgerId } : {}),
      ...(idempotencyKey ? { idempotencyKey } : {}),
      ...(sourceDeviceId ? { sourceDeviceId } : {}),
    },
  };
}

function pickString(...values) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function toSyncJsonSafe(value) {
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toSyncJsonSafe);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, toSyncJsonSafe(child)])
  );
}

function structuredCloneSafe(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

async function assertOwnerPermission(shopId, user, ownerPin) {
  if (!env.OWNER_PIN_REQUIRED && user?.role === "owner") return;

  if (!ownerPin) {
    throw new AppError("Owner PIN required for this synced action", 403);
  }
  if (!/^\d{4}$/.test(ownerPin)) {
    throw new AppError("Owner PIN must be exactly 4 digits", 400);
  }

  const owner = await db.user.findFirst({
    where: { shopId, role: "owner" },
    select: { pinHash: true },
  });

  if (!owner) throw new AppError("Owner not found", 404);
  if (!owner.pinHash) throw new AppError("Owner PIN not set yet", 400);

  const ok = await bcrypt.compare(ownerPin, owner.pinHash);
  if (!ok) throw new AppError("Wrong owner PIN", 403);
}

function stripKnownSyncPayloadKeys(payload) {
  const {
    eventId,
    clientEventId,
    type,
    payload: _payload,
    status,
    attempts,
    createdAt,
    updatedAt,
    ownerPin,
    localId,
    localCustomerId,
    localProductId,
    localBillId,
    localSupplierId,
    id,
    productId,
    supplierId,
    changes,
    customer,
    supplier,
    payment,
    ...rest
  } = payload ?? {};
  return rest;
}

function safeJsonParse(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}


function getServerId(result) {
  if (!result || typeof result !== "object") return null;
  return result.billId ?? result.productId ?? result.customerId ?? result.supplierId ?? result.ledgerEntryId ?? result.reversalLedgerEntryId ?? result.purchaseHistoryId ?? result.stockLedgerId ?? null;
}

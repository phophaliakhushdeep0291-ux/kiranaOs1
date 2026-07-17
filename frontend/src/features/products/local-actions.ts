import { offlineDB } from "@/lib/offline/db";
import { ownerPinRequiredActionSchema, productCreationSchema } from "@/lib/validation";
import {
  createLocalId,
  emitLocalDataChanged,
  removeCachedListItem,
  upsertCachedListItem,
  writeInstantCache,
} from "@/lib/offline/instant-cache";
import { buildOutboxOperation, type EnqueueOutboxOperationInput } from "@/features/sync/outbox";
import { normaliseProductInput } from "@/features/products/api";
import { makeLocalEntity, parseOrThrow, touchLocalEntity } from "@/lib/offline/actions/utils";
import type { Product, ProductInput } from "@/types/api";
import { buildAuditLogOutboxInput, buildAuditLogRow, type AuditLogRow } from "@/features/audit-logs/local-actions";
import { uniqueProductAliases } from "@/features/products/product-reliability";

const CACHE_KEY = "products";
const INVENTORY_CACHE_KEY = "inventory";

const PRODUCT_WRITE_TRANSACTION_TABLES = [
  "products",
  "local_audit_logs",
  "sync_outbox",
];

const PRODUCT_IMPORT_TRANSACTION_TABLES = [
  ...PRODUCT_WRITE_TRANSACTION_TABLES,
  "settings",
];

export interface ProductImportOperation {
  action: "create" | "update";
  rowNumber: number;
  input: ProductInput;
  existingProductId?: string;
}

export interface ProductImportMetadata {
  fingerprint: string;
  fileName: string;
  source: string;
  totalRows: number;
  skippedRows: number;
  errorRows: number;
}

export interface ProductImportSession {
  id: string;
  fingerprint: string;
  fileName: string;
  source: string;
  status: "completed";
  startedAt: string;
  completedAt: string;
  totalRows: number;
  createdRows: number;
  updatedRows: number;
  skippedRows: number;
  errorRows: number;
}

export const LAST_PRODUCT_IMPORT_SETTING_KEY = "migration:products:last";

export function productImportSessionSettingKey(fingerprint: string): string {
  return `migration:products:${fingerprint}`;
}

function hasPriceBelowMinimum(product: Product | ProductInput): boolean {
  const min = Number(product.minPricePerRateUnit ?? product.minimumSellingPrice ?? 0);
  if (min <= 0) return false;
  const prices = [
    product.defaultPricePerRateUnit,
    product.sellingPrice,
    product.retailPricePerRateUnit,
    product.retailPrice,
    product.wholesalePricePerRateUnit,
    product.wholesalePrice,
    ...((product.quantitySlabPricing ?? []).map((row) => row.price)),
  ].filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
  return prices.some((price) => price < min);
}

function buildPriceBelowMinimumAudit(product: Product, previous: Product | undefined, ownerPin?: string, reason?: string): AuditLogRow | null {
  if (!hasPriceBelowMinimum(product) || !ownerPin) return null;
  return buildAuditLogRow({
    action: "price_below_minimum",
    entityType: "product",
    entityId: product.id,
    entityLabel: product.name,
    oldValue: previous ?? null,
    newValue: product,
    reason: reason || "Selling price below minimum price approved by owner",
    ownerPinProvided: true,
    summary: `Below-minimum selling price approved for ${product.name}`,
  });
}

async function commitProductWrite(input: {
  product: Product;
  auditLogs: AuditLogRow[];
  outbox: EnqueueOutboxOperationInput;
}) {
  const auditOutboxRows = input.auditLogs.map((row) => buildOutboxOperation(buildAuditLogOutboxInput(row)));
  const productOutboxRow = buildOutboxOperation(input.outbox);

  await offlineDB.transaction(PRODUCT_WRITE_TRANSACTION_TABLES, async (tx) => {
    await tx.put("products", input.product);
    for (const auditLog of input.auditLogs) {
      await tx.put("local_audit_logs", auditLog);
    }
    for (const auditOutbox of auditOutboxRows) {
      await tx.enqueueOutboxOperation(auditOutbox);
    }
    await tx.enqueueOutboxOperation(productOutboxRow);
  });
}

function toProduct(data: ProductInput, id = createLocalId("product"), existing?: Product): Product {
  const now = new Date().toISOString();
  const normalized = normaliseProductInput(data);
  return {
    ...existing,
    id,
    name: normalized.name,
    category: normalized.category ?? existing?.category ?? "general",
    unit: normalized.unit ?? normalized.displayUnit ?? existing?.unit ?? existing?.displayUnit ?? "piece",
    aliases: uniqueProductAliases(normalized.aliases ?? existing?.aliases ?? []),
    barcode: normalized.barcode ?? existing?.barcode ?? null,
    sku: normalized.sku ?? normalized.barcode ?? existing?.sku ?? null,
    displayUnit: normalized.displayUnit,
    baseUnit: normalized.baseUnit,
    rateUnit: normalized.rateUnit,
    stockBaseQty: normalized.stockBaseQty,
    stockQuantity: normalized.stockQuantity,
    stockUnit: normalized.stockUnit ?? normalized.displayUnit,
    stockTrackingEnabled: true,
    trackStock: true,
    costPerRateUnit: normalized.averageCostPrice ?? normalized.costPerRateUnit,
    costPrice: normalized.averageCostPrice ?? normalized.costPrice ?? normalized.costPerRateUnit,
    averageCostPrice: normalized.averageCostPrice ?? normalized.costPrice ?? normalized.costPerRateUnit,
    minPricePerRateUnit: normalized.minPricePerRateUnit,
    minimumSellingPrice: normalized.minimumSellingPrice ?? normalized.minPricePerRateUnit,
    defaultPricePerRateUnit: normalized.defaultPricePerRateUnit,
    sellingPrice: normalized.sellingPrice ?? normalized.defaultPricePerRateUnit,
    retailPricePerRateUnit: normalized.retailPricePerRateUnit,
    retailPrice: normalized.retailPrice ?? normalized.retailPricePerRateUnit,
    retailFromQuantity: normalized.retailFromQuantity ?? existing?.retailFromQuantity ?? 1,
    wholesalePricePerRateUnit: normalized.wholesalePricePerRateUnit,
    wholesalePrice: normalized.wholesalePrice ?? normalized.wholesalePricePerRateUnit,
    wholesaleFromQuantity: normalized.wholesaleFromQuantity ?? existing?.wholesaleFromQuantity ?? 10,
    quantitySlabPricing: [],
    customerSpecificPricing: [],
    sellingUnits: normalized.sellingUnits ?? existing?.sellingUnits ?? [],
    gstRate: normalized.gstRate,
    hsn: normalized.hsn ?? existing?.hsn ?? null,
    brand: normalized.brand ?? existing?.brand ?? null,
    mrp: normalized.mrp ?? existing?.mrp ?? 0,
    reorderLevel: normalized.reorderLevel ?? existing?.reorderLevel ?? 0,
    description: normalized.description ?? existing?.description ?? null,
    imageUrl: normalized.imageUrl ?? existing?.imageUrl ?? null,
    isLooseItem: normalized.isLooseItem ?? existing?.isLooseItem ?? false,
    lowStockThreshold: normalized.lowStockThreshold,
    lowStockAlert: normalized.lowStockAlert ?? normalized.lowStockThreshold,
    isActive: normalized.isActive,
    status: normalized.status,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    deletedAt: null,
  };
}

/** Mirrors backend normalizeProductName (productRecycleRules.js) exactly. */
function normalizeProductName(name = ""): string {
  return String(name).trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Fail fast on duplicate product names BEFORE anything persists. The server
 * enforces this (409 PRODUCT_NAME_DUPLICATE) — without the local guard a
 * duplicate saves locally, then its CREATE_PRODUCT sync op conflicts forever.
 * The message steers the user to the right model: one product, many packagings.
 */
async function assertNoLocalProductNameConflict(name: string, excludeId?: string): Promise<void> {
  const normalized = normalizeProductName(name);
  if (!normalized) return;
  const products = await offlineDB.getAll<Product>("products").catch(() => [] as Product[]);
  const duplicate = products.find((row) =>
    row.id !== excludeId
    && !row.deletedAt
    && row.status !== "deleted"
    && normalizeProductName(row.name) === normalized);
  if (duplicate) {
    const error = new Error(
      `A product named "${duplicate.name}" already exists. To sell it in another pack size, edit that product and add a packaging under Selling units — don't create a duplicate.`,
    );
    (error as Error & { code?: string }).code = "PRODUCT_NAME_DUPLICATE";
    throw error;
  }
}

export async function createProductLocalFirst(data: ProductInput): Promise<Product> {
  const validated = parseOrThrow(productCreationSchema, data) as unknown as ProductInput;
  await assertNoLocalProductNameConflict(validated.name);
  const product = makeLocalEntity(toProduct(validated), "product", "pending_sync");
  const auditLogs = [
    buildAuditLogRow({
      action: "product_created",
      entityType: "product",
      entityId: product.id,
      entityLabel: product.name,
      newValue: product,
      ownerPinProvided: Boolean(validated.ownerPin),
      reason: validated.ownerPinReason,
      summary: `Product ${product.name} created`,
    }),
  ];
  const priceAudit = buildPriceBelowMinimumAudit(product, undefined, validated.ownerPin, validated.ownerPinReason);
  if (priceAudit) auditLogs.push(priceAudit);

  await commitProductWrite({
    product,
    auditLogs,
    outbox: {
      entity_type: "product",
      entity_id: product.id,
      operation_type: "CREATE_PRODUCT",
      payload: { localProductId: product.id, product: data, ownerPin: validated.ownerPin, reason: validated.ownerPinReason, ownerPinProvided: Boolean(validated.ownerPin) },
    },
  });
  upsertCachedListItem<Product>(CACHE_KEY, product, 1000);
  upsertCachedListItem<Product>(INVENTORY_CACHE_KEY, product, 1000);
  emitLocalDataChanged({ entityType: "product", action: "created", entityId: product.id });
  return product;
}

export async function updateProductLocalFirst(id: string, data: ProductInput): Promise<Product> {
  const validated = parseOrThrow(productCreationSchema, data) as unknown as ProductInput;
  await assertNoLocalProductNameConflict(validated.name, id);
  const existing = await offlineDB.getAll<Product>("products").then((rows) => rows.find((row) => row.id === id)).catch(() => undefined);
  const product = touchLocalEntity(toProduct(validated, id, existing), "pending_sync");
  const auditLogs = [
    buildAuditLogRow({
      action: "product_edited",
      entityType: "product",
      entityId: id,
      entityLabel: product.name,
      oldValue: existing ?? null,
      newValue: product,
      ownerPinProvided: Boolean(validated.ownerPin),
      reason: validated.ownerPinReason,
      summary: `Product ${product.name} edited`,
    }),
  ];
  const priceAudit = buildPriceBelowMinimumAudit(product, existing, validated.ownerPin, validated.ownerPinReason);
  if (priceAudit) auditLogs.push(priceAudit);

  await commitProductWrite({
    product,
    auditLogs,
    outbox: {
      entity_type: "product",
      entity_id: id,
      operation_type: "UPDATE_PRODUCT",
      payload: { productId: id, product: data, ownerPin: validated.ownerPin, reason: validated.ownerPinReason, ownerPinProvided: Boolean(validated.ownerPin) },
    },
  });
  upsertCachedListItem<Product>(CACHE_KEY, product, 1000);
  upsertCachedListItem<Product>(INVENTORY_CACHE_KEY, product, 1000);
  emitLocalDataChanged({ entityType: "product", action: "updated", entityId: product.id });
  return product;
}

/**
 * Commit a reviewed product migration as one IndexedDB transaction. Either every accepted
 * row, audit entry, and sync operation is stored, or none is. Re-selecting the same file is
 * safe because the dry-run reconciler will match the products created by the first import.
 */
export async function importProductsLocalFirst(
  operations: ProductImportOperation[],
  metadata: ProductImportMetadata,
): Promise<ProductImportSession> {
  const startedAt = new Date().toISOString();
  const existingProducts = await offlineDB.getAll<Product>("products");
  const existingById = new Map(existingProducts.map((product) => [product.id, product]));
  const seenUpdateIds = new Set<string>();
  const products: Product[] = [];
  const auditLogs: AuditLogRow[] = [];
  const productOutboxInputs: EnqueueOutboxOperationInput[] = [];

  for (const operation of operations) {
    const validated = parseOrThrow(productCreationSchema, operation.input) as unknown as ProductInput;
    const existing = operation.action === "update" && operation.existingProductId
      ? existingById.get(operation.existingProductId)
      : undefined;

    if (operation.action === "update") {
      if (!operation.existingProductId || !existing) {
        throw new Error(`Import row ${operation.rowNumber} no longer matches an existing product. Run the dry-run again.`);
      }
      if (seenUpdateIds.has(operation.existingProductId)) {
        throw new Error(`More than one import row targets ${existing.name}. Resolve the duplicate rows before importing.`);
      }
      seenUpdateIds.add(operation.existingProductId);
    }

    const product = operation.action === "create"
      ? makeLocalEntity(toProduct(validated), "product", "pending_sync")
      : touchLocalEntity(toProduct(validated, existing!.id, existing), "pending_sync");
    products.push(product);

    const auditLog = buildAuditLogRow({
      action: operation.action === "create" ? "product_import_created" : "product_import_updated",
      entityType: "product",
      entityId: product.id,
      entityLabel: product.name,
      oldValue: existing ?? null,
      newValue: product,
      reason: `Product migration from ${metadata.fileName}, row ${operation.rowNumber}`,
      ownerPinProvided: Boolean(validated.ownerPin),
      summary: `${operation.action === "create" ? "Created" : "Updated"} ${product.name} from product migration`,
    });
    auditLogs.push(auditLog);

    const priceAudit = buildPriceBelowMinimumAudit(product, existing, validated.ownerPin, validated.ownerPinReason);
    if (priceAudit) auditLogs.push(priceAudit);

    productOutboxInputs.push(operation.action === "create"
      ? {
          entity_type: "product",
          entity_id: product.id,
          operation_type: "CREATE_PRODUCT",
          payload: {
            localProductId: product.id,
            product: validated,
            importFingerprint: metadata.fingerprint,
            importRowNumber: operation.rowNumber,
            ownerPin: validated.ownerPin,
            reason: validated.ownerPinReason,
            ownerPinProvided: Boolean(validated.ownerPin),
          },
        }
      : {
          entity_type: "product",
          entity_id: product.id,
          operation_type: "UPDATE_PRODUCT",
          payload: {
            productId: product.id,
            product: validated,
            importFingerprint: metadata.fingerprint,
            importRowNumber: operation.rowNumber,
            ownerPin: validated.ownerPin,
            reason: validated.ownerPinReason,
            ownerPinProvided: Boolean(validated.ownerPin),
          },
        });
  }

  const completedAt = new Date().toISOString();
  const session: ProductImportSession = {
    id: `product-import-${metadata.fingerprint}`,
    fingerprint: metadata.fingerprint,
    fileName: metadata.fileName,
    source: metadata.source,
    status: "completed",
    startedAt,
    completedAt,
    totalRows: metadata.totalRows,
    createdRows: operations.filter((operation) => operation.action === "create").length,
    updatedRows: operations.filter((operation) => operation.action === "update").length,
    skippedRows: metadata.skippedRows,
    errorRows: metadata.errorRows,
  };

  const summaryAudit = buildAuditLogRow({
    action: "product_import_completed",
    entityType: "product_import",
    entityId: session.id,
    entityLabel: metadata.fileName,
    newValue: session,
    reason: `Imported ${session.createdRows} new and ${session.updatedRows} existing products`,
    summary: `Product migration completed from ${metadata.fileName}`,
  });
  auditLogs.push(summaryAudit);

  const outboxRows = [
    ...productOutboxInputs.map((input) => buildOutboxOperation(input)),
    ...auditLogs.map((auditLog) => buildOutboxOperation(buildAuditLogOutboxInput(auditLog))),
  ];

  await offlineDB.transaction(PRODUCT_IMPORT_TRANSACTION_TABLES, async (tx) => {
    await tx.putMany("products", products);
    await tx.putMany("local_audit_logs", auditLogs);
    await tx.putMany("sync_outbox", outboxRows);
    await tx.setSetting(productImportSessionSettingKey(metadata.fingerprint), session);
    await tx.setSetting(LAST_PRODUCT_IMPORT_SETTING_KEY, session);
  });

  const refreshedProducts = (await offlineDB.getAll<Product>("products")).slice(0, 1000);
  writeInstantCache(CACHE_KEY, refreshedProducts, 3650);
  writeInstantCache(INVENTORY_CACHE_KEY, refreshedProducts, 3650);
  emitLocalDataChanged({
    entityType: "product",
    action: "bulk_imported",
    count: products.length,
    importFingerprint: metadata.fingerprint,
  });
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("kirana:sync-queue-updated", {
      detail: { action: "bulk_enqueued", count: outboxRows.length },
    }));
  }
  return session;
}

export async function deleteProductLocalFirst(id: string, ownerPin: string, reason?: string): Promise<Product> {
  parseOrThrow(ownerPinRequiredActionSchema, { action: "delete_product", ownerPin, reason, entityId: id });
  const existing = await offlineDB.getAll<Product>("products").then((rows) => rows.find((row) => row.id === id)).catch(() => undefined);
  const now = new Date().toISOString();
  const deleted: Product = {
    ...(existing ?? { id, name: "Deleted product", defaultPricePerRateUnit: 0 }),
    id,
    deletedAt: now,
    updatedAt: now,
  };
  const deletedRecord = { ...deleted, deleted_at: now, sync_status: "pending_sync" as const };
  const cleanReason = reason?.trim() || "Moved to recycle bin";
  const auditLogs = [
    buildAuditLogRow({
      action: "product_deleted",
      entityType: "product",
      entityId: id,
      entityLabel: existing?.name ?? id,
      oldValue: existing ?? null,
      newValue: deletedRecord,
      reason: cleanReason,
      ownerPinProvided: true,
      summary: `Product ${existing?.name ?? id} moved to recycle bin`,
    }),
  ];

  await commitProductWrite({
    product: deletedRecord,
    auditLogs,
    outbox: {
      entity_type: "product",
      entity_id: id,
      operation_type: "DELETE_PRODUCT_PENDING",
      payload: { productId: id, ownerPin, reason: cleanReason, ownerPinProvided: true },
    },
  });
  removeCachedListItem<Product>(CACHE_KEY, id);
  removeCachedListItem<Product>(INVENTORY_CACHE_KEY, id);
  emitLocalDataChanged({ entityType: "product", action: "deleted", entityId: id });
  return deleted;
}

export async function patchProductLocalFirst(id: string, data: Partial<ProductInput>, ownerPin?: string, reason?: string): Promise<Product> {
  const existing = await offlineDB.getAll<Product>("products").then((rows) => rows.find((row) => row.id === id)).catch(() => undefined);
  const fallbackInput: ProductInput = {
    name: existing?.name ?? "Product",
    category: existing?.category ?? "general",
    unit: existing?.unit ?? existing?.displayUnit ?? "piece",
    displayUnit: existing?.displayUnit ?? existing?.unit ?? "piece",
    baseUnit: existing?.baseUnit ?? existing?.displayUnit ?? "piece",
    rateUnit: existing?.rateUnit ?? existing?.displayUnit ?? "piece",
    barcode: existing?.barcode ?? undefined,
    aliases: existing?.aliases ?? [],
    stockBaseQty: existing?.stockBaseQty ?? 0,
    stockTrackingEnabled: true,
    costPerRateUnit: existing?.averageCostPrice ?? existing?.costPerRateUnit ?? existing?.costPrice ?? 0,
    costPrice: existing?.averageCostPrice ?? existing?.costPrice ?? existing?.costPerRateUnit ?? 0,
    averageCostPrice: existing?.averageCostPrice ?? existing?.costPrice ?? existing?.costPerRateUnit ?? 0,
    minPricePerRateUnit: existing?.minPricePerRateUnit ?? existing?.minimumSellingPrice ?? 0,
    minimumSellingPrice: existing?.minimumSellingPrice ?? existing?.minPricePerRateUnit ?? 0,
    defaultPricePerRateUnit: existing?.defaultPricePerRateUnit ?? existing?.sellingPrice ?? 0,
    sellingPrice: existing?.sellingPrice ?? existing?.defaultPricePerRateUnit ?? 0,
    retailPricePerRateUnit: existing?.retailPricePerRateUnit ?? existing?.retailPrice ?? existing?.defaultPricePerRateUnit ?? 0,
    retailPrice: existing?.retailPrice ?? existing?.retailPricePerRateUnit ?? existing?.defaultPricePerRateUnit ?? 0,
    retailFromQuantity: existing?.retailFromQuantity ?? 1,
    wholesalePricePerRateUnit: existing?.wholesalePricePerRateUnit ?? existing?.wholesalePrice ?? existing?.defaultPricePerRateUnit ?? 0,
    wholesalePrice: existing?.wholesalePrice ?? existing?.wholesalePricePerRateUnit ?? existing?.defaultPricePerRateUnit ?? 0,
    wholesaleFromQuantity: existing?.wholesaleFromQuantity ?? 10,
    quantitySlabPricing: [],
    customerSpecificPricing: [],
    gstRate: existing?.gstRate ?? 0,
    lowStockThreshold: existing?.lowStockThreshold ?? existing?.lowStockAlert ?? 0,
    lowStockAlert: existing?.lowStockAlert ?? existing?.lowStockThreshold ?? 0,
    isActive: existing?.isActive ?? existing?.status !== "inactive",
    status: existing?.status ?? "active",
  };
  const nextInput = { ...fallbackInput, ...data, ownerPin: ownerPin ?? data.ownerPin, ownerPinReason: reason ?? data.ownerPinReason };
  const validated = parseOrThrow(productCreationSchema, nextInput) as unknown as ProductInput;
  const product = touchLocalEntity(toProduct(validated, id, existing), "pending_sync");
  const auditLogs = [
    buildAuditLogRow({
      action: "product_edited",
      entityType: "product",
      entityId: id,
      entityLabel: product.name,
      oldValue: existing ?? null,
      newValue: product,
      ownerPinProvided: Boolean(ownerPin),
      reason,
      summary: `Product ${product.name} edited`,
    }),
  ];
  const priceAudit = buildPriceBelowMinimumAudit(product, existing, ownerPin, reason);
  if (priceAudit) auditLogs.push(priceAudit);

  await commitProductWrite({
    product,
    auditLogs,
    outbox: {
      entity_type: "product",
      entity_id: id,
      operation_type: "UPDATE_PRODUCT",
      payload: { productId: id, product: data, ownerPin, reason, ownerPinProvided: Boolean(ownerPin) },
    },
  });
  upsertCachedListItem<Product>(CACHE_KEY, product, 1000);
  upsertCachedListItem<Product>(INVENTORY_CACHE_KEY, product, 1000);
  emitLocalDataChanged({ entityType: "product", action: "updated", entityId: product.id });
  return product;
}

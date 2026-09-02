import { offlineDB } from "@/lib/offline/db";
import { ownerPinRequiredActionSchema, productCreationSchema } from "@/lib/validation";
import {
  createLocalId,
  emitLocalDataChanged,
  removeCachedListItem,
  upsertCachedListItem,
  writeInstantCache,
} from "@/lib/offline/instant-cache";
import { buildOutboxOperation, type EnqueueOutboxOperationInput } from "@/features/core/sync/outbox";
import { normaliseProductInput } from "@/features/core/products/api";
import { makeLocalEntity, parseOrThrow, touchLocalEntity } from "@/lib/offline/actions/utils";
import type { Product, ProductInput } from "@/types/api";
import { buildAuditLogOutboxInput, buildAuditLogRow, type AuditLogRow } from "@/features/core/audit-logs/local-actions";
import { uniqueProductAliases } from "@/features/core/products/product-reliability";
// The value helpers only, never the catalogue: this module is reachable from the
// app entry, so importing product-attributes.ts here puts all twelve trades'
// field labels in front of every shop's first paint. See the note in
// product-attribute-values.ts.
import { normalizeProductAttributes, type ProductAttributes } from "@/features/core/products/product-attribute-values";
import { getActiveLocationId } from "@/features/core/stores/location-context";

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

/**
 * Older product records predate `packagingMode`. Their per-pack quantities are
 * still an authoritative record of how they are tracked, so infer that mode
 * before comparing an edit. Otherwise a normal save would look like a dangerous
 * pooled → per-pack conversion and be blocked even though nothing changed.
 */
function packagingModeForExistingProduct(product: Product | undefined): "pooled" | "per_pack" {
  if (product?.packagingMode === "per_pack" || product?.packagingMode === "pooled") {
    return product.packagingMode;
  }
  return product?.sellingUnits?.some((unit) => unit.onHandQty != null) ? "per_pack" : "pooled";
}

/**
 * A product with stock cannot safely switch between pooled and per-pack tracking.
 * The server enforces the same rule, but rejecting it here keeps an offline edit
 * from being written locally and then appearing as an unresolvable sync conflict.
 */
function assertPackagingModeChangeIsSafe(existing: Product | undefined, next: ProductInput) {
  if (!existing) return;
  const currentMode = packagingModeForExistingProduct(existing);
  const nextMode = String(next.packagingMode ?? currentMode).trim().toLowerCase();
  const stockOnHand = Number(existing.stockBaseQty ?? 0);
  if (currentMode === nextMode || !Number.isFinite(stockOnHand) || Math.abs(stockOnHand) < 0.000_001) return;

  const error = new Error(
    "Count this product's stock to zero before changing how it tracks pack-level inventory. Sync that stock correction, then change the packaging setup.",
  ) as Error & { code?: string };
  error.code = "PACKAGING_MODE_STOCK_MIGRATION_REQUIRED";
  throw error;
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

/**
 * The offline twin of the server's attribute merge (product-attributes.js).
 *
 * It has to be a merge here for the same reason it is one there, and the local
 * copy has to agree with the server's or the device would show a different
 * product than the one it just saved: the form sends only the current trade's
 * fields, so replacing the bag locally would blank whatever an earlier trade
 * recorded until the next pull put it back. A key named with no value is a
 * deliberate clear, which is how the form deletes a detail.
 */
function mergeLocalProductAttributes(
  existing: ProductAttributes | undefined,
  incoming: ProductAttributes | undefined,
): ProductAttributes {
  const base = normalizeProductAttributes(existing);
  if (!incoming || typeof incoming !== "object") return base;
  const merged: ProductAttributes = { ...base };
  for (const [key, value] of Object.entries(incoming)) {
    const cleared = value === null || value === undefined || (typeof value === "string" && !value.trim());
    if (cleared) delete merged[key];
    else merged[key] = typeof value === "string" ? value.trim() : value;
  }
  return normalizeProductAttributes(merged);
}

function toProduct(data: ProductInput, id = createLocalId("product"), existing?: Product): Product {
  const now = new Date().toISOString();
  const normalized = normaliseProductInput(data);
  const trackStock = normalized.stockTrackingEnabled ?? normalized.trackStock
    ?? existing?.stockTrackingEnabled ?? existing?.trackStock ?? true;
  return {
    ...existing,
    id,
    name: normalized.name,
    packagingMode: normalized.packagingMode ?? packagingModeForExistingProduct(existing),
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
    stockTrackingEnabled: trackStock,
    trackStock,
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
    variantAxes: normalized.variantAxes ?? existing?.variantAxes ?? [],
    gstRate: normalized.gstRate,
    hsn: normalized.hsn ?? existing?.hsn ?? null,
    brand: normalized.brand ?? existing?.brand ?? null,
    mrp: normalized.mrp ?? existing?.mrp ?? 0,
    reorderLevel: normalized.reorderLevel ?? existing?.reorderLevel ?? 0,
    description: normalized.description ?? existing?.description ?? null,
    imageUrl: normalized.imageUrl ?? existing?.imageUrl ?? null,
    isLooseItem: normalized.isLooseItem ?? existing?.isLooseItem ?? false,
    lowStockThreshold: normalized.lowStockThreshold,
    batchTrackingEnabled: normalized.batchTrackingEnabled ?? existing?.batchTrackingEnabled ?? false,
    drugSchedule: Object.prototype.hasOwnProperty.call(normalized, "drugSchedule")
      ? normalized.drugSchedule ?? null
      : existing?.drugSchedule ?? null,
    attributes: mergeLocalProductAttributes(existing?.attributes, normalized.attributes),
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
  const [products, mappings] = await Promise.all([
    offlineDB.getAll<Product>("products").catch(() => [] as Product[]),
    offlineDB.getAll<Record<string, unknown>>("id_mappings").catch(() => [] as Record<string, unknown>[]),
  ]);

  /**
   * Local ids the sync layer has already re-issued under a server id.
   *
   * `replaceLocalEntityId` normally DELETES the optimistic row the moment the push
   * lands, so this is usually empty of anything still in `products`. It skips the
   * delete when the row no longer passes `rowMatchesCurrentScope` though — switch
   * store while a create is in flight and the twin outlives its server copy. The twin
   * keeps the SAME name, so counting it makes the product permanently uneditable, and
   * the message tells the owner not to duplicate the very thing they are editing.
   * The mapping is written in the same breath as the server id, so it is the one
   * record that always knows a twin is a twin.
   */
  const retiredLocalIds = new Set(
    mappings
      .filter((row) => (row.entity_type === undefined || row.entity_type === "product")
        && typeof row.local_id === "string"
        && typeof row.server_id === "string"
        && row.local_id !== row.server_id)
      .map((row) => String(row.local_id)),
  );

  // A row is "gone" if it was deleted (either casing) or is a merged twin — the local
  // optimistic row that reconcile retires once its server copy arrives. Merged twins
  // keep the SAME name, so counting them would make editing any synced product fail.
  const isGone = (row: Record<string, unknown>) =>
    Boolean(row.deletedAt ?? row.deleted_at ?? row.merged_into_id ?? row.mergedIntoId)
    || row.status === "deleted"
    || (typeof row.id === "string" && retiredLocalIds.has(row.id));

  // The same logical product can be stored under its local id and its server id.
  // Treat any of them matching excludeId as "this is the product being edited".
  const isSameEntity = (row: Record<string, unknown>) =>
    Boolean(excludeId) && [row.id, row.local_id, row.server_id, row.localProductId, row.clientProductId]
      .some((candidate) => typeof candidate === "string" && candidate === excludeId);

  const duplicate = products.find((row) => {
    const record = row as unknown as Record<string, unknown>;
    if (isSameEntity(record) || isGone(record)) return false;
    return normalizeProductName(row.name) === normalized;
  });
  if (duplicate) {
    const error = new Error(
      `A product named "${duplicate.name}" already exists. To sell it in another pack size, edit that product and add a packaging under Selling units — don't create a duplicate.`,
    );
    (error as Error & { code?: string }).code = "PRODUCT_NAME_DUPLICATE";
    throw error;
  }
}

/* ─── Capture-on-first-scan ─────────────────────────────────────────────────
 *
 * The till teaches the catalog a barcode by being used: an unknown code opens a sheet,
 * the cashier picks the item, and the code binds. That write happens at the counter,
 * offline, mid-queue — so the rules below are enforced here AND again by the server's
 * unique index. This copy exists to fail fast with a message naming the owning product;
 * it is not the guard. See backend/prisma/migrations/20260807170000_product_barcode_unique.
 */

export type ProductBarcodeBindErrorCode =
  | "PRODUCT_BARCODE_REQUIRED"
  | "PRODUCT_NOT_FOUND"
  | "PRODUCT_BARCODE_ALREADY_SET"
  | "PRODUCT_BARCODE_DUPLICATE";

export class ProductBarcodeBindError extends Error {
  code: ProductBarcodeBindErrorCode;
  owner?: { id: string; name: string };

  constructor(code: ProductBarcodeBindErrorCode, message: string, owner?: { id: string; name: string }) {
    super(message);
    this.name = "ProductBarcodeBindError";
    this.code = code;
    this.owner = owner;
  }
}

export function normalizeBarcodeValue(raw: string | null | undefined): string {
  return String(raw ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Which product already answers to this code?
 *
 * Matches barcode OR sku, because resolveScanMatch() on the till scans both — a code
 * sitting in the other column would pass a barcode-only check and still make the next
 * scan ambiguous. Soft-deleted rows count: they can be restored, and releasing their
 * code would let that restore create a real duplicate.
 */
export function findLocalBarcodeOwner(
  code: string,
  products: Product[],
  excludeProductId?: string,
): Product | undefined {
  const needle = normalizeBarcodeValue(code).toLowerCase();
  if (!needle) return undefined;
  return products.find((row) => {
    const record = row as unknown as Record<string, unknown>;
    const isSameEntity = [record.id, record.local_id, record.server_id]
      .some((candidate) => typeof candidate === "string" && candidate === excludeProductId);
    if (isSameEntity) return false;
    const unitCodes = (row.sellingUnits ?? []).flatMap((unit) => [unit.barcode, unit.sku]);
    return [row.barcode, row.sku, ...unitCodes]
      .some((value) => value != null && normalizeBarcodeValue(String(value)).toLowerCase() === needle);
  });
}

type ProductCodeCandidate = Pick<ProductInput, "barcode" | "sku" | "sellingUnits">;

function productCodeAssignments(candidate: ProductCodeCandidate) {
  const assignments: Array<{ code: string; normalized: string; ownerKey: string; label: string }> = [];
  const add = (value: unknown, ownerKey: string, label: string) => {
    const code = normalizeBarcodeValue(typeof value === "string" ? value : null);
    if (code) assignments.push({ code, normalized: code.toLowerCase(), ownerKey, label });
  };
  add(candidate.barcode, "default", "product barcode");
  add(candidate.sku, "default", "product SKU");
  (candidate.sellingUnits ?? []).forEach((unit, index) => {
    const ownerKey = unit.isDefault ? "default" : `unit:${unit.unitCode || index}`;
    const label = unit.isDefault ? "default selling unit" : `${unit.unitCode || unit.name || `pack ${index + 1}`} pack`;
    add(unit.barcode, ownerKey, `${label} barcode`);
    add(unit.sku, ownerKey, `${label} SKU`);
  });
  return assignments;
}

/** Fail before IndexedDB/audit/outbox writes if the next scan would be ambiguous. */
async function assertNoLocalProductCodeConflict(candidate: ProductCodeCandidate, excludeProductId?: string): Promise<void> {
  const assignments = productCodeAssignments(candidate);
  const requested = new Map<string, (typeof assignments)[number]>();
  for (const assignment of assignments) {
    const previous = requested.get(assignment.normalized);
    if (previous && previous.ownerKey !== assignment.ownerKey) {
      throw new ProductBarcodeBindError(
        "PRODUCT_BARCODE_DUPLICATE",
        `Code ${assignment.code} is assigned to both ${previous.label} and ${assignment.label}`,
      );
    }
    if (!previous) requested.set(assignment.normalized, assignment);
  }
  if (requested.size === 0) return;

  const products = await offlineDB.getAll<Product>("products").catch(() => [] as Product[]);
  for (const assignment of requested.values()) {
    const owner = findLocalBarcodeOwner(assignment.code, products, excludeProductId);
    if (!owner) continue;
    throw new ProductBarcodeBindError(
      "PRODUCT_BARCODE_DUPLICATE",
      `Code ${assignment.code} already belongs to "${owner.name}"${owner.deletedAt || (owner as unknown as Record<string, unknown>).deleted_at ? " in the recycle bin" : ""}`,
      { id: owner.id, name: owner.name },
    );
  }
}

/**
 * Bind a scanned code to a product that has none yet.
 *
 * Never rebinds: a product that already answers to a code keeps it, because a cashier
 * scanning the wrong packet during a queue must not be able to repoint an existing
 * barcode. Changing one is an explicit action from the product screen.
 *
 * Re-binding the SAME code is a no-op success, and the outbox op is keyed deterministically
 * on (product, code) — the outbox is keyed by clientEventId and the server dedupes on
 * (shopId, eventId), so a bind that is queued twice, or replayed after a failed push,
 * still lands exactly once.
 */
export async function bindProductBarcodeLocalFirst(productId: string, barcode: string): Promise<Product> {
  const code = normalizeBarcodeValue(barcode);
  if (!code) throw new ProductBarcodeBindError("PRODUCT_BARCODE_REQUIRED", "A barcode is required");

  const products = await offlineDB.getAll<Product>("products").catch(() => [] as Product[]);
  const existing = products.find((row) => {
    const record = row as unknown as Record<string, unknown>;
    return [record.id, record.local_id, record.server_id]
      .some((candidate) => typeof candidate === "string" && candidate === productId);
  });
  if (!existing) throw new ProductBarcodeBindError("PRODUCT_NOT_FOUND", "Product not found");

  const current = normalizeBarcodeValue(existing.barcode);
  // Idempotent replay: this exact bind already landed on this device.
  if (current && current.toLowerCase() === code.toLowerCase()) return existing;
  if (current) {
    throw new ProductBarcodeBindError(
      "PRODUCT_BARCODE_ALREADY_SET",
      `"${existing.name}" already has barcode ${current}. Change it from the product screen.`,
      { id: existing.id, name: existing.name },
    );
  }

  const owner = findLocalBarcodeOwner(code, products, existing.id);
  if (owner) {
    throw new ProductBarcodeBindError(
      "PRODUCT_BARCODE_DUPLICATE",
      `Barcode ${code} already belongs to "${owner.name}"`,
      { id: owner.id, name: owner.name },
    );
  }

  const product = touchLocalEntity({
    ...existing,
    barcode: code,
    // sku mirrors barcode the way the create path does, so a scan resolves whichever
    // column the till matches on. An sku the shop already set is left alone.
    sku: normalizeBarcodeValue(existing.sku) ? existing.sku : code,
  }, "pending_sync");

  const auditLogs = [
    buildAuditLogRow({
      action: "product_barcode_bound",
      entityType: "product",
      entityId: existing.id,
      entityLabel: product.name,
      oldValue: { barcode: existing.barcode ?? null, sku: existing.sku ?? null },
      newValue: { barcode: product.barcode, sku: product.sku },
      summary: `Barcode ${code} bound to ${product.name}`,
    }),
  ];

  await commitProductWrite({
    product,
    auditLogs,
    outbox: {
      entity_type: "product",
      entity_id: existing.id,
      operation_type: "BIND_PRODUCT_BARCODE",
      op_id: `barcode-bind:${existing.id}:${code}`,
      idempotency_key: `barcode-bind:${existing.id}:${code}`,
      payload: { productId: existing.id, localProductId: existing.id, barcode: code },
    },
  });
  upsertCachedListItem<Product>(CACHE_KEY, product, 1000);
  upsertCachedListItem<Product>(INVENTORY_CACHE_KEY, product, 1000);
  emitLocalDataChanged({ entityType: "product", action: "updated", entityId: product.id });
  return product;
}

export async function createProductLocalFirst(data: ProductInput): Promise<Product> {
  const validated = parseOrThrow(productCreationSchema, data) as unknown as ProductInput;
  await assertNoLocalProductNameConflict(validated.name);
  await assertNoLocalProductCodeConflict(validated);
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
      payload: { localProductId: product.id, product: data, locationId: getActiveLocationId(), ownerPin: validated.ownerPin, reason: validated.ownerPinReason, ownerPinProvided: Boolean(validated.ownerPin) },
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
  await assertNoLocalProductCodeConflict(validated, id);
  const existing = await offlineDB.getAll<Product>("products").then((rows) => rows.find((row) => row.id === id)).catch(() => undefined);
  assertPackagingModeChangeIsSafe(existing, validated);
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
      payload: { productId: id, product: data, locationId: getActiveLocationId(), ownerPin: validated.ownerPin, reason: validated.ownerPinReason, ownerPinProvided: Boolean(validated.ownerPin) },
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
/**
 * Rebuild the product list caches from what is now in the database.
 *
 * Split out of the import so a batched load can do it once at the end instead of
 * once per batch. It reads the whole table and re-serialises the entire cached
 * array twice, so running it per batch is quadratic — see `deferCacheRefresh`.
 */
export async function refreshProductCaches(): Promise<void> {
  const refreshedProducts = (await offlineDB.getAll<Product>("products")).slice(0, 1000);
  writeInstantCache(CACHE_KEY, refreshedProducts, 3650);
  writeInstantCache(INVENTORY_CACHE_KEY, refreshedProducts, 3650);
}

export interface ImportProductsOptions {
  /**
   * Skip the cache rebuild and leave it to the caller.
   *
   * A batched load calls this function once per batch, and the rebuild reads
   * every product and rewrites both caches whole — so across fourteen batches of
   * the starter catalog it read roughly 3,900 rows and re-serialised about 7,800
   * product objects to produce one final cache. The caller that owns the loop is
   * the only one that knows when the last batch has landed, so it owns the
   * refresh; `refreshProductCaches` is exported for it.
   */
  deferCacheRefresh?: boolean;
}

export async function importProductsLocalFirst(
  operations: ProductImportOperation[],
  metadata: ProductImportMetadata,
  approval?: { ownerPin: string; reason?: string },
  options: ImportProductsOptions = {},
): Promise<ProductImportSession> {
  const startedAt = new Date().toISOString();
  /*
   * Read the products table only when a row in this batch actually targets an
   * existing product. It is consulted for nothing else, and reading it
   * unconditionally made a bulk import quadratic: the starter catalog arrives as
   * fourteen create-only batches, so this was fourteen full scans of a table that
   * each preceding batch had just made bigger — roughly 3,600 rows read to
   * resolve nothing.
   */
  const hasUpdates = operations.some((operation) => operation.action === "update");
  const existingProducts = hasUpdates ? await offlineDB.getAll<Product>("products") : [];
  const existingById = new Map(existingProducts.map((product) => [product.id, product]));
  const seenUpdateIds = new Set<string>();
  const products: Product[] = [];
  const auditLogs: AuditLogRow[] = [];
  const productOutboxInputs: EnqueueOutboxOperationInput[] = [];

  for (const operation of operations) {
    const validated = parseOrThrow(productCreationSchema, {
      ...operation.input,
      ...(approval?.ownerPin ? { ownerPin: approval.ownerPin, ownerPinReason: approval.reason } : {}),
    }) as unknown as ProductInput;
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
            locationId: getActiveLocationId(),
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
            locationId: getActiveLocationId(),
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

  if (!options.deferCacheRefresh) await refreshProductCaches();
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
    stockTrackingEnabled: existing?.stockTrackingEnabled ?? existing?.trackStock ?? true,
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
    sellingUnits: existing?.sellingUnits ?? [],
    variantAxes: existing?.variantAxes ?? [],
    gstRate: existing?.gstRate ?? 0,
    lowStockThreshold: existing?.lowStockThreshold ?? existing?.lowStockAlert ?? 0,
    lowStockAlert: existing?.lowStockAlert ?? existing?.lowStockThreshold ?? 0,
    packagingMode: packagingModeForExistingProduct(existing),
    isActive: existing?.isActive ?? existing?.status !== "inactive",
    status: existing?.status ?? "active",
  };
  const nextInput = { ...fallbackInput, ...data, ownerPin: ownerPin ?? data.ownerPin, ownerPinReason: reason ?? data.ownerPinReason };
  const validated = parseOrThrow(productCreationSchema, nextInput) as unknown as ProductInput;
  assertPackagingModeChangeIsSafe(existing, validated);
  // Callers may provide approval as part of the patch (the product editor does)
  // or as the explicit third/fourth arguments (the inventory flow does). Always
  // use the validated values below: otherwise a valid approval in `data` is
  // silently discarded and the queued protected update can never sync.
  const approvedOwnerPin = validated.ownerPin;
  const approvalReason = validated.ownerPinReason;
  const product = touchLocalEntity(toProduct(validated, id, existing), "pending_sync");
  const auditLogs = [
    buildAuditLogRow({
      action: "product_edited",
      entityType: "product",
      entityId: id,
      entityLabel: product.name,
      oldValue: existing ?? null,
      newValue: product,
      ownerPinProvided: Boolean(approvedOwnerPin),
      reason: approvalReason,
      summary: `Product ${product.name} edited`,
    }),
  ];
  const priceAudit = buildPriceBelowMinimumAudit(product, existing, approvedOwnerPin, approvalReason);
  if (priceAudit) auditLogs.push(priceAudit);

  await commitProductWrite({
    product,
    auditLogs,
    outbox: {
      entity_type: "product",
      entity_id: id,
      operation_type: "UPDATE_PRODUCT",
      payload: {
        productId: id,
        product: data,
        locationId: getActiveLocationId(),
        ownerPin: approvedOwnerPin,
        reason: approvalReason,
        ownerPinProvided: Boolean(approvedOwnerPin),
      },
    },
  });
  upsertCachedListItem<Product>(CACHE_KEY, product, 1000);
  upsertCachedListItem<Product>(INVENTORY_CACHE_KEY, product, 1000);
  emitLocalDataChanged({ entityType: "product", action: "updated", entityId: product.id });
  return product;
}

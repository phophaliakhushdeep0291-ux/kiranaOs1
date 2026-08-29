import { offlineDB, type OfflineWriteTransaction } from "@/lib/offline/db";
import { stockAdjustmentSchema } from "@/lib/validation";
import { createLocalId, readInstantCache, upsertCachedListItem } from "@/lib/offline/instant-cache";
import { buildOutboxOperation, type SyncOutboxOperationType } from "@/features/core/sync/outbox";
import { makeLocalEntity, parseOrThrow, readNumber, roundMoney } from "@/lib/offline/actions/utils";
import type { InventoryItem, Product, StockMovementInput } from "@/types/api";
import { getActiveLocationId } from "@/features/core/stores/location-context";
import { buildAuditLogOutboxInput, buildAuditLogRow } from "@/features/core/audit-logs/local-actions";
import { buildUnitMismatchWarning, fromInventoryBaseQty } from "@/features/core/inventory/calculations";
import { loadAuthSession } from "@/lib/storage/auth-storage";
import {
  findInventorySellingUnit,
  inventoryDisplayQuantity,
  inventoryQuantityToBase,
  inventorySimpleUnit,
  inventoryUnitLabel,
  productTracksStock,
} from "@/features/core/inventory/stock-display";

const PRODUCT_CACHE_KEY = "products";
const INVENTORY_CACHE_KEY = "inventory";
const LEDGER_CACHE_KEY = "inventory_movements";

const STOCK_ADJUSTMENT_TRANSACTION_TABLES = [
  "inventory_movements",
  "products",
  "local_audit_logs",
  "sync_outbox",
];

type StockMovementType = "purchase" | "sale" | "damage" | "correction";

function operationFor(type: StockMovementType): SyncOutboxOperationType {
  if (type === "purchase") return "STOCK_PURCHASE";
  if (type === "sale") return "STOCK_SALE";
  if (type === "damage") return "STOCK_DAMAGE";
  return "STOCK_CORRECTION";
}

function findProduct(productId: string): Product | undefined {
  return readInstantCache<Product[]>(PRODUCT_CACHE_KEY, []).find((product) => product.id === productId);
}

async function getProduct(productId: string): Promise<Product | undefined> {
  return findProduct(productId) ?? offlineDB.getAll<Product>("products").then((rows) => rows.find((row) => row.id === productId)).catch(() => undefined);
}

function allowsNegativeStock(product: Product | undefined, data: StockMovementInput) {
  const source = product as Record<string, unknown> | undefined;
  return Boolean(
    data.allowNegativeStock ??
    data.negativeStockAllowed ??
    source?.allowNegativeStock ??
    source?.negativeStockAllowed,
  );
}

function assertStockMovementRules(input: {
  movementType: StockMovementType;
  reason?: string;
  ownerPin?: string;
  product?: Product;
  productId: string;
  nextStock: number;
  data: StockMovementInput;
}) {
  if (!input.product) throw new Error("Product not found in local records");
  if (!productTracksStock(input.product)) {
    throw new Error("This item is not counted as stock. Track its ingredients or enable stock tracking first.");
  }

  // The server sync handler requires an owner PIN for BOTH correction and damage
  // stock adjustments. Enforce it locally too, so we never persist a movement whose
  // sync op the server will reject forever ("Owner PIN required for this synced action").
  if ((input.movementType === "correction" || input.movementType === "damage") && !input.ownerPin?.trim()) {
    throw new Error(`Owner PIN is required for stock ${input.movementType === "damage" ? "damage write-off" : "correction"}`);
  }

  if (input.movementType === "damage" && !input.reason?.trim()) {
    throw new Error("Reason is required for damaged stock adjustment");
  }

  if (input.movementType === "sale" && input.nextStock < 0) return;

  if (input.nextStock < 0 && !allowsNegativeStock(input.product, input.data)) {
    throw new Error("Negative stock is not allowed for this product. Enable negative stock override only after owner approval.");
  }
}

/**
 * How many of ONE packaging this movement adds or removes, for a product that
 * counts each size separately. Pooled products return 0 and keep using the single
 * shared base-unit number — every size draws on the same sack, so there is nothing
 * to attribute to a size.
 */
function packCountDelta(
  product: Product | undefined,
  movementType: StockMovementType,
  quantity: number,
): number {
  if (product?.packagingMode !== "per_pack") return 0;
  if (movementType === "purchase") return Math.abs(quantity);
  if (movementType === "sale" || movementType === "damage") return -Math.abs(quantity);
  // A correction states an absolute total in base units, which says nothing about
  // WHICH size holds it; the server refuses those for per-pack products too.
  return 0;
}

function buildUpdatedProduct(
  product: Product,
  productId: string,
  deltaBaseQty: number,
  movementType: StockMovementType,
  purchaseCost?: number,
  enteredUnit?: string,
  packDelta = 0,
): InventoryItem {
  const now = new Date().toISOString();
  const previousStock = readNumber(product.stockBaseQty, 0);
  const incomingStock = Math.max(deltaBaseQty, 0);
  const nextStock = roundMoney(previousStock + deltaBaseQty);
  const currentAverageCost = readNumber(product.averageCostPrice ?? product.costPrice ?? product.costPerRateUnit, 0);
  const cleanPurchaseCost = readNumber(purchaseCost, 0);
  const selectedSellingUnit = findInventorySellingUnit(product, enteredUnit);
  const rateUnit = selectedSellingUnit?.unitCode ?? product.stockUnit ?? product.rateUnit ?? product.displayUnit ?? product.unit ?? "piece";
  const previousStockInRateUnit = Math.max(inventoryDisplayQuantity({ ...product, stockBaseQty: previousStock }, rateUnit), 0);
  const incomingStockInRateUnit = Math.max(inventoryDisplayQuantity({ ...product, stockBaseQty: incomingStock }, rateUnit), 0);
  const nextStockInRateUnit = inventoryDisplayQuantity({ ...product, stockBaseQty: nextStock }, rateUnit);
  const displayUnit = inventoryUnitLabel(product, rateUnit);
  const simpleUnit = inventorySimpleUnit(product, rateUnit);
  const nextAverageCost = movementType === "purchase" && cleanPurchaseCost > 0 && incomingStockInRateUnit > 0
    ? roundMoney(((currentAverageCost * previousStockInRateUnit) + (cleanPurchaseCost * incomingStockInRateUnit)) / Math.max(previousStockInRateUnit + incomingStockInRateUnit, incomingStockInRateUnit))
    : currentAverageCost;

  // Per-packaging counts live on the selling unit, and only the size that actually
  // moved changes. Leaving them alone would show the shopkeeper a stale count for
  // the size they just received, which is the number this whole mode exists for.
  const sellingUnits = packDelta === 0 || !selectedSellingUnit
    ? product.sellingUnits
    : product.sellingUnits?.map((unit) => (
      unit.unitCode === selectedSellingUnit.unitCode
        ? { ...unit, onHandQty: roundMoney(readNumber(unit.onHandQty, 0) + packDelta) }
        : unit
    ));

  return {
    ...product,
    id: product.id,
    productId,
    sellingUnits,
    stockBaseQty: nextStock,
    stockQuantity: nextStockInRateUnit,
    stockUnit: rateUnit,
    unit: simpleUnit,
    displayUnit,
    rateUnit: simpleUnit,
    stockTrackingEnabled: productTracksStock(product),
    trackStock: productTracksStock(product),
    averageCostPrice: nextAverageCost,
    costPerRateUnit: nextAverageCost,
    costPrice: nextAverageCost,
    updatedAt: now,
    updated_at: now,
    sync_status: "pending_sync",
    stockNeedsReview: nextStock < 0,
    negativeStockWarning: nextStock < 0 ? "Stock is negative. Add stock when inventory is updated." : undefined,
    isLowStock: nextStock <= readNumber(product.lowStockThreshold, 0),
  } as InventoryItem;
}

function derivePurchaseBillAmount(input: {
  data: StockMovementInput;
  product?: Product;
  baseDelta: number;
  enteredUnit: string;
}) {
  const explicitBillAmount = readNumber(input.data.billAmount, 0);
  if (explicitBillAmount > 0) return explicitBillAmount;

  const unitCost = readNumber(input.data.costPerRateUnit, 0);
  if (unitCost <= 0) return 0;

  const qtyInRateUnit = Math.max(
    input.product
      ? inventoryDisplayQuantity(
        { ...input.product, stockBaseQty: Math.abs(input.baseDelta) },
        findInventorySellingUnit(input.product, input.enteredUnit)?.unitCode
          ?? input.product.stockUnit
          ?? input.product.rateUnit
          ?? input.product.displayUnit
          ?? input.product.unit
          ?? input.enteredUnit,
      )
      : fromInventoryBaseQty(Math.abs(input.baseDelta), input.enteredUnit, input.enteredUnit),
    0,
  );
  return roundMoney(unitCost * qtyInRateUnit);
}

async function stockMovementLocalFirst(
  data: StockMovementInput,
  movementType: StockMovementType,
  options: { tx?: OfflineWriteTransaction; product?: Product; updateCache?: boolean; enqueueStockOutbox?: boolean } = {},
) {
  data = { ...data, locationId: data.locationId ?? getActiveLocationId() ?? undefined };
  const productId = typeof data.productId === "string" ? data.productId : "";
  const quantity = readNumber(data.quantity ?? data.quantityDelta, 0);
  const enteredUnit = typeof data.enteredUnit === "string" ? data.enteredUnit : typeof data.unit === "string" ? data.unit : "piece";
  const product = options.product ?? await getProduct(productId);
  const correctionQuantity = data.quantity !== undefined
    ? readNumber(data.quantity, 0)
    : readNumber(data.quantityDelta, 0);
  const baseDelta = movementType === "purchase"
    ? Math.abs(inventoryQuantityToBase(product, quantity, enteredUnit))
    : movementType === "sale" || movementType === "damage"
      ? -Math.abs(inventoryQuantityToBase(product, quantity, enteredUnit))
      : inventoryQuantityToBase(product, correctionQuantity, enteredUnit);

  const reason = typeof data.note === "string" ? data.note : typeof data.reason === "string" ? data.reason : undefined;
  const ownerPin = typeof data.ownerPin === "string" ? data.ownerPin : undefined;
  const validated = parseOrThrow(stockAdjustmentSchema, {
    productId,
    movementType,
    quantityDelta: baseDelta,
    unit: enteredUnit,
    reason,
    supplierId: data.supplierId,
    supplierName: data.supplierName,
    ownerPin,
  });

  const validatedReason = typeof validated.reason === "string" ? validated.reason : undefined;
  const validatedOwnerPin = typeof validated.ownerPin === "string" ? validated.ownerPin : undefined;
  const previousStock = readNumber(product?.stockBaseQty, 0);
  const purchaseBillAmount = movementType === "purchase"
    ? derivePurchaseBillAmount({ data, product, baseDelta: validated.quantityDelta, enteredUnit })
    : readNumber(data.billAmount, 0) || undefined;
  const productUnit = product ? inventorySimpleUnit(product, enteredUnit) : enteredUnit;
  const productDefaultUnit = product ? inventorySimpleUnit(product) : productUnit;
  const unitMismatchWarning = buildUnitMismatchWarning(productUnit, productDefaultUnit);
  const nextStock = roundMoney(previousStock + validated.quantityDelta);
  assertStockMovementRules({ movementType, reason: validatedReason, ownerPin: validatedOwnerPin, product, productId, nextStock, data });
  if (!product) throw new Error("Product not found in local records");
  if (movementType === "purchase" && (!purchaseBillAmount || purchaseBillAmount <= 0)) {
    throw new Error("Enter purchase cost or bill amount before adding stock.");
  }

  const movementId = createLocalId(`stock_${movementType}`);
  const now = new Date().toISOString();
  const currentUser = loadAuthSession().user;
  const actorUserId = currentUser?.id ?? null;
  const actorName = currentUser?.name ?? currentUser?.email ?? "Offline operator";
  const selectedSellingUnit = findInventorySellingUnit(product, enteredUnit);
  const displayUnit = inventoryUnitLabel(product, enteredUnit);
  const syncEnteredUnit = product.baseUnit ?? productUnit ?? enteredUnit;
  const packDelta = selectedSellingUnit ? packCountDelta(product, movementType, quantity) : 0;
  const updatedProduct = buildUpdatedProduct(product, productId, validated.quantityDelta, movementType, typeof data.costPerRateUnit === "number" ? data.costPerRateUnit : undefined, enteredUnit, packDelta);
  const negativeStockWarning = nextStock < 0 ? "Negative stock override used" : undefined;
  const warning = [negativeStockWarning, unitMismatchWarning].filter(Boolean).join(" | ") || undefined;
  const purchaseInvoiceNumber =
    typeof data.invoiceNumber === "string" && data.invoiceNumber.trim()
      ? data.invoiceNumber.trim()
      : typeof data.purchaseBillNo === "string" && data.purchaseBillNo.trim()
        ? data.purchaseBillNo.trim()
        : typeof data.supplierBillNo === "string" && data.supplierBillNo.trim()
          ? data.supplierBillNo.trim()
          : undefined;
  const movement = makeLocalEntity({
    id: movementId,
    productId,
    product_id: productId,
    productName: product.name,
    type: movementType,
    action: movementType,
    actorUserId,
    actor_user_id: actorUserId,
    actorName,
    actor_name: actorName,
    sourceType: `manual_${movementType}`,
    source_type: `manual_${movementType}`,
    sourceId: movementId,
    source_id: movementId,
    quantityDelta: validated.quantityDelta,
    quantity_delta: validated.quantityDelta,
    stockBefore: previousStock,
    stock_before: previousStock,
    stockAfter: nextStock,
    stock_after: nextStock,
    unit: displayUnit,
    enteredUnit,
    entered_unit: enteredUnit,
    displayUnit,
    display_unit: displayUnit,
    sellingUnitCode: selectedSellingUnit?.unitCode,
    selling_unit_code: selectedSellingUnit?.unitCode,
    sellingUnitLabel: selectedSellingUnit?.name,
    selling_unit_label: selectedSellingUnit?.name,
    conversionToBase: selectedSellingUnit?.conversionToBase,
    conversion_to_base: selectedSellingUnit?.conversionToBase,
    // How many of that packaging moved — base units cannot tell 8 single packets
    // from one 8-pack, so the movement history would otherwise lose the size.
    sellingUnitQty: packDelta === 0 ? undefined : Math.abs(packDelta),
    selling_unit_qty: packDelta === 0 ? undefined : Math.abs(packDelta),
    invoiceNumber: purchaseInvoiceNumber,
    invoice_number: purchaseInvoiceNumber,
    billAmount: purchaseBillAmount,
    bill_amount: purchaseBillAmount,
    purchaseBillNo: purchaseInvoiceNumber,
    purchase_bill_no: purchaseInvoiceNumber,
    supplierBillNo: purchaseInvoiceNumber,
    supplier_bill_no: purchaseInvoiceNumber,
    purchasePaymentStatus: data.purchasePaymentStatus,
    purchase_payment_status: data.purchasePaymentStatus,
    purchasePaymentMode: data.purchasePaymentMode,
    purchase_payment_mode: data.purchasePaymentMode,
    purchasePaidAmount: data.purchasePaidAmount,
    purchase_paid_amount: data.purchasePaidAmount,
    purchaseDueAmount: data.purchaseDueAmount,
    purchase_due_amount: data.purchaseDueAmount,
    purchaseDueDate: data.purchaseDueDate,
    purchase_due_date: data.purchaseDueDate,
    supplierId: data.supplierId,
    supplierName: data.supplierName,
    supplier_id: data.supplierId,
    supplier_name: data.supplierName,
    costPerRateUnit: data.costPerRateUnit,
    cost_per_rate_unit: data.costPerRateUnit,
    note: data.note ?? data.reason ?? warning,
    reason: data.reason ?? data.note ?? warning,
    warning,
    negativeStockWarning,
    unitMismatchWarning,
    owner_pin_verified: Boolean(validatedOwnerPin),
    ownerPinVerified: Boolean(validatedOwnerPin),
    createdAt: now,
  }, "inventory_movement", "pending_sync");

  const auditLog = buildAuditLogRow({
    action: movementType === "correction" ? "stock_correction" : "stock_adjusted",
    entityType: "inventory_movement",
    entityId: movementId,
    entityLabel: product.name ?? productId,
    userId: actorUserId,
    userName: actorName,
    oldValue: product ?? null,
    newValue: { movement, product: updatedProduct },
    reason: data.reason ?? data.note ?? movementType,
    ownerPinProvided: Boolean(validatedOwnerPin),
    summary: `${movementType.replaceAll("_", " ")} ${product.name ?? productId} by ${validated.quantityDelta}`,
  });

  const auditOutbox = buildOutboxOperation(buildAuditLogOutboxInput(auditLog));
  const stockOutbox = buildOutboxOperation({
    entity_type: "inventory_movement",
    entity_id: movementId,
    operation_type: operationFor(movementType),
    idempotency_key: `stock-${movementType}:${productId}:${movementId}`,
    payload: {
      movementId,
      movementType,
      productId,
      previousStock,
      nextStock,
      ...data,
      // The server's stock schemas take idempotencyKey from the PAYLOAD, not the outbox
      // envelope. Send it explicitly so a replayed movement is recognised and never
      // doubles stock, cost, or a supplier due.
      idempotencyKey: `stock-${movementType}:${productId}:${movementId}`,
      clientMovementId: movementId,
      quantity: Math.abs(validated.quantityDelta),
      quantityDelta: validated.quantityDelta,
      enteredUnit: syncEnteredUnit,
      unit: syncEnteredUnit,
      displayQuantity: quantity,
      displayUnit,
      originalEnteredUnit: enteredUnit,
      sellingUnitCode: selectedSellingUnit?.unitCode,
      sellingUnitLabel: selectedSellingUnit?.name,
      conversionToBase: selectedSellingUnit?.conversionToBase,
      // The movement stated a second time, in the packaging it was counted in.
      // `quantity` above is base units, which cannot say WHICH size moved, and a
      // per-pack product refuses any movement it cannot attribute to a size.
      // Sent only for per-pack products; pooled sync is byte-for-byte unchanged.
      ...(packDelta !== 0 && selectedSellingUnit
        ? {
          sellingUnitId: selectedSellingUnit.id,
          sellingUnitQty: Math.abs(packDelta),
        }
        : {}),
      syncQuantityBase: Math.abs(validated.quantityDelta),
      syncEnteredUnit,
      billAmount: purchaseBillAmount,
      ownerPin: validatedOwnerPin,
      reason: data.reason ?? data.note,
      ownerPinProvided: Boolean(validatedOwnerPin),
      negativeStockWarning,
      unitMismatchWarning,
      warning,
    },
  });

  const persist = async (tx: OfflineWriteTransaction) => {
    await tx.put("inventory_movements", movement);
    await tx.put("products", updatedProduct);
    await tx.put("local_audit_logs", auditLog);
    await tx.enqueueOutboxOperation(auditOutbox);
    if (options.enqueueStockOutbox !== false) await tx.enqueueOutboxOperation(stockOutbox);
  };
  if (options.tx) await persist(options.tx);
  else await offlineDB.transaction(STOCK_ADJUSTMENT_TRANSACTION_TABLES, persist);

  if (options.updateCache !== false) {
    upsertCachedListItem(LEDGER_CACHE_KEY, movement, 1000);
    upsertCachedListItem<Product>(PRODUCT_CACHE_KEY, updatedProduct, 1000);
    upsertCachedListItem<InventoryItem>(INVENTORY_CACHE_KEY, updatedProduct, 1000);
  }
  return { success: true, movement, product: updatedProduct, stockOutbox, pendingSync: true };
}

export function recordPurchaseLocalFirst(data: StockMovementInput) {
  return stockMovementLocalFirst(data, "purchase");
}

/** Commit every line of one supplier invoice in a single IndexedDB transaction. */
export async function recordPurchaseBatchLocalFirst(lines: StockMovementInput[]) {
  if (lines.length === 0) throw new Error("Add at least one purchase line");
  const productIds = [...new Set(lines.map((line) => String(line.productId ?? "")).filter(Boolean))];
  const products = new Map<string, Product>();
  for (const productId of productIds) {
    const product = await getProduct(productId);
    if (!product) throw new Error(`Product ${productId} was not found in local records`);
    products.set(productId, product);
  }

  const results: Awaited<ReturnType<typeof stockMovementLocalFirst>>[] = [];
  await offlineDB.transaction(STOCK_ADJUSTMENT_TRANSACTION_TABLES, async (tx) => {
    for (const line of lines) {
      const productId = String(line.productId ?? "");
      const result = await stockMovementLocalFirst(line, "purchase", {
        tx,
        product: products.get(productId),
        updateCache: false,
        enqueueStockOutbox: false,
      });
      products.set(productId, result.product);
      results.push(result);
    }
    const batchId = createLocalId("purchase_batch");
    await tx.enqueueOutboxOperation(buildOutboxOperation({
      entity_type: "inventory_movement",
      entity_id: batchId,
      operation_type: "STOCK_PURCHASE_BATCH",
      idempotency_key: `stock-purchase-batch:${batchId}`,
      payload: {
        batchId,
        lines: results.map((result) => result.stockOutbox.payload),
      },
    }));
  });

  for (const result of results) {
    upsertCachedListItem(LEDGER_CACHE_KEY, result.movement, 1000);
    upsertCachedListItem<Product>(PRODUCT_CACHE_KEY, result.product, 1000);
    upsertCachedListItem<InventoryItem>(INVENTORY_CACHE_KEY, result.product, 1000);
  }
  return results;
}

export function recordSaleLocalFirst(data: StockMovementInput) {
  return stockMovementLocalFirst(data, "sale");
}

export function recordDamageLocalFirst(data: StockMovementInput) {
  return stockMovementLocalFirst(data, "damage");
}

export function stockCorrectionLocalFirst(data: StockMovementInput) {
  return stockMovementLocalFirst(data, "correction");
}

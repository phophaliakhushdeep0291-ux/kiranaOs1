import { offlineDB } from "@/lib/offline/db";
import { stockAdjustmentSchema } from "@/lib/validation";
import { createLocalId, readInstantCache, upsertCachedListItem } from "@/lib/offline/instant-cache";
import { buildOutboxOperation, type SyncOutboxOperationType } from "@/features/sync/outbox";
import { makeLocalEntity, parseOrThrow, readNumber, roundMoney } from "@/lib/offline/actions/utils";
import type { InventoryItem, Product, StockMovementInput } from "@/types/api";
import { buildAuditLogOutboxInput, buildAuditLogRow } from "@/features/audit-logs/local-actions";
import { buildUnitMismatchWarning, fromInventoryBaseQty, toInventoryBaseQty } from "@/features/inventory/calculations";

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

  if (input.movementType === "correction" && !input.ownerPin?.trim()) {
    throw new Error("Owner PIN is required for stock correction");
  }

  if (input.movementType === "damage" && !input.reason?.trim()) {
    throw new Error("Reason is required for damaged stock adjustment");
  }

  if (input.nextStock < 0 && !allowsNegativeStock(input.product, input.data)) {
    throw new Error("Negative stock is not allowed for this product. Enable negative stock override only after owner approval.");
  }
}

function buildUpdatedProduct(
  product: Product,
  productId: string,
  deltaBaseQty: number,
  movementType: StockMovementType,
  purchaseCost?: number,
): InventoryItem {
  const now = new Date().toISOString();
  const previousStock = readNumber(product.stockBaseQty, 0);
  const incomingStock = Math.max(deltaBaseQty, 0);
  const nextStock = roundMoney(previousStock + deltaBaseQty);
  const currentAverageCost = readNumber(product.averageCostPrice ?? product.costPrice ?? product.costPerRateUnit, 0);
  const cleanPurchaseCost = readNumber(purchaseCost, 0);
  const rateUnit = product.rateUnit ?? product.displayUnit ?? product.unit ?? "piece";
  const previousStockInRateUnit = Math.max(fromInventoryBaseQty(previousStock, product.baseUnit ?? product.unit, rateUnit), 0);
  const incomingStockInRateUnit = Math.max(fromInventoryBaseQty(incomingStock, product.baseUnit ?? product.unit, rateUnit), 0);
  const nextAverageCost = movementType === "purchase" && cleanPurchaseCost > 0 && incomingStockInRateUnit > 0
    ? roundMoney(((currentAverageCost * previousStockInRateUnit) + (cleanPurchaseCost * incomingStockInRateUnit)) / Math.max(previousStockInRateUnit + incomingStockInRateUnit, incomingStockInRateUnit))
    : currentAverageCost;

  return {
    ...product,
    id: product.id,
    productId,
    stockBaseQty: nextStock,
    stockTrackingEnabled: true,
    trackStock: true,
    averageCostPrice: nextAverageCost,
    costPerRateUnit: nextAverageCost,
    costPrice: nextAverageCost,
    updatedAt: now,
    updated_at: now,
    sync_status: "pending_sync",
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

  const rateUnit = input.product?.rateUnit ?? input.product?.displayUnit ?? input.product?.unit ?? input.enteredUnit;
  const qtyInRateUnit = Math.max(
    fromInventoryBaseQty(Math.abs(input.baseDelta), input.product?.baseUnit ?? input.enteredUnit, rateUnit),
    0,
  );
  return roundMoney(unitCost * qtyInRateUnit);
}

async function stockMovementLocalFirst(data: StockMovementInput, movementType: StockMovementType) {
  const productId = typeof data.productId === "string" ? data.productId : "";
  const quantity = readNumber(data.quantity ?? data.quantityDelta, 0);
  const enteredUnit = typeof data.enteredUnit === "string" ? data.enteredUnit : typeof data.unit === "string" ? data.unit : "piece";
  const product = await getProduct(productId);
  const baseDelta = movementType === "purchase"
    ? Math.abs(toInventoryBaseQty(quantity, enteredUnit, product?.baseUnit))
    : movementType === "sale" || movementType === "damage"
      ? -Math.abs(toInventoryBaseQty(quantity, enteredUnit, product?.baseUnit))
      : toInventoryBaseQty(readNumber(data.quantityDelta ?? data.quantity ?? 0), enteredUnit, product?.baseUnit);

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
  const productUnit = product?.unit ?? product?.displayUnit ?? product?.rateUnit ?? product?.baseUnit;
  const unitMismatchWarning = buildUnitMismatchWarning(enteredUnit, productUnit);
  const nextStock = roundMoney(previousStock + validated.quantityDelta);
  assertStockMovementRules({ movementType, reason: validatedReason, ownerPin: validatedOwnerPin, product, productId, nextStock, data });
  if (!product) throw new Error("Product not found in local records");
  if (movementType === "purchase" && (!purchaseBillAmount || purchaseBillAmount <= 0)) {
    throw new Error("Enter purchase cost or bill amount before adding stock.");
  }

  const movementId = createLocalId(`stock_${movementType}`);
  const now = new Date().toISOString();
  const updatedProduct = buildUpdatedProduct(product, productId, validated.quantityDelta, movementType, typeof data.costPerRateUnit === "number" ? data.costPerRateUnit : undefined);
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
    quantityDelta: validated.quantityDelta,
    quantity_delta: validated.quantityDelta,
    stockBefore: previousStock,
    stock_before: previousStock,
    stockAfter: nextStock,
    stock_after: nextStock,
    unit: enteredUnit,
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
      quantityDelta: validated.quantityDelta,
      billAmount: purchaseBillAmount,
      ownerPin: validatedOwnerPin,
      reason: data.reason ?? data.note,
      ownerPinProvided: Boolean(validatedOwnerPin),
      negativeStockWarning,
      unitMismatchWarning,
      warning,
    },
  });

  await offlineDB.transaction(STOCK_ADJUSTMENT_TRANSACTION_TABLES, async (tx) => {
    await tx.put("inventory_movements", movement);
    await tx.put("products", updatedProduct);
    await tx.put("local_audit_logs", auditLog);
    await tx.enqueueOutboxOperation(auditOutbox);
    await tx.enqueueOutboxOperation(stockOutbox);
  });

  upsertCachedListItem(LEDGER_CACHE_KEY, movement, 1000);
  upsertCachedListItem<Product>(PRODUCT_CACHE_KEY, updatedProduct, 1000);
  upsertCachedListItem<InventoryItem>(INVENTORY_CACHE_KEY, updatedProduct, 1000);
  return { success: true, movement, product: updatedProduct, pendingSync: true };
}

export function recordPurchaseLocalFirst(data: StockMovementInput) {
  return stockMovementLocalFirst(data, "purchase");
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

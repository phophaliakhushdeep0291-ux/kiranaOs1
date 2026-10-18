import type { CustomerDraft, InventoryDraft, PaymentDraft, ProductDraft, VoiceIntent, VoiceSearchTarget } from "./voice-types";

// Server-response normalization is needed only after an online AI request.
const SEARCH_TARGET_ROUTES: Record<VoiceSearchTarget, string> = {
  product: "/products", customer: "/customers", bill: "/bills", udhar: "/udhar", global: "/dashboard",
};

export function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (
    typeof value === "string" &&
    value.trim() &&
    Number.isFinite(Number(value))
  )
    return Number(value);
  return undefined;
}

export function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function asStringArray(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const rows = value
    .filter(
      (item): item is string =>
        typeof item === "string" && item.trim().length > 0,
    )
    .map((item) => item.trim());
  return rows.length ? rows : undefined;
}

export function normalizeProductDraft(
  value: unknown,
): ProductDraft | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  return {
    mode: record.mode === "edit" ? "edit" : "create",
    name: asString(record.name),
    productName: asString(record.productName) ?? asString(record.product_name),
    category: asString(record.category),
    unit: asString(record.unit),
    barcode: asString(record.barcode) ?? asString(record.sku),
    aliases: asStringArray(record.aliases),
    costPrice: asNumber(record.costPrice ?? record.cost_price),
    sellingPrice: asNumber(record.sellingPrice ?? record.selling_price),
    minimumSellingPrice: asNumber(
      record.minimumSellingPrice ??
        record.minimum_selling_price ??
        record.minPrice,
    ),
    retailPrice: asNumber(record.retailPrice ?? record.retail_price),
    wholesalePrice: asNumber(record.wholesalePrice ?? record.wholesale_price),
    retailFromQuantity: asNumber(
      record.retailFromQuantity ?? record.retail_from_quantity,
    ),
    wholesaleFromQuantity: asNumber(
      record.wholesaleFromQuantity ?? record.wholesale_from_quantity,
    ),
    stockQuantity: asNumber(record.stockQuantity ?? record.stock_quantity),
    lowStockAlert: asNumber(record.lowStockAlert ?? record.low_stock_alert),
  };
}

export function normalizeCustomerDraft(
  value: unknown,
): CustomerDraft | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  return {
    mode: record.mode === "edit" ? "edit" : "create",
    name: asString(record.name),
    mobile: asString(record.mobile) ?? asString(record.phone),
    address: asString(record.address),
    type: record.type === "udhar" ? "udhar" : "regular",
    udharLimit: asNumber(record.udharLimit ?? record.udhar_limit),
    dueDate: asString(record.dueDate ?? record.due_date),
    promiseToPayDate: asString(
      record.promiseToPayDate ?? record.promise_to_pay_date,
    ),
    notes: asString(record.notes),
  };
}

export function normalizeInventoryDraft(
  value: unknown,
): InventoryDraft | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const rawMovementType = String(record.movementType ?? record.movement_type);
  const movementType = ["purchase", "sale", "damage", "correction"].includes(
    rawMovementType,
  )
    ? (rawMovementType as InventoryDraft["movementType"])
    : "purchase";
  return {
    movementType,
    productName: asString(record.productName ?? record.product_name),
    quantity: asNumber(record.quantity),
    unit: asString(record.unit),
    supplierName: asString(record.supplierName ?? record.supplier_name),
    billAmount: asNumber(record.billAmount ?? record.bill_amount),
    costPrice: asNumber(record.costPrice ?? record.cost_price),
    minPrice: asNumber(record.minPrice ?? record.min_price),
    sellingPrice: asNumber(record.sellingPrice ?? record.selling_price),
    minMarginPercent: asNumber(
      record.minMarginPercent ?? record.min_margin_percent,
    ),
    sellingMarginPercent: asNumber(
      record.sellingMarginPercent ?? record.selling_margin_percent,
    ),
    reason: asString(record.reason ?? record.note),
  };
}

export function normalizePaymentDraft(
  value: unknown,
): PaymentDraft | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const rawMode = asString(record.mode ?? record.payment_mode)?.toLowerCase();
  return {
    customerName: asString(
      record.customerName ?? record.customer_name ?? record.name,
    ),
    mobile: asString(record.mobile ?? record.phone),
    amount: asNumber(record.amount),
    mode: rawMode === "upi" ? "upi" : "cash",
    note: asString(record.note ?? record.reason),
  };
}

export function normalizeSearchIntent(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const rawTarget = asString(record.target)?.toLowerCase();
  const query = asString(record.query);
  if (!query) return undefined;
  const target: VoiceSearchTarget =
    rawTarget === "customer" ||
    rawTarget === "bill" ||
    rawTarget === "udhar" ||
    rawTarget === "global"
      ? rawTarget
      : "product";
  return { target, query };
}

export function normalizeAiIntent(value: unknown): VoiceIntent | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const action = typeof record.action === "string" ? record.action : "noop";
  if (
    ![
      "navigate",
      "billing_command",
      "product_draft",
      "customer_draft",
      "inventory_draft",
      "payment_draft",
      "search",
      "dashboard_summary",
      "sync_count",
      "noop",
    ].includes(action)
  )
    return null;
  const search = normalizeSearchIntent(record.search ?? record.search_intent);
  const route =
    asString(record.route) ??
    (search ? SEARCH_TARGET_ROUTES[search.target] : undefined);
  return {
    action: action as VoiceIntent["action"],
    route,
    billingCommand:
      asString(record.billingCommand) ?? asString(record.billing_command),
    product: normalizeProductDraft(
      record.product ?? record.productDraft ?? record.product_draft,
    ),
    customer: normalizeCustomerDraft(
      record.customer ?? record.customerDraft ?? record.customer_draft,
    ),
    inventory: normalizeInventoryDraft(
      record.inventory ?? record.inventoryDraft ?? record.inventory_draft,
    ),
    payment: normalizePaymentDraft(
      record.payment ?? record.paymentDraft ?? record.payment_draft,
    ),
    search,
    message: asString(record.message),
    requiresConfirmation:
      record.requiresConfirmation === true ||
      record.requires_confirmation === true,
    requiresOwnerPin:
      record.requiresOwnerPin === true || record.requires_owner_pin === true,
    auditable: record.auditable !== false,
  };
}

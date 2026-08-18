export type ID = string;
export type QueryParams = Record<string, unknown>;

export interface User {
  id: string;
  shopId?: string;
  name: string;
  mobile?: string;
  email?: string;
  emailVerifiedAt?: string | null;
  role: "owner" | "staff" | string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Shop {
  id: string;
  name: string;
  ownerName: string;
  city: string;
  address: string;
  gstNumber?: string | null;
  phone?: string | null;
  settingsJson?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface AuthResponse {
  accessToken: string;
  token?: string;
  refreshToken: string;
  user: User;
  shop?: Shop;
}

export interface QuantitySlabPrice {
  minQty: number;
  price: number;
}

export interface CustomerSpecificPrice {
  customerId?: string;
  customerName?: string;
  price: number;
}

export interface ProductSellingUnit {
  id?: string;
  shopId?: string;
  productId?: string;
  name: string;
  unitType: string;
  unitCode: string;
  packSizeValue?: number | null;
  packSizeUnit?: string | null;
  conversionToBase: number;
  barcode?: string | null;
  sku?: string | null;
  defaultPrice: number;
  minimumPrice?: number | null;
  maximumPrice?: number | null;
  costPrice?: number | null;
  // Per-packaging stock, counted in this pack's own units. Only maintained when the
  // product's packagingMode is "per_pack"; pooled products leave these null and use
  // the single shared Product.stockBaseQty.
  onHandQty?: number | null;
  lowStockThreshold?: number | null;
  reorderLevel?: number | null;
  /**
   * Where this row sits on the parent's variant axes: `variantValue1` is its
   * value on `axes[0]`, `variantValue2` on `axes[1]`. Both null on an ordinary
   * packaging row — a 70 g packet has no position on a size chart.
   */
  variantValue1?: string | null;
  variantValue2?: string | null;
  isDefault: boolean;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/** How a product's stock is counted across its pack sizes. */
export type PackagingMode = "pooled" | "per_pack";

/**
 * One axis of a product's variant grid: "Size" with S, M, L.
 *
 * AXIS ORDER IS LOAD-BEARING — a selling unit's `variantValue1` is its value on
 * `axes[0]`. Reordering this array remaps every existing row, so once variants
 * exist treat it as append-only.
 */
export interface ProductVariantAxis {
  name: string;
  values: string[];
}

/** One size's holding at one branch, in that unit's own counts — 4 pairs, not 4000 g. */
export interface VariantLocationUnit {
  sellingUnitId: string;
  unitCode: string;
  name: string;
  variantValue1: string | null;
  variantValue2: string | null;
  qty: number;
}

export interface VariantLocationRow {
  id: string;
  name: string;
  isPrimary: boolean;
  units: VariantLocationUnit[];
}

export interface VariantStockByLocation {
  productId: string;
  axes: ProductVariantAxis[];
  /** Empty when the product has no variant rows; the caller renders nothing. */
  locations: VariantLocationRow[];
}

export interface Product {
  id: string;
  shopId?: string;
  name: string;
  packagingMode?: PackagingMode;
  category?: string | null;
  unit?: string | null;
  displayUnit?: string | null;
  baseUnit?: string | null;
  rateUnit?: string | null;
  barcode?: string | null;
  sku?: string | null;
  aliases?: string[];
  stockBaseQty?: number;
  stockQuantity?: number;
  stockUnit?: string | null;
  stockTrackingEnabled?: boolean;
  trackStock?: boolean;
  costPerRateUnit?: number;
  costPrice?: number;
  averageCostPrice?: number;
  minPricePerRateUnit?: number;
  minimumSellingPrice?: number;
  defaultPricePerRateUnit: number;
  sellingPrice?: number;
  retailPricePerRateUnit?: number;
  retailPrice?: number;
  retailFromQuantity?: number;
  wholesalePricePerRateUnit?: number;
  wholesalePrice?: number;
  wholesaleFromQuantity?: number;
  quantitySlabPricing?: QuantitySlabPrice[];
  customerSpecificPricing?: CustomerSpecificPrice[] | Record<string, number>;
  sellingUnits?: ProductSellingUnit[];
  /** The variant grid, in axis order. Empty for an ordinary product. */
  variantAxes?: ProductVariantAxis[];
  gstRate?: number;
  hsn?: string | null;
  brand?: string | null;
  mrp?: number;
  reorderLevel?: number;
  description?: string | null;
  imageUrl?: string | null;
  isLooseItem?: boolean;
  lowStockThreshold?: number;
  batchTrackingEnabled?: boolean;
  /** h | h1 | x | otc, or null for anything that is not a scheduled drug.
   *  Setting h/h1/x is what makes billing demand a prescription for it. */
  drugSchedule?: "h" | "h1" | "x" | "otc" | null;
  /** Trade details: the facts this shop type needs and no other does, keyed by
   *  the catalogue in features/core/products/product-attributes.ts. Descriptive
   *  only — anything the app branches on is a field of its own. */
  attributes?: Record<string, string | number | boolean>;
  lowStockAlert?: number;
  isActive?: boolean;
  status?: "active" | "inactive" | string;
  batchExpiryLocked?: boolean;
  deletedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export type InventoryItem = Product & { productId?: string; isLowStock?: boolean };

export interface ProductInput {
  name: string;
  packagingMode?: PackagingMode;
  category?: string;
  unit?: string;
  aliases?: string[];
  barcode?: string;
  sku?: string;
  displayUnit?: string;
  baseUnit?: string;
  rateUnit?: string;
  stockBaseQty?: number;
  stockQuantity?: number;
  stockUnit?: string;
  stockTrackingEnabled?: boolean;
  trackStock?: boolean;
  costPerRateUnit?: number;
  costPrice?: number;
  averageCostPrice?: number;
  minPricePerRateUnit?: number;
  minimumSellingPrice?: number;
  defaultPricePerRateUnit: number;
  sellingPrice?: number;
  retailPricePerRateUnit?: number;
  retailPrice?: number;
  retailFromQuantity?: number;
  wholesalePricePerRateUnit?: number;
  wholesalePrice?: number;
  wholesaleFromQuantity?: number;
  quantitySlabPricing?: QuantitySlabPrice[];
  customerSpecificPricing?: CustomerSpecificPrice[] | Record<string, number>;
  sellingUnits?: ProductSellingUnit[];
  /** The variant grid, in axis order. Declaring one forces per-pack stock. */
  variantAxes?: ProductVariantAxis[];
  gstRate?: number;
  hsn?: string;
  brand?: string;
  mrp?: number;
  reorderLevel?: number;
  description?: string;
  imageUrl?: string;
  isLooseItem?: boolean;
  lowStockThreshold?: number;
  batchTrackingEnabled?: boolean;
  /** h | h1 | x | otc, or null for anything that is not a scheduled drug.
   *  Setting h/h1/x is what makes billing demand a prescription for it. */
  drugSchedule?: "h" | "h1" | "x" | "otc" | null;
  /** Trade details. Merged onto what is stored rather than replacing it, so a
   *  payload that names only the current trade's fields cannot drop what an
   *  earlier trade recorded. A key sent empty is a deliberate clear. */
  attributes?: Record<string, string | number | boolean>;
  lowStockAlert?: number;
  isActive?: boolean;
  status?: "active" | "inactive" | string;
  baseUpdatedAt?: string;
  ownerPin?: string;
  ownerPinReason?: string;
}

export interface Customer {
  id: string;
  shopId?: string;
  name: string;
  mobile?: string | null;
  type?: "regular" | "udhar" | string;
  udharAmount?: number;
  totalUdhar?: number;
  reminderOverrideUntil?: string | null;
  address?: string | null;
  gstNumber?: string | null;
  stateCode?: string | null;
  dueDate?: string | null;
  promiseToPayDate?: string | null;
  udharLimit?: number;
  badCustomer?: boolean;
  trustScore?: number;
  customerSpecificPricing?: Record<string, number> | null;
  notes?: string | null;
  deletedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface CustomerInput {
  name?: string;
  mobile?: string;
  type?: "regular" | "udhar";
  reminderOverrideUntil?: string;
  address?: string;
  gstNumber?: string;
  stateCode?: string;
  dueDate?: string;
  promiseToPayDate?: string;
  udharLimit?: number;
  customerSpecificPricing?: Record<string, number>;
  notes?: string;
}

export interface Supplier {
  id: string;
  shopId?: string;
  name: string;
  mobile?: string | null;
  phone?: string | null;
  address?: string | null;
  // gstin, not gstNumber: the backend Supplier has never had a gstNumber column,
  // so the old name here described a field that could only ever be undefined —
  // sitting exactly where someone would reach for the real one. Customer keeps
  // gstNumber; only Supplier was wrong.
  gstin?: string | null;
  notes?: string | null;
  active?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export type ExpensePaymentMode = "cash" | "upi" | "bank" | "card" | "other";
export type ExpenseStatus = "paid" | "pending";
export type ExpenseRecurringInterval = "none" | "daily" | "weekly" | "monthly";

export interface Expense {
  id: string;
  shopId?: string;
  title: string;
  amount: number;
  category: string;
  paymentMode: ExpensePaymentMode | string;
  vendor?: string | null;
  status: ExpenseStatus | string;
  recurringInterval: ExpenseRecurringInterval | string;
  nextDueOn?: string | null;
  recordedBy?: string | null;
  notes?: string | null;
  spentAt: string;
  deletedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface ExpenseInput {
  idempotencyKey?: string;
  clientExpenseId?: string;
  title: string;
  amount: number;
  category?: string;
  paymentMode?: ExpensePaymentMode;
  vendor?: string;
  status?: ExpenseStatus;
  recurringInterval?: ExpenseRecurringInterval;
  nextDueOn?: string;
  notes?: string;
  spentAt?: string;
}

export interface ExpenseSummary {
  total: number;
  count: number;
  byCategory: Record<string, number>;
  byMode: Record<string, number>;
  pendingTotal?: number;
  pendingCount?: number;
}

export interface ExpenseOverview {
  today: number;
  yesterday: number;
  month: number;
  lastMonth: number;
  pendingTotal: number;
  pendingCount: number;
  byCategory: Record<string, number>;
  trend: { month: string; total: number }[];
  monthlyAverage: number;
}

export type OfferType = "percentage" | "flat";

export interface Offer {
  id: string;
  shopId?: string;
  title: string;
  code?: string | null;
  type: OfferType | string;
  value: number;
  minBillAmount: number;
  maxDiscount: number;
  scope: string;
  scopeValue?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  usageLimit: number;
  usedCount: number;
  discountGiven?: number;
  active: boolean;
  deletedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface OfferInput {
  title: string;
  code?: string;
  type?: OfferType;
  value: number;
  minBillAmount?: number;
  maxDiscount?: number;
  scope?: string;
  scopeValue?: string;
  validFrom?: string;
  validTo?: string;
  usageLimit?: number;
  active?: boolean;
}

export interface ApplyOfferResult {
  applicable: boolean;
  discount: number;
  offerId?: string;
  title?: string;
  code?: string | null;
  type?: string;
  value?: number;
  reason?: string;
}

export interface PurchaseBill {
  id: string;
  shopId?: string;
  supplierId?: string | null;
  supplier_id?: string | null;
  supplierName?: string | null;
  supplier_name?: string | null;
  supplierPhone?: string | null;
  supplierAddress?: string | null;
  invoiceNumber?: string | null;
  invoice_number?: string | null;
  supplierBillNo?: string | null;
  supplier_bill_no?: string | null;
  billAmount?: number;
  bill_amount?: number;
  totalAmount?: number;
  total_amount?: number;
  paidAmount?: number;
  paid_amount?: number;
  dueAmount?: number;
  due_amount?: number;
  paymentMode?: "cash" | "upi" | "bank" | string | null;
  payment_mode?: "cash" | "upi" | "bank" | string | null;
  status?: "paid" | "partial" | "due" | string;
  dueDate?: string | null;
  due_date?: string | null;
  createdAt?: string;
  created_at?: string;
  updatedAt?: string;
  updated_at?: string;
}

export interface PurchaseBillInput {
  supplierId?: string;
  supplierName?: string;
  invoiceNumber?: string;
  billAmount: number;
  paidAmount?: number;
  dueAmount?: number;
  paymentMode?: "cash" | "upi" | "bank" | string;
  status?: "paid" | "partial" | "due" | string;
  dueDate?: string;
}

export const BillPaymentMode = {
  cash: "cash",
  upi: "upi",
  bank: "bank",
  credit: "credit",
  gift_card: "gift_card",
} as const;

export const BillInputBillType = {
  normal_sale: "normal_sale",
  udhar_entry: "udhar_entry",
  gst_invoice: "gst_invoice",
  estimate: "estimate",
} as const;

export const CustomerInputType = {
  regular: "regular",
  udhar: "udhar",
} as const;

export const UdharPaymentInputMode = {
  cash: "cash",
  upi: "upi",
  bank: "bank",
} as const;

export interface BillPayment {
  mode: typeof BillPaymentMode[keyof typeof BillPaymentMode];
  amount: number;
  retailPaymentIntentId?: string;
  giftCardCode?: string;
}

export interface BillInputItem {
  productId?: string;
  /**
   * The batch to dispense from. Omitted means FEFO picks. Set, it fixes both the
   * stock consumed and the MRP ceiling the line is checked against.
   */
  inventoryLotId?: string;
  sellingUnitId?: string;
  sellingUnitCode?: string;
  sellingUnitLabel?: string;
  conversionToBase?: number;
  name: string;
  quantity: number;
  enteredUnit: string;
  ratePerRateUnit: number;
  /** Product/portion rate before configured options. The server prices options. */
  baseRatePerRateUnit?: number;
  addons?: Array<{
    optionId: string;
    quantity?: number;
    groupName?: string;
    name?: string;
    price?: number;
  }>;
  /** Flat rupee discount applied to the whole line (not per unit). */
  lineDiscount?: number;
  /** Free-text callout for this line ("no bag", weight callout) — printed on the receipt. */
  note?: string;
  originalUnitPrice?: number;
  appliedPricingRuleId?: string;
  appliedPricingRuleType?: string;
  pricingExplanation?: string;
  pricingConfidence?: number;
  pricingCalculationVersion?: string;
  wasPriceOverridden?: boolean;
  priceOverrideReason?: string;
  gstRate?: number;
  hsn?: string;
}

export interface BillInput {
  /** The register entry authorising this sale. Required only when the bill holds
   *  a Schedule H, H1 or X medicine; every other sale ignores it. */
  prescriptionId?: string;
  /**
   * Stable client identity for this bill so server-side creates are idempotent.
   * Vital on the ONLINE path (coupons/loyalty/gift cards): a retry after a lost
   * response must return the existing bill, not create a duplicate and redeem
   * the coupon twice. confirmBillSchema accepts it; the backend derives
   * create-bill:{shop}:{device}:{clientBillId} as the idempotency key.
   */
  clientBillId?: string;
  locationId?: string;
  billType: typeof BillInputBillType[keyof typeof BillInputBillType];
  /** How GST applies: inclusive (MRP prices, default), exclusive (added on top), or none. */
  gstMode?: "inclusive" | "exclusive" | "none";
  customerId?: string;
  customerName?: string;
  customerMobile?: string;
  /** Buyer tax identity is retained only for the offline invoice snapshot; the server resolves it from customerId. */
  buyerGstin?: string;
  buyerStateCode?: string;
  buyerAddress?: string;
  items: BillInputItem[];
  discount?: number;
  /** Optional free-text reason for the bill-level discount (discounts report). */
  discountReason?: string;
  /**
   * Round the bill total to the nearest rupee (shop's Taxes → "Round off" setting).
   * Carried on the bill so the offline validator and the server round identically and
   * the tendered cash reconciles against the recorded total.
   */
  roundOff?: boolean;
  offerId?: string;
  offerCode?: string;
  offerDiscount?: number;
  loyaltyPointsToRedeem?: number;
  actualAmount?: number;
  buyerPaidAmount?: number;
  waivedAmount?: number;
  allowAdvancePayment?: boolean;
  advanceAmount?: number;
  payments: BillPayment[];
  ownerPin?: string;
  reason?: string;
  sensitiveActions?: string[];
}

export interface Bill {
  id: string;
  billNo: string;
  billNumber?: string;
  billType: string;
  status: string;
  locationId?: string | null;
  isSynced?: boolean;
  is_synced?: boolean;
  sync_status?: string;
  local_id?: string;
  server_id?: string;
  clientBillId?: string;
  client_bill_id?: string;
  localBillId?: string;
  local_bill_id?: string;
  idempotencyKey?: string;
  idempotency_key?: string;
  customerId?: string | null;
  customerName?: string | null;
  customerMobile?: string | null;
  buyerGstin?: string | null;
  buyerStateCode?: string | null;
  buyerAddress?: string | null;
  subtotal?: number;
  discount?: number;
  discountReason?: string | null;
  offerId?: string | null;
  offerCode?: string | null;
  offerDiscount?: number;
  loyaltyPointsRedeemed?: number;
  loyaltyDiscount?: number;
  gst?: number;
  gstMode?: "inclusive" | "exclusive" | "none";
  grandTotal?: number;
  totalAmount?: number;
  netAmount?: number;
  grossProfit?: number;
  paidAmount?: number;
  buyerPaidAmount?: number;
  creditAmount?: number;
  giftCardAmount?: number;
  refundMode?: "cash" | "upi" | "bank" | "udhar" | "gift_card";
  returnOfBillId?: string | null;
  businessDate?: string;
  business_date?: string;
  createdAt?: string;
  updatedAt?: string;
  items?: unknown[];
  payments?: unknown[];
}

export interface LedgerResult<T> {
  entries: T[];
  total: number;
  page?: number;
  limit?: number;
}

export interface CustomerKhataResult {
  entries: unknown[];
  totalOutstanding: number;
  customer?: Customer;
  ledger?: unknown[];
  [key: string]: unknown;
}

export interface BillListResult {
  bills: Bill[];
  total: number;
  page?: number;
  limit?: number;
}

export interface PnLReport {
  revenue: number;
  cost: number;
  grossProfit: number;
  grossMarginPct: number;
  totalBills: number;
  cashSales: number;
  upiSales: number;
  udharSales: number;
  inventoryLoss?: number;
  netProfit?: number;
  [key: string]: unknown;
}

export interface PaymentSummary {
  cash: number;
  upi: number;
  bank?: number;
  credit: number;
  total: number;
  oldUdharRecovered?: number;
  cashInHand?: number;
  upiReceived?: number;
  bankReceived?: number;
  purchaseCashPaid?: number;
  purchaseUpiPaid?: number;
  purchaseBankPaid?: number;
  purchaseDue?: number;
  totalCollected?: number;
  netCashInHand?: number;
  netBankInHand?: number;
}

export interface TopProductRow {
  productId: string;
  name: string;
  quantitySold: number;
  revenue: number;
  profit: number;
}

export interface MonthlyBreakdownRow {
  month: string;
  revenue: number;
  cost: number;
  profit: number;
  bills: number;
}

export interface UdharSummaryCustomer {
  customerId: string;
  customerName: string;
  mobile?: string;
  amount: number;
  outstanding: number;
}

export interface UdharSummary {
  totalOutstanding: number;
  customers: UdharSummaryCustomer[];
}

export interface UdharPaymentInput {
  amount: number;
  mode: string;
  note?: string;
}

export interface StockMovementInput {
  idempotencyKey?: string;
  clientMovementId?: string;
  locationId?: string;
  productId?: string;
  productName?: string;
  quantity?: number;
  quantityDelta?: number;
  enteredUnit?: string;
  unit?: string;
  movementType?: "purchase" | "sale" | "damage" | "correction" | "opening_stock" | string;
  supplierId?: string;
  supplierName?: string;
  billAmount?: number;
  invoiceNumber?: string;
  purchaseBillNo?: string;
  supplierBillNo?: string;
  purchasePaymentStatus?: "paid" | "partial" | "due" | string;
  purchasePaymentMode?: "cash" | "upi" | "bank" | string;
  purchasePaidAmount?: number;
  purchaseDueAmount?: number;
  purchaseDueDate?: string;
  costPerRateUnit?: number;
  // The lot in hand, for a purchase of batch-tracked stock. Named rather than
  // left to the index signature below because the server reads exactly these
  // four and silently records no batch if one is misspelled.
  batchNumber?: string;
  manufacturedOn?: string;
  expiresOn?: string;
  batchMrp?: number;
  /** Set by a client that collects the lot; see recordPurchase on the server. */
  batchCaptureSupported?: boolean;
  reason?: string;
  note?: string;
  ownerPin?: string;
  [key: string]: unknown;
}

export type SyncResultStatus = "SYNCED" | "FAILED" | "CONFLICT" | "PENDING" | "DUPLICATE" | "synced" | "failed" | "conflict" | "duplicate" | string;

export interface SyncPushOperationPayload extends Record<string, unknown> {
  op_id?: string;
  clientEventId?: string;
  idempotency_key?: string;
  operation_type?: string;
  type?: string;
  entity_type?: string;
  entity_id?: string;
  payload?: Record<string, unknown>;
}

export interface SyncPushRequest {
  operations?: SyncPushOperationPayload[];
  events?: SyncPushOperationPayload[];
  cursor?: string | number | null;
  device_id?: string;
}

export interface SyncPushEventResult extends Record<string, unknown> {
  op_id?: string;
  clientEventId?: string;
  eventId?: string;
  idempotency_key?: string;
  status?: SyncResultStatus;
  success?: boolean;
  error?: string;
  error_message?: string;
  entity_type?: string;
  entity_id?: string;
  local_id?: string;
  localId?: string;
  server_id?: string;
  serverId?: string;
  server_version?: string | number;
  conflict_id?: string;
  result?: Record<string, unknown>;
  entity?: Record<string, unknown>;
  conflict?: Record<string, unknown>;
}

export interface SyncIdMappings extends Record<string, Record<string, string> | undefined> {
  products?: Record<string, string>;
  customers?: Record<string, string>;
  bills?: Record<string, string>;
}

export interface SyncPushResponse extends Record<string, unknown> {
  results?: SyncPushEventResult[];
  operations?: SyncPushEventResult[];
  idMappings?: SyncIdMappings;
  cursor?: string | number | null;
  next_cursor?: string | number | null;
  nextCursor?: string | number | null;
  server_version?: string | number | null;
}

export interface SyncPullChange extends Record<string, unknown> {
  change_id?: string;
  entity_type?: string;
  entityType?: string;
  entity_id?: string;
  entityId?: string;
  operation_type?: string;
  operationType?: string;
  type?: string;
  payload?: Record<string, unknown>;
  entity?: Record<string, unknown>;
  server_version?: string | number;
  version?: string | number;
  deleted_at?: string | null;
}

export interface SyncPullMetadata {
    protocol?: string;
    entityCursors?: Record<string, string | null>;
  hasMoreByEntity?: Record<string, boolean>;
  hasMore?: boolean;
  nextCursor?: string | number | null;
  serverTime?: string;
  limit?: number;
    returnedCount?: number;
    scannedCount?: number;
    nextServerSeq?: string | number | null;
    serverVersion?: string | number | null;
}

export interface SyncPullResponse extends Record<string, unknown> {
  changes?: SyncPullChange[] | Record<string, Record<string, unknown>[]>;
  sync?: SyncPullMetadata;
  cursor?: string | number | null;
  next_cursor?: string | number | null;
  nextCursor?: string | number | null;
  server_version?: string | number | null;
}

export interface SyncStatusResponse extends Record<string, unknown> {
  online?: boolean;
  allowed?: boolean;
  server_version?: string | number | null;
  cursor?: string | number | null;
}

export interface SyncRetryRequest {
  op_ids?: string[];
}

export interface SyncAcknowledgement extends Record<string, unknown> {
  device_id: string;
  accepted: boolean;
  stale_ack_ignored: boolean;
  applied_server_seq: string;
  server_seq: string;
  lag: string;
  acknowledged_at: string | null;
}

export interface SyncFleetDevice extends Record<string, unknown> {
  device_id: string;
  device_name?: string | null;
  platform?: string | null;
  app_version?: string | null;
  state: "current" | "behind" | "stale" | "never_acknowledged";
  online: boolean;
  applied_server_seq: string;
  server_seq: string;
  lag: string;
  last_seen_at: string | null;
  last_sync_at: string | null;
  acknowledged_at: string | null;
}

export interface SyncFleetResponse extends Record<string, unknown> {
  server_seq: string;
  generated_at: string;
  stale_after_seconds: number;
  summary: {
    total: number;
    current: number;
    behind: number;
    stale: number;
    never_acknowledged: number;
    attention: number;
  };
  devices: SyncFleetDevice[];
}

export interface SyncResolveConflictRequest {
  conflict_id: string;
  resolution: "use_local" | "use_server" | "manual_merge" | "dismiss" | "resolved_by_owner" | "ignored_by_owner";
  merged_payload?: Record<string, unknown>;
  note?: string;
  expected_version?: number;
}

export interface SyncConflictRecord extends Record<string, unknown> {
  id: string;
  client_conflict_id?: string | null;
  source_event_id?: string | null;
  device_id?: string | null;
  entity_type: string;
  entity_id: string;
  reason_code: string;
  message: string;
  status: "open" | "resolved" | "dismissed";
  local_snapshot?: Record<string, unknown> | null;
  server_snapshot?: Record<string, unknown> | null;
  base_snapshot?: Record<string, unknown> | null;
  server_version?: string | number | null;
  resolution?: string | null;
  merged_payload?: Record<string, unknown> | null;
  resolution_note?: string | null;
  version: number;
  detected_at: string;
  resolved_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface SyncConflictListResponse extends Record<string, unknown> {
  conflicts: SyncConflictRecord[];
  summary: { open: number; resolved: number; dismissed: number };
  pagination: { hasMore: boolean; nextCursor: string | null; limit: number };
}

export interface SyncConflictReportRequest {
  client_conflict_id: string;
  entity_type: string;
  entity_id: string;
  reason_code?: string;
  message?: string;
  local_snapshot?: Record<string, unknown> | null;
  server_snapshot?: Record<string, unknown> | null;
  base_snapshot?: Record<string, unknown> | null;
  server_version?: string | number | null;
}

export interface SyncConflictReportResponse extends Record<string, unknown> {
  conflict: SyncConflictRecord;
}

/* ── Cloth rental ─────────────────────────────────────────────────────────── */

export type RentalStatus = "booked" | "picked_up" | "returned" | "cancelled";
export type RentalIdProofType = "aadhaar" | "pan" | "driving_licence" | "voter_id" | "other";

export interface RentalBookingItem {
  id?: string;
  productId?: string | null;
  name: string;
  unit: string;
  qty: number;
  ratePerDay: number;
  amount: number;
}

export interface RentalBooking {
  id: string;
  bookingNumber: string;
  customerId?: string | null;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  idProofType?: RentalIdProofType | null;
  idProofNumber?: string | null;
  fromDate: string;
  toDate: string;
  /** Day-only forms (YYYY-MM-DD) of fromDate/toDate, already in the shop's timezone. */
  fromDateKey: string;
  toDateKey: string;
  returnedAt?: string | null;
  status: RentalStatus;
  rentAmount: number;
  depositAmount: number;
  advancePaid: number;
  lateFee: number;
  damageCharge: number;
  /** Rent + late fee + damage − advance, computed server-side. */
  balanceDue: number;
  /** Still out and past its due day. */
  isOverdue: boolean;
  notes?: string | null;
  items: RentalBookingItem[];
  deletedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface RentalBookingInput {
  customerId?: string | null;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  idProofType?: RentalIdProofType | null;
  idProofNumber?: string | null;
  /** YYYY-MM-DD */
  fromDate: string;
  /** YYYY-MM-DD */
  toDate: string;
  items: Array<Omit<RentalBookingItem, "id">>;
  rentAmount?: number;
  depositAmount?: number;
  advancePaid?: number;
  notes?: string | null;
}

export interface RentalAvailabilityItem {
  productId: string;
  name: string;
  category: string | null;
  unit: string;
  imageUrl: string | null;
  pricePerDay: number;
  /** Whole pieces the shop owns. */
  owned: number;
  /** Held by other bookings across the requested window. */
  booked: number;
  available: number;
}

export interface RentalAvailability {
  from: string;
  to: string;
  items: RentalAvailabilityItem[];
}

export interface RentalSummary {
  today: string;
  outNow: number;
  dueToday: number;
  overdue: number;
  upcoming: number;
  activeToday: number;
  depositHeld: number;
  pendingCollection: number;
}

/* ── Pharmacy prescription register ───────────────────────────────────────── */

export type PrescriptionStatus = "pending" | "dispensed" | "cancelled";
/** Which schedule the strictest drug on the slip falls under. h/h1/x are the regulated ones. */
export type PrescriptionScheduleType = "h" | "h1" | "x" | "otc" | "other";
export type PrescriptionGender = "male" | "female" | "other";

export interface PrescriptionItem {
  id?: string;
  productId?: string | null;
  name: string;
  strength?: string | null;
  /** As written on the slip: "1-0-1 for 5 days". */
  dosage?: string | null;
  qty: number;
  unit: string;
  batchNumber?: string | null;
  /** Set when a generic went out against a brand written on the slip. */
  substitutedFor?: string | null;
}

export interface Prescription {
  id: string;
  registerNumber: string;
  doctorName: string;
  doctorRegNo?: string | null;
  doctorClinic?: string | null;
  customerId?: string | null;
  patientName: string;
  patientPhone: string;
  patientAge?: string | null;
  patientGender?: PrescriptionGender | null;
  patientAddress: string;
  scheduleType: PrescriptionScheduleType;
  prescribedOn: string;
  /** Day-only forms (YYYY-MM-DD), already in the shop's timezone. */
  prescribedOnKey: string;
  dispensedAt?: string | null;
  dispensedAtKey?: string | null;
  status: PrescriptionStatus;
  billId?: string | null;
  billNumber?: string | null;
  refillsAllowed: number;
  refillsUsed: number;
  /** Repeats still available, computed server-side. */
  refillsLeft: number;
  /** Whole days since the date on the slip. */
  ageDays: number;
  /** Still waiting to be dispensed and older than the freshness window. Advisory only. */
  isStale: boolean;
  /** Pending, or dispensed with repeats left. */
  canDispense: boolean;
  /** Schedule H, H1 or X — the ones the retention and inspection rules bite on. */
  isRegulated: boolean;
  imageUrl?: string | null;
  notes?: string | null;
  items: PrescriptionItem[];
  deletedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface PrescriptionInput {
  doctorName: string;
  doctorRegNo?: string | null;
  doctorClinic?: string | null;
  customerId?: string | null;
  patientName: string;
  patientPhone?: string | null;
  patientAge?: string | null;
  patientGender?: PrescriptionGender | null;
  patientAddress?: string | null;
  scheduleType?: PrescriptionScheduleType;
  /** YYYY-MM-DD */
  prescribedOn: string;
  items: Array<Omit<PrescriptionItem, "id">>;
  billId?: string | null;
  billNumber?: string | null;
  refillsAllowed?: number;
  imageUrl?: string | null;
  notes?: string | null;
  /** Record and hand over in one step, for the usual counter case. */
  dispenseNow?: boolean;
}

export interface PrescriptionSummary {
  today: string;
  pending: number;
  dispensedToday: number;
  thisMonth: number;
  /** Schedule H/H1/X entries this month — what an inspection actually counts. */
  regulatedThisMonth: number;
  refillable: number;
  stale: number;
  staleAfterDays: number;
}

/* ── Electronics: serialised units ────────────────────────────────────────── */

export type ProductUnitStatus = "in_stock" | "sold" | "returned" | "rma" | "lost" | "scrapped";
export type ProductUnitCondition = "new" | "open_box" | "refurbished";

export interface ProductUnit {
  id: string;
  productId: string;
  productName: string;
  imei?: string | null;
  imei2?: string | null;
  serialNumber?: string | null;
  status: ProductUnitStatus;
  condition: ProductUnitCondition;
  purchaseBillId?: string | null;
  supplierId?: string | null;
  costPrice: number;
  receivedAt: string;
  receivedAtKey?: string | null;
  billId?: string | null;
  billNumber?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  customerPhone: string;
  soldAt?: string | null;
  soldAtKey?: string | null;
  sellingPrice: number;
  warrantyMonths: number;
  warrantyUntil?: string | null;
  warrantyUntilKey?: string | null;
  /** Days until cover ends; negative once it has lapsed, null when never sold. */
  warrantyDaysLeft?: number | null;
  isUnderWarranty: boolean;
  isWarrantyExpiringSoon: boolean;
  /** Still physically on the shop's shelf or bench. */
  isHeld: boolean;
  canSell: boolean;
  notes?: string | null;
  deletedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProductUnitIdentityInput {
  imei?: string | null;
  imei2?: string | null;
  serialNumber?: string | null;
  condition?: ProductUnitCondition;
  costPrice?: number;
  notes?: string | null;
}

export interface ReceiveProductUnitsInput {
  productId: string;
  purchaseBillId?: string | null;
  supplierId?: string | null;
  costPrice?: number;
  warrantyMonths?: number;
  units: ProductUnitIdentityInput[];
}

export interface SellProductUnitInput {
  billId?: string | null;
  billNumber?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  sellingPrice?: number;
  warrantyMonths?: number | null;
  /** YYYY-MM-DD. Defaults to today; backdating catches up a missed entry. */
  soldOn?: string | null;
  notes?: string | null;
}

export interface ProductUnitSummary {
  today: string;
  inStock: number;
  openBox: number;
  soldToday: number;
  soldThisMonth: number;
  atService: number;
  warrantyExpiringSoon: number;
  warrantySoonDays: number;
}

/* ── Auto parts: vehicle fitment ──────────────────────────────────────────── */

export type PartCrossReferenceKind = "oem" | "alternative" | "supersedes" | "superseded_by";

export interface PartFitment {
  id: string;
  productId: string;
  productName: string;
  make: string;
  model: string;
  /** Null means the part fits every variant of the model. */
  variant?: string | null;
  /** Null bounds are open: "since forever" and "still current". */
  yearFrom?: number | null;
  yearTo?: number | null;
  /** "2015–2020", "2015 onwards", "up to 2012", "all years". */
  yearLabel: string;
  /** "Maruti Suzuki Swift · Diesel 1.3 DDiS" */
  vehicleLabel: string;
  notes?: string | null;
  deletedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface PartFitmentInput {
  productId: string;
  make: string;
  model: string;
  variant?: string | null;
  yearFrom?: number | null;
  yearTo?: number | null;
  notes?: string | null;
}

export interface BulkPartFitmentInput {
  productId: string;
  fitments: Array<Omit<PartFitmentInput, "productId">>;
}

/** A part that fits the vehicle being asked about, with what the shop holds of it. */
export interface FittingPart {
  productId: string;
  productName: string;
  /** False when the fitment outlived the product it was recorded against. */
  inCatalogue: boolean;
  sku?: string | null;
  brand?: string | null;
  stockQty: number;
  unit: string;
  price: number;
  fitments: PartFitment[];
}

export interface PartCrossReference {
  id: string;
  productId: string;
  productName: string;
  /** Set only when the alternative is something this shop stocks. */
  alternateProductId?: string | null;
  partNumber: string;
  brand?: string | null;
  kind: PartCrossReferenceKind;
  /** Whether the shop can actually hand the alternative over. */
  isStocked: boolean;
  notes?: string | null;
  deletedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface PartCrossReferenceInput {
  productId: string;
  alternateProductId?: string | null;
  partNumber: string;
  brand?: string | null;
  kind?: PartCrossReferenceKind;
  notes?: string | null;
}

export interface VehicleOptions {
  makes: string[];
  models: string[];
  variants: string[];
}

export interface PartNumberLookup {
  partNumber: string;
  products: Array<{
    productId: string;
    productName: string;
    sku?: string | null;
    brand?: string | null;
    stockQty: number;
    price: number;
  }>;
  references: PartCrossReference[];
}

export interface FitmentSummary {
  fitments: number;
  references: number;
  mappedParts: number;
  catalogueSize: number;
  /** Parts still invisible to a "does this fit?" search. */
  unmappedParts: number;
  makes: number;
}

/* ── Footwear: size runs ──────────────────────────────────────────────────── */

export type ShoeSizeSystem = "uk" | "us" | "eu" | "cm";
export type ShoeSizeGender = "mens" | "womens" | "kids" | "unisex";

/** The same physical shoe on every scale. Null when the size is off the chart. */
export interface ShoeSizeEquivalents {
  gender: ShoeSizeGender;
  uk: string;
  us: string;
  eu: string;
  cm: string;
}

export interface SizeRunCell {
  size: string;
  colour: string | null;
  pairs: number;
  inStock: boolean;
  equivalents: ShoeSizeEquivalents | null;
}

export interface SizeRun {
  productId: string;
  productName: string;
  brand?: string | null;
  imageUrl?: string | null;
  sizeSystem: ShoeSizeSystem;
  gender: ShoeSizeGender;
  widthFit?: string | null;
  /** False until the shop says which scale these numbers are on. */
  isProfiled: boolean;
  /** Kids sizing has no dependable chart, so equivalents are absent by design. */
  canConvert: boolean;
  sizeAxisName: string;
  otherAxisName: string | null;
  sizes: string[];
  colours: string[];
  cells: SizeRunCell[];
  totalPairs: number;
  sizesInStock: number;
  sizesTotal: number;
  gaps: Array<{ size: string; colour: string | null }>;
  /** On the shelf, but with holes — not sellable to everyone who walks in. */
  isBroken: boolean;
  /** Nothing left at all, which is a different problem from a broken run. */
  isEmpty: boolean;
}

export interface SizeProfileInput {
  sizeSystem: ShoeSizeSystem;
  gender?: ShoeSizeGender;
  widthFit?: string | null;
  notes?: string | null;
}

export interface SizeLookupMatch {
  productId: string;
  productName: string;
  brand?: string | null;
  sizeSystem: ShoeSizeSystem;
  gender: ShoeSizeGender;
  /** The size as that style numbers it, which may differ from what was asked. */
  sizeInStyleSystem: string;
  pairs: number;
  colours: string[];
}

export interface SizeLookup {
  asked: { system: ShoeSizeSystem; value: string; gender: ShoeSizeGender };
  equivalents: ShoeSizeEquivalents | null;
  ladder: string[];
  matches: SizeLookupMatch[];
}

export interface SizeRunSummary {
  styles: number;
  totalPairs: number;
  brokenRuns: number;
  emptyRuns: number;
  unprofiledStyles: number;
  missingSizes: number;
}

/* ── Stationery: class book lists ─────────────────────────────────────────── */

export interface BookListItem {
  id?: string;
  productId?: string | null;
  name: string;
  qty: number;
  unit: string;
  /** On the list, but not counted as a shortfall when it is out. */
  isOptional: boolean;
  notes?: string | null;
  sortOrder?: number;
  /** Filled in when the list is read against the live catalogue. */
  inCatalogue?: boolean;
  productName?: string;
  sku?: string | null;
  price?: number;
  available?: number;
  shortBy?: number;
  isReady?: boolean;
}

export interface BookListMissingItem {
  productId?: string | null;
  name: string;
  needed: number;
  available: number;
  shortBy: number;
  inCatalogue: boolean;
}

export interface BookList {
  id: string;
  schoolName: string;
  className: string;
  academicYear: string;
  /** Empty rather than null — a nullable label would defeat the unique index. */
  name: string;
  /** "Class 6 · DPS — Science stream" */
  label: string;
  notes?: string | null;
  isActive: boolean;
  items: BookListItem[];
  itemCount: number;
  requiredCount: number;
  readyCount: number;
  shortCount: number;
  /** Every required line is on the shelf. */
  isComplete: boolean;
  missing: BookListMissingItem[];
  estimatedTotal: number;
  deletedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface BookListInput {
  schoolName: string;
  className: string;
  academicYear: string;
  name?: string | null;
  notes?: string | null;
  isActive?: boolean;
  items?: Array<Omit<BookListItem, "id" | "inCatalogue" | "productName" | "sku" | "price" | "available" | "shortBy" | "isReady">>;
}

export interface BookListOptions {
  schools: string[];
  classes: string[];
  years: string[];
}

/** One line of the reorder sheet: what to buy, and which classes are waiting on it. */
export interface BookListShortfall {
  productId?: string | null;
  name: string;
  inCatalogue: boolean;
  available: number;
  shortBy: number;
  lists: string[];
}

export interface BookListSummary {
  lists: number;
  completeLists: number;
  shortLists: number;
  itemsToOrder: number;
  unitsToOrder: number;
  schools: number;
}

/* ── Furniture: sales orders ──────────────────────────────────────────────── */

export type FurnitureOrderStatus =
  | "quote" | "confirmed" | "in_production" | "ready" | "delivered" | "installed" | "cancelled";
export type FurniturePaymentMode = "cash" | "upi" | "bank" | "card" | "other";

export interface FurnitureOrderItem {
  id?: string;
  /** Null for a made-to-order piece not in the catalogue. */
  productId?: string | null;
  name: string;
  /** "Teak, 6ft, walnut finish" — the spec a carpenter works from. */
  variant?: string | null;
  qty: number;
  rate: number;
  amount: number;
  /** Whether this line holds a piece off the showroom floor while the order is open. */
  reserveStock: boolean;
  notes?: string | null;
}

export interface FurnitureOrderPayment {
  id: string;
  amount: number;
  mode: FurniturePaymentMode;
  paidOn: string;
  reference?: string | null;
  notes?: string | null;
  createdAt?: string;
}

export interface FurnitureOrder {
  id: string;
  orderNumber: string;
  customerId?: string | null;
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  status: FurnitureOrderStatus;
  statusLabel: string;
  itemsTotal: number;
  discount: number;
  deliveryCharge: number;
  installCharge: number;
  grandTotal: number;
  quotedOn: string;
  quotedOnKey?: string | null;
  promisedOn?: string | null;
  promisedOnKey?: string | null;
  deliveredAt?: string | null;
  deliveredAtKey?: string | null;
  installedAt?: string | null;
  installedAtKey?: string | null;
  isCustom: boolean;
  billId?: string | null;
  billNumber?: string | null;
  notes?: string | null;
  items: FurnitureOrderItem[];
  payments: FurnitureOrderPayment[];
  /** Sum of payments, computed server-side. */
  paidTotal: number;
  balanceDue: number;
  /** More taken than the order is worth — a refund waiting to happen. */
  isOverpaid: boolean;
  advancePercent: number;
  isOpen: boolean;
  isOverdue: boolean;
  isDueSoon: boolean;
  daysToPromised?: number | null;
  /** What this order may legally become next. */
  nextStatuses: FurnitureOrderStatus[];
  canCancel: boolean;
  isPaidUp: boolean;
  deletedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface FurnitureOrderInput {
  customerId?: string | null;
  customerName: string;
  customerPhone?: string | null;
  deliveryAddress?: string | null;
  status?: "quote" | "confirmed";
  items: Array<Omit<FurnitureOrderItem, "id" | "amount"> & { amount?: number }>;
  discount?: number;
  deliveryCharge?: number;
  installCharge?: number;
  quotedOn?: string;
  promisedOn?: string | null;
  isCustom?: boolean;
  notes?: string | null;
}

export interface FurnitureOrderSummary {
  today: string;
  openOrders: number;
  quotes: number;
  inProduction: number;
  readyToDeliver: number;
  overdue: number;
  dueSoon: number;
  /** Money taken against work not yet delivered — held, not earned. */
  advancesHeld: number;
  pendingCollection: number;
  orderBookValue: number;
  reservedProducts: number;
}

/* ── Cosmetics: tester stock ──────────────────────────────────────────────── */

export type TesterStatus = "in_use" | "replaced" | "discarded";

export interface TesterUnit {
  id: string;
  productId: string;
  productName: string;
  /** The shade — a tester is opened per shade, not per product. */
  variant?: string | null;
  status: TesterStatus;
  openedOn: string;
  openedOnKey?: string | null;
  expectedDays: number;
  closedOn?: string | null;
  closedOnKey?: string | null;
  dueOnKey?: string | null;
  /** Snapshotted at opening so a later price change cannot rewrite it. */
  costValue: number;
  /** The stock movement this tester came out of, when one was made. */
  stockLedgerId?: string | null;
  ageDays: number;
  daysLeft?: number | null;
  isOpen: boolean;
  isDue: boolean;
  isDueSoon: boolean;
  notes?: string | null;
  deletedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface OpenTesterInput {
  productId: string;
  variant?: string | null;
  expectedDays?: number;
  costValue?: number | null;
  openedOn?: string;
  sellingUnitId?: string | null;
  locationId?: string | null;
  /** False when the shop already took the unit off the shelf by hand. */
  moveStock?: boolean;
  notes?: string | null;
}

export interface TesterCostLine {
  productId: string;
  productName: string;
  opened: number;
  cost: number;
}

export interface TesterCost {
  totalOpened: number;
  totalCost: number;
  byProduct: TesterCostLine[];
}

export interface TesterSummary {
  today: string;
  openTesters: number;
  dueNow: number;
  dueSoon: number;
  /** Money sitting on the counter as stock that will never be sold. */
  valueOnCounter: number;
  openedThisMonth: number;
  costThisMonth: number;
  dueSoonDays: number;
}

/* ── Restaurant: the floor, the menu card and the recipe book ─────────────── */

export interface RestaurantTable {
  id: string;
  /** What the QR sticker carries: short and human-checkable ("t5"). */
  code: string;
  name: string;
  section: string;
  seats: number;
  /** Per table, so the terrace can self-order while the private room does not. */
  selfOrderEnabled: boolean;
  active: boolean;
  sortOrder: number;
  locationId?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface RestaurantTableInput {
  name: string;
  code?: string;
  section?: string;
  seats?: number;
  selfOrderEnabled?: boolean;
  sortOrder?: number;
}

export type FoodType = "veg" | "nonveg" | "egg" | "vegan" | "jain";

export interface MenuDish {
  id: string;
  name: string;
  category: string | null;
  price: number;
  mrp: number | null;
  unit: string;
  imageUrl: string | null;
  description: string | null;
  gstRate: number;
  menuCourse: string | null;
  foodType: FoodType | null;
  spiceLevel: number | null;
  prepMinutes: number | null;
  tags: string[];
  /** Tonight's "86" switch: on the menu, priced, but the kitchen has run out. */
  menuAvailable: boolean;
  menuSortOrder: number;
  /** A dish cooked to order has no stock of its own — the ingredients are the stock. */
  hasRecipe: boolean;
  portionsLeft: number | null;
  stockBaseQty: number;
  /**
   * Half and Full, Small and Large. Empty for a dish sold one way, which is most
   * of them — the dish's own `price` is what a guest pays then.
   */
  variations: MenuDishVariation[];
  addonGroups: MenuAddonGroup[];
  /**
   * The dishes a thali or meal deal is made of. Empty for an ordinary dish.
   *
   * Having components IS what makes a product a combo — `isCombo` is derived from
   * this list rather than stored, so no flag can disagree with it.
   */
  comboComponents: MenuComboComponent[];
  isCombo: boolean;
  /** What the parts cost separately and what the guest saves. Null unless a combo. */
  comboValue: ComboValue | null;
}

export interface MenuAddonOption {
  id: string;
  name: string;
  price: number;
  linkedProductId: string | null;
  linkedQtyBase: number;
  sortOrder: number;
  isActive: boolean;
}

export interface MenuAddonGroup {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  sortOrder: number;
  isActive: boolean;
  required: boolean;
  options: MenuAddonOption[];
}

export interface MenuAddonGroupInput {
  name: string;
  minSelect?: number;
  maxSelect?: number;
  sortOrder?: number;
  isActive?: boolean;
  options: Array<{
    id?: string;
    name: string;
    price: number;
    linkedProductId?: string | null;
    linkedQtyBase?: number;
    sortOrder?: number;
  }>;
}

/**
 * One portion of a dish.
 *
 * Stored as the product's selling unit, which is why billing needs no new code to
 * charge for it: the cart already offers a unit dropdown priced per unit, and a
 * finalised bill already snapshots which one was sold.
 */
export interface MenuDishVariation {
  /** Stable id for this portion. Sending it back on an edit renames in place. */
  unitCode: string;
  name: string;
  price: number;
  /** How much of one full portion this is — Half = 0.5. Drives recipe depletion. */
  portionFactor: number;
  isDefault: boolean;
}

/** One dish inside a combo, with how many of it the combo includes. */
export interface MenuComboComponent {
  componentProductId: string;
  name: string;
  /** 2 roti in a thali. Fractional is legal — half a portion of raita. */
  quantity: number;
  sortOrder: number;
  note: string | null;
}

/**
 * A combo's price against its parts.
 *
 * Both numbers, not just the saving: "₹30 off" means nothing on a menu without
 * the ₹180 it came off, and a combo priced ABOVE its parts is a mistake the owner
 * should see rather than a negative number to hide.
 */
export interface ComboValue {
  /** What the components cost bought à la carte. */
  separately: number;
  price: number;
  /** Never negative — a combo dearer than its parts saves nothing. */
  saving: number;
  dearerThanParts: boolean;
}

export interface MenuCourseSection {
  course: string;
  dishes: MenuDish[];
}

export interface MenuBoard {
  courses: MenuCourseSection[];
  dishCount: number;
  suggestedCourses: string[];
}

export interface MenuDishPatch {
  menuCourse?: string | null;
  foodType?: FoodType | null;
  spiceLevel?: number | null;
  prepMinutes?: number | null;
  tags?: string[] | null;
  menuAvailable?: boolean;
  menuSortOrder?: number;
}

export interface DishRecipeComponent {
  id?: string;
  dishProductId?: string;
  ingredientProductId: string;
  ingredientName?: string;
  /** Per ONE portion, in the ingredient's own base unit (g, ml, piece). */
  qtyBase: number;
  wastagePct: number;
  /** A garnish the dish can be served without — excluded from "can we make it?". */
  optional: boolean;
  note?: string | null;
  ingredientMissing?: boolean;
  baseUnit?: string | null;
  stockBaseQty?: number;
  perPortion?: number;
}

export interface DishRecipe {
  dish: { id: string; name: string; unit: string; price: number };
  components: DishRecipeComponent[];
  /** Null means nothing constrains the dish — never confuse it with zero. */
  portionsPossible: number | null;
  ingredientCost: number;
}

export type KitchenStockStatus = "out" | "low" | "ok";

export interface KitchenIngredient {
  productId: string;
  name: string;
  missing: boolean;
  baseUnit: string | null;
  stockBaseQty: number;
  threshold: number;
  status: KitchenStockStatus;
  usedInDishes: number;
  dishIds: string[];
}

export interface KitchenDish {
  dishProductId: string;
  name: string;
  missing: boolean;
  menuCourse: string | null;
  menuAvailable: boolean;
  componentCount: number;
  portionsPossible: number | null;
  blockedBy: string[];
  status: KitchenStockStatus | "unknown";
}

export interface KitchenStock {
  ingredients: KitchenIngredient[];
  dishes: KitchenDish[];
  summary: {
    ingredientsOut: number;
    ingredientsLow: number;
    dishesOut: number;
    dishesLow: number;
    dishesWithRecipes: number;
  };
}

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
  defaultPrice: number;
  minimumPrice?: number | null;
  maximumPrice?: number | null;
  costPrice?: number | null;
  isDefault: boolean;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface Product {
  id: string;
  shopId?: string;
  name: string;
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
  gstNumber?: string | null;
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
  sellingUnitId?: string;
  sellingUnitCode?: string;
  sellingUnitLabel?: string;
  conversionToBase?: number;
  name: string;
  quantity: number;
  enteredUnit: string;
  ratePerRateUnit: number;
  originalUnitPrice?: number;
  appliedPricingRuleId?: string;
  appliedPricingRuleType?: string;
  pricingExplanation?: string;
  pricingConfidence?: number;
  pricingCalculationVersion?: string;
  wasPriceOverridden?: boolean;
  priceOverrideReason?: string;
  gstRate?: number;
}

export interface BillInput {
  locationId?: string;
  billType: typeof BillInputBillType[keyof typeof BillInputBillType];
  /** How GST applies: inclusive (MRP prices, default), exclusive (added on top), or none. */
  gstMode?: "inclusive" | "exclusive" | "none";
  customerId?: string;
  customerName?: string;
  customerMobile?: string;
  items: BillInputItem[];
  discount?: number;
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
  subtotal?: number;
  discount?: number;
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

export type ID = string;
export type QueryParams = Record<string, unknown>;

export interface User {
  id: string;
  shopId?: string;
  name: string;
  mobile?: string;
  email?: string;
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
  gstRate?: number;
  hsn?: string | null;
  brand?: string | null;
  mrp?: number;
  reorderLevel?: number;
  description?: string | null;
  imageUrl?: string | null;
  isLooseItem?: boolean;
  lowStockThreshold?: number;
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
  gstRate?: number;
  hsn?: string;
  brand?: string;
  mrp?: number;
  reorderLevel?: number;
  description?: string;
  imageUrl?: string;
  isLooseItem?: boolean;
  lowStockThreshold?: number;
  lowStockAlert?: number;
  isActive?: boolean;
  status?: "active" | "inactive" | string;
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
  credit: "credit",
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
} as const;

export interface BillPayment {
  mode: typeof BillPaymentMode[keyof typeof BillPaymentMode];
  amount: number;
}

export interface BillInputItem {
  productId?: string;
  name: string;
  quantity: number;
  enteredUnit: string;
  ratePerRateUnit: number;
  gstRate?: number;
}

export interface BillInput {
  billType: typeof BillInputBillType[keyof typeof BillInputBillType];
  customerId?: string;
  customerName?: string;
  customerMobile?: string;
  items: BillInputItem[];
  discount?: number;
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
  gst?: number;
  grandTotal?: number;
  totalAmount?: number;
  netAmount?: number;
  grossProfit?: number;
  paidAmount?: number;
  buyerPaidAmount?: number;
  creditAmount?: number;
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
  credit: number;
  total: number;
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
  entityCursors?: Record<string, string | null>;
  hasMoreByEntity?: Record<string, boolean>;
  hasMore?: boolean;
  nextCursor?: string | number | null;
  serverTime?: string;
  limit?: number;
  returnedCount?: number;
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

export interface SyncResolveConflictRequest {
  conflict_id: string;
  resolution: "use_local" | "use_server" | "manual_merge";
  merged_payload?: Record<string, unknown>;
}

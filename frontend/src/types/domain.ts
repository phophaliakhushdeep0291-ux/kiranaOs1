export type EntityId = string;
export type ISODateTimeString = string;

export type SyncStatus =
  | "local_only"
  | "pending_sync"
  | "syncing"
  | "synced"
  | "failed"
  | "conflict";

export interface LocalEntityMeta {
  id: EntityId;
  local_id?: EntityId;
  server_id?: EntityId;
  tenant_id: EntityId;
  store_id: EntityId;
  created_at: ISODateTimeString;
  updated_at: ISODateTimeString;
  deleted_at?: ISODateTimeString | null;
  version: number;
  sync_status: SyncStatus;
  last_modified_by?: EntityId | null;
  device_id: EntityId;
}

export type Money = number;
export type Quantity = number;
export type Percentage = number;

export type ProductUnit =
  | "piece" | "dozen" | "set" | "pair" | "bundle" | "roll" | "sheet"
  | "kg" | "g" | "gram"
  | "litre" | "ml"
  | "meter" | "yard"
  | "packet" | "box"
  | "strip" | "tablet" | "bottle" | "tube"
  | "plate" | "glass"
  | "custom";

export interface Product extends LocalEntityMeta {
  name: string;
  category?: string | null;
  aliases: string[];
  sku?: string | null;
  barcode?: string | null;
  hsn?: string | null;
  display_unit: ProductUnit | string;
  base_unit: ProductUnit | string;
  rate_unit: ProductUnit | string;
  stock_base_qty: Quantity;
  cost_per_rate_unit?: Money | null;
  min_price_per_rate_unit?: Money | null;
  default_price_per_rate_unit: Money;
  gst_rate: Percentage;
  low_stock_threshold?: Quantity | null;
  is_active: boolean;
}

export type CustomerType = "regular" | "udhar";

export interface Customer extends LocalEntityMeta {
  name: string;
  mobile?: string | null;
  type: CustomerType;
  address?: string | null;
  udhar_limit?: Money | null;
  udhar_amount: Money;
  total_udhar: Money;
  reminder_override_until?: ISODateTimeString | null;
  notes?: string | null;
}

export type BillType = "normal_sale" | "udhar_entry" | "gst_invoice" | "estimate";
export type BillStatus = "draft" | "pending_sync" | "confirmed" | "cancelled" | "refunded";
export type PaymentMode = "cash" | "upi" | "credit" | "split";

export interface BillItem extends LocalEntityMeta {
  bill_id: EntityId;
  product_id?: EntityId | null;
  product_local_id?: EntityId | null;
  name: string;
  quantity: Quantity;
  entered_unit: string;
  rate_per_rate_unit: Money;
  cost_per_rate_unit?: Money | null;
  gst_rate: Percentage;
  line_subtotal: Money;
  line_gst: Money;
  line_total: Money;
}

export interface Payment extends LocalEntityMeta {
  bill_id?: EntityId | null;
  customer_id?: EntityId | null;
  ledger_entry_id?: EntityId | null;
  mode: Exclude<PaymentMode, "split">;
  amount: Money;
  reference_no?: string | null;
  note?: string | null;
  paid_at: ISODateTimeString;
}

export interface Bill extends LocalEntityMeta {
  bill_no: string;
  bill_type: BillType;
  status: BillStatus;
  customer_id?: EntityId | null;
  customer_local_id?: EntityId | null;
  customer_name?: string | null;
  customer_mobile?: string | null;
  items: BillItem[];
  payments: Payment[];
  subtotal: Money;
  discount: Money;
  gst: Money;
  gst_mode?: "inclusive" | "exclusive" | "none";
  grand_total: Money;
  paid_amount: Money;
  credit_amount: Money;
  gross_profit?: Money | null;
  cancelled_at?: ISODateTimeString | null;
  cancelled_by?: EntityId | null;
}

export type LedgerEntryType = "debit" | "credit" | "waiver" | "adjustment";
export type LedgerSourceType = "bill" | "payment" | "manual_adjustment" | "opening_balance";

export interface LedgerEntry extends LocalEntityMeta {
  customer_id: EntityId;
  customer_local_id?: EntityId | null;
  type: LedgerEntryType;
  source_type: LedgerSourceType;
  source_id?: EntityId | null;
  amount: Money;
  balance_after: Money;
  note?: string | null;
  entry_at: ISODateTimeString;
}

export type InventoryMovementType =
  | "sale"
  | "purchase"
  | "damage"
  | "return"
  | "correction"
  | "opening_stock";

export interface InventoryMovement extends LocalEntityMeta {
  product_id: EntityId;
  product_local_id?: EntityId | null;
  type: InventoryMovementType;
  quantity_delta: Quantity;
  unit: string;
  reason?: string | null;
  reference_type?: "bill" | "supplier_purchase" | "manual" | null;
  reference_id?: EntityId | null;
  stock_after?: Quantity | null;
  owner_pin_verified: boolean;
}

export interface Supplier extends LocalEntityMeta {
  name: string;
  mobile?: string | null;
  address?: string | null;
  gst_number?: string | null;
  notes?: string | null;
  is_active: boolean;
}

export type StaffRole = "owner" | "manager" | "cashier" | "inventory" | "viewer";

export interface StaffUser extends LocalEntityMeta {
  name: string;
  mobile?: string | null;
  email?: string | null;
  role: StaffRole;
  permissions: string[];
  is_active: boolean;
  last_login_at?: ISODateTimeString | null;
}

export type SubscriptionPlanCode = "free" | "starter" | "growth" | "pro" | "enterprise";
export type SubscriptionFeatureKey =
  | "billing"
  | "udhar_ledger"
  | "reports"
  | "multi_device"
  | "staff"
  | "inventory"
  | "sync"
  | "recycle_bin";

export interface SubscriptionPlan extends LocalEntityMeta {
  code: SubscriptionPlanCode | string;
  name: string;
  monthly_price: Money;
  currency: "INR" | string;
  features: SubscriptionFeatureKey[];
  max_staff_users: number;
  max_devices: number;
  max_monthly_bills?: number | null;
  is_active: boolean;
}

export type DeviceLicenseStatus = "active" | "revoked" | "expired" | "pending";

export interface DeviceLicense extends LocalEntityMeta {
  device_name: string;
  device_fingerprint: string;
  license_key?: string | null;
  status: DeviceLicenseStatus;
  activated_at?: ISODateTimeString | null;
  expires_at?: ISODateTimeString | null;
  last_seen_at?: ISODateTimeString | null;
}

export type SyncOperationType = "create" | "update" | "delete" | "restore";
export type SyncEntityType =
  | "product"
  | "customer"
  | "bill"
  | "bill_item"
  | "payment"
  | "ledger_entry"
  | "inventory_movement"
  | "supplier"
  | "staff_user"
  | "subscription_plan"
  | "device_license"
  | "audit_log";

export interface SyncOutboxOperation<TPayload extends Record<string, unknown> = Record<string, unknown>> extends LocalEntityMeta {
  operation_type: SyncOperationType;
  entity_type: SyncEntityType;
  entity_id: EntityId;
  payload: TPayload;
  retry_count: number;
  last_error?: string | null;
  next_retry_at?: ISODateTimeString | null;
  queued_at: ISODateTimeString;
  synced_at?: ISODateTimeString | null;
}

export type SyncConflictResolution = "use_local" | "use_server" | "manual_merge" | "unresolved";

export interface SyncConflict<TLocal = unknown, TServer = unknown> extends LocalEntityMeta {
  entity_type: SyncEntityType;
  entity_id: EntityId;
  local_version: number;
  server_version: number;
  local_snapshot: TLocal;
  server_snapshot: TServer;
  conflict_fields: string[];
  resolution: SyncConflictResolution;
  resolved_by?: EntityId | null;
  resolved_at?: ISODateTimeString | null;
}

export type AuditAction =
  | "create"
  | "update"
  | "delete"
  | "restore"
  | "login"
  | "logout"
  | "pin_verify"
  | "sync"
  | "export";

export interface AuditLog extends LocalEntityMeta {
  action: AuditAction | string;
  entity_type?: SyncEntityType | string | null;
  entity_id?: EntityId | null;
  actor_id?: EntityId | null;
  actor_role?: StaffRole | string | null;
  device_fingerprint?: string | null;
  ip_address?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
}

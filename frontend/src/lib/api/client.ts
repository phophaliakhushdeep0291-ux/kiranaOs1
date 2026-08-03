export {
  AUTH_SESSION_EXPIRED_EVENT,
  DEVICE_SESSION_REVOKED_EVENT,
  ApiClientError,
  apiRequest,
  buildQuery,
  getApiBaseUrl,
  getStoredAccessToken,
  getStoredRefreshToken,
  isBrowserOnline,
  setApiBaseUrl,
  setAuthTokenGetter,
} from "@/lib/api/http";

export type { ApiErrorData } from "@/lib/api/http";
export type {
  AuthResponse,
  Bill,
  BillInput,
  BillListResult,
  BillPayment,
  Customer,
  CustomerInput,
  ID,
  InventoryItem,
  LedgerResult,
  MonthlyBreakdownRow,
  PaymentSummary,
  PnLReport,
  Product,
  ProductInput,
  ProductSellingUnit,
  PurchaseBill,
  PurchaseBillInput,
  QueryParams,
  QuantitySlabPrice,
  CustomerSpecificPrice,
  Shop,
  Supplier,
  TopProductRow,
  UdharPaymentInput,
  UdharSummary,
  User,
} from "@/types/api";
export { BillInputBillType, BillPaymentMode, CustomerInputType, UdharPaymentInputMode } from "@/types/api";

export { getMe, logoutSession, refreshAccessToken, setOwnerPin } from "@/features/core/auth/api";
export { syncPush } from "@/features/core/sync/api";

// Temporary compatibility exports while pages migrate to feature-local query modules.
export * from "@/features/core/auth/queries";
export * from "@/features/core/products/queries";
export * from "@/features/core/customers/queries";
export * from "@/features/core/billing/queries";
export * from "@/features/core/bills/queries";
export * from "@/features/core/inventory/queries";
export * from "@/features/core/reports/queries";
export * from "@/features/core/suppliers/queries";
export * from "@/features/core/settings/queries";

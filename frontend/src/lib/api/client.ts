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

export { getMe, logoutSession, refreshAccessToken, setOwnerPin } from "@/features/auth/api";
export { syncPush } from "@/features/sync/api";

// Temporary compatibility exports while pages migrate to feature-local query modules.
export * from "@/features/auth/queries";
export * from "@/features/products/queries";
export * from "@/features/customers/queries";
export * from "@/features/billing/queries";
export * from "@/features/bills/queries";
export * from "@/features/inventory/queries";
export * from "@/features/reports/queries";
export * from "@/features/suppliers/queries";
export * from "@/features/settings/queries";

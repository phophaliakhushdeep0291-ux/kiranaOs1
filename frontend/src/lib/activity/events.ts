// The activity event catalogue (§13). This mirrors
// backend/src/modules/activity/activity.events.js exactly — the server rejects
// anything it does not recognise, so the two lists must be diffed together when
// either changes.

export const ACTIVITY_EVENTS = {
  // App / session
  APP_LAUNCH: "APP_LAUNCH",
  USER_LOGIN: "USER_LOGIN",
  USER_LOGOUT: "USER_LOGOUT",
  SCREEN_VIEW: "SCREEN_VIEW",

  // Billing
  PRODUCT_SEARCH: "PRODUCT_SEARCH",
  PRODUCT_VIEW: "PRODUCT_VIEW",
  PRODUCT_ADDED_TO_BILL: "PRODUCT_ADDED_TO_BILL",
  PRODUCT_REMOVED_FROM_BILL: "PRODUCT_REMOVED_FROM_BILL",
  BILL_CREATED: "BILL_CREATED",
  BILL_MODIFIED: "BILL_MODIFIED",
  BILL_CANCELLED: "BILL_CANCELLED",
  PAYMENT_COMPLETED: "PAYMENT_COMPLETED",

  // Customers
  CUSTOMER_SEARCH: "CUSTOMER_SEARCH",
  CUSTOMER_SELECTED: "CUSTOMER_SELECTED",

  // Inventory / purchases
  INVENTORY_VIEW: "INVENTORY_VIEW",
  INVENTORY_UPDATE: "INVENTORY_UPDATE",
  PURCHASE_CREATED: "PURCHASE_CREATED",

  // Reports / documents
  REPORT_VIEW: "REPORT_VIEW",
  REPORT_EXPORT: "REPORT_EXPORT",
  PDF_GENERATED: "PDF_GENERATED",

  // Settings / hardware
  SETTINGS_CHANGED: "SETTINGS_CHANGED",
  PRINTER_USED: "PRINTER_USED",
  BARCODE_SCANNED: "BARCODE_SCANNED",
  VOICE_COMMAND_USED: "VOICE_COMMAND_USED",

  // Support / AI
  AI_ASSISTANT_QUERY: "AI_ASSISTANT_QUERY",
  HELP_ARTICLE_VIEWED: "HELP_ARTICLE_VIEWED",
  ERROR_OCCURRED: "ERROR_OCCURRED",

  // Sync
  SYNC_STARTED: "SYNC_STARTED",
  SYNC_COMPLETED: "SYNC_COMPLETED",
  SYNC_FAILED: "SYNC_FAILED",

  // Online (QR self-order) session
  ONLINE_SESSION_START: "ONLINE_SESSION_START",
  ONLINE_SESSION_END: "ONLINE_SESSION_END",
  ONLINE_PRODUCT_VIEW: "ONLINE_PRODUCT_VIEW",
  ONLINE_CART_ADD: "ONLINE_CART_ADD",
  ONLINE_CART_ABANDONED: "ONLINE_CART_ABANDONED",
  ONLINE_CHECKOUT_STARTED: "ONLINE_CHECKOUT_STARTED",
  ONLINE_CHECKOUT_COMPLETED: "ONLINE_CHECKOUT_COMPLETED",
  ONLINE_PAYMENT_FAILED: "ONLINE_PAYMENT_FAILED",

  // Generic
  FEATURE_USED: "FEATURE_USED",
  TASK_COMPLETED: "TASK_COMPLETED",
} as const;

export type ActivityEventType = (typeof ACTIVITY_EVENTS)[keyof typeof ACTIVITY_EVENTS];

export const ONLINE_EVENT_TYPES: readonly ActivityEventType[] = [
  ACTIVITY_EVENTS.ONLINE_SESSION_START,
  ACTIVITY_EVENTS.ONLINE_SESSION_END,
  ACTIVITY_EVENTS.ONLINE_PRODUCT_VIEW,
  ACTIVITY_EVENTS.ONLINE_CART_ADD,
  ACTIVITY_EVENTS.ONLINE_CART_ABANDONED,
  ACTIVITY_EVENTS.ONLINE_CHECKOUT_STARTED,
  ACTIVITY_EVENTS.ONLINE_CHECKOUT_COMPLETED,
  ACTIVITY_EVENTS.ONLINE_PAYMENT_FAILED,
];

export function isOnlineEventType(type: ActivityEventType): boolean {
  return ONLINE_EVENT_TYPES.includes(type);
}

/** Event-specific metadata. Values stay JSON-serializable — this is persisted. */
export type ActivityMetadata = Record<string, unknown>;

export interface ActivityEventInput {
  eventId: string;
  eventType: ActivityEventType;
  occurredAt: string;
  sessionId?: string;
  deviceId?: string;
  screen?: string;
  module?: string;
  appVersion?: string;
  networkStatus?: "online" | "offline";
  durationMs?: number;
  metadata?: ActivityMetadata;
}

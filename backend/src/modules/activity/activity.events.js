/**
 * The activity event catalogue (§13 "Event Generation").
 *
 * This is a CLOSED vocabulary on purpose. An open one ("accept whatever string
 * the client sends") makes the analytics surface unqueryable within a release or
 * two: a typo silently becomes a new feature in the adoption report, and nobody
 * finds out. Unknown types are rejected at ingest and counted, so a client/server
 * version skew shows up as a number rather than as quietly wrong dashboards.
 *
 * Ordering of the list mirrors the spec so the two can be diffed by eye.
 */

export const ACTIVITY_EVENTS = Object.freeze({
  // ── App / session ──────────────────────────────────────────────
  APP_LAUNCH: "APP_LAUNCH",
  USER_LOGIN: "USER_LOGIN",
  USER_LOGOUT: "USER_LOGOUT",
  SCREEN_VIEW: "SCREEN_VIEW",

  // ── Billing ────────────────────────────────────────────────────
  PRODUCT_SEARCH: "PRODUCT_SEARCH",
  PRODUCT_VIEW: "PRODUCT_VIEW",
  PRODUCT_ADDED_TO_BILL: "PRODUCT_ADDED_TO_BILL",
  PRODUCT_REMOVED_FROM_BILL: "PRODUCT_REMOVED_FROM_BILL",
  BILL_CREATED: "BILL_CREATED",
  BILL_MODIFIED: "BILL_MODIFIED",
  BILL_CANCELLED: "BILL_CANCELLED",
  PAYMENT_COMPLETED: "PAYMENT_COMPLETED",

  // ── Customers ──────────────────────────────────────────────────
  CUSTOMER_SEARCH: "CUSTOMER_SEARCH",
  CUSTOMER_SELECTED: "CUSTOMER_SELECTED",

  // ── Inventory / purchases ──────────────────────────────────────
  INVENTORY_VIEW: "INVENTORY_VIEW",
  INVENTORY_UPDATE: "INVENTORY_UPDATE",
  PURCHASE_CREATED: "PURCHASE_CREATED",

  // ── Reports / documents ────────────────────────────────────────
  REPORT_VIEW: "REPORT_VIEW",
  REPORT_EXPORT: "REPORT_EXPORT",
  PDF_GENERATED: "PDF_GENERATED",

  // ── Settings / hardware ────────────────────────────────────────
  SETTINGS_CHANGED: "SETTINGS_CHANGED",
  PRINTER_USED: "PRINTER_USED",
  BARCODE_SCANNED: "BARCODE_SCANNED",
  VOICE_COMMAND_USED: "VOICE_COMMAND_USED",

  // ── Support / AI ───────────────────────────────────────────────
  AI_ASSISTANT_QUERY: "AI_ASSISTANT_QUERY",
  HELP_ARTICLE_VIEWED: "HELP_ARTICLE_VIEWED",
  ERROR_OCCURRED: "ERROR_OCCURRED",

  // ── Sync ───────────────────────────────────────────────────────
  SYNC_STARTED: "SYNC_STARTED",
  SYNC_COMPLETED: "SYNC_COMPLETED",
  SYNC_FAILED: "SYNC_FAILED",

  // ── Online (QR self-order) session ─────────────────────────────
  ONLINE_SESSION_START: "ONLINE_SESSION_START",
  ONLINE_SESSION_END: "ONLINE_SESSION_END",
  ONLINE_PRODUCT_VIEW: "ONLINE_PRODUCT_VIEW",
  ONLINE_CART_ADD: "ONLINE_CART_ADD",
  ONLINE_CART_ABANDONED: "ONLINE_CART_ABANDONED",
  ONLINE_CHECKOUT_STARTED: "ONLINE_CHECKOUT_STARTED",
  ONLINE_CHECKOUT_COMPLETED: "ONLINE_CHECKOUT_COMPLETED",
  ONLINE_PAYMENT_FAILED: "ONLINE_PAYMENT_FAILED",

  // ── Generic ────────────────────────────────────────────────────
  // A named UI action that does not deserve its own type but still counts
  // toward feature adoption. `metadata.feature` carries which one.
  FEATURE_USED: "FEATURE_USED",
  // A user-facing operation that was timed end to end ("which tasks consume the
  // most time"). `metadata.task` names it.
  TASK_COMPLETED: "TASK_COMPLETED",
});

export const ACTIVITY_EVENT_TYPES = Object.freeze(Object.values(ACTIVITY_EVENTS));

const EVENT_TYPE_SET = new Set(ACTIVITY_EVENT_TYPES);

export function isKnownEventType(type) {
  return EVENT_TYPE_SET.has(type);
}

/**
 * Events raised from an online customer session. These carry no POS user, so
 * `userId` is null and they only ever feed shop-wide rollups — a shopper's
 * browsing must never be attributed to a staff member's personal suggestions.
 */
export const ONLINE_EVENT_TYPES = Object.freeze([
  ACTIVITY_EVENTS.ONLINE_SESSION_START,
  ACTIVITY_EVENTS.ONLINE_SESSION_END,
  ACTIVITY_EVENTS.ONLINE_PRODUCT_VIEW,
  ACTIVITY_EVENTS.ONLINE_CART_ADD,
  ACTIVITY_EVENTS.ONLINE_CART_ABANDONED,
  ACTIVITY_EVENTS.ONLINE_CHECKOUT_STARTED,
  ACTIVITY_EVENTS.ONLINE_CHECKOUT_COMPLETED,
  ACTIVITY_EVENTS.ONLINE_PAYMENT_FAILED,
]);

const ONLINE_EVENT_SET = new Set(ONLINE_EVENT_TYPES);

export function isOnlineEventType(type) {
  return ONLINE_EVENT_SET.has(type);
}

/**
 * Aggregate kinds — the buckets ActivityAggregate.kind can hold. Closed for the
 * same reason as the event list: every read surface selects by kind.
 */
export const AGGREGATE_KINDS = Object.freeze({
  PRODUCT_BILLED: "product_billed",
  PRODUCT_SEARCHED: "product_searched",
  SEARCH_QUERY: "search_query",
  REPORT: "report",
  CUSTOMER: "customer",
  PAYMENT_METHOD: "payment_method",
  FILTER: "filter",
  PAGE: "page",
  ONLINE_PRODUCT_VIEW: "online_product_view",
  ONLINE_CART_ADD: "online_cart_add",
  FEATURE: "feature",
  TASK_TIME: "task_time",
  PRODUCT_PAIR: "product_pair",
  ABANDONED_CART: "abandoned_cart",
});

/**
 * Module attribution, reusing the audit trail's vocabulary so an activity
 * timeline and an audit timeline can be filtered by the same module names.
 */
export const EVENT_MODULES = Object.freeze({
  [ACTIVITY_EVENTS.APP_LAUNCH]: "auth",
  [ACTIVITY_EVENTS.USER_LOGIN]: "auth",
  [ACTIVITY_EVENTS.USER_LOGOUT]: "auth",
  [ACTIVITY_EVENTS.SCREEN_VIEW]: "other",
  [ACTIVITY_EVENTS.PRODUCT_SEARCH]: "billing",
  [ACTIVITY_EVENTS.PRODUCT_VIEW]: "inventory",
  [ACTIVITY_EVENTS.PRODUCT_ADDED_TO_BILL]: "billing",
  [ACTIVITY_EVENTS.PRODUCT_REMOVED_FROM_BILL]: "billing",
  [ACTIVITY_EVENTS.BILL_CREATED]: "billing",
  [ACTIVITY_EVENTS.BILL_MODIFIED]: "billing",
  [ACTIVITY_EVENTS.BILL_CANCELLED]: "billing",
  [ACTIVITY_EVENTS.PAYMENT_COMPLETED]: "payments",
  [ACTIVITY_EVENTS.CUSTOMER_SEARCH]: "customers",
  [ACTIVITY_EVENTS.CUSTOMER_SELECTED]: "customers",
  [ACTIVITY_EVENTS.INVENTORY_VIEW]: "inventory",
  [ACTIVITY_EVENTS.INVENTORY_UPDATE]: "inventory",
  [ACTIVITY_EVENTS.PURCHASE_CREATED]: "inventory",
  [ACTIVITY_EVENTS.REPORT_VIEW]: "reports",
  [ACTIVITY_EVENTS.REPORT_EXPORT]: "reports",
  [ACTIVITY_EVENTS.PDF_GENERATED]: "reports",
  [ACTIVITY_EVENTS.SETTINGS_CHANGED]: "settings",
  [ACTIVITY_EVENTS.PRINTER_USED]: "devices",
  [ACTIVITY_EVENTS.BARCODE_SCANNED]: "devices",
  [ACTIVITY_EVENTS.VOICE_COMMAND_USED]: "billing",
  [ACTIVITY_EVENTS.AI_ASSISTANT_QUERY]: "support",
  [ACTIVITY_EVENTS.HELP_ARTICLE_VIEWED]: "support",
  [ACTIVITY_EVENTS.ERROR_OCCURRED]: "other",
  [ACTIVITY_EVENTS.SYNC_STARTED]: "sync",
  [ACTIVITY_EVENTS.SYNC_COMPLETED]: "sync",
  [ACTIVITY_EVENTS.SYNC_FAILED]: "sync",
  [ACTIVITY_EVENTS.ONLINE_SESSION_START]: "orders",
  [ACTIVITY_EVENTS.ONLINE_SESSION_END]: "orders",
  [ACTIVITY_EVENTS.ONLINE_PRODUCT_VIEW]: "orders",
  [ACTIVITY_EVENTS.ONLINE_CART_ADD]: "orders",
  [ACTIVITY_EVENTS.ONLINE_CART_ABANDONED]: "orders",
  [ACTIVITY_EVENTS.ONLINE_CHECKOUT_STARTED]: "orders",
  [ACTIVITY_EVENTS.ONLINE_CHECKOUT_COMPLETED]: "orders",
  [ACTIVITY_EVENTS.ONLINE_PAYMENT_FAILED]: "orders",
  [ACTIVITY_EVENTS.FEATURE_USED]: "other",
  [ACTIVITY_EVENTS.TASK_COMPLETED]: "other",
});

export function moduleForEvent(type) {
  return EVENT_MODULES[type] ?? "other";
}

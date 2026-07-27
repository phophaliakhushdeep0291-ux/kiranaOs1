import { offlineDB } from "@/lib/offline/db";

/**
 * Security policy (Settings -> Security & PIN) lives in the synced settings blob
 * (kirana:settings-prefs:v1 -> .security) and rides Shop.settingsJson across
 * devices. This module mirrors the printer-config / tax-config pattern: an async
 * loader plus a sync cache, so the counter flows can ask "is this action
 * protected?" without awaiting IndexedDB mid-checkout.
 */

export type ProtectedActionKey =
  | "cancelBill"
  | "reversePayment"
  | "deleteProduct"
  | "deleteCustomer"
  | "stockCorrection"
  | "largeDiscount"
  | "sellBelowMin"
  | "exportData"
  | "staffPermissions"
  | "restoreDeleted"
  | "gstSettings";

export type ActionApprover = "owner" | "ownerManager";

export interface ActionRule {
  on: boolean;
  approver: ActionApprover;
}

export interface SecurityPolicy {
  /** Label from the Select, e.g. "15 minutes". Parsed by `sessionTimeoutMs`. */
  sessionTimeout: string;
  /** Lock the screen (PIN to resume) instead of signing out. */
  autoLock: boolean;
  biometric: boolean;
  requireLoginOnStart: boolean;
  rememberDevice: boolean;
  actions: Record<string, ActionRule>;
}

/**
 * `serverEnforced` marks the actions whose API route already sits behind
 * `requireOwnerPin` on the backend. Those prompts cannot be switched off — the
 * request would just be rejected — so the UI locks the row on instead of
 * offering a toggle that breaks the action. The rest are decided purely at the
 * counter, which is where this policy is the only thing standing in the way.
 */
export const PROTECTED_ACTIONS: { key: ProtectedActionKey; label: string; serverEnforced: boolean }[] = [
  { key: "cancelBill", label: "Cancel Bill", serverEnforced: true },
  { key: "reversePayment", label: "Reverse Payment", serverEnforced: true },
  { key: "deleteProduct", label: "Delete Product", serverEnforced: true },
  { key: "deleteCustomer", label: "Delete Customer", serverEnforced: true },
  { key: "stockCorrection", label: "Stock Correction", serverEnforced: true },
  { key: "largeDiscount", label: "Large Discount", serverEnforced: false },
  { key: "sellBelowMin", label: "Sell Below Min Price", serverEnforced: false },
  { key: "exportData", label: "Export Data", serverEnforced: false },
  { key: "staffPermissions", label: "Change Staff Permissions", serverEnforced: true },
  { key: "restoreDeleted", label: "Restore Deleted Record", serverEnforced: true },
  { key: "gstSettings", label: "Change GST Settings", serverEnforced: true },
];

const SERVER_ENFORCED = new Set(PROTECTED_ACTIONS.filter((a) => a.serverEnforced).map((a) => a.key));

export function isServerEnforced(key: ProtectedActionKey): boolean {
  return SERVER_ENFORCED.has(key);
}

export const DEFAULT_ACTION_RULE: ActionRule = { on: true, approver: "owner" };

export const DEFAULT_SECURITY_POLICY: SecurityPolicy = {
  sessionTimeout: "15 minutes",
  autoLock: true,
  biometric: false,
  requireLoginOnStart: true,
  rememberDevice: true,
  actions: Object.fromEntries(PROTECTED_ACTIONS.map((a) => [a.key, DEFAULT_ACTION_RULE])),
};

const PREFS_KEY = "kirana:settings-prefs:v1";

/** Emitted whenever the cache changes so mounted guards can re-read it. */
export const SECURITY_POLICY_CHANGED_EVENT = "kirana:security-policy-changed";

const TIMEOUT_MINUTES: Record<string, number> = {
  "5 minutes": 5,
  "15 minutes": 15,
  "30 minutes": 30,
  "1 hour": 60,
};

export const SESSION_TIMEOUT_OPTIONS = Object.keys(TIMEOUT_MINUTES);

let cache: SecurityPolicy = { ...DEFAULT_SECURITY_POLICY };

function normalise(saved: Partial<SecurityPolicy> | null | undefined): SecurityPolicy {
  return {
    ...DEFAULT_SECURITY_POLICY,
    ...(saved ?? {}),
    actions: { ...DEFAULT_SECURITY_POLICY.actions, ...(saved?.actions ?? {}) },
  };
}

export function getSecurityPolicySync(): SecurityPolicy {
  return cache;
}

export function setSecurityPolicyCache(saved: Partial<SecurityPolicy> | null | undefined) {
  cache = normalise(saved);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SECURITY_POLICY_CHANGED_EVENT));
  }
}

export async function loadSecurityPolicy(): Promise<SecurityPolicy> {
  try {
    const prefs = await offlineDB.getSetting<{ security?: Partial<SecurityPolicy> }>(PREFS_KEY);
    setSecurityPolicyCache(prefs?.security);
  } catch {
    /* keep whatever is cached */
  }
  return cache;
}

/** Idle window in milliseconds; 0 means "never time out". */
export function sessionTimeoutMs(policy: SecurityPolicy = cache): number {
  const minutes = TIMEOUT_MINUTES[policy.sessionTimeout];
  return minutes ? minutes * 60_000 : 0;
}

/**
 * Whether an action still needs owner approval. Turning a row off in Settings ->
 * Security removes the prompt; the backend keeps its own checks either way, so
 * this only controls the counter-side prompt.
 */
export function isActionProtected(key: ProtectedActionKey, policy: SecurityPolicy = cache): boolean {
  if (isServerEnforced(key)) return true; // the API rejects it without a PIN anyway
  return (policy.actions[key] ?? DEFAULT_ACTION_RULE).on;
}

export function actionApprover(key: ProtectedActionKey, policy: SecurityPolicy = cache): ActionApprover {
  return (policy.actions[key] ?? DEFAULT_ACTION_RULE).approver;
}

/**
 * Roles allowed to approve the action, for the prompt copy and for the local
 * pre-check before the request is sent.
 */
export function approverRoles(key: ProtectedActionKey, policy: SecurityPolicy = cache): string[] {
  return actionApprover(key, policy) === "ownerManager" ? ["owner", "admin"] : ["owner"];
}

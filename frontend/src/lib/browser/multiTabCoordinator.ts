const TAB_ID_KEY = "kirana.tab.id";
const LEADER_KEY = "kirana.background.leader";
const LEADER_TTL_MS = 20_000;
const HEARTBEAT_MS = 5_000;

interface LeaderRecord {
  tabId: string;
  updatedAt: number;
}

function now() {
  return Date.now();
}

function safeSessionGet(key: string) {
  if (typeof sessionStorage === "undefined") return null;
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSessionSet(key: string, value: string) {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Ignore storage issues in locked-down browser contexts.
  }
}

function safeLocalGet(key: string) {
  if (typeof localStorage === "undefined") return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalSet(key: string, value: string) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore storage issues in locked-down browser contexts.
  }
}

function parseLeader(value: string | null): LeaderRecord | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<LeaderRecord>;
    if (typeof parsed.tabId === "string" && typeof parsed.updatedAt === "number") {
      return { tabId: parsed.tabId, updatedAt: parsed.updatedAt };
    }
  } catch {
    // Corrupt leader records are treated as expired.
  }
  return null;
}

export function getTabId() {
  const existing = safeSessionGet(TAB_ID_KEY);
  if (existing) return existing;
  const generated = `tab_${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
  safeSessionSet(TAB_ID_KEY, generated);
  return generated;
}

export function claimBackgroundLeadership() {
  if (typeof window === "undefined") return true;
  const tabId = getTabId();
  const current = parseLeader(safeLocalGet(LEADER_KEY));
  const expired = !current || now() - current.updatedAt > LEADER_TTL_MS;
  if (expired || current.tabId === tabId) {
    safeLocalSet(LEADER_KEY, JSON.stringify({ tabId, updatedAt: now() }));
    return true;
  }
  return false;
}

export function isBackgroundLeader() {
  if (typeof window === "undefined") return true;
  const tabId = getTabId();
  const current = parseLeader(safeLocalGet(LEADER_KEY));
  if (!current || now() - current.updatedAt > LEADER_TTL_MS) return claimBackgroundLeadership();
  return current.tabId === tabId;
}

/**
 * Foreground/interactive work is intentionally NOT single-tab locked.
 *
 * A POS can be open on two counters, two browser windows, or two devices under the
 * same shop/account. Those sessions must be allowed to make different requests at
 * the same time, just like two Netflix devices can stream different titles under one
 * account.
 *
 * Use this for user-facing reads/writes and active-page refreshes.
 */
export function shouldRunInteractiveNetworkWork() {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

/**
 * Scheduled/background work is still coordinated per browser profile to avoid
 * duplicate polling from five tabs of the same app. Different devices/browsers do
 * not share localStorage, so each device gets its own scheduler.
 */
export function shouldRunScheduledNetworkWork() {
  if (typeof document !== "undefined" && document.visibilityState !== "visible") return false;
  return isBackgroundLeader();
}

// Backward-compatible name used by older modules. It now means scheduled work,
// not interactive requests. New code should prefer the explicit functions above.
export function shouldRunBackgroundNetworkWork() {
  return shouldRunScheduledNetworkWork();
}

export function startBackgroundLeadershipHeartbeat() {
  if (typeof window === "undefined") return () => undefined;
  claimBackgroundLeadership();
  const interval = window.setInterval(() => {
    if (isBackgroundLeader()) claimBackgroundLeadership();
  }, HEARTBEAT_MS);
  const onVisibility = () => {
    if (document.visibilityState === "visible") claimBackgroundLeadership();
  };
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    window.clearInterval(interval);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}

export function getSharedThrottle(key: string) {
  const raw = safeLocalGet(key);
  const value = raw ? Number(raw) : 0;
  return Number.isFinite(value) ? value : 0;
}

export function setSharedThrottle(key: string, timestamp = now()) {
  safeLocalSet(key, String(timestamp));
}

export function shouldPassSharedThrottle(key: string, intervalMs: number) {
  const last = getSharedThrottle(key);
  if (now() - last < intervalMs) return false;
  setSharedThrottle(key);
  return true;
}

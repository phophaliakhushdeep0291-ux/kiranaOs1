const TAB_ID_KEY = "kirana.tab.id";
const LEADER_KEY = "kirana.background.leader";
const LEADER_TTL_MS = 20_000;
const HEARTBEAT_MS = 5_000;

interface BrowserLockManager {
  request<T>(
    name: string,
    options: { mode: "exclusive" },
    callback: () => Promise<T> | T,
  ): Promise<T>;
}

interface LeaderRecord {
  tabId: string;
  updatedAt: number;
  /**
   * Whether the leader's document was visible when it last wrote the record.
   * Absent on records written before this field existed; those read as visible,
   * so an old leader is only replaced once its lease expires, as before.
   */
  visible?: boolean;
}

function now() {
  return Date.now();
}

function isDocumentVisible() {
  return typeof document === "undefined" || document.visibilityState === "visible";
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
      return {
        tabId: parsed.tabId,
        updatedAt: parsed.updatedAt,
        ...(typeof parsed.visible === "boolean" ? { visible: parsed.visible } : {}),
      };
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

/**
 * A visible tab takes leadership from a hidden one.
 *
 * Scheduled sync runs only in a tab that is both visible AND the leader. The
 * lease used to go to whichever tab claimed it first, and a hidden tab keeps
 * renewing it — timers still fire in the background — so after the shopkeeper
 * switched from one KiranaOS tab to another, the hidden tab held the lease but
 * would not sync because it was hidden, and the visible tab would not sync
 * because it was not the leader. Nobody pushed: bills sat on "Syncing" and the
 * pending count never moved until the old tab was closed or Force sync pressed.
 */
function canTakeLeadership(current: LeaderRecord | null, tabId: string) {
  if (!current || now() - current.updatedAt > LEADER_TTL_MS) return true;
  if (current.tabId === tabId) return true;
  return isDocumentVisible() && current.visible === false;
}

export function claimBackgroundLeadership() {
  if (typeof window === "undefined") return true;
  const tabId = getTabId();
  const current = parseLeader(safeLocalGet(LEADER_KEY));
  if (canTakeLeadership(current, tabId)) {
    safeLocalSet(LEADER_KEY, JSON.stringify({ tabId, updatedAt: now(), visible: isDocumentVisible() }));
    return true;
  }
  return false;
}

export function isBackgroundLeader() {
  if (typeof window === "undefined") return true;
  const tabId = getTabId();
  const current = parseLeader(safeLocalGet(LEADER_KEY));
  if (current?.tabId !== tabId && canTakeLeadership(current, tabId)) return claimBackgroundLeadership();
  return current?.tabId === tabId;
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

/**
 * Serializes a short critical section across tabs in the same browser profile.
 * Refresh-token rotation uses this so two tabs cannot replay the same token.
 */
export async function withCrossTabLock<T>(name: string, callback: () => Promise<T> | T): Promise<T> {
  if (typeof navigator === "undefined") return callback();
  const locks = (navigator as Navigator & { locks?: BrowserLockManager }).locks;
  if (!locks?.request) return callback();
  return locks.request(name, { mode: "exclusive" }, callback);
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
    // Visible: take over from a hidden leader. Hidden: if this tab leads, record
    // that now rather than at the next heartbeat, so a tab being switched to can
    // take over on its own visibilitychange instead of waiting up to 5s.
    if (document.visibilityState === "visible" || isBackgroundLeader()) claimBackgroundLeadership();
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

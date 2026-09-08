import { sessionTimeoutMs, type SecurityPolicy } from "./security-policy";

const ACTIVITY_KEY = "kiranaos.security.lastActivity.v1";
const START_KEY = "kiranaos.security.sessionStarted.v1";
const key = (base: string, identity: string | null) => identity ? `${base}:${identity}` : base;
export type CounterDecision = "allow" | "lock" | "logout";

export function markCounterActive(identity: string | null, at = Date.now()) {
  try { localStorage.setItem(key(ACTIVITY_KEY, identity), String(at)); } catch { /* fail closed at the next check */ }
}

export function markCounterSessionStarted(identity: string | null, at = Date.now()) {
  try { sessionStorage.setItem(key(START_KEY, identity), String(at)); } catch { /* next mount remains a cold start */ }
}

export function clearCounterActivity() {
  for (const [storage, prefix] of [[localStorage, ACTIVITY_KEY], [sessionStorage, START_KEY]] as const) {
    try {
      for (let index = storage.length - 1; index >= 0; index--) {
        const name = storage.key(index);
        if (name && (name === prefix || name.startsWith(`${prefix}:`))) storage.removeItem(name);
      }
      storage.removeItem(prefix);
    } catch { /* authentication is independently cleared on sign-out */ }
  }
}

export function counterIdleDecision(policy: SecurityPolicy, identity: string | null, now = Date.now()): CounterDecision {
  if (!identity) return "lock";
  const timeout = sessionTimeoutMs(policy);
  if (timeout <= 0) return "allow";
  let last = 0;
  try { last = Number(localStorage.getItem(key(ACTIVITY_KEY, identity))); } catch { /* cannot prove recent activity */ }
  if (Number.isFinite(last) && last > 0 && last <= now && now - last < timeout) return "allow";
  return policy.autoLock && policy.rememberDevice ? "lock" : "logout";
}

export function counterStartupDecision(policy: SecurityPolicy, identity: string | null, now = Date.now()): CounterDecision {
  if (!identity) return "lock";
  let started = false;
  try { started = Boolean(sessionStorage.getItem(key(START_KEY, identity))); } catch { /* treat as cold */ }
  if (!started && policy.requireLoginOnStart) return policy.rememberDevice ? "lock" : "logout";
  return counterIdleDecision(policy, identity, now);
}

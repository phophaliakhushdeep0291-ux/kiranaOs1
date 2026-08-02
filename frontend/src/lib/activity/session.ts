import { safeRandomUUID } from "@/lib/safe-uuid";

/**
 * Session identity for activity events (§13's "Session ID" attribute).
 *
 * A session is one continuous stretch of work: it survives navigation and a
 * background tab, and ends when the app has been away long enough that the next
 * interaction is plainly a new visit. That matters for the derived metrics —
 * "average checkout duration" is nonsense if a session spans an overnight gap
 * because someone left the tab open.
 *
 * Stored in sessionStorage rather than localStorage so two tabs are two
 * sessions, which is what a shop with a billing tab and a reports tab actually
 * has.
 */

const SESSION_KEY = "kiranaos.activity.session.v1";
const LAST_SEEN_KEY = "kiranaos.activity.session.lastSeen.v1";

/** Idle gap after which the next event starts a new session. */
const SESSION_IDLE_MS = 30 * 60 * 1000;

interface SessionState {
  id: string;
  startedAt: number;
}

let cached: SessionState | null = null;

function readState(): SessionState | null {
  if (cached) return cached;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionState;
    return parsed?.id ? parsed : null;
  } catch {
    return null;
  }
}

function writeState(state: SessionState): void {
  cached = state;
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
  } catch {
    // A private-mode browser with no storage still gets a working in-memory
    // session for the life of the tab.
  }
}

function lastSeen(): number {
  try {
    return Number(sessionStorage.getItem(LAST_SEEN_KEY)) || 0;
  } catch {
    return 0;
  }
}

function touch(now: number): void {
  try {
    sessionStorage.setItem(LAST_SEEN_KEY, String(now));
  } catch {
    // ignore
  }
}

/** The current session id, starting a new one if the last is stale. */
export function currentSessionId(): string {
  const now = Date.now();
  const previous = readState();
  const idle = now - lastSeen();
  if (!previous || (lastSeen() > 0 && idle > SESSION_IDLE_MS)) {
    const fresh = { id: `ses_${safeRandomUUID().replaceAll("-", "")}`, startedAt: now };
    writeState(fresh);
    touch(now);
    return fresh.id;
  }
  touch(now);
  return previous.id;
}

/** Seconds the current session has been running, for session-duration metrics. */
export function sessionAgeMs(): number {
  const state = readState();
  return state ? Date.now() - state.startedAt : 0;
}

/**
 * Force a new session. Called on login and logout: one person's work must never
 * be recorded inside another person's session on a shared counter machine.
 */
export function resetActivitySession(): string {
  const fresh = { id: `ses_${safeRandomUUID().replaceAll("-", "")}`, startedAt: Date.now() };
  writeState(fresh);
  touch(fresh.startedAt);
  return fresh.id;
}

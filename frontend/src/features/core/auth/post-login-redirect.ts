/**
 * Remembers where the user was headed when an auth gate bounced them to /login, so we can send
 * them back after they sign in. The main motivation is the QR import deep link
 * (`/import-order#o=<order>`): if the owner scans while logged out, the order lives in the URL
 * hash and must survive the login round-trip. Kept in sessionStorage (per-tab, auto-clears).
 */
const KEY = "kirana:post-login-redirect:v1";
// A stash is meant only for the login that immediately follows the auth bounce. Expire it so a
// stale target (bounced, didn't log in, came back much later) can't hijack a later normal login.
const TTL_MS = 5 * 60_000;

// Validate on both write and read: persisted state can be stale or malformed.
function isInternalDestination(target: unknown): target is string {
  if (typeof target !== "string" || !target.startsWith("/") || target.startsWith("//")
    || /[\\\x00-\x20\x7f]/.test(target)) return false;
  try {
    const url = new URL(target, "https://kirana.invalid");
    return url.origin === "https://kirana.invalid"
      && !/^\/(login|register|forgot-password|reset-password)(?:\/|$)/.test(url.pathname);
  } catch {
    return false;
  }
}

function readDestination(raw: string | null): string | null {
  if (!raw) return null;
  const parsed = JSON.parse(raw) as { target?: unknown; ts?: unknown } | null;
  if (!isInternalDestination(parsed?.target) || typeof parsed?.ts !== "number"
    || !Number.isFinite(parsed.ts) || parsed.ts <= 0) return null;
  const age = Date.now() - parsed.ts;
  return age >= 0 && age <= TTL_MS ? parsed.target : null;
}

export function stashPostLoginRedirect(target: string): void {
  try {
    if (!isInternalDestination(target)) return;
    sessionStorage.setItem(KEY, JSON.stringify({ target, ts: Date.now() }));
  } catch {
    // Storage can be unavailable; sign-in must still work without restoration.
  }
}

export function peekPostLoginRedirect(): string | null {
  try {
    return readDestination(sessionStorage.getItem(KEY));
  } catch {
    return null;
  }
}

export function consumePostLoginRedirect(): string | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return readDestination(raw);
  } catch {
    return null;
  }
}

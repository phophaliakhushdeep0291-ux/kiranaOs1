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

export function stashPostLoginRedirect(target: string): void {
  try {
    if (!target || target.startsWith("/login") || target.startsWith("/register")) return;
    sessionStorage.setItem(KEY, JSON.stringify({ target, ts: Date.now() }));
  } catch {
    // sessionStorage can be unavailable (private mode); the deep link just won't be restored.
  }
}

export function peekPostLoginRedirect(): string | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { target?: unknown; ts?: unknown };
    const target = typeof parsed?.target === "string" ? parsed.target : null;
    const ts = typeof parsed?.ts === "number" ? parsed.ts : 0;
    if (!target || Date.now() - ts > TTL_MS) return null;
    return target;
  } catch {
    return null;
  }
}
export function consumePostLoginRedirect(): string | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    const parsed = JSON.parse(raw) as { target?: unknown; ts?: unknown };
    const target = typeof parsed?.target === "string" ? parsed.target : null;
    const ts = typeof parsed?.ts === "number" ? parsed.ts : 0;
    if (!target || Date.now() - ts > TTL_MS) return null;
    return target;
  } catch {
    return null;
  }
}

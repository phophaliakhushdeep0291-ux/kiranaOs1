/**
 * Remembers where the user was headed when an auth gate bounced them to /login, so we can send
 * them back after they sign in. The main motivation is the QR import deep link
 * (`/import-order#o=<order>`): if the owner scans while logged out, the order lives in the URL
 * hash and must survive the login round-trip. Kept in sessionStorage (per-tab, auto-clears).
 */
const KEY = "kirana:post-login-redirect:v1";

export function stashPostLoginRedirect(target: string): void {
  try {
    if (!target || target.startsWith("/login") || target.startsWith("/register")) return;
    sessionStorage.setItem(KEY, target);
  } catch {
    // sessionStorage can be unavailable (private mode); the deep link just won't be restored.
  }
}

export function consumePostLoginRedirect(): string | null {
  try {
    const value = sessionStorage.getItem(KEY);
    if (value) sessionStorage.removeItem(KEY);
    return value;
  } catch {
    return null;
  }
}

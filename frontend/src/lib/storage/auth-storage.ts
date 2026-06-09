import type { Shop, User } from "@/types/api";

const SESSION_KEY = "kiranaos.auth.session.v1";

// Legacy individual keys that used to be stored in sessionStorage or localStorage.
const LEGACY_KEYS = ["accessToken", "refreshToken", "user", "shop"] as const;
type LegacyKey = typeof LEGACY_KEYS[number];

interface AuthSession {
  accessToken?: string | null;
  refreshToken?: string | null;
  user?: User | null;
  shop?: Shop | null;
}

function safeGet(storage: Storage | undefined, key: string): string | null {
  if (typeof window === "undefined" || !storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(storage: Storage | undefined, key: string, value: string): void {
  if (typeof window === "undefined" || !storage) return;
  try {
    storage.setItem(key, value);
  } catch {
    // Storage can be restricted (private mode, quota exceeded, etc.)
  }
}

function safeRemove(storage: Storage | undefined, key: string): void {
  if (typeof window === "undefined" || !storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // Ignore.
  }
}

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

// ─── Primary session API (persists across PWA restarts) ─────────────────────

export function saveAuthSession(session: AuthSession): void {
  if (typeof window === "undefined") return;
  const existing = loadAuthSession();
  const merged: AuthSession = { ...existing, ...session };
  // Never persist undefined fields (use null to explicitly clear).
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(merged)) {
    if (v !== undefined) clean[k] = v;
  }
  safeSet(window.localStorage, SESSION_KEY, JSON.stringify(clean));
}

export function loadAuthSession(): AuthSession {
  if (typeof window === "undefined") return {};
  return parseJson<AuthSession>(safeGet(window.localStorage, SESSION_KEY)) ?? {};
}

export function clearAuthSession(): void {
  if (typeof window === "undefined") return;
  safeRemove(window.localStorage, SESSION_KEY);
}

// ─── Legacy migration: clean up old per-key storage on startup ───────────────

export function migrateAuthFromLocalStorage(): void {
  if (typeof window === "undefined") return;

  // If new session key is already present, just clean up legacy keys and return.
  const hasNewKey = safeGet(window.localStorage, SESSION_KEY) !== null;

  // Attempt to migrate from old individual localStorage keys.
  if (!hasNewKey) {
    const token = safeGet(window.localStorage, "accessToken");
    const refresh = safeGet(window.localStorage, "refreshToken");
    const userStr = safeGet(window.localStorage, "user");
    const shopStr = safeGet(window.localStorage, "shop");

    if (token || refresh || userStr) {
      const session: AuthSession = {
        accessToken: token ?? null,
        refreshToken: refresh ?? null,
        user: parseJson<User>(userStr),
        shop: parseJson<Shop>(shopStr),
      };
      saveAuthSession(session);
    } else {
      // Also try to migrate from old sessionStorage keys (previous implementation).
      const sToken = safeGet(window.sessionStorage, "accessToken");
      const sRefresh = safeGet(window.sessionStorage, "refreshToken");
      const sUserStr = safeGet(window.sessionStorage, "user");
      const sShopStr = safeGet(window.sessionStorage, "shop");
      if (sToken || sRefresh || sUserStr) {
        saveAuthSession({
          accessToken: sToken ?? null,
          refreshToken: sRefresh ?? null,
          user: parseJson<User>(sUserStr),
          shop: parseJson<Shop>(sShopStr),
        });
      }
    }
  }

  // Clean up all legacy per-key entries.
  for (const key of LEGACY_KEYS) {
    safeRemove(window.localStorage, key);
    safeRemove(window.sessionStorage, key);
  }
}

// ─── Compatibility helpers (used throughout the codebase) ────────────────────

export function getAuthValue(key: LegacyKey): string | null {
  const session = loadAuthSession();
  const val = session[key];
  if (val === null || val === undefined) return null;
  if (typeof val === "string") return val;
  // user/shop are objects — return JSON string.
  return JSON.stringify(val);
}

export function setAuthValue(key: LegacyKey, value: string): void {
  if (key === "user" || key === "shop") {
    saveAuthSession({ [key]: parseJson(value) });
  } else {
    saveAuthSession({ [key]: value });
  }
}

export function removeAuthValue(key: LegacyKey): void {
  saveAuthSession({ [key]: null });
}

export function clearAuthStorage(): void {
  clearAuthSession();
}

export function readStoredUser(): User | null {
  return loadAuthSession().user ?? null;
}

export function readStoredShop(): Shop | null {
  return loadAuthSession().shop ?? null;
}

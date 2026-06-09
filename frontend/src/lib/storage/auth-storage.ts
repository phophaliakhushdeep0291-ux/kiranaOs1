import type { Shop, User } from "@/types/api";

const AUTH_KEYS = ["accessToken", "refreshToken", "user", "shop"] as const;

type AuthKey = typeof AUTH_KEYS[number];

function canUseStorage(storage: Storage | undefined): storage is Storage {
  return typeof window !== "undefined" && typeof storage !== "undefined";
}

function read(storage: Storage | undefined, key: string): string | null {
  if (!canUseStorage(storage)) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function write(storage: Storage | undefined, key: string, value: string): void {
  if (!canUseStorage(storage)) return;
  try {
    storage.setItem(key, value);
  } catch {
    // Restricted storage should not crash auth state updates.
  }
}

function remove(storage: Storage | undefined, key: string): void {
  if (!canUseStorage(storage)) return;
  try {
    storage.removeItem(key);
  } catch {
    // Ignore restricted storage failures.
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

export function migrateAuthFromLocalStorage(): void {
  if (typeof window === "undefined") return;
  for (const key of AUTH_KEYS) {
    const existing = read(window.sessionStorage, key);
    const legacy = read(window.localStorage, key);
    if (!existing && legacy) write(window.sessionStorage, key, legacy);
    remove(window.localStorage, key);
  }
}

export function getAuthValue(key: AuthKey): string | null {
  if (typeof window === "undefined") return null;
  migrateAuthFromLocalStorage();
  return read(window.sessionStorage, key);
}

export function setAuthValue(key: AuthKey, value: string): void {
  if (typeof window === "undefined") return;
  write(window.sessionStorage, key, value);
  remove(window.localStorage, key);
}

export function removeAuthValue(key: AuthKey): void {
  if (typeof window === "undefined") return;
  remove(window.sessionStorage, key);
  remove(window.localStorage, key);
}

export function clearAuthStorage(): void {
  for (const key of AUTH_KEYS) removeAuthValue(key);
}

export function readStoredUser(): User | null {
  return parseJson<User>(getAuthValue("user"));
}

export function readStoredShop(): Shop | null {
  return parseJson<Shop>(getAuthValue("shop"));
}

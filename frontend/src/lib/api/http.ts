import type { AuthResponse } from "@/types/api";
import { clearAuthStorage, getAuthValue, removeAuthValue, setAuthValue } from "@/lib/storage/auth-storage";
import { getOfflineScope } from "@/lib/offline/context";

export interface ApiErrorData {
  message?: string;
  error?: string;
  code?: string;
  requestId?: string;
  details?: Record<string, string[]>;
}

export class ApiClientError extends Error {
  status: number;
  data: ApiErrorData;

  constructor(message: string, status: number, data: ApiErrorData = {}) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.data = data;
  }
}

export interface ApiRequestOptions extends RequestInit {
  ownerPin?: string;
  skipAuth?: boolean;
  skipRefresh?: boolean;
  skipDevice?: boolean;
  /**
   * Marks automatic/background reads such as polling, bootstrap, and scheduled sync.
   * Interactive user actions should leave this false so one rate-limited dashboard
   * request does not block a cashier creating a bill in another tab/device.
   */
  background?: boolean;
}

let authTokenGetter: (() => string | null) | null = null;
const readRateLimitCooldownByBucket = new Map<string, number>();
let refreshPromise: Promise<AuthResponse> | null = null;

export const AUTH_SESSION_EXPIRED_EVENT = "kirana:auth-session-expired";

export function setAuthTokenGetter(getter: () => string | null) {
  authTokenGetter = getter;
}

function safeLocalStorageGet(key: string) {
  if (typeof localStorage === "undefined") return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalStorageSet(key: string, value: string) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable in private windows or restricted contexts.
  }
}

export function getApiBaseUrl() {
  const fromStorage = safeLocalStorageGet("kiranaApiBaseUrl");
  const fromEnv = import.meta.env.VITE_API_BASE_URL as string | undefined;
  return (fromStorage || fromEnv || "http://localhost:3000/api").replace(/\/$/, "");
}

export function setApiBaseUrl(url: string) {
  safeLocalStorageSet("kiranaApiBaseUrl", url.replace(/\/$/, ""));
}

export function getStoredAccessToken() {
  return authTokenGetter?.() ?? getAuthValue("accessToken");
}

export function getStoredRefreshToken() {
  return getAuthValue("refreshToken");
}

export function isBrowserOnline() {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

export function buildQuery(params?: Record<string, unknown>) {
  if (!params) return "";
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `?${text}` : "";
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function parseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response.text();

  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const body = await parseBody(response);

  if (!response.ok) {
    const data: ApiErrorData = isJsonRecord(body)
      ? {
          message: typeof body.message === "string" ? body.message : undefined,
          error: typeof body.error === "string" ? body.error : undefined,
          code: typeof body.code === "string" ? body.code : undefined,
          requestId: typeof body.requestId === "string" ? body.requestId : undefined,
          details: isJsonRecord(body.details)
            ? Object.fromEntries(
                Object.entries(body.details)
                  .filter(([, value]) => Array.isArray(value))
                  .map(([key, value]) => [key, (value as unknown[]).filter((item): item is string => typeof item === "string")])
              )
            : undefined,
        }
      : { message: body === null ? `Request failed (${response.status})` : String(body) };

    throw new ApiClientError(data.message ?? data.error ?? `Request failed (${response.status})`, response.status, data);
  }

  if (isJsonRecord(body) && "data" in body) return body.data as T;
  return body as T;
}

function getMethod(options: RequestInit) {
  return String(options.method || "GET").toUpperCase();
}

function rateLimitBucket(path: string) {
  const clean = path.split("?")[0] || path;
  const parts = clean.split("/").filter(Boolean);
  // Keep dashboard/report cooldown separate from sync/product/customer/billing.
  if (parts[0] === "reports" && parts[1]) return `/reports/${parts[1]}`;
  if (parts[0] === "sync" && parts[1]) return `/sync/${parts[1]}`;
  return parts[0] ? `/${parts[0]}` : clean;
}

function isReadMethod(method: string) {
  return method === "GET" || method === "HEAD";
}

function updateRateLimitCooldown(path: string, response: Response) {
  if (response.status !== 429) return;
  const retryAfter = Number(response.headers.get("Retry-After") || "");
  const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 10_000;
  readRateLimitCooldownByBucket.set(rateLimitBucket(path), Date.now() + Math.min(waitMs, 30_000));
}

function assertNoBackgroundCooldown(path: string, method: string, background: boolean | undefined) {
  if (!background || !isReadMethod(method)) return;
  const bucket = rateLimitBucket(path);
  const cooldownUntil = readRateLimitCooldownByBucket.get(bucket) ?? 0;
  if (Date.now() < cooldownUntil) {
    throw new ApiClientError(`Backend is rate limiting ${bucket}. Waiting before background retry.`, 429, { code: "RATE_LIMITED_COOLDOWN" });
  }
}

async function refreshAuthSession(refreshToken: string) {
  return apiRequest<AuthResponse>("/auth/refresh", {
    method: "POST",
    body: JSON.stringify({ refreshToken }),
    skipAuth: true,
    skipRefresh: true,
  });
}

function persistRefreshedAuth(refreshed: AuthResponse) {
  const token = refreshed.accessToken || refreshed.token;
  if (!token) throw new ApiClientError("Refresh response missing access token", 401);
  setAuthValue("accessToken", token);
  setAuthValue("refreshToken", refreshed.refreshToken);
  setAuthValue("user", JSON.stringify(refreshed.user));
  if (refreshed.shop) setAuthValue("shop", JSON.stringify(refreshed.shop));
  else removeAuthValue("shop");
  return token;
}

function isFinalRefreshFailure(error: unknown) {
  return error instanceof ApiClientError && (error.status === 401 || error.status === 403);
}

function notifyAuthSessionExpired() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(AUTH_SESSION_EXPIRED_EVENT));
}

async function getSharedRefreshedAuth(refreshToken: string) {
  if (!refreshPromise) {
    refreshPromise = refreshAuthSession(refreshToken)
      .then((refreshed) => {
        persistRefreshedAuth(refreshed);
        return refreshed;
      })
      .catch((error) => {
        if (isFinalRefreshFailure(error)) {
          clearAuthStorage();
          notifyAuthSessionExpired();
        }
        throw error;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { ownerPin, skipAuth, skipRefresh, skipDevice, background, ...fetchOptions } = options;
  let token = getStoredAccessToken();

  if (!token && !skipAuth && !skipRefresh) {
    const refreshToken = getStoredRefreshToken();
    if (refreshToken) {
      try {
        const refreshed = await getSharedRefreshedAuth(refreshToken);
        token = refreshed.accessToken || refreshed.token || null;
      } catch (error) {
        if (isFinalRefreshFailure(error)) {
          throw new ApiClientError("Session expired. Please log in again.", 401, { code: "AUTH_SESSION_EXPIRED" });
        }
      }
    }
  }

  if (!token && !skipAuth) {
    throw new ApiClientError("Authentication required. Please log in again.", 401, { code: "AUTH_REQUIRED" });
  }

  const headers = new Headers(fetchOptions.headers);

  if (!headers.has("Content-Type") && fetchOptions.body && !(fetchOptions.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (token && !skipAuth) headers.set("Authorization", `Bearer ${token}`);
  if (!skipDevice && !headers.has("x-device-id")) {
    try {
      headers.set("x-device-id", getOfflineScope().device_id);
    } catch {
      // Device ID is best-effort on non-browser/test environments.
    }
  }
  if (ownerPin) headers.set("x-owner-pin", ownerPin);

  const method = getMethod(fetchOptions);
  assertNoBackgroundCooldown(path, method, background);

  const url = `${getApiBaseUrl()}${path}`;
  let response = await fetch(url, { ...fetchOptions, headers });
  updateRateLimitCooldown(path, response);

  if (response.status === 401 && !skipRefresh && !skipAuth) {
    const refreshToken = getStoredRefreshToken();
    if (refreshToken) {
      try {
        const refreshed = await getSharedRefreshedAuth(refreshToken);
        const refreshedToken = refreshed.accessToken || refreshed.token;

        const retryHeaders = new Headers(headers);
        retryHeaders.set("Authorization", `Bearer ${refreshedToken}`);
        response = await fetch(url, { ...fetchOptions, headers: retryHeaders });
        updateRateLimitCooldown(path, response);
      } catch {
        // Fall through to the original 401 response.
      }
    }
  }

  return parseResponse<T>(response);
}

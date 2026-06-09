import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { useLocation } from "wouter";
import { AUTH_SESSION_EXPIRED_EVENT, ApiClientError, getMe, logoutSession, refreshAccessToken, setAuthTokenGetter, type AuthResponse, type User, type Shop } from "@/lib/api/client";
import { clearAuthStorage, getAuthValue, migrateAuthFromLocalStorage, removeAuthValue, setAuthValue } from "@/lib/storage/auth-storage";
import { writeAuditLog } from "@/features/audit-logs/local-actions";
import { activateDevice } from "@/features/devices/api";
import { ensureCurrentDeviceRegistered, writeOfflineLicenseToken } from "@/features/devices/license";
import { getOfflineScope } from "@/lib/offline/context";

interface AuthContextType {
  user: User | null;
  shop: Shop | null;
  accessToken: string | null;
  isLoading: boolean;
  login: (token: string | undefined | null, refresh: string | undefined | null, user: User, shop?: Shop | null) => void;
  logout: () => Promise<void>;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function persistAuth(data: AuthResponse) {
  const token = data.accessToken || data.token;
  if (!token) throw new Error("Login response did not include an access token");
  setAuthValue("accessToken", token);
  setAuthValue("refreshToken", data.refreshToken);
  setAuthValue("user", JSON.stringify(data.user));
  if (data.shop) setAuthValue("shop", JSON.stringify(data.shop));
  else removeAuthValue("shop");
  return { token, user: data.user, shop: data.shop ?? null };
}


async function activateCurrentDeviceSafely() {
  try {
    const scope = getOfflineScope();
    const deviceName = typeof navigator !== "undefined" && navigator.userAgent
      ? "This device"
      : "This device";
    await ensureCurrentDeviceRegistered(deviceName);
    const response = await activateDevice(deviceName, scope.device_id);
    if (response.license) await writeOfflineLicenseToken(response.license, "backend-activation");
  } catch {
    // Login must not fail just because the backend/device activation endpoint is temporarily unavailable.
    // Sync will retry after connectivity/device activation is restored.
  }
}

function isFinalAuthFailure(error: unknown) {
  return error instanceof ApiClientError && (error.status === 401 || error.status === 403);
}

function isTemporaryAuthCheckFailure(error: unknown) {
  if (!(error instanceof ApiClientError)) return true;
  return error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [shop, setShop] = useState<Shop | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const authGenerationRef = useRef(0);
  const [, setLocation] = useLocation();

  useEffect(() => {
    let cancelled = false;
    const generation = authGenerationRef.current;
    const isStale = () => cancelled || authGenerationRef.current !== generation;
    migrateAuthFromLocalStorage();
    setAuthTokenGetter(() => getAuthValue("accessToken"));

    const token = getAuthValue("accessToken");
    const refreshToken = getAuthValue("refreshToken");
    const storedUser = getAuthValue("user");
    const storedShop = getAuthValue("shop");

    if (!token && !refreshToken) {
      setIsLoading(false);
      return () => {
        cancelled = true;
      };
    }

    if (token) setAccessToken(token);

    if (storedUser) {
      try {
        const parsedUser = JSON.parse(storedUser) as User;
        const parsedShop = storedShop ? JSON.parse(storedShop) as Shop : null;
        setUser(parsedUser);
        setShop(parsedShop);
        setIsLoading(false);
      } catch {
        removeAuthValue("user");
        removeAuthValue("shop");
      }
    }

    async function verifyInBackground() {
      try {
        if (token) {
          const current = await getMe();
          if (isStale()) return;
          setUser(current.user);
          setShop(current.shop ?? null);
          setAccessToken(getAuthValue("accessToken"));
          setAuthValue("user", JSON.stringify(current.user));
          if (current.shop) setAuthValue("shop", JSON.stringify(current.shop));
          else removeAuthValue("shop");
          void activateCurrentDeviceSafely();
          setIsLoading(false);
          return;
        }
      } catch (error) {
        if (isTemporaryAuthCheckFailure(error)) {
          if (!storedUser && !isStale()) setIsLoading(false);
          return;
        }
        if (!isFinalAuthFailure(error)) {
          if (!storedUser && !isStale()) setIsLoading(false);
          return;
        }
      }

      if (!refreshToken) {
        if (!isStale() && !storedUser) {
          clearAuthStorage();
          setAccessToken(null);
          setUser(null);
          setShop(null);
          setIsLoading(false);
        }
        return;
      }

      try {
        const refreshed = await refreshAccessToken(refreshToken);
        if (isStale()) return;
        const next = persistAuth(refreshed);
        setAccessToken(next.token);
        setUser(next.user);
        setShop(next.shop);
        void activateCurrentDeviceSafely();
      } catch (error) {
        if (!isStale() && isFinalAuthFailure(error)) {
          clearAuthStorage();
          setAccessToken(null);
          setUser(null);
          setShop(null);
        }
      } finally {
        if (!isStale()) setIsLoading(false);
      }
    }

    window.setTimeout(() => void verifyInBackground(), 0);

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handleSessionExpired = () => {
      authGenerationRef.current += 1;
      clearAuthStorage();
      setAccessToken(null);
      setUser(null);
      setShop(null);
      setIsLoading(false);
      setLocation("/login");
    };
    window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, handleSessionExpired);
    return () => window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, handleSessionExpired);
  }, [setLocation]);

  const login = (token: string | undefined | null, refresh: string | undefined | null, userData: User, shopData?: Shop | null) => {
    if (!token || !refresh) throw new Error("Login response missing token or refresh token");
    authGenerationRef.current += 1;
    setAuthValue("accessToken", token);
    setAuthValue("refreshToken", refresh);
    setAuthValue("user", JSON.stringify(userData));
    if (shopData) setAuthValue("shop", JSON.stringify(shopData));
    else removeAuthValue("shop");
    setAccessToken(token);
    setUser(userData);
    setShop(shopData ?? null);
    setIsLoading(false);
    void activateCurrentDeviceSafely();
    void writeAuditLog({
      action: "staff_login",
      entityType: "staff",
      entityId: userData.id ?? userData.email ?? "current-user",
      entityLabel: userData.name ?? userData.email ?? "Current user",
      userId: userData.id ?? null,
      userName: userData.name ?? userData.email ?? null,
      newValue: { role: userData.role ?? "owner", shopId: shopData?.id ?? null },
      summary: `${userData.name ?? userData.email ?? "User"} logged in`,
    }).catch(() => undefined);
  };

  const logout = async () => {
    try {
      await logoutSession();
    } catch {
      // Continue with local logout even when network is unavailable.
    }
    authGenerationRef.current += 1;
    clearAuthStorage();
    setAccessToken(null);
    setUser(null);
    setShop(null);
    setLocation("/login");
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        shop,
        accessToken,
        isLoading,
        login,
        logout,
        isAuthenticated: !!accessToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}

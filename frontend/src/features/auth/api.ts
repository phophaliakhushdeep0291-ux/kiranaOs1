import { apiRequest, getStoredRefreshToken, ApiClientError } from "@/lib/api/http";
import type { AuthResponse, Shop, User } from "@/types/api";

export interface LoginRequest {
  mobile: string;
  password: string;
  shopId?: string;
}

export type RegisterRequest = Record<string, unknown>;

export interface SetOwnerPinRequest {
  pin: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export function login(data: LoginRequest) {
  return apiRequest<AuthResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify(data),
    skipAuth: true,
    skipRefresh: true,
  });
}

export function register(data: RegisterRequest) {
  return apiRequest<AuthResponse>("/auth/register", {
    method: "POST",
    body: JSON.stringify(data),
    skipAuth: true,
    skipRefresh: true,
  });
}

export function refreshAccessToken(refreshToken = getStoredRefreshToken()) {
  if (!refreshToken) throw new ApiClientError("Refresh token missing", 401);
  return apiRequest<AuthResponse>("/auth/refresh", {
    method: "POST",
    body: JSON.stringify({ refreshToken }),
    skipAuth: true,
    skipRefresh: true,
  });
}

export function logoutSession(refreshToken = getStoredRefreshToken()) {
  if (!refreshToken) return Promise.resolve({ success: true });
  return apiRequest<{ success: boolean; message?: string }>("/auth/logout", {
    method: "POST",
    body: JSON.stringify({ refreshToken }),
    skipAuth: true,
    skipRefresh: true,
  });
}

export function getMe() {
  return apiRequest<{ user: User; shop?: Shop }>("/auth/me");
}

export function setOwnerPin(pin: string) {
  return apiRequest<{ success: boolean; message?: string }>("/auth/pin/set", {
    method: "POST",
    body: JSON.stringify({ pin } satisfies SetOwnerPinRequest),
  });
}

export function changePassword(data: ChangePasswordRequest) {
  return apiRequest<{ success?: boolean; message?: string }>("/auth/change-password", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

import { apiRequest, getStoredRefreshToken, refreshStoredAuthSession } from "@/lib/api/http";
import type { AuthResponse, Shop, User } from "@/types/api";
import { getDeviceMetadata, hydrateDeviceIdentity } from "@/lib/device-identity";

export interface LoginRequest {
  mobile?: string;
  email?: string;
  identifier?: string;
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

export interface ForgotPasswordRequest {
  identifier: string;
  shopId?: string;
}

export interface ResetPasswordRequest {
  token: string;
  newPassword: string;
}

export interface VerifyEmailRequest {
  token: string;
}

export async function login(data: LoginRequest) {
  await hydrateDeviceIdentity();
  return apiRequest<AuthResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ ...data, device: getDeviceMetadata() }),
    skipAuth: true,
    skipRefresh: true,
  });
}

export interface GoogleLoginRequest {
  /** GIS ID token from the "Continue with Google" button. */
  credential: string;
  shopId?: string;
}

export async function googleLogin(data: GoogleLoginRequest) {
  await hydrateDeviceIdentity();
  return apiRequest<AuthResponse>("/auth/google", {
    method: "POST",
    body: JSON.stringify({ ...data, device: getDeviceMetadata() }),
    skipAuth: true,
    skipRefresh: true,
  });
}

export async function register(data: RegisterRequest) {
  await hydrateDeviceIdentity();
  return apiRequest<AuthResponse>("/auth/register", {
    method: "POST",
    body: JSON.stringify({ ...data, device: getDeviceMetadata() }),
    skipAuth: true,
    skipRefresh: true,
  });
}

export function verifyEmail(data: VerifyEmailRequest) {
  return apiRequest<{ success?: boolean; message?: string }>("/auth/verify-email", {
    method: "POST",
    body: JSON.stringify(data),
    skipAuth: true,
    skipRefresh: true,
  });
}

export function resendVerification(data: ForgotPasswordRequest) {
  return apiRequest<{ success?: boolean; message?: string }>("/auth/resend-verification", {
    method: "POST",
    body: JSON.stringify(data),
    skipAuth: true,
    skipRefresh: true,
  });
}

export function forgotPassword(data: ForgotPasswordRequest) {
  return apiRequest<{ success?: boolean; message?: string }>("/auth/password/forgot", {
    method: "POST",
    body: JSON.stringify(data),
    skipAuth: true,
    skipRefresh: true,
  });
}

export function resetPassword(data: ResetPasswordRequest) {
  return apiRequest<{ success?: boolean; message?: string }>("/auth/password/reset", {
    method: "POST",
    body: JSON.stringify(data),
    skipAuth: true,
    skipRefresh: true,
  });
}

export function refreshAccessToken(refreshToken = getStoredRefreshToken()) {
  return refreshStoredAuthSession(refreshToken);
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

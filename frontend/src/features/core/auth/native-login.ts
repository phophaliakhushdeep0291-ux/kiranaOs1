import { apiRequest } from "@/lib/api/http";
import { getDeviceMetadata, hydrateDeviceIdentity } from "@/lib/device-identity";
import type { AuthResponse } from "@/types/api";

export const isNativeApp = Boolean(import.meta.env.VITE_NATIVE_APP);
export interface NativeLoginRequest { requestId: string; userCode: string; expiresAt: number; intervalMs: number }
export interface NativeLoginProof { requestId: string; verifier: string }
export interface NativeLoginInfo { deviceName: string; nonce: string; expiresAt: number }

export function nativeAuthRequest<T>(action: string, body: unknown, signal?: AbortSignal) {
  return apiRequest<T>(`/auth/native/${action}`, {
    method: "POST", body: JSON.stringify(body), skipAuth: true, skipRefresh: true, cache: "no-store", signal,
  });
}
export async function startNativeLogin(signal: AbortSignal) {
  await hydrateDeviceIdentity();
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const verifier = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const request = await nativeAuthRequest<NativeLoginRequest>("start", { verifier, device: getDeviceMetadata() }, signal);
  return { ...request, verifier };
}
export function nativeLoginUrl(requestId: string, site = import.meta.env.VITE_NATIVE_SITE_URL as string) {
  const url = new URL(site);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("Invalid native sign-in site");
  if (!/^[A-Za-z0-9_-]{43}$/.test(requestId)) throw new Error("Invalid sign-in request");
  url.pathname = "/native-sign-in";
  url.hash = requestId;
  return url.href;
}
export async function openNativeLoginBrowser(requestId: string) {
  const url = nativeLoginUrl(requestId);
  if (import.meta.env.VITE_NATIVE_APP === "mobile") {
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url });
  } else {
    // Electron's main process denies remote navigation and opens HTTPS URLs
    // through shell.openExternal. Google never runs in our embedded webview.
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
export async function closeNativeLoginBrowser() {
  if (import.meta.env.VITE_NATIVE_APP === "mobile") {
    const { Browser } = await import("@capacitor/browser");
    await Browser.close().catch(() => undefined);
  }
}
export function pollNativeLogin(proof: NativeLoginProof, signal: AbortSignal) {
  return nativeAuthRequest<{ status: "pending" } | { status: "complete"; auth: AuthResponse }>("poll", proof, signal);
}

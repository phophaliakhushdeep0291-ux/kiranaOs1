import { apiRequest, getStoredAccessToken } from "@/lib/api/http";
import { collectDeviceContext } from "./collectDeviceContext";
import { getRecentApiRequests, getRecentBreadcrumbs, getRecentErrors } from "./telemetryBuffer";

export interface ClientErrorReport {
  message: string;
  stack?: string;
  errorCode?: string;
  fileName?: string;
  lineNumber?: number;
  functionName?: string;
}

/**
 * reportErrorToBackend — forward a captured client error to our own store.
 * Best-effort and silent: diagnostics must never surface as a user-facing
 * failure, and we skip entirely when unauthenticated (there is no shop/tenant to
 * attach the error to, and the ingest endpoint requires auth).
 */
export async function reportErrorToBackend(input: ClientErrorReport): Promise<void> {
  try {
    if (!getStoredAccessToken()) return;
    const ctx = collectDeviceContext();
    await apiRequest("/diagnostics/errors", {
      method: "POST",
      skipRefresh: true,
      background: true,
      body: JSON.stringify({
        message: input.message,
        stack: input.stack,
        errorCode: input.errorCode,
        fileName: input.fileName,
        lineNumber: input.lineNumber,
        functionName: input.functionName,
        appVersion: ctx.appVersion,
        os: ctx.os,
        browser: ctx.browser,
        networkStatus: ctx.networkStatus,
        onlineMode: ctx.onlineMode,
        memoryUsageMb: ctx.memoryUsageMb,
        route: ctx.route,
      }),
    });
  } catch {
    // Never let diagnostics reporting break the app.
  }
}

export interface SupportRequestBundle {
  device: ReturnType<typeof collectDeviceContext>;
  recentApiRequests: ReturnType<typeof getRecentApiRequests>;
  recentErrors: ReturnType<typeof getRecentErrors>;
  breadcrumbs: ReturnType<typeof getRecentBreadcrumbs>;
}

/** Assemble the auto-collected context bundle sent with a support request. */
export function buildSupportContext(): SupportRequestBundle {
  return {
    device: collectDeviceContext(),
    recentApiRequests: getRecentApiRequests(),
    recentErrors: getRecentErrors(),
    breadcrumbs: getRecentBreadcrumbs(),
  };
}

export interface SubmitSupportInput {
  description: string;
  screenshot?: string;
}

export interface SupportRequestResult {
  id: string;
  status: string;
  createdAt: string;
}

/**
 * submitSupportRequest — send the user's short description plus the auto-collected
 * context bundle. Unlike error reporting this DOES throw on failure so the dialog
 * can tell the user their report was not sent.
 */
export async function submitSupportRequest(input: SubmitSupportInput): Promise<SupportRequestResult> {
  const context = buildSupportContext();
  return apiRequest<SupportRequestResult>("/diagnostics/support-requests", {
    method: "POST",
    body: JSON.stringify({
      description: input.description,
      page: context.device.route,
      appVersion: context.device.appVersion,
      context,
      screenshot: input.screenshot,
    }),
  });
}

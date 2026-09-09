import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import { describe, expect, it, vi } from "vitest";
import { syncEn } from "@/features/core/settings/translations/sync";
const state = vi.hoisted(() => ({ status: { queueStatus: "error", pendingCount: 0, failedCount: 0, conflictCount: 0, isSyncing: false } }));
vi.mock("@/features/core/settings/i18n", () => ({ useAppLanguage: () => ({ t: (key: keyof typeof syncEn) => syncEn[key] }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/features/core/sync/useOfflineStatus", () => ({ useOfflineStatus: () => state.status }));
vi.mock("@/features/core/sync/manual-sync", () => ({ runManualSyncCycle: vi.fn() }));
import { LocalDataUnavailable } from "@/features/core/sync/LocalDataUnavailable";
import { SyncAlertBanner } from "@/features/core/sync/SyncAlertBanner";

describe("local read failure recovery surface", () => {
  it("renders a visible alert with retry and recovery, not zero totals or a synced label", () => {
    const html = renderToStaticMarkup(createElement(Router, { ssrPath: "/dashboard" }, createElement(LocalDataUnavailable, { onRetry: () => undefined })));
    expect(html).toContain('role="alert"');
    expect(html).toContain("Cannot verify local data");
    expect(html).toContain("Retry local check");
    expect(html).toContain('href="/recovery-mode"');
    expect(html).not.toContain("Synced");
    expect(html).not.toContain("₹0");
  });
  it("does not announce healthy or recovery failure before the initial check completes", () => {
    const html = renderToStaticMarkup(createElement(Router, { ssrPath: "/dashboard" }, createElement(LocalDataUnavailable, { checking: true, onRetry: () => undefined })));
    expect(html).toContain('role="status"');
    expect(html).toContain("Checking local data");
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("Cannot verify local data");
  });
  it("renders the global database failure alert even when last-known counts are all zero", () => {
    state.status.queueStatus = "error";
    const html = renderToStaticMarkup(createElement(Router, { ssrPath: "/dashboard" }, createElement(SyncAlertBanner)));
    expect(html).toContain('role="alert"');
    expect(html).toContain("Cannot verify local data");
    expect(html).toContain('href="/recovery-mode"');
  });
  it("removes the failure alert only after a verified empty queue read", () => {
    state.status.queueStatus = "ready";
    const html = renderToStaticMarkup(createElement(Router, { ssrPath: "/dashboard" }, createElement(SyncAlertBanner)));
    expect(html).toBe("");
  });
});

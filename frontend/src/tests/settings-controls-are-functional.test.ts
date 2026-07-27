import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_SECURITY_POLICY,
  PROTECTED_ACTIONS,
  actionApprover,
  approverRoles,
  isActionProtected,
  isServerEnforced,
  sessionTimeoutMs,
  setSecurityPolicyCache,
} from "@/features/settings/security-policy";
import {
  DEFAULT_APP_PREFERENCES,
  applyAppPreferences,
  autoCleanupEnabled,
  defaultPaymentMode,
  formatPreferredDate,
  getAppPreferences,
  keyboardShortcutsEnabled,
  playCounterBeep,
} from "@/features/settings/app-preferences";
import { appVersion, formatBytes } from "@/features/settings/app-info";

/**
 * These settings used to persist and do nothing. The assertions below pin the
 * behaviour each control now drives, so a future refactor cannot quietly turn
 * one back into decoration.
 */
describe("security policy drives real behaviour", () => {
  beforeEach(() => {
    setSecurityPolicyCache(DEFAULT_SECURITY_POLICY);
  });

  it("maps every session-timeout label to a real idle window", () => {
    setSecurityPolicyCache({ ...DEFAULT_SECURITY_POLICY, sessionTimeout: "5 minutes" });
    expect(sessionTimeoutMs()).toBe(5 * 60_000);
    setSecurityPolicyCache({ ...DEFAULT_SECURITY_POLICY, sessionTimeout: "1 hour" });
    expect(sessionTimeoutMs()).toBe(60 * 60_000);
  });

  it("treats an unknown timeout label as no timeout instead of locking instantly", () => {
    setSecurityPolicyCache({ ...DEFAULT_SECURITY_POLICY, sessionTimeout: "banana" });
    expect(sessionTimeoutMs()).toBe(0);
  });

  it("lets the counter turn off only the prompts the server does not require", () => {
    setSecurityPolicyCache({
      ...DEFAULT_SECURITY_POLICY,
      actions: {
        ...DEFAULT_SECURITY_POLICY.actions,
        largeDiscount: { on: false, approver: "owner" },
        cancelBill: { on: false, approver: "owner" },
      },
    });
    // Counter-side rule: switching it off really removes the prompt.
    expect(isActionProtected("largeDiscount")).toBe(false);
    // Server-enforced rule: the API rejects it without a PIN, so it stays on.
    expect(isServerEnforced("cancelBill")).toBe(true);
    expect(isActionProtected("cancelBill")).toBe(true);
  });

  it("exposes who may approve each action", () => {
    setSecurityPolicyCache({
      ...DEFAULT_SECURITY_POLICY,
      actions: { ...DEFAULT_SECURITY_POLICY.actions, exportData: { on: true, approver: "ownerManager" } },
    });
    expect(actionApprover("exportData")).toBe("ownerManager");
    expect(approverRoles("exportData")).toEqual(["owner", "admin"]);
    expect(approverRoles("deleteProduct")).toEqual(["owner"]);
  });

  it("keeps a rule for every row rendered in the settings table", () => {
    for (const action of PROTECTED_ACTIONS) {
      expect(DEFAULT_SECURITY_POLICY.actions[action.key]).toBeDefined();
    }
  });
});

describe("app preferences take effect", () => {
  beforeEach(() => {
    applyAppPreferences(DEFAULT_APP_PREFERENCES);
  });

  it("drives compact density from one document attribute", () => {
    // The suite runs without a DOM, so assert the contract the stylesheet keys
    // off rather than the rendered element.
    const source = readFileSync("src/features/settings/app-preferences.ts", "utf8");
    const css = readFileSync("src/index.css", "utf8");
    expect(source).toContain('document.documentElement.dataset.density = prefs.compactMode ? "compact" : "comfortable"');
    expect(css).toContain('html[data-density="compact"]');
  });

  it("gates keyboard shortcuts and background cleanup", () => {
    applyAppPreferences({ shortcuts: false, autoCleanup: false });
    expect(keyboardShortcutsEnabled()).toBe(false);
    expect(autoCleanupEnabled()).toBe(false);
  });

  it("formats dates in the chosen order", () => {
    const date = new Date(2026, 6, 27);
    applyAppPreferences({ dateFormat: "DD/MM/YYYY" });
    expect(formatPreferredDate(date)).toBe("27/07/2026");
    applyAppPreferences({ dateFormat: "MM/DD/YYYY" });
    expect(formatPreferredDate(date)).toBe("07/27/2026");
    applyAppPreferences({ dateFormat: "YYYY-MM-DD" });
    expect(formatPreferredDate(date)).toBe("2026-07-27");
  });

  it("maps the default payment label to the billing mode", () => {
    applyAppPreferences({ defaultPayment: "UPI" });
    expect(defaultPaymentMode()).toBe("upi");
    applyAppPreferences({ defaultPayment: "Split" });
    expect(defaultPaymentMode()).toBe("split");
    applyAppPreferences({ defaultPayment: "Cash" });
    expect(defaultPaymentMode()).toBe("cash");
  });

  it("keeps working when the browser has no usable storage", () => {
    // Private mode, a blocked origin, or SSR: the preference must still apply
    // for this session instead of throwing on the billing screen.
    expect(() => applyAppPreferences({ sound: false })).not.toThrow();
    expect(getAppPreferences().sound).toBe(false);
    expect(() => playCounterBeep("success")).not.toThrow();
  });
});

describe("diagnostics report real runtime facts", () => {
  it("formats byte counts instead of quoting a fixed size", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(null)).toBe("—");
  });

  it("derives the version from the injected build stamp", () => {
    expect(appVersion()).not.toBe("2.1.3");
    expect(appVersion().length).toBeGreaterThan(0);
  });
});

describe("settings pages no longer ship placeholder content", () => {
  it("does not hardcode devices, security logs or a version string", () => {
    const security = readFileSync("src/features/settings/pages/SecuritySettingsPage.tsx", "utf8");
    const advanced = readFileSync("src/features/settings/pages/AdvancedSettingsPage.tsx", "utf8");
    const general = readFileSync("src/features/settings/pages/SettingsPage.tsx", "utf8");

    // The old fixtures that showed on a brand-new shop.
    expect(security).not.toContain("POS Terminal 01");
    expect(security).not.toContain("Billing Tablet");
    expect(security).not.toContain("Owner PIN verified for bill cancellation");
    expect(advanced).not.toContain("Backups\", mb: 230");
    for (const source of [advanced, general]) expect(source).not.toContain("2.1.3");

    // ...replaced by live sources.
    expect(security).toContain("listDevices");
    expect(security).toContain("local_audit_logs");
    expect(security).toContain("checkOwnerPin");
    expect(advanced).toContain("measureStorage");
    expect(advanced).toContain("verifyOwnerPin");
    expect(general).toContain("appVersion()");
  });

  it("runs the danger-zone actions instead of only toasting", () => {
    const advanced = readFileSync("src/features/settings/pages/AdvancedSettingsPage.tsx", "utf8");
    expect(advanced).not.toContain("This action needs owner approval from the backend");
    expect(advanced).toContain("logoutDevice");
    expect(advanced).toContain("removeDevice");
  });

  it("never locks the counter when the PIN could not be checked", () => {
    const gate = readFileSync("src/features/settings/SessionLockGate.tsx", "utf8");
    // Offline-first is the product promise: the lock must not strand a shop.
    expect(gate).toContain("const canLock = hasPin === true && navigator.onLine");
    expect(gate).toContain("if (!navigator.onLine || hasPin !== true) return;");
    expect(gate).toContain("checkOwnerPin");
  });
});

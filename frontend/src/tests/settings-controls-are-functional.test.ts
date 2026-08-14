import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
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
} from "@/features/core/settings/security-policy";
import {
  DEFAULT_APP_PREFERENCES,
  applyAppPreferences,
  autoCleanupEnabled,
  defaultPaymentMode,
  formatPreferredDate,
  getAppPreferences,
  keyboardShortcutsEnabled,
  playCounterBeep,
} from "@/features/core/settings/app-preferences";
import { appVersion, formatBytes } from "@/features/core/settings/app-info";

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

  it("cannot turn off server-derived billing or destructive approval prompts", () => {
    setSecurityPolicyCache({
      ...DEFAULT_SECURITY_POLICY,
      actions: {
        ...DEFAULT_SECURITY_POLICY.actions,
        largeDiscount: { on: false, approver: "owner" },
        cancelBill: { on: false, approver: "owner" },
      },
    });
    // The API derives this from bill money/catalogue data, so stale settings
    // cannot disable the prompt or authorize a modified client.
    expect(isServerEnforced("largeDiscount")).toBe(true);
    expect(isServerEnforced("sellBelowMin")).toBe(true);
    expect(isActionProtected("largeDiscount")).toBe(true);
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
    const source = readFileSync("src/features/core/settings/app-preferences.ts", "utf8");
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

describe("accent picker repaints the app", () => {
  const css = readFileSync("src/index.css", "utf8");
  const theme = readFileSync("src/features/core/settings/theme.tsx", "utf8");
  // The accent map holds swatches only now: the labels moved to `accentLabel(t)`
  // so that `applyAccent`'s colour maths would not need a translator threaded
  // through it. The picker still offers one entry per swatch.
  const accents = [...theme.matchAll(/^ {2}(\w+): \{ swatch:/gm)].map((m) => m[1]);

  it("finds every swatch the picker offers", () => {
    expect(accents.length).toBeGreaterThanOrEqual(8);
    expect(accents).toContain("emerald");
  });

  it("ships a CSS block for every swatch", () => {
    // Emerald shipped without one, so the first swatch in the picker set
    // data-accent="emerald" and nothing in the stylesheet matched it.
    for (const accent of accents) {
      expect(css, `missing [data-accent="${accent}"] block`).toContain(`[data-accent="${accent}"] {`);
    }
  });

  it("redefines all five brand tokens on every accent", () => {
    for (const accent of accents) {
      const start = css.indexOf(`[data-accent="${accent}"] {`);
      const block = css.slice(start, css.indexOf("}", start));
      for (const token of ["--brand:", "--brand-strong:", "--brand-soft:", "--brand-softer:", "--brand-border:"]) {
        expect(block, `${accent} is missing ${token}`).toContain(token);
      }
    }
  });

  it("never silently rewrites a saved accent to blue", () => {
    expect(theme).not.toContain('saved === "emerald"');
    expect(theme).toContain("isAccent(saved) ? saved : \"blue\"");
  });

  it("keeps the literal brand hexes out of the app so themes can take effect", () => {
    // These were painted directly into ~550 class names, which is why switching
    // accent used to change almost nothing the shopkeeper could see.
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) { if (entry.name !== "node_modules") walk(full); continue; }
        if (!/\.tsx?$/.test(entry.name)) continue;
        if (full.replaceAll("\\", "/").endsWith("features/core/settings/theme.tsx")) continue; // the swatches themselves
        if (/#(075fff|005dff|2563eb|0047e8|0046d8)/i.test(readFileSync(full, "utf8"))) offenders.push(full);
      }
    };
    walk("src");
    expect(offenders, `hardcoded brand hex in:\n${offenders.join("\n")}`).toEqual([]);
  });
});

describe("settings pages no longer ship placeholder content", () => {
  it("does not hardcode devices, security logs or a version string", () => {
    const security = readFileSync("src/features/core/settings/pages/SecuritySettingsPage.tsx", "utf8");
    const advanced = readFileSync("src/features/core/settings/pages/AdvancedSettingsPage.tsx", "utf8");
    const general = readFileSync("src/features/core/settings/pages/SettingsPage.tsx", "utf8");

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
    const advanced = readFileSync("src/features/core/settings/pages/AdvancedSettingsPage.tsx", "utf8");
    expect(advanced).not.toContain("This action needs owner approval from the backend");
    expect(advanced).toContain("logoutDevice");
    expect(advanced).toContain("removeDevice");
  });

  it("never locks the counter when the PIN could not be checked", () => {
    const gate = readFileSync("src/features/core/settings/SessionLockGate.tsx", "utf8");
    // Offline-first is the product promise: the lock must not strand a shop.
    expect(gate).toContain("const canLock = hasPin === true && navigator.onLine");
    expect(gate).toContain("if (!navigator.onLine || hasPin !== true) return;");
    expect(gate).toContain("checkOwnerPin");
  });
});

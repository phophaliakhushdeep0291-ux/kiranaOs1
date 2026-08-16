import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { shellCrashCopy } from "@/components/shared/ShellErrorBoundary";

/**
 * The shell boundary is the difference between "one reload" and "the till is
 * dead until someone who knows React looks at it".
 *
 * Page-level boundaries already live inside AppRoutes. Nothing guarded the shell,
 * so a throw in a provider, the auth bootstrap, the sync bridge or the toaster
 * unmounted the root — blank page, and the sync timer torn down with it because
 * it is scheduled from a `useEffect`.
 */
const app = readFileSync("src/app/App.tsx", "utf8");
const boundary = readFileSync("src/components/shared/ShellErrorBoundary.tsx", "utf8");

describe("shell error boundary", () => {
  it("wraps the providers rather than sitting inside them", () => {
    // React unwinds to a boundary ABOVE whatever threw. Inside AppProviders it
    // would catch the routes it already has boundaries for, and miss every
    // provider — which is the layer that actually took the app down.
    const guard = app.indexOf("<ShellErrorBoundary>");
    const providers = app.indexOf("<AppProviders>");
    expect(guard).toBeGreaterThan(-1);
    expect(providers).toBeGreaterThan(guard);
  });

  it("depends on nothing that can be broken by the crash it is catching", () => {
    // A fallback that reads from a provider is worthless exactly when a provider
    // is what failed — that is the bug this whole boundary exists for.
    // Calls, not mentions — the file explains in prose why it avoids the hook.
    expect(boundary).not.toMatch(/useAppLanguage\s*\(/);
    expect(boundary).not.toMatch(/use(Query|Auth|Toast|Location|Context)\s*\(/);
    // Styling is inline because a stylesheet that never loaded is one of the ways
    // this screen is reached, and white text on a white page is still a blank app.
    expect(boundary).toContain("style={{");
    expect(boundary).not.toMatch(/className=/);
  });

  it("still routes a stale-deploy chunk failure to silent recovery", () => {
    expect(boundary).toContain("isChunkLoadError");
    expect(boundary).toContain("recoverFromStaleDeploy");
    // Transient by nature: recovering is the fix, a support ticket is not.
    const chunkBranch = boundary.slice(boundary.indexOf("isChunkLoadError(error.message)"));
    expect(chunkBranch.indexOf("return;")).toBeLessThan(chunkBranch.indexOf("reportClientError"));
  });

  it("speaks the shop's language on the one screen that matters most", () => {
    const en = shellCrashCopy("en");
    const hi = shellCrashCopy("hi");
    // The generic i18n guard cannot see this copy: it bypasses `t()` on purpose.
    // So the pairing is asserted here instead — a new string has to arrive in
    // both languages or this fails.
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(en[key], `${key} is empty in English`).toBeTruthy();
      expect(hi[key], `${key} is empty in Hindi`).toBeTruthy();
      expect(hi[key], `${key} was left in English`).not.toBe(en[key]);
      expect(hi[key], `${key} is not Devanagari`).toMatch(/[ऀ-ॿ]/);
    }
  });

  it("leads with the reassurance a shopkeeper actually needs", () => {
    // Mid-bill, the first question is not "what broke" but "did I lose the day".
    expect(shellCrashCopy("en").body).toMatch(/saved on this device|nothing has been lost/i);
    expect(shellCrashCopy("hi").body).toContain("सुरक्षित");
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { shellEn } from "@/features/core/settings/translations/shell";
import { shellHi } from "@/features/core/settings/translations/shell.hi";

const source = readFileSync("src/components/layout/Layout.tsx", "utf8");

describe("offline backend banner", () => {
  it("keeps localhost diagnostics in development and shows cashier-safe copy in production", () => {
    expect(source).toContain("const showLocalhostDiagnostic = import.meta.env.DEV");
    expect(source).toContain("showLocalhostDiagnostic ?");
    // The copy itself moved into the dictionary, because a Hindi counter was being
    // shown this banner in English. The rule it encodes is unchanged: the localhost
    // wording is developer information and must never be the production branch.
    expect(source).toContain('t("chrome.backendUnreachable.localhost")');
    expect(source).toContain('t("chrome.backendUnreachable.paused")');
    expect(shellEn["chrome.backendUnreachable.paused"]).toContain("Cloud backup is paused because the backend is not reachable");
    expect(shellEn["chrome.backendUnreachable.localhost"]).toContain("localhost");
  });

  it("gives the cashier-facing branch real Hindi, since that is the branch a shop sees", () => {
    expect(shellHi["chrome.backendUnreachable.paused"]).not.toBe(shellEn["chrome.backendUnreachable.paused"]);
    expect(shellHi["chrome.backendUnreachable.paused"]).toMatch(/[ऀ-ॿ]/);
  });
});

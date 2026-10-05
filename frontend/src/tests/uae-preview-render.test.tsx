import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { settingsPagesEn } from "@/features/core/settings/translations/settings-pages";
import { marketPreviewEn } from "@/features/core/settings/translations/market-preview";
import { marketPreviewHi } from "@/features/core/settings/translations/market-preview.hi";

vi.mock("@/features/core/settings/i18n", () => ({ useAppLanguage: () => ({ language: "en", t: (key: string) => ({ ...settingsPagesEn, ...marketPreviewEn } as Record<string, string>)[key] ?? key }) }));
import UaePilotPage from "@/features/core/settings/pages/UaePilotPage";

describe("UAE preview screen", () => {
  it("renders readable AED amounts with an explicit preview boundary", () => {
    const html = renderToStaticMarkup(<Router ssrPath="/settings/uae-pilot"><UaePilotPage /></Router>).replace(/\u00a0/g, " ");
    expect(html).toContain("Preview only — no sales or payments are recorded.");
    expect(html).toContain("AED 100.00");
    expect(html).toContain("AED 5.00");
    expect(html).toContain("AED 105.00");
    expect(html).toContain('for="uae-price"');
    expect(html).toContain('id="uae-price"');
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain("CGST + SGST");
    expect(html).not.toContain("settings.market.");
  });

  it("loads the online preview dictionary with its route and has complete Hindi copy", () => {
    const routes = readFileSync(new URL("../app/routes.tsx", import.meta.url), "utf8");
    expect(routes).toContain('lazy(cloudPage(() => import("@/features/core/settings/pages/UaePilotPage")))');
    expect(routes).toContain('<ProtectedRoute component={UaePilotSettings} onlineOnly />');
    expect(Object.keys(marketPreviewHi).sort()).toEqual(Object.keys(marketPreviewEn).sort());
    for (const text of Object.values(marketPreviewHi)) expect(text.trim()).not.toBe("");
  });
});

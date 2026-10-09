import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { tallyEn } from "@/features/core/settings/translations/tally";
import { settingsPagesEn } from "@/features/core/settings/translations/settings-pages";
vi.mock("@/features/core/settings/i18n", () => ({ useAppLanguage: () => ({ t: (key: string) => ({ ...tallyEn, ...settingsPagesEn } as Record<string, string>)[key] ?? key }) }));
vi.mock("@/features/core/reports/DataExportProvider", () => ({ useDataExport: () => vi.fn() }));
vi.mock("@/lib/offline/context", () => ({ getOfflineScope: () => ({ tenant_id: "test-shop" }) }));
import { TallyConnectionCard } from "@/features/core/settings/TallyConnectionCard";
describe("Tally connection screen", () => {
  it("renders setup and visible action labels without claiming an unchecked connection", () => {
    const html = renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><TallyConnectionCard enabled /></QueryClientProvider>);
    expect(html).toContain("Connect TallyPrime");
    expect(html).toContain("Check Tally connection");
    expect(html).toContain("Connection check needed");
    expect(html).toContain("Preview unsent vouchers");
    expect(html).toContain("Prepare XML files");
    expect(html).toContain("6-character");
    expect(html).toContain("Client/Server Configuration");
    expect(html).not.toContain(">tally.");
    expect(html).not.toContain("Connection checked");
  });
});

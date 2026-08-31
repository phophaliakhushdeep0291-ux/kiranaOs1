import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const routes = readFileSync(new URL("../app/routes.tsx", import.meta.url), "utf8");
const viteConfig = readFileSync(new URL("../../vite.config.ts", import.meta.url), "utf8");
const criticalEntries = viteConfig.match(/const criticalEntries = \[([\s\S]*?)\n\s*\];/)?.[1] ?? "";

describe("offline route capability contract", () => {
  it("keeps an offline operator on cloud-managed routes with an explicit explanation", () => {
    expect(routes).toContain('data-testid="internet-required-route"');
    expect(routes).toContain('t("chrome.route.internetRequired")');
    expect(routes).toContain('setLocation("/sync-status")');
    expect(routes).toContain("onlineOnly && !routeConnection");
    expect(routes).toContain('window.addEventListener("kirana:backend-status-changed"');
    expect(routes).toContain("snapshot.browserOnline && snapshot.backendReachable");
  });

  it("labels sensitive cloud-only routes instead of mounting their network loaders offline", () => {
    for (const page of [
      "Loyalty", "GiftCards", "ChannelSettlements", "NotificationsSettings",
      "IntegrationsSettings", "PlansPage", "SubscriptionPage", "DevicesPage",
      "PlatformAdminPage", "RemoteSupportConsolePage", "AskArthaPage",
      "ActivityInsightsPage", "AssuranceDashboardPage", "AssuranceFindingDetailPage",
    ]) {
      expect(routes).toMatch(new RegExp(`ProtectedRoute component=\\{${page}\\}[^>]*onlineOnly`));
    }
  });

  it("does not precache cloud-only page chunks that the offline route guard never mounts", () => {
    for (const page of [
      "LoyaltyPage.tsx", "GiftCardsPage.tsx", "ChannelSettlementsPage.tsx",
      "DevicesSettingsPage.tsx", "NotificationsSettingsPage.tsx",
      "IntegrationsSettingsPage.tsx", "PlansPage.tsx", "SubscriptionPage.tsx",
      "DevicesPage.tsx", "PlatformAdminPage.tsx", "RemoteSupportConsolePage.tsx",
      "AskArthaPage.tsx", "ActivityInsightsPage.tsx", "AssuranceDashboardPage.tsx",
      "FindingsPage.tsx", "FindingDetailPage.tsx", "EvidenceRequestsPage.tsx",
      "AuditRunsPage.tsx", "AuditRulesPage.tsx", "ReviewQueuePage.tsx",
      "AssuranceReportPage.tsx", "CasesPage.tsx",
    ]) {
      expect(criticalEntries).not.toContain(page);
    }
  });

  it("does not classify local counter work as internet-only", () => {
    for (const page of ["Billing", "Products", "Customers", "CustomerDetailPage", "Inventory", "BillsPage", "PurchaseBillsPage", "Suppliers", "Expenses", "Reports", "DailyClosingPage", "RecycleBinPage", "RecoveryModePage"]) {
      expect(routes).not.toMatch(new RegExp(`ProtectedRoute component=\\{${page}\\}[^>]*onlineOnly`));
    }
  });
});

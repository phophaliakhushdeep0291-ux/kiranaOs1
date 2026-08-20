import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const routes = readFileSync(new URL("../app/routes.tsx", import.meta.url), "utf8");

describe("offline route capability contract", () => {
  it("keeps an offline operator on cloud-managed routes with an explicit explanation", () => {
    expect(routes).toContain('data-testid="internet-required-route"');
    expect(routes).toContain('t("chrome.route.internetRequired")');
    expect(routes).toContain('setLocation("/sync-status")');
    expect(routes).toContain("onlineOnly && !browserOnline");
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

  it("does not classify local counter work as internet-only", () => {
    for (const page of ["Billing", "Products", "Customers", "CustomerDetailPage", "Inventory", "BillsPage", "PurchaseBillsPage", "Suppliers", "Expenses", "Reports", "DailyClosingPage", "RecycleBinPage", "RecoveryModePage"]) {
      expect(routes).not.toMatch(new RegExp(`ProtectedRoute component=\\{${page}\\}[^>]*onlineOnly`));
    }
  });
});

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { restaurantEn } from "@/features/core/settings/translations/restaurant";
import { RestaurantMarketplaceConnectionsCard } from "@/features/core/settings/RestaurantMarketplaceConnectionsCard";

const mocks = vi.hoisted(() => ({
  auth: { user: { role: "owner" }, shop: { id: "shop-1" } },
  profile: { data: { shop: { id: "shop-1", businessType: "restaurant" } } },
  query: { isLoading: false, isError: false, data: undefined as unknown, refetch: vi.fn() },
  useQuery: vi.fn(),
}));
vi.mock("@/features/core/auth/useAuth", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/features/core/settings/business-profile-bootstrap", () => ({ useShopBusinessProfile: () => mocks.profile }));
vi.mock("@tanstack/react-query", () => ({ useQuery: (options: unknown) => { mocks.useQuery(options); return mocks.query; }, useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/features/core/settings/i18n", () => ({ useAppLanguage: () => ({ t: (key: string) => restaurantEn[key as keyof typeof restaurantEn] ?? key }) }));

const render = () => renderToStaticMarkup(<RestaurantMarketplaceConnectionsCard />);
describe("restaurant marketplace onboarding", () => {
  beforeEach(() => {
    mocks.auth.user.role = "owner";
    mocks.profile.data.shop.businessType = "restaurant";
    mocks.query.isLoading = false; mocks.query.isError = false;
    mocks.query.data = { providers: [{ id: "zomato", name: "Zomato", implemented: false, docsUrl: "https://www.zomato.com/developer/integration/docs/getting-started/forms/" }, { id: "swiggy", name: "Swiggy", implemented: false, docsUrl: "https://partner.swiggy.com/" }], connections: [], locations: [{ id: "branch-1", name: "Main restaurant", code: "MAIN" }], inboxEnabled: false, liveOrdersSupported: false };
    mocks.useQuery.mockClear();
  });

  it("renders real provider names with explicit unavailable messaging", () => {
    const html = render();
    expect(html).toContain("Zomato"); expect(html).toContain("Swiggy");
    expect(html.match(/Not connected/g)).toHaveLength(2);
    expect(html).toContain("Live marketplace ordering is not available yet");
    expect(html).toContain("Save outlet details");
    expect(html).not.toContain("Connect now");
    expect(mocks.useQuery.mock.calls[0][0]).toMatchObject({ enabled: true, queryKey: ["restaurant-marketplaces", "shop-1"] });
  });

  it("does not show or request the owner setup for staff or other shop types", () => {
    mocks.auth.user.role = "cashier";
    expect(render()).toBe("");
    expect(mocks.useQuery.mock.lastCall?.[0].enabled).toBe(false);
    mocks.auth.user.role = "owner"; mocks.profile.data.shop.businessType = "kirana";
    expect(render()).toBe("");
    expect(mocks.useQuery.mock.lastCall?.[0].enabled).toBe(false);
  });

  it("labels saved details as pending, never as a live connection", () => {
    (mocks.query.data as { connections: unknown[] }).connections = [{ id: "connection-1", provider: "zomato", locationId: "branch-1", externalOutletId: "OUTLET-123", environment: "live", status: "pending" }];
    const html = render();
    expect(html).toContain("Main restaurant"); expect(html).toContain("OUTLET-123");
    expect(html).toContain("partner verification pending");
    expect(html).toContain("Live outlet (not activated)");
    expect(html.match(/Not connected/g)).toHaveLength(2);
  });

  it("gives loading, retry and missing-branch feedback", () => {
    mocks.query.isLoading = true;
    expect(render()).toContain("Loading outlet setup");
    mocks.query.isLoading = false; mocks.query.isError = true;
    expect(render()).toContain("Could not load outlet setup"); expect(render()).toContain("Retry");
    mocks.query.isError = false;
    (mocks.query.data as { locations: unknown[] }).locations = [];
    expect(render()).toContain("Create an active store location");
  });

  it("uses owner approval and a narrow online setup payload, not a credential or enable form", () => {
    const source = readFileSync("src/features/core/settings/RestaurantMarketplaceConnectionsCard.tsx", "utf8");
    const routes = readFileSync("../backend/src/modules/integrations/restaurant-marketplace/routes.js", "utf8");
    expect(source).toContain("<OwnerPinModal"); expect(source).toContain('method: "PUT", ownerPin');
    expect(source).toContain("JSON.stringify({ locationId: pending.locationId, externalOutletId: pending.externalOutletId.trim(), environment: pending.environment })");
    expect(source).not.toContain("localStorage"); expect(source).not.toContain("keySecret");
    expect(routes).toContain('router.use(requireRole("owner"))');
    expect(routes).toContain('router.put("/:provider", requireOwnerPin, validate(marketplaceSetupSchema)');
  });
});

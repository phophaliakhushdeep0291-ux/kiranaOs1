import { describe, expect, it } from "vitest";
import fs from "node:fs";

describe("business profile offline routing", () => {
  it("persists the bootstrap per shop and falls back on recoverable failures", () => {
    const api = fs.readFileSync("src/features/core/settings/api.ts", "utf8");
    expect(api).toContain("SHOP_BOOTSTRAP_CACHE_PREFIX");
    expect(api).toContain("current.shop.id !== shopId");
    expect(api).toContain("cached && isRecoverableNetworkError(error)");
    expect(api).toContain("timeoutMs: 2_500");
    expect(api).toContain("SHOP_BOOTSTRAP_OFFLINE");
  });

  it("seeds the route gate synchronously and never waits for network when definitely offline", () => {
    const bootstrap = fs.readFileSync("src/features/core/settings/business-profile-bootstrap.ts", "utf8");
    const routes = fs.readFileSync("src/app/routes.tsx", "utf8");
    expect(bootstrap).toContain("initialData: () => readCachedShopBootstrap()");
    expect(routes).toContain("profile.isLoading && !definitelyOffline");
    expect(routes).toContain("if (!profile.data) return <>{children}</>");
  });
});

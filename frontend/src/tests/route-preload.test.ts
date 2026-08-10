import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = (relativePath: string) => readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

describe("high-frequency route preloading", () => {
  it("keeps Billing, Customers, and Udhar lazy while sharing their loaders with navigation warm-up", () => {
    const preload = source("../app/route-preload.ts");
    const routes = source("../app/routes.tsx");

    for (const name of ["loadBillingRoute", "loadCustomersRoute", "loadUdharRoute"]) {
      expect(routes).toContain(`lazy(${name})`);
      expect(preload).toContain(`export const ${name}`);
    }
    expect(preload).toContain("requestIdleCallback");
    expect(preload).toContain("pending.get(key)");
  });

  it("warms customer routes after dashboard idle and before pointer, focus, or touch navigation", () => {
    const layout = source("../components/layout/Layout.tsx");
    const mobile = source("../components/layout/MobileAppChrome.tsx");

    expect(layout).toContain('scheduleCoreRoutePreload("/customers"');
    expect(layout).toContain('scheduleCoreRoutePreload("/udhar"');
    for (const event of ["onMouseEnter", "onFocus", "onTouchStart"]) {
      expect(layout).toContain(event);
      expect(mobile).toContain(event);
    }
  });
});

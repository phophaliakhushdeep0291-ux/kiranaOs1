import { describe, expect, it } from "vitest";
import { BUSINESS_TYPE_IDS, DORMANT_VERTICALS_ENABLED, offeredBusinessTypes } from "@/features/core/settings/business-types";
import { packForBusinessType } from "@/features/verticals/registry";

describe("dormant vertical release flag", () => {
  it("offers only kirana and custom by default, or the full catalog when enabled", () => {
    expect(offeredBusinessTypes()).toEqual(
      DORMANT_VERTICALS_ENABLED ? BUSINESS_TYPE_IDS : ["kirana", "other"],
    );
  });

  it("continues to resolve an existing restaurant shop while it is hidden", () => {
    const restaurant = packForBusinessType("restaurant");
    expect(restaurant.routes.map((route) => route.path)).toContain("/tables");
    expect(restaurant.nav.map((entry) => entry.href)).toContain("/kitchen");
    expect(restaurant.capabilities).toContain("KOT");
    expect(restaurant.capabilities).toContain("TABLE_MANAGEMENT");
  });
});
